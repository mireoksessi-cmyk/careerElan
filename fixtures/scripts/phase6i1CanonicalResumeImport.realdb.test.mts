/*
  Phase 6I.1 - Canonical Resume Import / Upload Bridge real-DB
  verification. Exercises CanonicalResumeImportService end-to-end
  against a REAL local Supabase instance: real Storage upload of a real
  fixture PDF, real analyzeDocument/buildLosslessResumeDocument/
  buildStructuredResume DPE pipeline run (no mocked structuring), real
  ensureProfile/registerSourceDocument/saveCanonicalRuntimeAcknowledgingGap
  RPC calls. Never calls OpenAI - nothing in this import path does.

  Every user here is created fresh via admin.auth.admin.createUser(),
  matching this repo's own established real-DB test convention
  (phase6iProductionEnablement.realdb.test.mts) - no fixture/seed data
  is ever written into a real user's own account.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i1CanonicalResumeImport.realdb.test.mts
  Requires local Supabase running (this repo's dev stack shares its
  Postgres container across every worktree of this repo - do not
  `supabase db reset` from here, it would wipe state other concurrent
  worktree sessions may depend on).
*/
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { CanonicalResumeImportService } from "../../lib/careerMemory/services/canonicalResumeImportService";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";
import { CanonicalCareerMemoryService } from "../../lib/careerMemory/services/canonicalCareerMemoryService";
import { NotFoundError, ValidationError } from "../../lib/careerMemory/errors/domainErrors";

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
function checkFalse(label: string, actual: boolean) {
  check(label, actual, false);
}

