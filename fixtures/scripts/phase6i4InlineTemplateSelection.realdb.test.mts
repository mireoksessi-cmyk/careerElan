/*
  Phase 6I.4 - Inline Template Selection at Career Memory Completion,
  real-DB verification. app/career-memory/page.tsx's own
  runInlineCanonicalFlow()/selectInlineTemplate() are plain client-side
  React state machines with no dedicated component-testing harness in
  this codebase (every phase this session has instead verified the real
  server-side routes/services those functions call, matching the
  established convention - see phase6i2CanonicalTemplateLifecycle.
  realdb.test.mts's own header comment). This file exercises the EXACT
  SAME sequence runInlineCanonicalFlow() performs, in the same order,
  against a REAL local Supabase instance:

    GET config -> GET template-preference -> GET profile
      -> [POST import-resume only if profile 404] -> GET templates
      -> PUT template-preference

  for every branch spec section 8 requires: brand-new user (import
  runs), existing profile with NULL default (import skipped, picker
  still required), existing profile WITH a default (picker skipped
  entirely), and legacy-only (nothing applicable). No real OpenAI call
  anywhere in this file - nothing in the import or template-preference
  path can reach OpenAI (verified by what those modules import).

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i4InlineTemplateSelection.realdb.test.mts
  Requires local Supabase running.
*/
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { runWithAuthenticatedContext } from "../../lib/careerMemory/api/routeGuard";
import { makeHandleConfig } from "../../app/api/internal/canonical-generate-package/config/route";
import { handleGetTemplatePreference, makeHandlePutTemplatePreference } from "../../app/api/internal/canonical-career-memory/template-preference/route";
import { handleGetProfile } from "../../app/api/internal/canonical-career-memory/profile/route";
import { makeHandleImportResume } from "../../app/api/internal/canonical-career-memory/import-resume/route";
import { GET as getTemplates } from "../../app/api/internal/canonical-career-memory/templates/route";

const URL = "http://127.0.0.1:54321";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const FIXTURE_PDF_PATH = "fixtures/resumes/standard-pdf-resume.pdf";
const FIXTURE_PDF_2_PATH = "fixtures/resumes/threepage-pdf-resume.pdf";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}

