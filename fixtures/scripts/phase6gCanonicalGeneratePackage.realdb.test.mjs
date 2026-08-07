/*
  Phase 6G - real local Supabase DB E2E for the 3 new "system" RPCs
  (system_create_canonical_overlay, complete_canonical_generation,
  mark_canonical_fallback) added by
  supabase/migrations/20260807000000_canonical_generate_package_integration.sql.

  Follows the naming/pattern convention of the existing
  fixtures/scripts/rpcTransactionIdempotency.realdb.test.mjs (same URL/
  anon key, same makeTestUser/check helpers), with one deliberate
  departure: `service_role` has NO direct table GRANT on ANY
  career_memory/applications table in this schema (confirmed via
  information_schema.role_table_grants - only TRUNCATE/REFERENCES/
  TRIGGER, no SELECT/INSERT/UPDATE/DELETE) - only RPC EXECUTE grants.
  So:
  - Fixture seeding (career_profiles/career_resume_versions/applications)
    happens via each test user's OWN authenticated client (RLS-scoped
    INSERT policies already allow this).
  - RLS-boundary assertions ("user B cannot see user A's row") use the
    relevant user's own authenticated client directly - that IS the
    real-world enforcement path.
  - Admin-level cross-user verification (row counts spanning users,
    reading a row nobody's own session could legitimately read back)
    uses a raw `psql` query as the Postgres superuser via
    `docker exec supabase_db_careerelan psql`, bypassing RLS entirely -
    the same authority level a real DBA/admin script would have, and
    the only way to observe ground truth independent of any one
    session's own RLS view.
  - The 3 new RPCs themselves are called via the admin (service-role)
    client, matching their actual production caller
    (generateCore.ts's background worker) and their EXECUTE grant.

  Run: node fixtures/scripts/phase6gCanonicalGeneratePackage.realdb.test.mjs
  Requires local Supabase running (docker ps | grep supabase_db).
  Cleans up only the synthetic users this run itself created (their
  rows cascade-delete via applications/career_profiles' own
  `references auth.users(id) on delete cascade`).
*/
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";

const URL = "http://127.0.0.1:54321";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const PG_CONTAINER = "supabase_db_careerelan";

let pass = 0;
let fail = 0;
/*
  Stable stringify (recursively sorts object keys) - the RPCs return
  jsonb_build_object(...) results whose key order is not a contract
  either the RPC or this test should depend on; a plain
  JSON.stringify(actual) === JSON.stringify(expected) comparison is
  falsely key-order-sensitive.
*/
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function check(label, actual, expected) {
  const ok = stableStringify(actual) === stableStringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label, actual) {
  check(label, actual, true);
}

