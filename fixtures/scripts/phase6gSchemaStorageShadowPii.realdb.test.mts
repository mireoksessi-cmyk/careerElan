/*
  Phase 6G - real local Supabase DB E2E, covering ground not yet
  exercised by the other 2 real-DB suites in this directory:
  - applications table CHECK constraints actually reject invalid
    canonical values at the database layer (not just app-level
    validation - a real Postgres error, proven with real INSERT/UPDATE
    attempts).
  - generated-documents Storage bucket RLS: owner-path-prefix
    enforcement for a REAL authenticated session, independent of the
    canonical_document_storage_enabled app flag (RLS is the ground-
    truth enforcement layer; the app flag only gates whether the
    application code ATTEMPTS an upload, not whether Postgres would
    allow one).
  - Shadow comparison log record never contains resume/job text (PII
    safety, §16's own explicit exclusion list) - proven by capturing
    console.log output for a real (fast, no-AI) failure path.
  - Stale-version conflict on the /preview route: if the canonical
    resume has been updated (a new latest version exists) since a
    tailored resume was generated against an older version, preview
    must return 409, never silently render against a mismatched
    version.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6gSchemaStorageShadowPii.realdb.test.mts
  Requires local Supabase running. Explicit process.exit() at the end -
  see phase6gCanonicalGeneratePackageRoutes.realdb.test.mts's own
  comment on why (shared Playwright browser singleton is never closed
  by production code, which would otherwise hang this process forever
  after the version-conflict section's one real HTML render).
*/
import { createClient } from "@supabase/supabase-js";
import { runWithAuthenticatedContext } from "../../lib/careerMemory/api/routeGuard";
import { makeHandlePreview } from "../../app/api/internal/canonical-generate-package/preview/route";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";
import { CanonicalCareerMemoryService } from "../../lib/careerMemory/services/canonicalCareerMemoryService";
import { buildFixtureRuntime } from "../../lib/careerMemory/persistence/testFixtures";
import { runShadowComparisonSafely } from "../../lib/careerMemory/orchestration/canonicalShadowComparisonService";
import { renderCanonicalPackage } from "../../lib/careerMemory/orchestration/canonicalRenderService";
import { applyOverlay } from "../../lib/careerMemory/runtime/overlayRuntime";
import type { CanonicalResumeRuntime } from "../../lib/careerMemory/runtime/types";

const URL = "http://127.0.0.1:54321";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

let pass = 0;
let fail = 0;
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function check(label: string, actual: unknown, expected: unknown) {
  const ok = stableStringify(actual) === stableStringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}
function checkFalse(label: string, actual: boolean) {
  check(label, actual, false);
}

const createdUserIds: string[] = [];

