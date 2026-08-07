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