/*
  Raw superuser SQL escape hatch - ONLY for read-side ground-truth
  verification after an RPC call, never used to perform the actual
  writes under test (those all go through the real RPCs, exactly as
  production does). Returns parsed JSON: every query below is written
  as `select row_to_json(t) from (...) t` (single row) or
  `select json_agg(t) from (...) t` (multi-row), so the shell round-trip
  stays a single well-typed JSON value with no fragile string parsing.
*/
function pgJson(sql) {
  const out = execFileSync("docker", ["exec", PG_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", sql], { encoding: "utf8" }).trim();
  if (out === "" || out === "null") return null;
  return JSON.parse(out);
}
function pgCount(tableSql, whereSql) {
  const out = execFileSync("docker", ["exec", PG_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", `select count(*) from ${tableSql} where ${whereSql};`], { encoding: "utf8" }).trim();
  return parseInt(out, 10);
}

const createdUserIds = [];

async function makeTestUser(admin, emailPrefix) {
  const email = `phase6g-${emailPrefix}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6g-realdb-test-password-123";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  const client = createClient(URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client };
}

async function seedCanonicalFixture(client, userId) {
  const { data: profile, error: profileError } = await client.from("career_profiles").insert({ user_id: userId, schema_version: "v1", serializer_version: "s1" }).select("*").single();
  if (profileError) throw profileError;
  const { data: version, error: versionError } = await client
    .from("career_resume_versions")
    .insert({ profile_id: profile.id, reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" })
    .select("*")
    .single();
  if (versionError) throw versionError;
  const { data: application, error: applicationError } = await client.from("applications").insert({ user_id: userId }).select("*").single();
  if (applicationError) throw applicationError;
  return { profile, version, application };
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);

  // ==================== 1. system_create_canonical_overlay: success path ====================
  let userA, fixtureA, overlayIdA;
  {
    userA = await makeTestUser(admin, "overlay-owner");
    fixtureA = await seedCanonicalFixture(userA.client, userA.userId);

    const { data, error } = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userA.userId,
      p_profile_id: fixtureA.profile.id,
      p_resume_version_id: fixtureA.version.id,
      p_application_id: fixtureA.application.id,
      p_template_id: "professional-ats",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0", professionalSummaryText: "Test summary" },
    });
    check("overlay success: no error", error, null);
    check("overlay success: status success", data?.status, "success");
    checkTrue("overlay success: overlayId is a real uuid string", typeof data?.overlayId === "string" && data.overlayId.length > 0);
    overlayIdA = data?.overlayId;

    const row = pgJson(`select row_to_json(t) from (select profile_id, application_id, template_id, overlay from career_tailored_resumes where id = '${overlayIdA}') t;`);
    check("overlay success: persisted row's profile_id matches", row?.profile_id, fixtureA.profile.id);
    check("overlay success: persisted row's application_id matches", row?.application_id, fixtureA.application.id);
    check("overlay success: persisted row's template_id matches", row?.template_id, "professional-ats");
    check("overlay success: persisted overlay JSON round-trips exactly", row?.overlay, { schemaVersion: "1.0.0", professionalSummaryText: "Test summary" });
  }

  // ==================== 2. system_create_canonical_overlay: ownership rejections ====================
  {
    const userB = await makeTestUser(admin, "overlay-attacker");
    const fixtureB = await seedCanonicalFixture(userB.client, userB.userId);

    const crossProfile = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userB.userId,
      p_profile_id: fixtureA.profile.id, // user A's profile, but claiming to be user B
      p_resume_version_id: fixtureA.version.id,
      p_application_id: null,
      p_template_id: "professional-ats",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    check("overlay cross-user profile attack: rejected as not_found (never leaks whether the profile exists)", crossProfile.data?.status, "not_found");
    check("overlay cross-user profile attack: reason is profile", crossProfile.data?.reason, "profile");

    const crossVersion = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userB.userId,
      p_profile_id: fixtureB.profile.id,
      p_resume_version_id: fixtureA.version.id, // belongs to a different profile entirely
      p_application_id: null,
      p_template_id: "professional-ats",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    check("overlay cross-profile version attack: rejected as not_found/resume_version", crossVersion.data, { status: "not_found", reason: "resume_version" });

    const crossApplication = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userB.userId,
      p_profile_id: fixtureB.profile.id,
      p_resume_version_id: fixtureB.version.id,
      p_application_id: fixtureA.application.id, // belongs to user A
      p_template_id: "professional-ats",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    check("overlay cross-user application attack: rejected as not_found/application", crossApplication.data, { status: "not_found", reason: "application" });

    const nullUser = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: null,
      p_profile_id: fixtureA.profile.id,
      p_resume_version_id: fixtureA.version.id,
      p_application_id: null,
      p_template_id: "professional-ats",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    checkTrue("overlay p_user_id=null: RPC itself raises an error (AUTHENTICATION_REQUIRED), never silently proceeds", nullUser.error !== null);

    // RLS: authenticated (non-service-role) callers cannot invoke this RPC at all.
    const rlsAttempt = await userA.client.rpc("system_create_canonical_overlay", {
      p_user_id: userA.userId,
      p_profile_id: fixtureA.profile.id,
      p_resume_version_id: fixtureA.version.id,
      p_application_id: null,
      p_template_id: "professional-ats",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    checkTrue("overlay: authenticated (non-service-role) client is REJECTED - EXECUTE only granted to service_role", rlsAttempt.error !== null);

    // RLS: user B cannot SELECT user A's tailored resume row directly.
    const { data: crossSelect } = await userB.client.from("career_tailored_resumes").select("*").eq("id", overlayIdA);
    check("RLS: user B cannot see user A's tailored-resume row via direct select", (crossSelect ?? []).length, 0);
    const { data: ownSelect } = await userA.client.from("career_tailored_resumes").select("*").eq("id", overlayIdA);
    check("RLS: user A CAN see their own tailored-resume row via direct select", (ownSelect ?? []).length, 1);
  }

  // ==================== 3. complete_canonical_generation: success + idempotent replay ====================
  {
    const first = await admin.rpc("complete_canonical_generation", {
      p_user_id: userA.userId,
      p_application_id: fixtureA.application.id,
      p_tailored_resume_id: overlayIdA,
      p_canonical_profile_id: fixtureA.profile.id,
      p_canonical_resume_version_id: fixtureA.version.id,
      p_template_id: "professional-ats",
      p_pdf_storage_bucket: "generated-documents",
      p_pdf_storage_path: `${userA.userId}/${fixtureA.application.id}.pdf`,
      p_docx_storage_bucket: "generated-documents",
      p_docx_storage_path: `${userA.userId}/${fixtureA.application.id}.docx`,
      p_generation_engine: "canonical",
      p_generation_engine_version: "6G.0",
      p_protected_fact_validation_result: { pdfProtectedFactsUnchanged: true, docxProtectedFactsUnchanged: true },
    });
    check("complete success: no error", first.error, null);
    check("complete success: status success, not a replay", first.data, {
      status: "success",
      alreadyCompleted: false,
      pdfDocumentId: first.data?.pdfDocumentId,
      docxDocumentId: first.data?.docxDocumentId,
    });
    checkTrue("complete success: pdfDocumentId is a real uuid", typeof first.data?.pdfDocumentId === "string" && first.data.pdfDocumentId.length > 0);
    checkTrue("complete success: docxDocumentId is a real uuid, distinct from pdf", first.data?.docxDocumentId !== first.data?.pdfDocumentId);

    const appRow = pgJson(`select row_to_json(t) from (select canonical_profile_id, selected_template_id, generation_engine, generated_pdf_document_id, generated_docx_document_id from applications where id = '${fixtureA.application.id}') t;`);
    check("complete success: applications.canonical_profile_id set", appRow?.canonical_profile_id, fixtureA.profile.id);
    check("complete success: applications.selected_template_id set", appRow?.selected_template_id, "professional-ats");
    check("complete success: applications.generation_engine set", appRow?.generation_engine, "canonical");
    check("complete success: applications.generated_pdf_document_id set", appRow?.generated_pdf_document_id, first.data.pdfDocumentId);
    check("complete success: applications.generated_docx_document_id set", appRow?.generated_docx_document_id, first.data.docxDocumentId);

    check("complete success: exactly 2 document rows created (pdf+docx)", pgCount("generated_resume_documents", `tailored_resume_id = '${overlayIdA}'`), 2);

    // Idempotent replay - same call again must NOT create duplicate document rows.
    const replay = await admin.rpc("complete_canonical_generation", {
      p_user_id: userA.userId,
      p_application_id: fixtureA.application.id,
      p_tailored_resume_id: overlayIdA,
      p_canonical_profile_id: fixtureA.profile.id,
      p_canonical_resume_version_id: fixtureA.version.id,
      p_template_id: "professional-ats",
      p_pdf_storage_bucket: "generated-documents",
      p_pdf_storage_path: "should-be-ignored/should-be-ignored.pdf",
      p_docx_storage_bucket: "generated-documents",
      p_docx_storage_path: "should-be-ignored/should-be-ignored.docx",
      p_generation_engine: "canonical",
      p_generation_engine_version: "6G.0",
      p_protected_fact_validation_result: {},
    });
    check("complete idempotent replay: alreadyCompleted true", replay.data?.alreadyCompleted, true);
    check("complete idempotent replay: returns the SAME pdfDocumentId, not a new one", replay.data?.pdfDocumentId, first.data.pdfDocumentId);
    check("complete idempotent replay: returns the SAME docxDocumentId, not a new one", replay.data?.docxDocumentId, first.data.docxDocumentId);
    check("complete idempotent replay: still exactly 2 document rows (no duplicates created)", pgCount("generated_resume_documents", `tailored_resume_id = '${overlayIdA}'`), 2);

    const appRowAfterReplay = pgJson(`select row_to_json(t) from (select generated_pdf_document_id from applications where id = '${fixtureA.application.id}') t;`);
    check("complete idempotent replay: applications storage path was NOT overwritten by the ignored replay args", appRowAfterReplay?.generated_pdf_document_id, first.data.pdfDocumentId);
  }

  // ==================== 4. complete_canonical_generation: ownership + not-found rejections ====================
  {
    const userC = await makeTestUser(admin, "complete-attacker");
    const wrongUser = await admin.rpc("complete_canonical_generation", {
      p_user_id: userC.userId,
      p_application_id: fixtureA.application.id, // belongs to user A
      p_tailored_resume_id: overlayIdA,
      p_canonical_profile_id: fixtureA.profile.id,
      p_canonical_resume_version_id: fixtureA.version.id,
      p_template_id: "professional-ats",
      p_pdf_storage_bucket: "generated-documents",
      p_pdf_storage_path: "x/x.pdf",
      p_docx_storage_bucket: "generated-documents",
      p_docx_storage_path: "x/x.docx",
      p_generation_engine: "canonical",
      p_generation_engine_version: "6G.0",
      p_protected_fact_validation_result: {},
    });
    check("complete cross-user application attack: rejected as not_found/application", wrongUser.data, { status: "not_found", reason: "application" });

    const fixtureC = await seedCanonicalFixture(userC.client, userC.userId);
    const wrongTailored = await admin.rpc("complete_canonical_generation", {
      p_user_id: userC.userId,
      p_application_id: fixtureC.application.id,
      p_tailored_resume_id: overlayIdA, // belongs to user A's profile, not user C's
      p_canonical_profile_id: fixtureC.profile.id,
      p_canonical_resume_version_id: fixtureC.version.id,
      p_template_id: "professional-ats",
      p_pdf_storage_bucket: "generated-documents",
      p_pdf_storage_path: "x/x.pdf",
      p_docx_storage_bucket: "generated-documents",
      p_docx_storage_path: "x/x.docx",
      p_generation_engine: "canonical",
      p_generation_engine_version: "6G.0",
      p_protected_fact_validation_result: {},
    });
    check("complete cross-profile tailored-resume attack: rejected as not_found/tailored_resume", wrongTailored.data, { status: "not_found", reason: "tailored_resume" });

    // overlayIdA already legitimately has exactly 2 document rows from section
    // 3 - both rejected attacks above targeted this same tailored_resume_id,
    // so the correct assertion is that the count is STILL 2, not that it grew.
    check("complete rejected cross-user attempts: document count for overlayIdA unchanged (still the 2 from section 3, no leaked writes)", pgCount("generated_resume_documents", `tailored_resume_id = '${overlayIdA}'`), 2);
    check(
      "complete rejected cross-user attempts: zero document rows created under user C's own profile either",
      pgCount("generated_resume_documents grd join career_tailored_resumes ctr on ctr.id = grd.tailored_resume_id", `ctr.profile_id = '${fixtureC.profile.id}'`),
      0
    );
  }

  // ==================== 5. complete_canonical_generation: real Postgres transaction rollback ====================
  {
    const userD = await makeTestUser(admin, "rollback-owner");
    const fixtureD = await seedCanonicalFixture(userD.client, userD.userId);
    const overlayD = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userD.userId,
      p_profile_id: fixtureD.profile.id,
      p_resume_version_id: fixtureD.version.id,
      p_application_id: fixtureD.application.id,
      p_template_id: "professional-ats",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    const tailoredIdD = overlayD.data.overlayId;

    // p_generation_engine violates applications_generation_engine_check on the
    // FINAL update statement - AFTER both document inserts have already run in
    // this same function call. A real transaction must roll back both inserts.
    const forcedFailure = await admin.rpc("complete_canonical_generation", {
      p_user_id: userD.userId,
      p_application_id: fixtureD.application.id,
      p_tailored_resume_id: tailoredIdD,
      p_canonical_profile_id: fixtureD.profile.id,
      p_canonical_resume_version_id: fixtureD.version.id,
      p_template_id: "professional-ats",
      p_pdf_storage_bucket: "generated-documents",
      p_pdf_storage_path: `${userD.userId}/${fixtureD.application.id}.pdf`,
      p_docx_storage_bucket: "generated-documents",
      p_docx_storage_path: `${userD.userId}/${fixtureD.application.id}.docx`,
      p_generation_engine: "not-a-real-engine", // <-- violates the CHECK constraint
      p_generation_engine_version: "6G.0",
      p_protected_fact_validation_result: {},
    });
    checkTrue("rollback: the RPC call itself surfaces a real Postgres error", forcedFailure.error !== null);
    check("rollback: NEITHER document row survived the failed call (real transaction rollback, not a partial write)", pgCount("generated_resume_documents", `tailored_resume_id = '${tailoredIdD}'`), 0);

    const appRowAfterFailure = pgJson(`select row_to_json(t) from (select generated_pdf_document_id, generation_engine from applications where id = '${fixtureD.application.id}') t;`);
    check("rollback: applications row's canonical columns remain untouched after the failed call", appRowAfterFailure?.generated_pdf_document_id, null);
    check("rollback: applications row's generation_engine remains untouched (never left in the invalid state)", appRowAfterFailure?.generation_engine, null);

    // A subsequent, VALID call for the same tailored resume must still succeed cleanly -
    // the failed attempt did not leave any residue that would block a real retry.
    const retry = await admin.rpc("complete_canonical_generation", {
      p_user_id: userD.userId,
      p_application_id: fixtureD.application.id,
      p_tailored_resume_id: tailoredIdD,
      p_canonical_profile_id: fixtureD.profile.id,
      p_canonical_resume_version_id: fixtureD.version.id,
      p_template_id: "professional-ats",
      p_pdf_storage_bucket: "generated-documents",
      p_pdf_storage_path: `${userD.userId}/${fixtureD.application.id}.pdf`,
      p_docx_storage_bucket: "generated-documents",
      p_docx_storage_path: `${userD.userId}/${fixtureD.application.id}.docx`,
      p_generation_engine: "canonical",
      p_generation_engine_version: "6G.0",
      p_protected_fact_validation_result: {},
    });
    check("rollback: retry with valid arguments after a rolled-back failure succeeds cleanly", retry.data?.status, "success");
    check("rollback: retry creates exactly 2 document rows (the earlier failed attempt left none behind)", pgCount("generated_resume_documents", `tailored_resume_id = '${tailoredIdD}'`), 2);
  }

  // ==================== 6. mark_canonical_fallback ====================
  {
    const userE = await makeTestUser(admin, "fallback-owner");
    const fixtureE = await seedCanonicalFixture(userE.client, userE.userId);

    const result = await admin.rpc("mark_canonical_fallback", {
      p_user_id: userE.userId,
      p_application_id: fixtureE.application.id,
      p_fallback_used: true,
      p_fallback_reason: "no_canonical_profile",
      p_generation_engine: "legacy",
    });
    check("fallback mark: success", result.data?.status, "success");
    const appRow = pgJson(`select row_to_json(t) from (select fallback_used, fallback_reason, generation_engine from applications where id = '${fixtureE.application.id}') t;`);
    check("fallback mark: fallback_used persisted", appRow?.fallback_used, true);
    check("fallback mark: fallback_reason persisted", appRow?.fallback_reason, "no_canonical_profile");
    check("fallback mark: generation_engine persisted as legacy", appRow?.generation_engine, "legacy");

    const wrongUserFallback = await admin.rpc("mark_canonical_fallback", {
      p_user_id: userA.userId, // does not own fixtureE.application
      p_application_id: fixtureE.application.id,
      p_fallback_used: true,
      p_fallback_reason: "transient_failure",
      p_generation_engine: "legacy",
    });
    check("fallback mark cross-user attack: rejected as not_found", wrongUserFallback.data, { status: "not_found", reason: "application" });
    const appRowUnchanged = pgJson(`select row_to_json(t) from (select fallback_reason from applications where id = '${fixtureE.application.id}') t;`);
    check("fallback mark cross-user attack: original fallback_reason NOT overwritten by the rejected attempt", appRowUnchanged?.fallback_reason, "no_canonical_profile");
  }

  // ==================== 7. Quota isolation - none of the 3 new RPCs ever touch generate_package_usage tables ====================
  {
    const userF = await makeTestUser(admin, "quota-isolation");
    const fixtureF = await seedCanonicalFixture(userF.client, userF.userId);

    check("quota isolation baseline: zero reservations before any canonical RPC call", pgCount("generate_package_quota_reservations", `user_id = '${userF.userId}'`), 0);

    const overlayF = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userF.userId,
      p_profile_id: fixtureF.profile.id,
      p_resume_version_id: fixtureF.version.id,
      p_application_id: fixtureF.application.id,
      p_template_id: "modern-sidebar",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    await admin.rpc("complete_canonical_generation", {
      p_user_id: userF.userId,
      p_application_id: fixtureF.application.id,
      p_tailored_resume_id: overlayF.data.overlayId,
      p_canonical_profile_id: fixtureF.profile.id,
      p_canonical_resume_version_id: fixtureF.version.id,
      p_template_id: "modern-sidebar",
      p_pdf_storage_bucket: "generated-documents",
      p_pdf_storage_path: `${userF.userId}/${fixtureF.application.id}.pdf`,
      p_docx_storage_bucket: "generated-documents",
      p_docx_storage_path: `${userF.userId}/${fixtureF.application.id}.docx`,
      p_generation_engine: "canonical",
      p_generation_engine_version: "6G.0",
      p_protected_fact_validation_result: {},
    });
    await admin.rpc("mark_canonical_fallback", { p_user_id: userF.userId, p_application_id: fixtureF.application.id, p_fallback_used: false, p_fallback_reason: null, p_generation_engine: "canonical" });

    check("quota isolation: still zero reservations after overlay+complete+fallback-mark calls - Canonical path never consumes legacy quota", pgCount("generate_package_quota_reservations", `user_id = '${userF.userId}'`), 0);
    check("quota isolation: zero quota_periods rows either", pgCount("generate_package_quota_periods", `user_id = '${userF.userId}'`), 0);
  }

  // ==================== 8. Canonical-less legacy user - system_create_canonical_overlay finds no profile ====================
  {
    const userG = await makeTestUser(admin, "canonical-less-legacy-user");
    // No career_profiles row ever created for this user - simulates an
    // existing legacy-only user who has never touched Career Memory.
    const result = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userG.userId,
      p_profile_id: "00000000-0000-0000-0000-000000000000",
      p_resume_version_id: null,
      p_application_id: null,
      p_template_id: "professional-ats",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    check("canonical-less legacy user: overlay creation for a nonexistent profile id returns not_found/profile (never crashes, never fabricates)", result.data, { status: "not_found", reason: "profile" });
    check("canonical-less legacy user: confirmed zero career_profiles rows exist for this user (the scenario this test targets)", pgCount("career_profiles", `user_id = '${userG.userId}'`), 0);
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);

  /*
    Cleanup: only this run's own synthetic users. applications.user_id
    and career_profiles.user_id are both `references auth.users(id) on
    delete cascade` (confirmed via pg_constraint) - career_resume_versions/
    career_tailored_resumes/generated_resume_documents all cascade
    further from career_profiles - so deleting the auth user alone
    removes every row this run created, with no separate service-role
    table access needed (service_role has no direct GRANT on any of
    these tables, by design - see this file's own header comment).
  */
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }

  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