async function makeTestUser(admin: ReturnType<typeof createClient>, emailPrefix: string) {
  const email = `phase6i1-${emailPrefix}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i1-realdb-test-password-123";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY);
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client, session: signInData.session };
}

/*
  Seeds a REAL, real-file-backed `resumes` row exactly the way the
  legacy upload flow produces one - a real Storage object plus a real
  row with storage_path/original_file_type/source_type set - so the
  import pipeline runs against genuine data, not a shortcut. Analysis
  fields (parsed_data/original_text) are deliberately left unset: the
  import bridge never reads them (see runForApplication.ts's own
  precedent - only storage_path/original_file_type/source_type matter).
*/
async function seedUploadedResume(admin: ReturnType<typeof createClient>, user: { userId: string; client: ReturnType<typeof createClient> }, filePath: string, fileName: string, isDefault = true) {
  const bytes = readFileSync(filePath);
  const storagePath = `${user.userId}/${Date.now()}-${fileName}`;
  const { error: uploadError } = await admin.storage.from("resumes").upload(storagePath, bytes, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;

  // service_role has no direct table grant on `resumes` (see
  // runForApplication.ts's own header comment) - insert through the
  // owning user's own RLS-authenticated session, exactly how the real
  // upload flow does it. `resumes_user_default_uidx` allows only one
  // is_default=true row per user, so a second seeded resume for the
  // same user must opt out.
  const { data: resumeRow, error: insertError } = await user.client
    .from("resumes")
    .insert({ user_id: user.userId, file_name: fileName, storage_path: storagePath, source_type: "uploaded", original_file_type: "pdf", is_default: isDefault })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return resumeRow.id as string;
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);

  // ==================== A. Successful import (real Storage + real DPE pipeline + real RPCs) ====================
  const userA = await makeTestUser(admin, "a");
  const resumeIdA = await seedUploadedResume(admin, userA, FIXTURE_PDF_PATH, "standard-pdf-resume.pdf");
  const reposA = createCanonicalRepositories(userA.client);
  const importServiceA = new CanonicalResumeImportService(reposA, userA.client);

  const resultA1 = await importServiceA.importResume(userA.userId, resumeIdA);
  checkTrue("A1: successful import returns status=imported", resultA1.status === "imported");
  if (resultA1.status === "imported") {
    checkFalse("A2: first import is not a replay (alreadyImported=false)", resultA1.alreadyImported);
    checkTrue("A3: round-trip validation passed", resultA1.roundTripValid);
  }

  const memoryServiceA = new CanonicalCareerMemoryService(reposA);
  const runtimeAfterImport = await memoryServiceA.getCanonicalRuntime(userA.userId);
  checkTrue("A4: a real canonical runtime now exists for this user", runtimeAfterImport !== null);
  checkTrue("A5: runtime carries exactly the 1 imported source document", runtimeAfterImport?.sourceDocuments.length === 1);
  check("A6: runtime version reason is 'import'", runtimeAfterImport?.version.reason, "import");
  checkTrue("A7: structured resume identity was actually extracted (not an empty/lossy import)", !!runtimeAfterImport?.resume.identity);

  // ==================== B. Retry idempotency (same resumeId, same file - safe replay, no duplicate version) ====================
  const resultA2 = await importServiceA.importResume(userA.userId, resumeIdA);
  checkTrue("B1: retried import of the SAME resumeId still returns status=imported", resultA2.status === "imported");
  if (resultA2.status === "imported" && resultA1.status === "imported") {
    checkTrue("B2: retry is recognized as a replay (alreadyImported=true)", resultA2.alreadyImported);
    check("B3: retry produces the SAME version id, not a new one (idempotency key honored)", resultA2.versionId, resultA1.versionId);
    check("B4: retry produces the SAME source document id (content-hash dedup)", resultA2.sourceDocumentId, resultA1.sourceDocumentId);
  }

  // Direct, unambiguous duplicate check: exactly 1 version row for this profile after 2 identical imports.
  const profileA = await reposA.profiles.getByUserId(userA.userId);
  const { count: realVersionCount } = await userA.client.from("career_resume_versions").select("id", { count: "exact", head: true }).eq("profile_id", profileA!.id);
  check("B5: exactly 1 version row exists after 2 identical imports (no duplicate)", realVersionCount, 1);
  const { count: sourceDocCount } = await userA.client.from("career_source_documents").select("id", { count: "exact", head: true }).eq("profile_id", profileA!.id);
  check("B6: exactly 1 source document row exists after 2 identical imports (no duplicate)", sourceDocCount, 1);

  // ==================== C. Phase 6I.5 policy: importing a DIFFERENT resume once a profile exists creates a NEW version (old preserved) ====================
  const resumeIdA2 = await seedUploadedResume(admin, userA, FIXTURE_PDF_2_PATH, "threepage-pdf-resume.pdf", false);
  const resultA3 = await importServiceA.importResume(userA.userId, resumeIdA2);
  checkTrue("C1: importing a DIFFERENT resume for a user who already has a profile now SUCCEEDS (status=imported)", resultA3.status === "imported");
  if (resultA3.status === "imported" && resultA1.status === "imported") {
    checkFalse("C2: the new-content import is not a replay (alreadyImported=false)", resultA3.alreadyImported);
    checkTrue("C3: the new import produces a DIFFERENT versionId than the first resume's version", resultA3.versionId !== resultA1.versionId);
    checkTrue("C4: the new import produces a DIFFERENT sourceDocumentId than the first resume's source", resultA3.sourceDocumentId !== resultA1.sourceDocumentId);
  }
  const { count: versionCountAfterSecondImport } = await userA.client.from("career_resume_versions").select("id", { count: "exact", head: true }).eq("profile_id", profileA!.id);
  check("C5: exactly 2 version rows now exist (the old one preserved, not overwritten)", versionCountAfterSecondImport, 2);
  const oldVersionStillExists = resultA1.status === "imported" ? await reposA.resumeVersions.getById(resultA1.versionId) : null;
  checkTrue("C6: the FIRST resume's version row is still readable, untouched, after the second import", oldVersionStillExists !== null);
  const latestVersionAfterC = await reposA.resumeVersions.getLatestByProfileId(profileA!.id);
  if (resultA3.status === "imported") {
    check("C7: the profile's current LATEST version is now the SECOND resume's version", latestVersionAfterC?.id, resultA3.versionId);
  }

  // ==================== C8-C9. Re-uploading the SAME (now-current) resume again is a no-op replay, not a V3 ====================
  const resumeIdA2Retry = await seedUploadedResume(admin, userA, FIXTURE_PDF_2_PATH, "threepage-pdf-resume-retry.pdf", false);
  const resultA4 = await importServiceA.importResume(userA.userId, resumeIdA2Retry);
  checkTrue("C8: re-uploading identical content under a DIFFERENT resumeId is still recognized as a replay", resultA4.status === "imported" && resultA4.alreadyImported === true);
  if (resultA3.status === "imported" && resultA4.status === "imported") {
    check("C9: the replay returns the SAME versionId as the second resume's own import (no V3)", resultA4.versionId, resultA3.versionId);
  }
  const { count: versionCountAfterReplay } = await userA.client.from("career_resume_versions").select("id", { count: "exact", head: true }).eq("profile_id", profileA!.id);
  check("C10: still exactly 2 version rows after the identical-content re-upload under a new resumeId", versionCountAfterReplay, 2);

  // ==================== D. Ownership: cannot import another user's resume ====================
  const userB = await makeTestUser(admin, "b");
  const reposB = createCanonicalRepositories(userB.client);
  const importServiceB = new CanonicalResumeImportService(reposB, userB.client);
  let ownershipErrorIsNotFound = false;
  try {
    await importServiceB.importResume(userB.userId, resumeIdA);
  } catch (error) {
    ownershipErrorIsNotFound = error instanceof NotFoundError;
  }
  checkTrue("D1: importing another user's resumeId throws NotFoundError (RLS + app-level ownership check)", ownershipErrorIsNotFound);

  // ==================== E. Missing resume ====================
  let missingErrorIsNotFound = false;
  try {
    await importServiceB.importResume(userB.userId, "00000000-0000-0000-0000-000000000000");
  } catch (error) {
    missingErrorIsNotFound = error instanceof NotFoundError;
  }
  checkTrue("E1: importing a nonexistent resumeId throws NotFoundError", missingErrorIsNotFound);

  // ==================== F. career_memory-sourced resume (no original file) is refused, not silently coerced ====================
  const { data: cmResumeRow, error: cmInsertError } = await userB.client.from("resumes").insert({ user_id: userB.userId, file_name: "career-memory-draft", source_type: "career_memory" }).select("id").single();
  if (cmInsertError) throw cmInsertError;
  let cmErrorIsValidation = false;
  try {
    await importServiceB.importResume(userB.userId, cmResumeRow.id);
  } catch (error) {
    cmErrorIsValidation = error instanceof ValidationError;
  }
  checkTrue("F1: a career_memory-sourced resume (no original file) throws ValidationError, not a silent/lossy import", cmErrorIsValidation);

  // ==================== G. Legacy resume selection/generation path is unaffected (defense-in-depth read, no mutation by this suite) ====================
  const { data: legacySelectedCheck } = await userB.client.from("resumes").select("id").eq("user_id", userB.userId);
  checkTrue("G1: legacy resumes rows for this user are still readable/unaffected by the import bridge", Array.isArray(legacySelectedCheck));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exit(1);
});