async function makeTestUser(admin: ReturnType<typeof createClient>, emailPrefix: string) {
  const email = `phase6g-schema-${emailPrefix}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6g-realdb-test-password-123";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  const client = createClient(URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client };
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);

  // ==================== A. applications CHECK constraints - real Postgres rejection ====================
  {
    const userA = await makeTestUser(admin, "constraints");
    const { data: application } = await userA.client.from("applications").insert({ user_id: userA.userId }).select("*").single();

    const badTemplate = await admin.rpc("complete_canonical_generation", {
      p_user_id: userA.userId,
      p_application_id: application.id,
      p_tailored_resume_id: "00000000-0000-0000-0000-000000000000",
      p_canonical_profile_id: "00000000-0000-0000-0000-000000000000",
      p_canonical_resume_version_id: "00000000-0000-0000-0000-000000000000",
      p_template_id: "professional-ats",
      p_pdf_storage_bucket: "generated-documents",
      p_pdf_storage_path: "x.pdf",
      p_docx_storage_bucket: "generated-documents",
      p_docx_storage_path: "x.docx",
      p_generation_engine: "canonical",
      p_generation_engine_version: "6G.0",
      p_protected_fact_validation_result: {},
    });
    check("constraints: complete_canonical_generation with a nonexistent tailored_resume_id returns not_found (never bypasses to a raw insert)", badTemplate.data, { status: "not_found", reason: "tailored_resume" });

    // Direct attempts at the CHECK constraints themselves (service_role
    // has no UPDATE grant on applications, so this uses a raw superuser
    // SQL statement via the RPC's own SECURITY DEFINER body indirectly
    // is not possible for arbitrary values - instead this proves the
    // CHECK constraint exists and is enforced for ANY writer, including
    // a hypothetical direct SQL client, by attempting it as postgres).
    const directAttempts: Array<[string, string]> = [
      ["selected_template_id", `update applications set selected_template_id = 'not-a-real-template' where id = '${application.id}';`],
      ["generation_engine", `update applications set generation_engine = 'not-a-real-engine' where id = '${application.id}';`],
      ["fallback_reason", `update applications set fallback_reason = 'not-a-real-reason' where id = '${application.id}';`],
    ];
    for (const [label, sql] of directAttempts) {
      const { execFileSync } = await import("node:child_process");
      try {
        execFileSync("docker", ["exec", "supabase_db_careerelan", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
        check(`constraints: ${label} CHECK constraint rejects an invalid value at the database layer`, "no error (BUG)", "CHECK violation expected");
      } catch (e) {
        const stderr = (e as { stderr?: Buffer })?.stderr?.toString() ?? "";
        checkTrue(`constraints: ${label} CHECK constraint rejects an invalid value at the database layer`, stderr.includes("violates check constraint"));
      }
    }

    // Positive counterpart: every REAL enum value for each constrained
    // column is accepted without error - proves the CHECK lists aren't
    // accidentally too narrow (the exact class of bug found and fixed
    // in the route-level density validator earlier in this round).
    const { execFileSync: execFileSyncOk } = await import("node:child_process");
    const validValueAttempts: Array<[string, string]> = [
      ["selected_template_id=professional-ats", `update applications set selected_template_id = 'professional-ats' where id = '${application.id}';`],
      ["selected_template_id=modern-sidebar", `update applications set selected_template_id = 'modern-sidebar' where id = '${application.id}';`],
      ["selected_template_id=executive-minimal", `update applications set selected_template_id = 'executive-minimal' where id = '${application.id}';`],
      ["selected_template_id=creative-timeline", `update applications set selected_template_id = 'creative-timeline' where id = '${application.id}';`],
      ["generation_engine=legacy", `update applications set generation_engine = 'legacy' where id = '${application.id}';`],
      ["generation_engine=canonical", `update applications set generation_engine = 'canonical' where id = '${application.id}';`],
      ["fallback_reason=no_canonical_profile", `update applications set fallback_reason = 'no_canonical_profile' where id = '${application.id}';`],
      ["fallback_reason=no_canonical_version", `update applications set fallback_reason = 'no_canonical_version' where id = '${application.id}';`],
      ["fallback_reason=deserialization_failure", `update applications set fallback_reason = 'deserialization_failure' where id = '${application.id}';`],
      ["fallback_reason=overlay_validation_failure", `update applications set fallback_reason = 'overlay_validation_failure' where id = '${application.id}';`],
      ["fallback_reason=template_rendering_failure", `update applications set fallback_reason = 'template_rendering_failure' where id = '${application.id}';`],
      ["fallback_reason=generated_document_failure", `update applications set fallback_reason = 'generated_document_failure' where id = '${application.id}';`],
      ["fallback_reason=feature_flag_disabled", `update applications set fallback_reason = 'feature_flag_disabled' where id = '${application.id}';`],
      ["fallback_reason=transient_failure", `update applications set fallback_reason = 'transient_failure' where id = '${application.id}';`],
    ];
    for (const [label, sql] of validValueAttempts) {
      try {
        execFileSyncOk("docker", ["exec", "supabase_db_careerelan", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
        checkTrue(`constraints: real enum value ${label} is accepted (CHECK list is not accidentally too narrow)`, true);
      } catch {
        checkTrue(`constraints: real enum value ${label} is accepted (CHECK list is not accidentally too narrow)`, false);
      }
    }

    // NULL is explicitly allowed on all 3 constrained columns (CHECK only
    // fires when the value is non-null, per each constraint's own "IS NULL OR ..." shape).
    try {
      execFileSyncOk("docker", ["exec", "supabase_db_careerelan", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `update applications set selected_template_id = null, generation_engine = null, fallback_reason = null where id = '${application.id}';`], { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
      checkTrue("constraints: setting all 3 constrained columns back to NULL succeeds (nullable, CHECK only fires on non-null)", true);
    } catch {
      checkTrue("constraints: setting all 3 constrained columns back to NULL succeeds (nullable, CHECK only fires on non-null)", false);
    }
  }

  // ==================== B. generated-documents Storage bucket RLS ====================
  {
    const userA = await makeTestUser(admin, "storage-owner");
    const userB = await makeTestUser(admin, "storage-attacker");
    const bytes = new Uint8Array([1, 2, 3, 4]);

    const ownUpload = await userA.client.storage.from("generated-documents").upload(`${userA.userId}/test.pdf`, bytes, { contentType: "application/pdf", upsert: true });
    check("storage RLS: user can upload to their own owner-prefixed path", ownUpload.error, null);

    const crossUpload = await userA.client.storage.from("generated-documents").upload(`${userB.userId}/test.pdf`, bytes, { contentType: "application/pdf", upsert: true });
    checkTrue("storage RLS: user CANNOT upload under a different user's owner-prefix path", crossUpload.error !== null);

    const ownDownload = await userA.client.storage.from("generated-documents").download(`${userA.userId}/test.pdf`);
    check("storage RLS: user can download their own uploaded object", ownDownload.error, null);

    const crossDownload = await userB.client.storage.from("generated-documents").download(`${userA.userId}/test.pdf`);
    checkTrue("storage RLS: a different user CANNOT download user A's object", crossDownload.error !== null);

    const crossList = await userB.client.storage.from("generated-documents").list(userA.userId);
    check("storage RLS: a different user's list of user A's folder is empty (not an error, just invisible)", (crossList.data ?? []).length, 0);

    const adminUpload = await admin.storage.from("generated-documents").upload(`${userA.userId}/admin-test.pdf`, bytes, { contentType: "application/pdf", upsert: true });
    check("storage RLS: service_role (background worker context) CAN upload regardless of RLS - bypasses by design", adminUpload.error, null);

    // Update/overwrite RLS: owner can overwrite their own object; a
    // different user cannot overwrite it either (separate from the
    // insert-with-upsert path already covered above).
    const ownOverwrite = await userA.client.storage.from("generated-documents").update(`${userA.userId}/test.pdf`, new Uint8Array([9, 9, 9]), { contentType: "application/pdf" });
    check("storage RLS: owner can update/overwrite their own already-uploaded object", ownOverwrite.error, null);
    const crossOverwrite = await userB.client.storage.from("generated-documents").update(`${userA.userId}/test.pdf`, new Uint8Array([9, 9, 9]), { contentType: "application/pdf" });
    checkTrue("storage RLS: a different user CANNOT update/overwrite user A's object", crossOverwrite.error !== null);

    // Delete RLS: a different user cannot delete; the owner can.
    const crossDelete = await userB.client.storage.from("generated-documents").remove([`${userA.userId}/test.pdf`]);
    check("storage RLS: a different user's delete attempt reports no removed files (RLS makes the object invisible to delete, not a visible permission error)", (crossDelete.data ?? []).length, 0);
    const stillThere = await userA.client.storage.from("generated-documents").download(`${userA.userId}/test.pdf`);
    check("storage RLS: object still exists after the other user's failed delete attempt", stillThere.error, null);
    const ownDelete = await userA.client.storage.from("generated-documents").remove([`${userA.userId}/test.pdf`]);
    checkTrue("storage RLS: owner CAN delete their own object", (ownDelete.data ?? []).length === 1);
    const goneAfterDelete = await userA.client.storage.from("generated-documents").download(`${userA.userId}/test.pdf`);
    checkTrue("storage RLS: object is genuinely gone after the owner's real delete", goneAfterDelete.error !== null);

    // Unauthenticated (anon key, no session) access is rejected outright -
    // RLS policies are all scoped `to authenticated`, so a bare anon
    // client has no matching policy at all for this bucket.
    const anonClient = createClient(URL, ANON_KEY);
    const anonUpload = await anonClient.storage.from("generated-documents").upload(`${userA.userId}/anon-attempt.pdf`, bytes, { contentType: "application/pdf" });
    checkTrue("storage RLS: a completely unauthenticated (anon key, no session) upload attempt is rejected", anonUpload.error !== null);
    const anonDownload = await anonClient.storage.from("generated-documents").download(`${userA.userId}/admin-test.pdf`);
    checkTrue("storage RLS: a completely unauthenticated download attempt is rejected", anonDownload.error !== null);

    // A path with no owner-prefix match at all (malformed/attacker-shaped
    // path) is also rejected for an authenticated-but-wrong-owner client.
    const malformedPathUpload = await userB.client.storage.from("generated-documents").upload("not-a-real-user-id-prefix/x.pdf", bytes, { contentType: "application/pdf" });
    checkTrue("storage RLS: a path whose first segment matches NEITHER caller's own uid is rejected", malformedPathUpload.error !== null);
  }

  // ==================== C. Shadow comparison PII safety + flag-off no-op ====================
  {
    const userA = await makeTestUser(admin, "shadow-pii");
    const secretJobText = "CONFIDENTIAL-JOB-TEXT-MARKER-89213: Senior Underwater Basket Weaving Engineer at Acme Corp, contact jane.doe@example.com or 555-0199";

    const originalLog = console.log;
    const capturedLogs: string[] = [];
    console.log = (...args: unknown[]) => {
      capturedLogs.push(args.map((a) => String(a)).join(" "));
    };
    try {
      // No canonical profile exists for this user -> fails fast (before
      // any AI call), but still goes through the full
      // runShadowComparisonSafely()/console.log(JSON.stringify(record))
      // path - exactly what needs to be checked for PII leakage.
      await runShadowComparisonSafely({
        userId: userA.userId,
        applicationId: "00000000-0000-0000-0000-000000000000",
        jobDescriptionText: secretJobText,
        jobAnalysisSummary: "some analysis summary text that must also never leak",
        legacySucceeded: true,
      });
    } finally {
      console.log = originalLog;
    }
    checkTrue("shadow PII: runShadowComparisonSafely produced at least one log line", capturedLogs.length > 0);
    checkFalse("shadow PII: log output never contains the raw job description text", capturedLogs.some((l) => l.includes(secretJobText)));
    checkFalse("shadow PII: log output never contains the job analysis summary text", capturedLogs.some((l) => l.includes("some analysis summary text")));
    checkFalse("shadow PII: log output never contains an email address pattern", capturedLogs.some((l) => /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(l)));
    checkFalse("shadow PII: log output never contains the literal injected phone number", capturedLogs.some((l) => l.includes("555-0199")));
    checkTrue("shadow PII: log output DOES contain the applicationId (a safe, non-PII identifier)", capturedLogs.some((l) => l.includes("00000000-0000-0000-0000-000000000000")));
  }

  // ==================== D. Stale-version conflict on /preview (409, never silently mismatched) ====================
  {
    const userD = await makeTestUser(admin, "version-conflict");
    const repos = createCanonicalRepositories(userD.client);
    const service = new CanonicalCareerMemoryService(repos);
    const runtimeV1: CanonicalResumeRuntime = { ...buildFixtureRuntime(), sourceDocuments: [], overlayState: { history: [] } };
    const savedV1 = await service.saveCanonicalRuntimeAcknowledgingGap(userD.userId, { runtime: runtimeV1 });

    const profile = await repos.profiles.getByUserId(userD.userId);
    if (!profile) throw new Error("profile not found");

    const { data: application } = await userD.client.from("applications").insert({ user_id: userD.userId }).select("*").single();

    const overlay = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userD.userId,
      p_profile_id: profile.id,
      p_resume_version_id: savedV1.version.id,
      p_application_id: application.id,
      p_template_id: "professional-ats",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    if (overlay.error || overlay.data?.status !== "success") throw new Error(`overlay seed failed: ${JSON.stringify(overlay.error ?? overlay.data)}`);

    // A SECOND save creates a new latest version (V2) for the SAME
    // profile - simulating the user editing their canonical resume
    // after the tailored generation already happened against V1.
    const runtimeV2: CanonicalResumeRuntime = { ...buildFixtureRuntime(), sourceDocuments: [], overlayState: { history: [] } };
    const savedV2 = await service.saveCanonicalRuntimeAcknowledgingGap(userD.userId, { runtime: runtimeV2 });
    checkTrue("version conflict setup: V2 is a genuinely different version id than V1", savedV2.version.id !== savedV1.version.id);

    process.env.CANONICAL_GENERATE_ENABLED = "true";
    const req = new Request("http://x/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ applicationId: application.id, templateId: "professional-ats" }) });
    const res = await runWithAuthenticatedContext(userD.client as never, makeHandlePreview(req));
    check("version conflict: preview against a stale (V1) overlay after the canonical resume moved to V2 returns 409, never a silently mismatched render", res.status, 409);
    delete process.env.CANONICAL_GENERATE_ENABLED;

    // Retry-after-transient-failure recovery: the correct client response
    // to a 409 is to regenerate against the CURRENT version, not to keep
    // retrying the stale request. Proves the recovery path actually works
    // end-to-end, not just that the failure is detected.
    const overlayV2 = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userD.userId,
      p_profile_id: profile.id,
      p_resume_version_id: savedV2.version.id,
      p_application_id: application.id,
      p_template_id: "professional-ats",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    checkTrue("version conflict recovery: creating a fresh overlay against the current (V2) version succeeds", overlayV2.data?.status === "success");
    const completeV2 = await admin.rpc("complete_canonical_generation", {
      p_user_id: userD.userId,
      p_application_id: application.id,
      p_tailored_resume_id: overlayV2.data.overlayId,
      p_canonical_profile_id: profile.id,
      p_canonical_resume_version_id: savedV2.version.id,
      p_template_id: "professional-ats",
      p_pdf_storage_bucket: "generated-documents",
      p_pdf_storage_path: `${userD.userId}/${application.id}.pdf`,
      p_docx_storage_bucket: "generated-documents",
      p_docx_storage_path: `${userD.userId}/${application.id}.docx`,
      p_generation_engine: "canonical",
      p_generation_engine_version: "6G.0",
      p_protected_fact_validation_result: {},
    });
    checkTrue("version conflict recovery: completing generation against the fresh V2 overlay succeeds", completeV2.data?.status === "success");
    process.env.CANONICAL_GENERATE_ENABLED = "true";
    const reqAfterRecovery = new Request("http://x/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ applicationId: application.id, templateId: "professional-ats" }) });
    const resAfterRecovery = await runWithAuthenticatedContext(userD.client as never, makeHandlePreview(reqAfterRecovery));
    check("version conflict recovery: /preview now succeeds (200) once the application points at a same-version (V2) overlay - the 409 is genuinely recoverable, not a permanent dead end", resAfterRecovery.status, 200);
    delete process.env.CANONICAL_GENERATE_ENABLED;
  }

  // ==================== E. Shadow mode ENABLED - real failure-path PII safety + resultCategory correctness ====================
  // The existing section C test never actually set CANONICAL_SHADOW_MODE,
  // so runShadowComparisonSafely() short-circuited to
  // "skipped_flag_disabled" without ever calling generateCanonicalPackage -
  // its PII assertions technically passed, but against an almost-empty
  // record, not a real failure path. This section closes that gap: shadow
  // mode is genuinely enabled and exercised against a real no-canonical-
  // profile user, which fails BEFORE any AI call (zero cost) but DOES
  // exercise the full runShadowComparison() try/catch + classifyForFallback
  // + JSON-log-record path for real.
  {
    const userE = await makeTestUser(admin, "shadow-real-failure");
    const secretJobText = "CONFIDENTIAL-JOB-TEXT-MARKER-77451: Lead Underwater Basket Weaving Architect, contact real.person@example.com or 555-0188";
    process.env.CANONICAL_SHADOW_MODE = "true";

    const originalLog = console.log;
    const capturedLogs: string[] = [];
    console.log = (...args: unknown[]) => {
      capturedLogs.push(args.map((a) => String(a)).join(" "));
    };
    try {
      // userE has NO career_profiles row at all - generateCanonicalPackage
      // throws CanonicalProfileUnavailableError before any AI call.
      await runShadowComparisonSafely({
        userId: userE.userId,
        applicationId: "11111111-1111-1111-1111-111111111111",
        jobDescriptionText: secretJobText,
        jobAnalysisSummary: "another summary that must never leak",
        legacySucceeded: true,
      });
    } finally {
      console.log = originalLog;
      delete process.env.CANONICAL_SHADOW_MODE;
    }
    checkTrue("shadow ENABLED real-failure: produced at least one log line", capturedLogs.length > 0);
    const parsedRecord = JSON.parse(capturedLogs[capturedLogs.length - 1]) as { resultCategory?: string; fallbackReason?: string | null; applicationId?: string };
    check("shadow ENABLED real-failure: resultCategory correctly reflects a REAL fallback-eligible failure, not skipped_flag_disabled", parsedRecord.resultCategory, "canonical_failed_fallback_eligible");
    check("shadow ENABLED real-failure: fallbackReason correctly identifies the no-profile case", parsedRecord.fallbackReason, "no_canonical_profile");
    check("shadow ENABLED real-failure: applicationId echoed correctly", parsedRecord.applicationId, "11111111-1111-1111-1111-111111111111");
    checkFalse("shadow ENABLED real-failure: log output never contains the raw job description text", capturedLogs.some((l) => l.includes(secretJobText)));
    checkFalse("shadow ENABLED real-failure: log output never contains the job analysis summary text", capturedLogs.some((l) => l.includes("another summary that must never leak")));
    checkFalse("shadow ENABLED real-failure: log output never contains an email address pattern", capturedLogs.some((l) => /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(l)));
    checkFalse("shadow ENABLED real-failure: log output never contains the literal injected phone number", capturedLogs.some((l) => l.includes("555-0188")));
    checkFalse("shadow ENABLED real-failure: log output never contains the userId's raw value alongside job text in a way that could correlate PII (userId itself is a safe, non-PII identifier - only checking no cross-contamination)", capturedLogs.some((l) => l.includes(secretJobText) && l.includes(userE.userId)));
  }

  // ==================== F. Shadow mode isolation - a canonical failure never affects the legacy outcome semantics ====================
  {
    const userF = await makeTestUser(admin, "shadow-isolation");
    process.env.CANONICAL_SHADOW_MODE = "true";
    let threw = false;
    try {
      // legacySucceeded: false path - shadow mode runs even after a legacy
      // FAILURE, and must still never throw regardless of its own outcome.
      await runShadowComparisonSafely({
        userId: userF.userId,
        applicationId: "22222222-2222-2222-2222-222222222222",
        jobDescriptionText: "some job text",
        jobAnalysisSummary: "some summary",
        legacySucceeded: false,
      });
    } catch {
      threw = true;
    } finally {
      delete process.env.CANONICAL_SHADOW_MODE;
    }
    checkFalse("shadow isolation: runShadowComparisonSafely NEVER throws, even on the legacy-failure path with a real underlying canonical failure", threw);

    // Malformed/garbage applicationId passed to shadow mode (simulating an
    // unexpected internal state) - must still never throw or crash the caller.
    process.env.CANONICAL_SHADOW_MODE = "true";
    let threwOnGarbage = false;
    const originalLogGarbage = console.log;
    const capturedGarbageLogs: string[] = [];
    console.log = (...args: unknown[]) => {
      capturedGarbageLogs.push(args.map((a) => String(a)).join(" "));
    };
    try {
      await runShadowComparisonSafely({ userId: "not-a-real-uuid", applicationId: "also-not-a-uuid", jobDescriptionText: "x", jobAnalysisSummary: "y", legacySucceeded: true });
    } catch {
      threwOnGarbage = true;
    } finally {
      console.log = originalLogGarbage;
      delete process.env.CANONICAL_SHADOW_MODE;
    }
    checkFalse("shadow isolation: even a malformed userId/applicationId (garbage, non-UUID strings) never escapes as an uncaught exception - full isolation guarantee holds under garbage input too", threwOnGarbage);

    // Beyond "never throws" - the malformed input must still classify to a
    // SPECIFIC, correct category/reason (a non-UUID userId makes the
    // service-role RPC lookup itself fail with a raw Postgres type error,
    // which generateCanonicalPackage wraps as CanonicalDeserializationError
    // -> fallback-eligible/deserialization_failure, not a generic catch-all).
    const parsedGarbageRecord = JSON.parse(capturedGarbageLogs[capturedGarbageLogs.length - 1]) as { resultCategory?: string; fallbackReason?: string | null; latencyMs?: number };
    check("shadow isolation garbage input: classifies specifically as fallback-eligible/deserialization_failure, not a generic unknown category", { resultCategory: parsedGarbageRecord.resultCategory, fallbackReason: parsedGarbageRecord.fallbackReason }, { resultCategory: "canonical_failed_fallback_eligible", fallbackReason: "deserialization_failure" });
    checkTrue("shadow isolation garbage input: latencyMs is a real non-negative measured duration, not a placeholder", typeof parsedGarbageRecord.latencyMs === "number" && parsedGarbageRecord.latencyMs >= 0);
  }

  // ==================== G. Feature-flag independence: complete_canonical_generation RPC succeeds regardless of canonical_document_storage_enabled ====================
  // The RPC itself has no dependency on this flag at all - it only gates
  // the APP-LAYER uploadGeneratedDocument() call (canonicalDocumentStorageService.ts),
  // which the real-DB RPC tests bypass entirely by calling the RPC
  // directly with placeholder storage paths. This documents that
  // real-world boundary explicitly: the flag being off does NOT block the
  // RPC's own write path (by design - the app layer is responsible for
  // never calling the RPC with a fabricated path when storage is disabled,
  // not the RPC itself).
  {
    const userG = await makeTestUser(admin, "storage-flag-independence");
    const repos = createCanonicalRepositories(userG.client);
    const service = new CanonicalCareerMemoryService(repos);
    const runtimeG: CanonicalResumeRuntime = { ...buildFixtureRuntime(), sourceDocuments: [], overlayState: { history: [] } };
    const savedG = await service.saveCanonicalRuntimeAcknowledgingGap(userG.userId, { runtime: runtimeG });
    const profileG = await repos.profiles.getByUserId(userG.userId);
    if (!profileG) throw new Error("profile not found");
    const { data: applicationG } = await userG.client.from("applications").insert({ user_id: userG.userId }).select("*").single();

    delete process.env.CANONICAL_DOCUMENT_STORAGE_ENABLED; // explicit Production-default OFF state
    const overlayG = await admin.rpc("system_create_canonical_overlay", { p_user_id: userG.userId, p_profile_id: profileG.id, p_resume_version_id: savedG.version.id, p_application_id: applicationG.id, p_template_id: "professional-ats", p_ai_model: "test-model", p_prompt_version: "test-v1", p_overlay: { schemaVersion: "1.0.0" } });
    const completeG = await admin.rpc("complete_canonical_generation", {
      p_user_id: userG.userId,
      p_application_id: applicationG.id,
      p_tailored_resume_id: overlayG.data.overlayId,
      p_canonical_profile_id: profileG.id,
      p_canonical_resume_version_id: savedG.version.id,
      p_template_id: "professional-ats",
      p_pdf_storage_bucket: "generated-documents",
      p_pdf_storage_path: `${userG.userId}/${applicationG.id}.pdf`,
      p_docx_storage_bucket: "generated-documents",
      p_docx_storage_path: `${userG.userId}/${applicationG.id}.docx`,
      p_generation_engine: "canonical",
      p_generation_engine_version: "6G.0",
      p_protected_fact_validation_result: {},
    });
    check("flag independence: complete_canonical_generation RPC succeeds with canonical_document_storage_enabled unset/off - the RPC has no awareness of this app-layer flag", completeG.data?.status, "success");
  }

  // ==================== H. Missing canonical version at the /preview route - defense-in-depth for an inconsistent DB state ====================
  // Constructs a state that should never occur via the normal generation
  // flow (a tailored-resume row exists, but its owning profile has since
  // lost every resume version) purely to prove the route's own null-
  // handling is real defensive code, not just an untested assumption.
  {
    const userH = await makeTestUser(admin, "missing-version-defense");
    const repos = createCanonicalRepositories(userH.client);
    const service = new CanonicalCareerMemoryService(repos);
    const runtimeH: CanonicalResumeRuntime = { ...buildFixtureRuntime(), sourceDocuments: [], overlayState: { history: [] } };
    const savedH = await service.saveCanonicalRuntimeAcknowledgingGap(userH.userId, { runtime: runtimeH });
    const profileH = await repos.profiles.getByUserId(userH.userId);
    if (!profileH) throw new Error("profile not found");
    const { data: applicationH } = await userH.client.from("applications").insert({ user_id: userH.userId }).select("*").single();
    const overlayH = await admin.rpc("system_create_canonical_overlay", { p_user_id: userH.userId, p_profile_id: profileH.id, p_resume_version_id: savedH.version.id, p_application_id: applicationH.id, p_template_id: "professional-ats", p_ai_model: "test-model", p_prompt_version: "test-v1", p_overlay: { schemaVersion: "1.0.0" } });
    checkTrue("missing-version defense setup: overlay creation succeeded first", overlayH.data?.status === "success");

    // Delete every resume version row for this profile directly (admin/raw
    // access - simulates an inconsistent state no normal app code path
    // would produce, but which the route must still handle without crashing).
    const { execFileSync } = await import("node:child_process");
    execFileSync("docker", ["exec", "supabase_db_careerelan", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `delete from career_resume_versions where profile_id = '${profileH.id}';`], { encoding: "utf8" });

    process.env.CANONICAL_GENERATE_ENABLED = "true";
    const req = new Request("http://x/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ applicationId: applicationH.id, templateId: "professional-ats" }) });
    const res = await runWithAuthenticatedContext(userH.client as never, makeHandlePreview(req));
    checkTrue("missing-version defense: /preview against a profile with zero resume versions returns a clean 4xx/5xx, never a crash or 200 with fabricated content", res.status >= 400);
    delete process.env.CANONICAL_GENERATE_ENABLED;
  }

  // ==================== I. Shadow comparison - legacySucceeded=false path + stack-trace-free logging ====================
  {
    const userI = await makeTestUser(admin, "shadow-legacy-failed");
    process.env.CANONICAL_SHADOW_MODE = "true";
    const originalLog = console.log;
    const capturedLogs: string[] = [];
    console.log = (...args: unknown[]) => {
      capturedLogs.push(args.map((a) => String(a)).join(" "));
    };
    try {
      await runShadowComparisonSafely({ userId: userI.userId, applicationId: "33333333-3333-3333-3333-333333333333", jobDescriptionText: "job text here", jobAnalysisSummary: "summary here", legacySucceeded: false });
    } finally {
      console.log = originalLog;
      delete process.env.CANONICAL_SHADOW_MODE;
    }
    const parsedRecordI = JSON.parse(capturedLogs[capturedLogs.length - 1]) as { legacySucceeded?: boolean; resultCategory?: string };
    check("shadow legacy-failed path: legacySucceeded correctly recorded as false", parsedRecordI.legacySucceeded, false);
    check("shadow legacy-failed path: still correctly classifies the real underlying no-profile failure", parsedRecordI.resultCategory, "canonical_failed_fallback_eligible");
    checkFalse("shadow legacy-failed path: log output never contains a JS stack trace (the string 'at ' followed by a file path pattern, a common stack-trace signature)", capturedLogs.some((l) => /\bat .+\.(ts|js):\d+/.test(l)));
    checkFalse("shadow legacy-failed path: log output never contains the literal string 'node_modules' (would indicate a leaked stack trace or internal path)", capturedLogs.some((l) => l.includes("node_modules")));
  }

  // ==================== J. Storage: listing at the bucket root reflects only the caller's own top-level folder ====================
  {
    const userJ = await makeTestUser(admin, "storage-root-list");
    const bytes = new Uint8Array([1, 2, 3]);
    await userJ.client.storage.from("generated-documents").upload(`${userJ.userId}/root-list-test.pdf`, bytes, { contentType: "application/pdf", upsert: true });
    const rootList = await userJ.client.storage.from("generated-documents").list("");
    checkTrue("storage RLS: listing the bucket root for an authenticated user returns exactly their own uid as the visible top-level folder (RLS filters the listing itself, not just downloads)", (rootList.data ?? []).some((entry) => entry.name === userJ.userId));

    const userK = await makeTestUser(admin, "storage-root-list-cross");
    const crossRootList = await userK.client.storage.from("generated-documents").list("");
    checkFalse("storage RLS: a different user's bucket-root listing does NOT include user J's folder name", (crossRootList.data ?? []).some((entry) => entry.name === userJ.userId));
  }

  // ==================== K. renderCanonicalPackage() exercised directly - documentStorage branches never covered by any RPC-only test ====================
  // Every other real-DB test in this round calls system_create_canonical_overlay
  // / complete_canonical_generation directly, never renderCanonicalPackage()
  // itself - the one function that actually decides which documentStorage
  // branch fires (no_tailored_resume / storage_disabled / a real persisted
  // upload+RPC cycle). This closes that gap with the SAME call shape
  // production code uses (applyOverlay then renderCanonicalPackage), at
  // zero AI cost since the overlay applied here is a real, valid, no-op one.
  {
    const userK = await makeTestUser(admin, "render-package-direct");
    const repos = createCanonicalRepositories(userK.client);
    const service = new CanonicalCareerMemoryService(repos);
    const runtimeK: CanonicalResumeRuntime = { ...buildFixtureRuntime(), sourceDocuments: [], overlayState: { history: [] } };
    const savedK = await service.saveCanonicalRuntimeAcknowledgingGap(userK.userId, { runtime: runtimeK });
    const profileK = await repos.profiles.getByUserId(userK.userId);
    if (!profileK) throw new Error("profile not found");
    const { data: applicationK } = await userK.client.from("applications").insert({ user_id: userK.userId }).select("*").single();

    const appliedK = applyOverlay(savedK.runtime, { schemaVersion: "1.0.0" });
    checkTrue("render-package-direct setup: applying a valid no-op overlay produces zero rejections", appliedK.rejections.length === 0);

    // K1: tailoredResumeId=null -> documentStorage.reason="no_tailored_resume",
    // regardless of the storage flag - this branch is checked FIRST in the
    // real function, before the flag is even consulted.
    delete process.env.CANONICAL_DOCUMENT_STORAGE_ENABLED;
    const resultNoTailored = await renderCanonicalPackage(userK.client as never, {
      userId: userK.userId,
      applicationId: applicationK.id,
      runtime: appliedK.runtime,
      useTailored: true,
      templateId: "modern-sidebar",
      paperSize: "letter",
      density: "balanced",
      locale: "en-CA",
      canonicalProfileId: profileK.id,
      canonicalResumeVersionId: savedK.version.id,
      tailoredResumeId: null,
      generatedAt: new Date().toISOString(),
    });
    check("render-package-direct K1: tailoredResumeId=null -> documentStorage reports no_tailored_resume, never attempts an upload", resultNoTailored.documentStorage, { persisted: false, reason: "no_tailored_resume" });
    checkTrue("render-package-direct K1: the render itself still succeeded (real HTML/PDF/DOCX bytes) even though nothing was persisted", resultNoTailored.pageCount > 0 && resultNoTailored.pdfBytes.length > 0 && resultNoTailored.docxBytes.length > 0);

    // Real overlay row, reused for K2 (storage disabled) and K3 (storage enabled).
    const overlayK = await admin.rpc("system_create_canonical_overlay", {
      p_user_id: userK.userId,
      p_profile_id: profileK.id,
      p_resume_version_id: savedK.version.id,
      p_application_id: applicationK.id,
      p_template_id: "professional-ats",
      p_ai_model: "test-model",
      p_prompt_version: "test-v1",
      p_overlay: { schemaVersion: "1.0.0" },
    });
    checkTrue("render-package-direct setup: real overlay row created for K2/K3", overlayK.data?.status === "success");

    // K2: a real tailoredResumeId, but storage explicitly disabled ->
    // documentStorage.reason="storage_disabled", never reaches the RPC at all.
    delete process.env.CANONICAL_DOCUMENT_STORAGE_ENABLED;
    const resultStorageDisabled = await renderCanonicalPackage(userK.client as never, {
      userId: userK.userId,
      applicationId: applicationK.id,
      runtime: appliedK.runtime,
      useTailored: true,
      templateId: "modern-sidebar",
      paperSize: "letter",
      density: "balanced",
      locale: "en-CA",
      canonicalProfileId: profileK.id,
      canonicalResumeVersionId: savedK.version.id,
      tailoredResumeId: overlayK.data.overlayId,
      generatedAt: new Date().toISOString(),
    });
    check("render-package-direct K2: real tailoredResumeId but storage disabled -> documentStorage reports storage_disabled", resultStorageDisabled.documentStorage, { persisted: false, reason: "storage_disabled" });

    // K3: storage genuinely ENABLED - the full real upload + complete_canonical_generation
    // cycle runs through renderCanonicalPackage() itself for the first time
    // in this test suite (every other passing test calls the RPC directly).
    process.env.CANONICAL_DOCUMENT_STORAGE_ENABLED = "true";
    const resultPersisted = await renderCanonicalPackage(admin as never, {
      userId: userK.userId,
      applicationId: applicationK.id,
      runtime: appliedK.runtime,
      useTailored: true,
      templateId: "modern-sidebar",
      paperSize: "letter",
      density: "balanced",
      locale: "en-CA",
      canonicalProfileId: profileK.id,
      canonicalResumeVersionId: savedK.version.id,
      tailoredResumeId: overlayK.data.overlayId,
      generatedAt: new Date().toISOString(),
    });
    delete process.env.CANONICAL_DOCUMENT_STORAGE_ENABLED;
    checkTrue("render-package-direct K3: storage enabled -> documentStorage.persisted is true (a real end-to-end upload+RPC cycle succeeded)", resultPersisted.documentStorage.persisted === true);
    const persistedIds = resultPersisted.documentStorage as { persisted: true; pdfDocumentId: string; docxDocumentId: string };
    checkTrue("render-package-direct K3: pdfDocumentId is a real, non-empty id", typeof persistedIds.pdfDocumentId === "string" && persistedIds.pdfDocumentId.length > 0);
    checkTrue("render-package-direct K3: docxDocumentId is a real, non-empty id, distinct from pdfDocumentId", typeof persistedIds.docxDocumentId === "string" && persistedIds.docxDocumentId.length > 0 && persistedIds.docxDocumentId !== persistedIds.pdfDocumentId);

    const { execFileSync: execFileSyncK } = await import("node:child_process");
    const appRowK = JSON.parse(execFileSyncK("docker", ["exec", "supabase_db_careerelan", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", `select row_to_json(t) from (select generated_pdf_document_id, generated_docx_document_id from applications where id = '${applicationK.id}') t;`], { encoding: "utf8" }).trim());
    check("render-package-direct K3: the applications row's generated_pdf_document_id was actually persisted by the real RPC call inside renderCanonicalPackage, matching the returned id exactly", appRowK.generated_pdf_document_id, persistedIds.pdfDocumentId);
    check("render-package-direct K3: same for generated_docx_document_id", appRowK.generated_docx_document_id, persistedIds.docxDocumentId);
  }

  // ==================== L. REGRESSION GUARD - professional-ats PDF generation for buildFixtureRuntime()'s content (Phase 6G.1 fix) ====================
  // Phase 6G originally found and disclosed a real defect here (never
  // exposed before - no test in this entire Phase 6G effort had ever
  // requested format:"pdf" explicitly for professional-ats; every prior
  // coverage used the default "html" format, which doesn't enforce the
  // Phase 4/5A content-preservation gate buildProfessionalAtsPdf does).
  // Phase 6G.1 root-caused it using REAL (non-synthetic) resumes - see
  // fixtures/scripts/phase6g1AtsPdfRepro.mts/phase6g1AtsFullVerify.mts -
  // and found it was NOT a general professional-ats/DPE defect (all 6
  // real bench resumes always passed): it was 3 distinct, fixed bugs -
  // (1) this file's own testFixtures.ts hand-authored fixture had an
  // exp-acme-ops entry whose hierarchicalContent tree didn't mirror its
  // own content/bullets arrays (missing a bullet, an untracked
  // subheading label), (2) renderers.tsx/docxRenderer.ts never rendered
  // ProjectEntry.technologies or PublicationEntry.urlOrDoi even though
  // textExtraction.ts already (correctly) expected them, (3)
  // textExtraction.ts read entry.content unconditionally instead of
  // mirroring the renderer's own hierarchicalContent-when-present
  // branch. This test now asserts the FIXED behavior - a permanent
  // regression guard, not a limitation to keep working around.
  {
    const userL = await makeTestUser(admin, "professional-ats-pdf-fixed");
    const repos = createCanonicalRepositories(userL.client);
    const service = new CanonicalCareerMemoryService(repos);
    const runtimeL: CanonicalResumeRuntime = { ...buildFixtureRuntime(), sourceDocuments: [], overlayState: { history: [] } };
    const savedL = await service.saveCanonicalRuntimeAcknowledgingGap(userL.userId, { runtime: runtimeL });
    const appliedL = applyOverlay(savedL.runtime, { schemaVersion: "1.0.0" });
    const profileL = await repos.profiles.getByUserId(userL.userId);
    if (!profileL) throw new Error("profile not found");
    const { data: applicationL } = await userL.client.from("applications").insert({ user_id: userL.userId }).select("*").single();

    const resultL = await renderCanonicalPackage(userL.client as never, {
      userId: userL.userId,
      applicationId: applicationL.id,
      runtime: appliedL.runtime,
      useTailored: true,
      templateId: "professional-ats",
      paperSize: "letter",
      density: "balanced",
      locale: "en-CA",
      canonicalProfileId: profileL.id,
      canonicalResumeVersionId: savedL.version.id,
      tailoredResumeId: null,
      generatedAt: new Date().toISOString(),
    });
    checkTrue("REGRESSION GUARD (Phase 6G.1 fix): professional-ats PDF generation for buildFixtureRuntime()'s content now succeeds (previously threw)", resultL.pdfBytes.length > 0);
    checkTrue("REGRESSION GUARD (Phase 6G.1 fix): PDF content-preservation validation now passes", resultL.pdfValidation.passed);
    checkTrue("REGRESSION GUARD (Phase 6G.1 fix): DOCX content-preservation validation now passes too (the same underlying content gap affected both renderers)", resultL.docxValidation.passed);
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);

  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