async function makeTestUser(admin: ReturnType<typeof createClient>, emailPrefix: string) {
  const email = `phase6i4-${emailPrefix}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i4-realdb-test-password-123";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client };
}

async function seedUploadedResume(admin: ReturnType<typeof createClient>, user: { userId: string; client: ReturnType<typeof createClient> }, fileName: string, isDefault = true, filePath = FIXTURE_PDF_PATH) {
  const bytes = readFileSync(filePath);
  const storagePath = `${user.userId}/${Date.now()}-${fileName}`;
  const { error: uploadError } = await admin.storage.from("resumes").upload(storagePath, bytes, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;
  const { data: resumeRow, error: insertError } = await user.client
    .from("resumes")
    .insert({ user_id: user.userId, file_name: fileName, storage_path: storagePath, source_type: "uploaded", original_file_type: "pdf", is_default: isDefault })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return resumeRow.id as string;
}

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, { method, headers: body !== undefined ? { "content-type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);

  // ==================== 0. Config flag (pure logic, no user needed) ====================
  const userConfig = await makeTestUser(admin, "config");
  {
    const res = await runWithAuthenticatedContext(userConfig.client as never, makeHandleConfig());
    check("config route -> 200", res.status, 200);
    const body = await res.json();
    checkTrue("config route returns booleans for both flags", typeof body.generateEnabled === "boolean" && typeof body.templateSelectorEnabled === "boolean");
  }

  // ==================== A. Brand-new user: no profile yet -> import runs, then picker required ====================
  const userA = await makeTestUser(admin, "new-upload");
  const resumeIdA = await seedUploadedResume(admin, userA, "standard-pdf-resume.pdf");
  {
    // Server-side preconditions runInlineCanonicalFlow() reads, in order:
    const prefBefore = await runWithAuthenticatedContext(userA.client as never, handleGetTemplatePreference);
    const prefBeforeBody = await prefBefore.json();
    check("new user: template-preference before import -> defaultTemplateId null", prefBeforeBody.defaultTemplateId, null);

    const profileBefore = await runWithAuthenticatedContext(userA.client as never, handleGetProfile);
    check("new user: profile before import -> 404 (import SHOULD run)", profileBefore.status, 404);

    // import-resume, using the just-uploaded resumeId (mirrors runInlineCanonicalFlow's own call).
    const importRes = await runWithAuthenticatedContext(userA.client as never, makeHandleImportResume(jsonRequest("http://x/import-resume", "POST", { resumeId: resumeIdA })));
    check("new user: import-resume -> 201 (first import)", importRes.status, 201);
    const importBody = await importRes.json();
    checkTrue("new user: import returns a real profileId", typeof importBody.profileId === "string" && importBody.profileId.length > 0);
    check("new user: import is not a replay the first time", importBody.alreadyImported, false);

    const profileAfterImport = await runWithAuthenticatedContext(userA.client as never, handleGetProfile);
    check("new user: profile after import -> 200 (exists now)", profileAfterImport.status, 200);

    // Templates list (unauthenticated dev-only route, matches CanonicalTemplatePicker's own data source).
    const templatesRes = await getTemplates();
    check("templates route -> 200", templatesRes.status, 200);
    const templatesBody = await templatesRes.json();
    check("templates route returns exactly 4 templates", templatesBody.templates?.length, 4);

    // Select one (PUT template-preference), completing the inline flow.
    const putRes = await runWithAuthenticatedContext(userA.client as never, makeHandlePutTemplatePreference(jsonRequest("http://x/template-preference", "PUT", { templateId: "modern-sidebar" })));
    check("new user: PUT template-preference -> 200", putRes.status, 200);
    const putBody = await putRes.json();
    check("new user: selection persisted", putBody.defaultTemplateId, "modern-sidebar");

    // Retry/idempotency: re-running import for the SAME resumeId after a
    // default is already set must still succeed as a harmless replay
    // (matches Phase 6I.1's own established idempotent-import guarantee -
    // this is what makes a duplicate runInlineCanonicalFlow() call, e.g.
    // from a double-fired analysis-success event, safe).
    const importRetry = await runWithAuthenticatedContext(userA.client as never, makeHandleImportResume(jsonRequest("http://x/import-resume", "POST", { resumeId: resumeIdA })));
    check("new user: re-import same resumeId -> 200 (idempotent replay, not an error)", importRetry.status, 200);
    const importRetryBody = await importRetry.json();
    check("new user: replay reports alreadyImported true", importRetryBody.alreadyImported, true);
    check("new user: replay returns the SAME profileId (no duplicate profile)", importRetryBody.profileId, importBody.profileId);
  }

  // ==================== B. Existing user, default ALREADY set -> picker must be skipped entirely ====================
  {
    const prefRes = await runWithAuthenticatedContext(userA.client as never, handleGetTemplatePreference);
    const prefBody = await prefRes.json();
    checkTrue("existing default: template-preference now has a real defaultTemplateId (runInlineCanonicalFlow's own not-applicable branch precondition)", typeof prefBody.defaultTemplateId === "string" && prefBody.defaultTemplateId.length > 0);
  }

  // ==================== C. Existing profile, NULL default (mid-selection from an earlier session) -> import skipped, picker still required ====================
  const userC = await makeTestUser(admin, "null-default");
  const resumeIdC = await seedUploadedResume(admin, userC, "standard-pdf-resume.pdf");
  {
    const importResC = await runWithAuthenticatedContext(userC.client as never, makeHandleImportResume(jsonRequest("http://x/import-resume", "POST", { resumeId: resumeIdC })));
    check("null-default setup: initial import succeeds", importResC.status, 201);

    const prefResC = await runWithAuthenticatedContext(userC.client as never, handleGetTemplatePreference);
    const prefBodyC = await prefResC.json();
    check("null-default: template-preference is null (profile exists, no default yet)", prefBodyC.defaultTemplateId, null);

    const profileResC = await runWithAuthenticatedContext(userC.client as never, handleGetProfile);
    check("null-default: profile GET -> 200, NOT 404 (runInlineCanonicalFlow must skip re-import, go straight to picker)", profileResC.status, 200);

    // Attempting to import a DIFFERENT resumeId while a profile already
    // exists must be refused (Phase 6I.1's own no-silent-overwrite rule) -
    // proves why runInlineCanonicalFlow() is correct to check profile
    // existence BEFORE ever calling import for this branch.
    const otherResumeId = await seedUploadedResume(admin, userC, "second-resume.pdf", false, FIXTURE_PDF_2_PATH);
    const conflictRes = await runWithAuthenticatedContext(userC.client as never, makeHandleImportResume(jsonRequest("http://x/import-resume", "POST", { resumeId: otherResumeId })));
    check("null-default: importing a DIFFERENT resumeId for an existing profile -> 409 CONFLICT (confirms the skip-import branch is necessary, not optional)", conflictRes.status, 409);
  }

  // ==================== D. Legacy-only user (never uploaded/imported anything) -> not-applicable ====================
  const userD = await makeTestUser(admin, "legacy-only");
  {
    const prefResD = await runWithAuthenticatedContext(userD.client as never, handleGetTemplatePreference);
    const prefBodyD = await prefResD.json();
    check("legacy-only: template-preference -> defaultTemplateId null", prefBodyD.defaultTemplateId, null);

    const profileResD = await runWithAuthenticatedContext(userD.client as never, handleGetProfile);
    check("legacy-only: profile GET -> 404 (no canonical profile, no resume to import either - genuinely not-applicable)", profileResD.status, 404);
  }

  // ==================== E. Cross-user isolation on the whole sequence ====================
  {
    const prefResA = await runWithAuthenticatedContext(userA.client as never, handleGetTemplatePreference);
    const prefBodyA = await prefResA.json();
    const prefResD = await runWithAuthenticatedContext(userD.client as never, handleGetTemplatePreference);
    const prefBodyD = await prefResD.json();
    checkTrue("userA's persisted template selection never leaks into userD's own read", prefBodyA.defaultTemplateId !== prefBodyD.defaultTemplateId);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exit(1);
});
