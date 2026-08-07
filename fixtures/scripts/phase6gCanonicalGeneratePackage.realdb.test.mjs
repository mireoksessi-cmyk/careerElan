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

  // ==================== 9. system_create_canonical_overlay: additional not-found + shape edges ====================
  {
    const userH = await makeTestUser(admin, "overlay-notfound");
    const fixtureH = await seedCanonicalFixture(userH.client, userH.userId);

    const nonexistentVersion = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userH.userId,
      p_profile_id: fixtureH.profile.id,
      p_resume_version_id: "00000000-0000-0000-0000-000000000000", // well-formed uuid, no such row
      p_application_id: null,
      p_template_id: "professional-ats",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    check("overlay: well-formed but nonexistent p_resume_version_id -> not_found/resume_version", nonexistentVersion.data, { status: "not_found", reason: "resume_version" });

    const nonexistentApplication = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userH.userId,
      p_profile_id: fixtureH.profile.id,
      p_resume_version_id: fixtureH.version.id,
      p_application_id: "00000000-0000-0000-0000-000000000000",
      p_template_id: "professional-ats",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    check("overlay: well-formed but nonexistent p_application_id -> not_found/application", nonexistentApplication.data, { status: "not_found", reason: "application" });

    const malformedUuid = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userH.userId,
      p_profile_id: "not-a-real-uuid-at-all",
      p_resume_version_id: null,
      p_application_id: null,
      p_template_id: "professional-ats",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    checkTrue("overlay: malformed (non-UUID) p_profile_id string -> real Postgres error, never silently treated as not_found", malformedUuid.error !== null);

    // Overlay column is jsonb - the RPC itself does NOT validate the overlay's
    // internal shape (that validation lives entirely at the app layer in
    // validateAiTailoringResponse, tested exhaustively in the pure-logic
    // suite). This documents the actual defense-boundary split.
    const arbitraryOverlay = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userH.userId,
      p_profile_id: fixtureH.profile.id,
      p_resume_version_id: fixtureH.version.id,
      p_application_id: fixtureH.application.id,
      p_template_id: "professional-ats",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { totallyArbitraryShape: true, notTheRealOverlayContract: [1, 2, 3] },
    });
    check("overlay: RPC layer accepts ANY valid jsonb shape for p_overlay - shape validation is an app-layer concern, not a DB-layer one (documents the defense-boundary split)", arbitraryOverlay.data?.status, "success");

    // No idempotency key at this RPC layer (per the migration's own header
    // comment) - two structurally-identical calls create two distinct rows.
    const dup1 = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userH.userId,
      p_profile_id: fixtureH.profile.id,
      p_resume_version_id: fixtureH.version.id,
      p_application_id: null,
      p_template_id: "modern-sidebar",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    const dup2 = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userH.userId,
      p_profile_id: fixtureH.profile.id,
      p_resume_version_id: fixtureH.version.id,
      p_application_id: null,
      p_template_id: "modern-sidebar",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    checkTrue("overlay: two structurally-identical calls produce two DISTINCT overlay ids (no idempotency key at this layer, by design)", dup1.data?.overlayId !== dup2.data?.overlayId);

    // Concurrency: two overlay creations fired in parallel for the same
    // profile/version both succeed independently, no crash / no lost update.
    const [concA, concB] = await Promise.all([
      admin.rpc("system_create_canonical_overlay", { p_user_id: userH.userId, p_profile_id: fixtureH.profile.id, p_resume_version_id: fixtureH.version.id, p_application_id: null, p_template_id: "executive-minimal", p_ai_model: "test-model", p_prompt_version: "test-v1", p_overlay: { schemaVersion: "1.0.0" } }),
      admin.rpc("system_create_canonical_overlay", { p_user_id: userH.userId, p_profile_id: fixtureH.profile.id, p_resume_version_id: fixtureH.version.id, p_application_id: null, p_template_id: "executive-minimal", p_ai_model: "test-model", p_prompt_version: "test-v1", p_overlay: { schemaVersion: "1.0.0" } }),
    ]);
    checkTrue("overlay: concurrent parallel calls both succeed", concA.data?.status === "success" && concB.data?.status === "success");
    checkTrue("overlay: concurrent parallel calls produce two distinct rows, no race-condition crash or overwrite", concA.data?.overlayId !== concB.data?.overlayId);
  }

  // ==================== 10. complete_canonical_generation: additional not-found + FK-violation rollback + concurrency ====================
  {
    const userI = await makeTestUser(admin, "complete-notfound");
    const fixtureI = await seedCanonicalFixture(userI.client, userI.userId);

    const malformedAppId = await admin.rpc("complete_canonical_generation", {
      p_user_id: userI.userId,
      p_application_id: "not-a-uuid",
      p_tailored_resume_id: "00000000-0000-0000-0000-000000000000",
      p_canonical_profile_id: fixtureI.profile.id,
      p_canonical_resume_version_id: fixtureI.version.id,
      p_template_id: "professional-ats",
      p_pdf_storage_bucket: "generated-documents",
      p_pdf_storage_path: "x.pdf",
      p_docx_storage_bucket: "generated-documents",
      p_docx_storage_path: "x.docx",
      p_generation_engine: "canonical",
      p_generation_engine_version: "6G.0",
      p_protected_fact_validation_result: {},
    });
    checkTrue("complete: malformed (non-UUID) p_application_id -> real Postgres error, never silently treated as not_found", malformedAppId.error !== null);

    const nonexistentTailored = await admin.rpc("complete_canonical_generation", {
      p_user_id: userI.userId,
      p_application_id: fixtureI.application.id,
      p_tailored_resume_id: "00000000-0000-0000-0000-000000000000",
      p_canonical_profile_id: fixtureI.profile.id,
      p_canonical_resume_version_id: fixtureI.version.id,
      p_template_id: "professional-ats",
      p_pdf_storage_bucket: "generated-documents",
      p_pdf_storage_path: "x.pdf",
      p_docx_storage_bucket: "generated-documents",
      p_docx_storage_path: "x.docx",
      p_generation_engine: "canonical",
      p_generation_engine_version: "6G.0",
      p_protected_fact_validation_result: {},
    });
    check("complete: well-formed but nonexistent p_tailored_resume_id -> not_found/tailored_resume", nonexistentTailored.data, { status: "not_found", reason: "tailored_resume" });

    // FK-violation rollback: p_canonical_resume_version_id references a
    // nonexistent career_resume_versions row - violates the FK constraint
    // on the FINAL update statement, AFTER both document inserts already
    // ran. A DISTINCT failure mode from section 5's CHECK-constraint
    // rollback test - this proves real transactional rollback under an FK
    // violation too, not just a CHECK violation.
    const overlayJ = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userI.userId,
      p_profile_id: fixtureI.profile.id,
      p_resume_version_id: fixtureI.version.id,
      p_application_id: fixtureI.application.id,
      p_template_id: "professional-ats",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    const tailoredIdJ = overlayJ.data.overlayId;
    const fkViolation = await admin.rpc("complete_canonical_generation", {
      p_user_id: userI.userId,
      p_application_id: fixtureI.application.id,
      p_tailored_resume_id: tailoredIdJ,
      p_canonical_profile_id: fixtureI.profile.id,
      p_canonical_resume_version_id: "00000000-0000-0000-0000-000000000000", // <-- violates the FK constraint on applications.canonical_resume_version_id
      p_template_id: "professional-ats",
      p_pdf_storage_bucket: "generated-documents",
      p_pdf_storage_path: `${userI.userId}/${fixtureI.application.id}.pdf`,
      p_docx_storage_bucket: "generated-documents",
      p_docx_storage_path: `${userI.userId}/${fixtureI.application.id}.docx`,
      p_generation_engine: "canonical",
      p_generation_engine_version: "6G.0",
      p_protected_fact_validation_result: {},
    });
    checkTrue("complete: FK-violation on the final update surfaces a real Postgres error", fkViolation.error !== null);
    check("complete: FK-violation rollback - neither document row survived (real transaction rollback under an FK violation, not just CHECK)", pgCount("generated_resume_documents", `tailored_resume_id = '${tailoredIdJ}'`), 0);
    const appRowAfterFk = pgJson(`select row_to_json(t) from (select generated_pdf_document_id from applications where id = '${fixtureI.application.id}') t;`);
    check("complete: FK-violation rollback - applications row untouched", appRowAfterFk?.generated_pdf_document_id, null);

    // Concurrency: two complete_canonical_generation calls fired in
    // parallel for the SAME tailored_resume_id - idempotent replay logic
    // must still hold under a real race, never creating duplicate document
    // rows regardless of which call's transaction commits first.
    const overlayK = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userI.userId,
      p_profile_id: fixtureI.profile.id,
      p_resume_version_id: fixtureI.version.id,
      p_application_id: null,
      p_template_id: "creative-timeline",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    const applicationK = await userI.client.from("applications").insert({ user_id: userI.userId }).select("*").single();
    const tailoredIdK = overlayK.data.overlayId;
    const completeArgsK = {
      p_user_id: userI.userId,
      p_application_id: applicationK.data.id,
      p_tailored_resume_id: tailoredIdK,
      p_canonical_profile_id: fixtureI.profile.id,
      p_canonical_resume_version_id: fixtureI.version.id,
      p_template_id: "creative-timeline",
      p_pdf_storage_bucket: "generated-documents",
      p_pdf_storage_path: `${userI.userId}/${applicationK.data.id}.pdf`,
      p_docx_storage_bucket: "generated-documents",
      p_docx_storage_path: `${userI.userId}/${applicationK.data.id}.docx`,
      p_generation_engine: "canonical",
      p_generation_engine_version: "6G.0",
      p_protected_fact_validation_result: {},
    };
    const [raceA, raceB] = await Promise.all([admin.rpc("complete_canonical_generation", completeArgsK), admin.rpc("complete_canonical_generation", completeArgsK)]);
    checkTrue("complete: concurrent race for the same tailored_resume_id - both calls return success (one real, one idempotent-or-real)", raceA.data?.status === "success" && raceB.data?.status === "success");
    check("complete: concurrent race for the same tailored_resume_id - exactly 2 document rows exist afterward, never 4 (no duplicate-write race)", pgCount("generated_resume_documents", `tailored_resume_id = '${tailoredIdK}'`), 2);
  }

  // ==================== 11. mark_canonical_fallback: CHECK-constraint + not-found edges ====================
  {
    const userL = await makeTestUser(admin, "fallback-constraints");
    const fixtureL = await seedCanonicalFixture(userL.client, userL.userId);

    const badReason = await admin.rpc("mark_canonical_fallback", {
      p_user_id: userL.userId,
      p_application_id: fixtureL.application.id,
      p_fallback_used: true,
      p_fallback_reason: "not-a-real-fallback-reason",
      p_generation_engine: "legacy",
    });
    checkTrue("fallback mark: invalid fallback_reason value rejected by the real applications_fallback_reason_check CHECK constraint", badReason.error !== null);

    const badEngine = await admin.rpc("mark_canonical_fallback", {
      p_user_id: userL.userId,
      p_application_id: fixtureL.application.id,
      p_fallback_used: true,
      p_fallback_reason: "transient_failure",
      p_generation_engine: "not-a-real-engine",
    });
    checkTrue("fallback mark: invalid generation_engine value rejected by the real applications_generation_engine_check CHECK constraint", badEngine.error !== null);

    const nonexistentApp = await admin.rpc("mark_canonical_fallback", {
      p_user_id: userL.userId,
      p_application_id: "00000000-0000-0000-0000-000000000000",
      p_fallback_used: true,
      p_fallback_reason: "transient_failure",
      p_generation_engine: "legacy",
    });
    check("fallback mark: well-formed but nonexistent application id -> not_found/application", nonexistentApp.data, { status: "not_found", reason: "application" });

    const nullUserFallback = await admin.rpc("mark_canonical_fallback", { p_user_id: null, p_application_id: fixtureL.application.id, p_fallback_used: true, p_fallback_reason: "transient_failure", p_generation_engine: "legacy" });
    checkTrue("fallback mark: p_user_id null -> RPC raises AUTHENTICATION_REQUIRED, never silently proceeds", nullUserFallback.error !== null);

    // fallback_used=false + fallback_reason=null is the documented "shadow
    // mode ran, no fallback needed" success case, not an error.
    const cleanFallback = await admin.rpc("mark_canonical_fallback", { p_user_id: userL.userId, p_application_id: fixtureL.application.id, p_fallback_used: false, p_fallback_reason: null, p_generation_engine: "canonical" });
    check("fallback mark: fallback_used=false + fallback_reason=null (canonical succeeded, no fallback needed) is a valid success case", cleanFallback.data?.status, "success");
  }

  // ==================== 12. get_canonical_generation_status: direct RPC coverage ====================
  {
    const userM = await makeTestUser(admin, "status-rpc");
    const fixtureM = await seedCanonicalFixture(userM.client, userM.userId);

    const beforeCompletion = await admin.rpc("get_canonical_generation_status", { p_user_id: userM.userId, p_application_id: fixtureM.application.id });
    check("status RPC: application exists but has no canonical generation yet -> success with all canonical fields null", beforeCompletion.data, {
      status: "success",
      application: {
        id: fixtureM.application.id,
        canonical_profile_id: null,
        canonical_resume_version_id: null,
        tailored_resume_id: null,
        selected_template_id: null,
        generated_pdf_document_id: null,
        generated_docx_document_id: null,
        generation_engine: null,
        generation_engine_version: null,
        fallback_used: null,
        fallback_reason: null,
      },
    });

    const wrongUserStatus = await admin.rpc("get_canonical_generation_status", { p_user_id: userA.userId, p_application_id: fixtureM.application.id });
    check("status RPC: cross-user request -> not_found/application (never leaks another user's row)", wrongUserStatus.data, { status: "not_found", reason: "application" });

    const nonexistentStatus = await admin.rpc("get_canonical_generation_status", { p_user_id: userM.userId, p_application_id: "00000000-0000-0000-0000-000000000000" });
    check("status RPC: nonexistent application id -> not_found/application", nonexistentStatus.data, { status: "not_found", reason: "application" });

    const nullUserStatus = await admin.rpc("get_canonical_generation_status", { p_user_id: null, p_application_id: fixtureM.application.id });
    checkTrue("status RPC: p_user_id null -> RPC raises AUTHENTICATION_REQUIRED", nullUserStatus.error !== null);
  }

  // ==================== 13. Repeated-cycle quota isolation + owner-vs-cross-user RLS on new canonical columns ====================
  {
    const userN = await makeTestUser(admin, "repeated-quota-isolation");
    const fixtureN = await seedCanonicalFixture(userN.client, userN.userId);

    for (let i = 0; i < 3; i++) {
      const overlayN = await admin.rpc("system_create_canonical_overlay", { p_user_id: userN.userId, p_profile_id: fixtureN.profile.id, p_resume_version_id: fixtureN.version.id, p_application_id: null, p_template_id: "professional-ats", p_ai_model: "test-model", p_prompt_version: "test-v1", p_overlay: { schemaVersion: "1.0.0" } });
      checkTrue(`repeated cycle ${i + 1}/3: overlay creation succeeds`, overlayN.data?.status === "success");
    }
    check("repeated-cycle quota isolation: 3 full overlay-creation cycles later, still zero quota reservations for this user", pgCount("generate_package_quota_reservations", `user_id = '${userN.userId}'`), 0);

    // RLS: the owning user CAN see their own application's canonical
    // columns via a direct authenticated select (not just via the status
    // RPC) after a real completion; a different user cannot.
    const overlayForRls = await admin.rpc("system_create_canonical_overlay", { p_user_id: userN.userId, p_profile_id: fixtureN.profile.id, p_resume_version_id: fixtureN.version.id, p_application_id: fixtureN.application.id, p_template_id: "modern-sidebar", p_ai_model: "test-model", p_prompt_version: "test-v1", p_overlay: { schemaVersion: "1.0.0" } });
    await admin.rpc("complete_canonical_generation", {
      p_user_id: userN.userId,
      p_application_id: fixtureN.application.id,
      p_tailored_resume_id: overlayForRls.data.overlayId,
      p_canonical_profile_id: fixtureN.profile.id,
      p_canonical_resume_version_id: fixtureN.version.id,
      p_template_id: "modern-sidebar",
      p_pdf_storage_bucket: "generated-documents",
      p_pdf_storage_path: `${userN.userId}/${fixtureN.application.id}.pdf`,
      p_docx_storage_bucket: "generated-documents",
      p_docx_storage_path: `${userN.userId}/${fixtureN.application.id}.docx`,
      p_generation_engine: "canonical",
      p_generation_engine_version: "6G.0",
      p_protected_fact_validation_result: {},
    });
    const { data: ownCanonicalSelect } = await userN.client.from("applications").select("selected_template_id, generation_engine").eq("id", fixtureN.application.id).single();
    check("RLS: owning user can directly select their own application's new canonical columns", ownCanonicalSelect, { selected_template_id: "modern-sidebar", generation_engine: "canonical" });

    const userO = await makeTestUser(admin, "cross-user-canonical-columns");
    const { data: crossCanonicalSelect } = await userO.client.from("applications").select("selected_template_id").eq("id", fixtureN.application.id);
    check("RLS: a different user's direct select of that same application row returns zero rows (canonical columns invisible cross-user, same as every other applications column)", (crossCanonicalSelect ?? []).length, 0);
  }

  // ==================== 14. system_get_canonical_memory_bundle: direct RPC coverage ====================
  // Follow-up RPC added after a real-DB test exposed that generateCanonicalPackage()
  // - always called with the service-role client by /generate and shadow
  // mode - could never actually read a user's canonical profile at all
  // (service_role had zero table GRANT on career_profiles and its 9
  // child tables). This RPC is the fix; these are its own direct tests.
  {
    const userP = await makeTestUser(admin, "bundle-rpc-no-profile");
    const noProfile = await admin.rpc("system_get_canonical_memory_bundle", { p_user_id: userP.userId });
    check("bundle RPC: user with zero career_profiles rows -> status no_profile", noProfile.data, { status: "no_profile" });

    const nullUserBundle = await admin.rpc("system_get_canonical_memory_bundle", { p_user_id: null });
    checkTrue("bundle RPC: p_user_id null -> RPC raises AUTHENTICATION_REQUIRED, never silently proceeds", nullUserBundle.error !== null);

    const malformedUserBundle = await admin.rpc("system_get_canonical_memory_bundle", { p_user_id: "not-a-real-uuid" });
    checkTrue("bundle RPC: malformed (non-UUID) p_user_id -> real Postgres error", malformedUserBundle.error !== null);

    const rlsAttemptBundle = await userP.client.rpc("system_get_canonical_memory_bundle", { p_user_id: userP.userId });
    checkTrue("bundle RPC: authenticated (non-service-role) client is REJECTED - EXECUTE only granted to service_role", rlsAttemptBundle.error !== null);

    const userQ = await makeTestUser(admin, "bundle-rpc-profile-no-version");
    const { data: profileOnlyRow, error: profileOnlyError } = await userQ.client.from("career_profiles").insert({ user_id: userQ.userId, schema_version: "v1", serializer_version: "s1" }).select("*").single();
    check("bundle RPC setup: profile-only row created (no version yet)", profileOnlyError, null);
    const profileNoVersion = await admin.rpc("system_get_canonical_memory_bundle", { p_user_id: userQ.userId });
    check("bundle RPC: profile exists but zero resume versions -> status no_version, profile still returned", profileNoVersion.data?.status, "no_version");
    check("bundle RPC: no_version response includes the correct profile id", profileNoVersion.data?.profile?.id, profileOnlyRow.id);

    const userR = await makeTestUser(admin, "bundle-rpc-success");
    const fixtureR = await seedCanonicalFixture(userR.client, userR.userId);
    const successBundle = await admin.rpc("system_get_canonical_memory_bundle", { p_user_id: userR.userId });
    check("bundle RPC: profile + version exist -> status success", successBundle.data?.status, "success");
    check("bundle RPC: success response includes the correct profile id", successBundle.data?.profile?.id, fixtureR.profile.id);
    check("bundle RPC: success response includes the correct latestVersion id", successBundle.data?.latestVersion?.id, fixtureR.version.id);
    check("bundle RPC: success response includes empty arrays for child tables the minimal fixture never populated (never null, never omitted)", {
      sourceDocuments: successBundle.data?.sourceDocuments,
      experiences: successBundle.data?.experiences,
      languages: successBundle.data?.languages,
      projects: successBundle.data?.projects,
      credentials: successBundle.data?.credentials,
      awards: successBundle.data?.awards,
      publications: successBundle.data?.publications,
      tailoredResumes: successBundle.data?.tailoredResumes,
    }, { sourceDocuments: [], experiences: [], languages: [], projects: [], credentials: [], awards: [], publications: [], tailoredResumes: [] });

    // Cross-user ownership: userR's own profile id used with a DIFFERENT user's p_user_id must not leak anything -
    // the RPC scopes strictly by p_user_id -> its OWN profile lookup, never by a caller-supplied profile id at all.
    const crossUserBundle = await admin.rpc("system_get_canonical_memory_bundle", { p_user_id: userQ.userId });
    check("bundle RPC: a different user's own p_user_id call returns THEIR OWN state (no_version), never user R's data", crossUserBundle.data?.status, "no_version");

    // Multiple resume versions - the RPC must select the LATEST one (matches
    // getLatestByProfileId's own "order by created_at desc limit 1" contract).
    const { data: secondVersion, error: secondVersionError } = await userR.client
      .from("career_resume_versions")
      .insert({ profile_id: fixtureR.profile.id, reason: "user_edit", snapshot: { schemaVersion: "v1", marker: "second-version" }, schema_version: "v1", serializer_version: "s1" })
      .select("*")
      .single();
    check("bundle RPC setup: second resume version created for the same profile", secondVersionError, null);
    const latestBundle = await admin.rpc("system_get_canonical_memory_bundle", { p_user_id: userR.userId });
    check("bundle RPC: with 2 versions present, returns the LATEST (most recently created) version, not the first", latestBundle.data?.latestVersion?.id, secondVersion.id);
    checkTrue("bundle RPC: latest-version selection correctly excludes the older version id", latestBundle.data?.latestVersion?.id !== fixtureR.version.id);
  }

  // ==================== 15. mark_canonical_fallback + get_canonical_generation_status: additional negative depth ====================
  {
    const userS = await makeTestUser(admin, "fallback-additional");
    const fixtureS = await seedCanonicalFixture(userS.client, userS.userId);

    const malformedAppIdFallback = await admin.rpc("mark_canonical_fallback", { p_user_id: userS.userId, p_application_id: "not-a-uuid", p_fallback_used: true, p_fallback_reason: "transient_failure", p_generation_engine: "legacy" });
    checkTrue("fallback mark: malformed (non-UUID) p_application_id -> real Postgres error", malformedAppIdFallback.error !== null);

    const nullFallbackReason = await admin.rpc("mark_canonical_fallback", { p_user_id: userS.userId, p_application_id: fixtureS.application.id, p_fallback_used: true, p_fallback_reason: null, p_generation_engine: "legacy" });
    check("fallback mark: fallback_used=true with fallback_reason=null is accepted (the RPC itself does not cross-validate the two fields against each other - that's an app-layer concern)", nullFallbackReason.data?.status, "success");

    // Repeated calls - last write wins, no accumulation/versioning at this RPC layer.
    await admin.rpc("mark_canonical_fallback", { p_user_id: userS.userId, p_application_id: fixtureS.application.id, p_fallback_used: true, p_fallback_reason: "no_canonical_profile", p_generation_engine: "legacy" });
    await admin.rpc("mark_canonical_fallback", { p_user_id: userS.userId, p_application_id: fixtureS.application.id, p_fallback_used: true, p_fallback_reason: "template_rendering_failure", p_generation_engine: "legacy" });
    const finalReason = pgJson(`select row_to_json(t) from (select fallback_reason from applications where id = '${fixtureS.application.id}') t;`);
    check("fallback mark: 3rd call's reason is what persists - last write wins, no history accumulation at this layer", finalReason?.fallback_reason, "template_rendering_failure");

    const invalidEngineFallback = await admin.rpc("mark_canonical_fallback", { p_user_id: userS.userId, p_application_id: fixtureS.application.id, p_fallback_used: true, p_fallback_reason: "transient_failure", p_generation_engine: "not-a-real-engine" });
    checkTrue("fallback mark: invalid generation_engine on the LAST field still rejected by the real CHECK constraint even after prior valid writes", invalidEngineFallback.error !== null);
    const afterRejectedFallback = pgJson(`select row_to_json(t) from (select fallback_reason, generation_engine from applications where id = '${fixtureS.application.id}') t;`);
    check("fallback mark: the whole failed UPDATE statement rolled back entirely - fallback_reason from the LAST successful call is untouched, not partially applied", afterRejectedFallback?.fallback_reason, "template_rendering_failure");

    // get_canonical_generation_status reflects mark_canonical_fallback's own writes correctly.
    const statusAfterFallback = await admin.rpc("get_canonical_generation_status", { p_user_id: userS.userId, p_application_id: fixtureS.application.id });
    check("status RPC: correctly reflects a fallback-marked (not canonical-completed) application - fallback_used/fallback_reason/generation_engine all populated, canonical fields still null", statusAfterFallback.data?.application, {
      id: fixtureS.application.id,
      canonical_profile_id: null,
      canonical_resume_version_id: null,
      tailored_resume_id: null,
      selected_template_id: null,
      generated_pdf_document_id: null,
      generated_docx_document_id: null,
      generation_engine: "legacy",
      generation_engine_version: null,
      fallback_used: true,
      fallback_reason: "template_rendering_failure",
    });

    // Concurrency: two mark_canonical_fallback calls in parallel for the same application - both succeed, no crash, last-committed wins deterministically (no assertion on WHICH one wins, only that neither errors and the row ends in a valid state).
    const [fbA, fbB] = await Promise.all([
      admin.rpc("mark_canonical_fallback", { p_user_id: userS.userId, p_application_id: fixtureS.application.id, p_fallback_used: true, p_fallback_reason: "no_canonical_version", p_generation_engine: "legacy" }),
      admin.rpc("mark_canonical_fallback", { p_user_id: userS.userId, p_application_id: fixtureS.application.id, p_fallback_used: true, p_fallback_reason: "generated_document_failure", p_generation_engine: "legacy" }),
    ]);
    checkTrue("fallback mark: concurrent parallel calls for the same application both succeed (no crash, no deadlock)", fbA.data?.status === "success" && fbB.data?.status === "success");
    const finalConcurrentReason = pgJson(`select row_to_json(t) from (select fallback_reason from applications where id = '${fixtureS.application.id}') t;`);
    checkTrue("fallback mark: after the concurrent race, the row holds ONE of the two valid reasons (not a corrupted/mixed value)", finalConcurrentReason?.fallback_reason === "no_canonical_version" || finalConcurrentReason?.fallback_reason === "generated_document_failure");
  }

  // ==================== 16. system_create_canonical_overlay: p_resume_version_id=null valid path (never tested at RPC level before) ====================
  {
    const userT = await makeTestUser(admin, "overlay-no-version");
    const fixtureT = await seedCanonicalFixture(userT.client, userT.userId);

    const noVersionOverlay = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userT.userId,
      p_profile_id: fixtureT.profile.id,
      p_resume_version_id: null,
      p_application_id: fixtureT.application.id,
      p_template_id: "professional-ats",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    check("overlay: p_resume_version_id=null is a genuinely valid input (the version check inside the RPC is itself conditional on IS NOT NULL) - succeeds", noVersionOverlay.data?.status, "success");
    const rowNoVersion = pgJson(`select row_to_json(t) from (select resume_version_id from career_tailored_resumes where id = '${noVersionOverlay.data.overlayId}') t;`);
    check("overlay: p_resume_version_id=null persists as a genuine NULL, not a fabricated placeholder id", rowNoVersion?.resume_version_id, null);
  }

  // ==================== 17. complete_canonical_generation: real template matrix (all 4 canonical templates, not just professional-ats) ====================
  {
    const userU = await makeTestUser(admin, "template-matrix");
    const fixtureU = await seedCanonicalFixture(userU.client, userU.userId);

    for (const templateId of ["professional-ats", "modern-sidebar", "executive-minimal", "creative-timeline"]) {
      const application = await userU.client.from("applications").insert({ user_id: userU.userId }).select("*").single();
      const overlay = await admin.rpc("system_create_canonical_overlay", {
        p_user_id: userU.userId,
        p_profile_id: fixtureU.profile.id,
        p_resume_version_id: fixtureU.version.id,
        p_application_id: application.data.id,
        p_template_id: templateId,
        p_ai_model: "test-model",
        p_prompt_version: "test-v1",
        p_overlay: { schemaVersion: "1.0.0" },
      });
      const complete = await admin.rpc("complete_canonical_generation", {
        p_user_id: userU.userId,
        p_application_id: application.data.id,
        p_tailored_resume_id: overlay.data.overlayId,
        p_canonical_profile_id: fixtureU.profile.id,
        p_canonical_resume_version_id: fixtureU.version.id,
        p_template_id: templateId,
        p_pdf_storage_bucket: "generated-documents",
        p_pdf_storage_path: `${userU.userId}/${application.data.id}.pdf`,
        p_docx_storage_bucket: "generated-documents",
        p_docx_storage_path: `${userU.userId}/${application.data.id}.docx`,
        p_generation_engine: "canonical",
        p_generation_engine_version: "6G.0",
        p_protected_fact_validation_result: {},
      });
      check(`template matrix: complete_canonical_generation succeeds for real template "${templateId}"`, complete.data?.status, "success");
      const appRow = pgJson(`select row_to_json(t) from (select selected_template_id from applications where id = '${application.data.id}') t;`);
      check(`template matrix: applications.selected_template_id correctly persists "${templateId}" (not a different/default template)`, appRow?.selected_template_id, templateId);
    }
  }

  // ==================== 18. RLS on career_tailored_resumes / career_resume_versions - owner vs cross-user (direct select, not just via RPC) ====================
  {
    const userV = await makeTestUser(admin, "tailored-rls");
    const fixtureV = await seedCanonicalFixture(userV.client, userV.userId);
    const overlayV = await admin.rpc("system_create_canonical_overlay", { p_user_id: userV.userId, p_profile_id: fixtureV.profile.id, p_resume_version_id: fixtureV.version.id, p_application_id: fixtureV.application.id, p_template_id: "professional-ats", p_ai_model: "test-model", p_prompt_version: "test-v1", p_overlay: { schemaVersion: "1.0.0" } });

    const { data: ownTailoredSelect } = await userV.client.from("career_tailored_resumes").select("id, template_id").eq("id", overlayV.data.overlayId);
    check("RLS: owner CAN directly select their own tailored-resume row", (ownTailoredSelect ?? []).length, 1);

    const userW = await makeTestUser(admin, "tailored-rls-cross");
    const { data: crossTailoredSelect } = await userW.client.from("career_tailored_resumes").select("id").eq("id", overlayV.data.overlayId);
    check("RLS: a different user's direct select of that same tailored-resume row returns zero rows", (crossTailoredSelect ?? []).length, 0);

    const { data: ownVersionSelect } = await userV.client.from("career_resume_versions").select("id").eq("id", fixtureV.version.id);
    check("RLS: owner CAN directly select their own resume-version row", (ownVersionSelect ?? []).length, 1);
    const { data: crossVersionSelect } = await userW.client.from("career_resume_versions").select("id").eq("id", fixtureV.version.id);
    check("RLS: a different user's direct select of that same resume-version row returns zero rows", (crossVersionSelect ?? []).length, 0);

    const { data: ownProfileSelect } = await userV.client.from("career_profiles").select("id").eq("id", fixtureV.profile.id);
    check("RLS: owner CAN directly select their own career_profiles row", (ownProfileSelect ?? []).length, 1);
    const { data: crossProfileSelect } = await userW.client.from("career_profiles").select("id").eq("id", fixtureV.profile.id);
    check("RLS: a different user's direct select of that same career_profiles row returns zero rows", (crossProfileSelect ?? []).length, 0);
  }

  // ==================== 19. Wider concurrency stress: 5 parallel overlay creations for the same profile ====================
  {
    const userX = await makeTestUser(admin, "wide-concurrency");
    const fixtureX = await seedCanonicalFixture(userX.client, userX.userId);

    const parallelCalls = Array.from({ length: 5 }, () =>
      admin.rpc("system_create_canonical_overlay", { p_user_id: userX.userId, p_profile_id: fixtureX.profile.id, p_resume_version_id: fixtureX.version.id, p_application_id: null, p_template_id: "professional-ats", p_ai_model: "test-model", p_prompt_version: "test-v1", p_overlay: { schemaVersion: "1.0.0" } })
    );
    const results = await Promise.all(parallelCalls);
    checkTrue("wide concurrency: all 5 parallel overlay-creation calls succeed with no crash/deadlock", results.every((r) => r.data?.status === "success"));
    const distinctIds = new Set(results.map((r) => r.data?.overlayId));
    check("wide concurrency: all 5 parallel calls produce 5 genuinely distinct overlay ids (no collision, no lost write)", distinctIds.size, 5);
    check("wide concurrency: the database itself shows exactly 5 real rows for this profile (matches the 5 returned ids, no phantom/missing rows)", pgCount("career_tailored_resumes", `profile_id = '${fixtureX.profile.id}'`), 5);
  }

  // ==================== 20. complete_canonical_generation: idempotent replay preserves protected_fact_validation_result from the FIRST call, not the replay's ignored args ====================
  {
    const userY = await makeTestUser(admin, "replay-protected-facts");
    const fixtureY = await seedCanonicalFixture(userY.client, userY.userId);
    const overlayY = await admin.rpc("system_create_canonical_overlay", { p_user_id: userY.userId, p_profile_id: fixtureY.profile.id, p_resume_version_id: fixtureY.version.id, p_application_id: fixtureY.application.id, p_template_id: "professional-ats", p_ai_model: "test-model", p_prompt_version: "test-v1", p_overlay: { schemaVersion: "1.0.0" } });

    const firstCall = await admin.rpc("complete_canonical_generation", {
      p_user_id: userY.userId,
      p_application_id: fixtureY.application.id,
      p_tailored_resume_id: overlayY.data.overlayId,
      p_canonical_profile_id: fixtureY.profile.id,
      p_canonical_resume_version_id: fixtureY.version.id,
      p_template_id: "professional-ats",
      p_pdf_storage_bucket: "generated-documents",
      p_pdf_storage_path: `${userY.userId}/${fixtureY.application.id}.pdf`,
      p_docx_storage_bucket: "generated-documents",
      p_docx_storage_path: `${userY.userId}/${fixtureY.application.id}.docx`,
      p_generation_engine: "canonical",
      p_generation_engine_version: "6G.0",
      p_protected_fact_validation_result: { pdfProtectedFactsUnchanged: true, docxProtectedFactsUnchanged: true, marker: "first-call" },
    });
    check("replay protected-facts: first call succeeds", firstCall.data?.status, "success");

    await admin.rpc("complete_canonical_generation", {
      p_user_id: userY.userId,
      p_application_id: fixtureY.application.id,
      p_tailored_resume_id: overlayY.data.overlayId,
      p_canonical_profile_id: fixtureY.profile.id,
      p_canonical_resume_version_id: fixtureY.version.id,
      p_template_id: "professional-ats",
      p_pdf_storage_bucket: "generated-documents",
      p_pdf_storage_path: "ignored/ignored.pdf",
      p_docx_storage_bucket: "generated-documents",
      p_docx_storage_path: "ignored/ignored.docx",
      p_generation_engine: "canonical",
      p_generation_engine_version: "6G.0",
      p_protected_fact_validation_result: { marker: "replay-call-should-be-ignored" },
    });
    const persisted = pgJson(`select row_to_json(t) from (select protected_fact_validation_result from applications where id = '${fixtureY.application.id}') t;`);
    check("replay protected-facts: the FIRST call's protected_fact_validation_result persists, the replay's own (different) value is correctly ignored", persisted?.protected_fact_validation_result?.marker, "first-call");
  }

  // ==================== 21. system_create_canonical_overlay: p_ai_model / p_prompt_version persist exactly as given ====================
  {
    const userZ = await makeTestUser(admin, "overlay-metadata");
    const fixtureZ = await seedCanonicalFixture(userZ.client, userZ.userId);
    const overlayZ = await admin.rpc("system_create_canonical_overlay", { p_user_id: userZ.userId, p_profile_id: fixtureZ.profile.id, p_resume_version_id: fixtureZ.version.id, p_application_id: fixtureZ.application.id, p_template_id: "modern-sidebar", p_ai_model: "gpt-5.5-custom-test", p_prompt_version: "canonical-tailoring-v7", p_overlay: { schemaVersion: "1.0.0" } });
    const persistedMeta = pgJson(`select row_to_json(t) from (select ai_model, prompt_version, template_id from career_tailored_resumes where id = '${overlayZ.data.overlayId}') t;`);
    check("overlay metadata: ai_model persists exactly as given", persistedMeta?.ai_model, "gpt-5.5-custom-test");
    check("overlay metadata: prompt_version persists exactly as given", persistedMeta?.prompt_version, "canonical-tailoring-v7");
    check("overlay metadata: template_id persists exactly as given", persistedMeta?.template_id, "modern-sidebar");
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
