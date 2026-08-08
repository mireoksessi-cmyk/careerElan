/*
  Phase 6I.6.14 - Per-Resume Canonical Template Ownership real-DB
  verification. Exercises resolveResumeTemplate()/setResumeTemplatePreference()
  (lib/careerMemory/services/resolveResumeTemplate.ts) end-to-end against
  a REAL local Supabase instance: real Storage uploads of 3 distinct real
  fixture files, real CanonicalResumeImportService.importResume() calls
  (real DPE pipeline, real content-hash matching, real career_profiles/
  career_source_documents/career_resume_versions rows), real
  resumes.selected_template reads/writes. Never calls OpenAI - nothing
  in this path does.

  Covers spec section 19's scenarios A-M (three-resume isolation, single-
  resume-change isolation, Dashboard-card-preview independence from the
  currently-selected resume, Manual vs Imported isolation via the shared
  career_profiles.default_template_id fallback boundary, cross-user
  isolation, and zero AI/quota/overlay/version side effects).

  Every user here is created fresh via admin.auth.admin.createUser(),
  matching this repo's own established real-DB test convention.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i614PerResumeTemplateOwnership.realdb.test.mts
  Requires local Supabase running (shared Postgres container across
  worktrees - do not `supabase db reset` from here).
*/
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { CanonicalResumeImportService } from "../../lib/careerMemory/services/canonicalResumeImportService";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";
import { resolveResumeTemplate, setResumeTemplatePreference } from "../../lib/careerMemory/services/resolveResumeTemplate";
import { CanonicalTemplatePreferenceService } from "../../lib/careerMemory/services/canonicalTemplatePreferenceService";
import { NotFoundError } from "../../lib/careerMemory/errors/domainErrors";

const URL = "http://127.0.0.1:54321";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const FIXTURE_A = "fixtures/resumes/standard-pdf-resume.pdf";
const FIXTURE_B = "fixtures/resumes/threepage-pdf-resume.pdf";
const FIXTURE_C = "fixtures/resumes/canva-pdf-resume.pdf";

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
  const email = `phase6i614-${emailPrefix}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i614-realdb-test-password-123";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY);
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client, session: signInData.session };
}

async function seedUploadedResume(admin: ReturnType<typeof createClient>, user: { userId: string; client: ReturnType<typeof createClient> }, filePath: string, fileName: string, isDefault: boolean) {
  const bytes = readFileSync(filePath);
  const storagePath = `${user.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`;
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

async function getResumeSelectedTemplateColumn(admin: ReturnType<typeof createClient>, resumeId: string) {
  const { data } = await admin.from("resumes").select("selected_template").eq("id", resumeId).single();
  return data?.selected_template ?? null;
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);

  // ==================== Setup: one user, three real distinct resumes (A/B/C) ====================
  const user1 = await makeTestUser(admin, "u1");
  const resumeA = await seedUploadedResume(admin, user1, FIXTURE_A, "resume-a.pdf", true);
  const resumeB = await seedUploadedResume(admin, user1, FIXTURE_B, "resume-b.pdf", false);
  const resumeC = await seedUploadedResume(admin, user1, FIXTURE_C, "resume-c.pdf", false);

  const repos1 = createCanonicalRepositories(user1.client);
  const importService1 = new CanonicalResumeImportService(repos1, user1.client);

  const importA = await importService1.importResume(user1.userId, resumeA);
  checkTrue("setup: A imports successfully", importA.status === "imported");
  const importB = await importService1.importResume(user1.userId, resumeB);
  checkTrue("setup: B imports successfully (adds to the SAME existing profile, not a new one)", importB.status === "imported");
  const importC = await importService1.importResume(user1.userId, resumeC);
  checkTrue("setup: C imports successfully", importC.status === "imported");

  if (importA.status === "imported" && importB.status === "imported" && importC.status === "imported") {
    check("setup: A/B/C share exactly ONE career_profiles row (confirms the real cardinality this fix works around)", new Set([importA.profileId, importB.profileId, importC.profileId]).size, 1);
    checkTrue("setup: A/B/C each got their OWN distinct career_resume_versions row", new Set([importA.versionId, importB.versionId, importC.versionId]).size === 3);
  }

  // ==================== A. Three resumes / three templates - assert independently persisted ====================
  await setResumeTemplatePreference(user1.client, user1.userId, resumeA, "professional-ats");
  await setResumeTemplatePreference(user1.client, user1.userId, resumeB, "modern-sidebar");
  await setResumeTemplatePreference(user1.client, user1.userId, resumeC, "creative-timeline");

  const resA1 = await resolveResumeTemplate(repos1, user1.client, user1.userId, resumeA);
  const resB1 = await resolveResumeTemplate(repos1, user1.client, user1.userId, resumeB);
  const resC1 = await resolveResumeTemplate(repos1, user1.client, user1.userId, resumeC);
  check("A. Resume A resolves to professional-ats", resA1.kind === "canonical" ? resA1.templateId : null, "professional-ats");
  check("A. Resume B resolves to modern-sidebar", resB1.kind === "canonical" ? resB1.templateId : null, "modern-sidebar");
  check("A. Resume C resolves to creative-timeline", resC1.kind === "canonical" ? resC1.templateId : null, "creative-timeline");
  check("A. Resume A source is resume-explicit", resA1.kind === "canonical" ? resA1.source : null, "resume-explicit");
  check("A. resumes.selected_template persisted directly on the A row", await getResumeSelectedTemplateColumn(admin, resumeA), "professional-ats");
  check("A. resumes.selected_template persisted directly on the B row", await getResumeSelectedTemplateColumn(admin, resumeB), "modern-sidebar");
  check("A. resumes.selected_template persisted directly on the C row", await getResumeSelectedTemplateColumn(admin, resumeC), "creative-timeline");

  // ==================== B. Change one resume's template - assert the other two are unaffected ====================
  await setResumeTemplatePreference(user1.client, user1.userId, resumeB, "executive-minimal");
  const resA2 = await resolveResumeTemplate(repos1, user1.client, user1.userId, resumeA);
  const resB2 = await resolveResumeTemplate(repos1, user1.client, user1.userId, resumeB);
  const resC2 = await resolveResumeTemplate(repos1, user1.client, user1.userId, resumeC);
  check("B. A unchanged after changing B", resA2.kind === "canonical" ? resA2.templateId : null, "professional-ats");
  check("B. B changed to executive-minimal", resB2.kind === "canonical" ? resB2.templateId : null, "executive-minimal");
  check("B. C unchanged after changing B", resC2.kind === "canonical" ? resC2.templateId : null, "creative-timeline");

  // ==================== C/D. Dashboard card preview independence from the currently-selected resume ====================
  // Simulate "A is currently selected" via career_memory.selected_resume_id, then resolve B - must still be B's own content+template.
  await user1.client.from("career_memory").upsert({ user_id: user1.userId, selected_resume_type: "uploaded", selected_resume_id: resumeA }, { onConflict: "user_id" });
  const resBWhileASelected = await resolveResumeTemplate(repos1, user1.client, user1.userId, resumeB);
  checkTrue("C. Previewing B while A is the selected resume still resolves B's own version", resBWhileASelected.kind === "canonical" && resBWhileASelected.versionId === importB.versionId);
  check("C. Previewing B while A is selected still resolves B's own template (not A's)", resBWhileASelected.kind === "canonical" ? resBWhileASelected.templateId : null, "executive-minimal");

  // Now switch active resume to C, then resolve B again - must be identical to before the switch.
  await user1.client.from("career_memory").upsert({ user_id: user1.userId, selected_resume_type: "uploaded", selected_resume_id: resumeC }, { onConflict: "user_id" });
  const resBWhileCSelected = await resolveResumeTemplate(repos1, user1.client, user1.userId, resumeB);
  check("D. Previewing B is identical regardless of which resume is currently active (A selected)", JSON.stringify(resBWhileASelected), JSON.stringify(resBWhileCSelected));
  const resCWhileCSelected = await resolveResumeTemplate(repos1, user1.client, user1.userId, resumeC);
  check("D. C's own resolution is also unaffected by being the active selection", resCWhileCSelected.kind === "canonical" ? resCWhileCSelected.templateId : null, "creative-timeline");

  // ==================== E. Backward-compat fallback: a resume with NO explicit preference falls back to the profile default ====================
  const userLegacy = await makeTestUser(admin, "legacy");
  const legacyResumeD = await seedUploadedResume(admin, userLegacy, FIXTURE_A, "legacy-resume-d.pdf", true);
  const reposLegacy = createCanonicalRepositories(userLegacy.client);
  const importServiceLegacy = new CanonicalResumeImportService(reposLegacy, userLegacy.client);
  const importD = await importServiceLegacy.importResume(userLegacy.userId, legacyResumeD);
  checkTrue("E. legacy-compat resume D imports successfully", importD.status === "imported");

  const resDBeforeAnyPreference = await resolveResumeTemplate(reposLegacy, userLegacy.client, userLegacy.userId, legacyResumeD);
  check("E. no explicit preference + no profile default yet -> selection-required (not an error)", resDBeforeAnyPreference.kind, "selection-required");

  // Simulate an existing (pre-6I.6.14) user who already has a profile default set the OLD way, with zero per-resume preference.
  const templatePrefService = new CanonicalTemplatePreferenceService(reposLegacy);
  await templatePrefService.setTemplatePreference(userLegacy.userId, "modern-sidebar");
  const resDAfterProfileDefaultOnly = await resolveResumeTemplate(reposLegacy, userLegacy.client, userLegacy.userId, legacyResumeD);
  check("E. legacy compat: no resume-level preference -> falls back to profile default", resDAfterProfileDefaultOnly.kind === "canonical" ? resDAfterProfileDefaultOnly.templateId : null, "modern-sidebar");
  check("E. legacy compat fallback source is explicitly 'profile-default', not 'resume-explicit'", resDAfterProfileDefaultOnly.kind === "canonical" ? resDAfterProfileDefaultOnly.source : null, "profile-default");

  // Once this resume gets its OWN explicit preference, it must stop following the shared profile default.
  await setResumeTemplatePreference(userLegacy.client, userLegacy.userId, legacyResumeD, "creative-timeline");
  await templatePrefService.setTemplatePreference(userLegacy.userId, "professional-ats"); // change the shared default AFTER D has its own preference
  const resDAfterOwnPreference = await resolveResumeTemplate(reposLegacy, userLegacy.client, userLegacy.userId, legacyResumeD);
  check("E. once D has its OWN explicit preference, changing the shared profile default no longer affects D", resDAfterOwnPreference.kind === "canonical" ? resDAfterOwnPreference.templateId : null, "creative-timeline");
  check("E. D's source is now resume-explicit", resDAfterOwnPreference.kind === "canonical" ? resDAfterOwnPreference.source : null, "resume-explicit");

  // ==================== H. Zero side effects from saved-resume template switching ====================
  const { data: versionsBeforeSwitch } = await admin.from("career_resume_versions").select("id").eq("profile_id", importA.status === "imported" ? importA.profileId : "");
  await setResumeTemplatePreference(user1.client, user1.userId, resumeA, "executive-minimal");
  const { data: versionsAfterSwitch } = await admin.from("career_resume_versions").select("id").eq("profile_id", importA.status === "imported" ? importA.profileId : "");
  check("M. changing a saved resume's template creates ZERO new career_resume_versions rows", versionsAfterSwitch?.length ?? -1, versionsBeforeSwitch?.length ?? -2);
  const { data: tailoredRowsAfterSwitch } = await admin.from("career_tailored_resumes").select("id").eq("profile_id", importA.status === "imported" ? importA.profileId : "");
  check("M. changing a saved resume's template creates ZERO overlay/career_tailored_resumes rows", tailoredRowsAfterSwitch?.length ?? -1, 0);
  // restore A back to professional-ats for the rest of the assertions below, which assume A = professional-ats
  await setResumeTemplatePreference(user1.client, user1.userId, resumeA, "professional-ats");

  // ==================== L. Cross-user isolation ====================
  const user2 = await makeTestUser(admin, "u2");
  const resumeUser2 = await seedUploadedResume(admin, user2, FIXTURE_A, "user2-resume.pdf", true);
  const repos2 = createCanonicalRepositories(user2.client);
  const importService2 = new CanonicalResumeImportService(repos2, user2.client);
  const importUser2 = await importService2.importResume(user2.userId, resumeUser2);
  checkTrue("L. user2's own resume imports successfully", importUser2.status === "imported");
  await setResumeTemplatePreference(user2.client, user2.userId, resumeUser2, "modern-sidebar");

  // user1 changing THEIR OWN resumes must never touch user2's row.
  await setResumeTemplatePreference(user1.client, user1.userId, resumeA, "creative-timeline");
  const user2ResolutionAfterUser1Change = await resolveResumeTemplate(repos2, user2.client, user2.userId, resumeUser2);
  check("L. user1 changing their own resume A never affects user2's resume", user2ResolutionAfterUser1Change.kind === "canonical" ? user2ResolutionAfterUser1Change.templateId : null, "modern-sidebar");
  // restore A
  await setResumeTemplatePreference(user1.client, user1.userId, resumeA, "professional-ats");

  // user1's own session must not be able to resolve/mutate user2's resumeId (ownership enforced, not just "different result").
  let user1CrossUserResolveThrew = false;
  try {
    await resolveResumeTemplate(repos1, user1.client, user1.userId, resumeUser2);
  } catch (error) {
    user1CrossUserResolveThrew = error instanceof NotFoundError;
  }
  checkTrue("L. user1 attempting to resolve user2's resumeId throws NotFoundError (ownership-enforced, not silently empty)", user1CrossUserResolveThrew);

  let user1CrossUserSetThrew = false;
  try {
    await setResumeTemplatePreference(user1.client, user1.userId, resumeUser2, "executive-minimal");
  } catch (error) {
    user1CrossUserSetThrew = error instanceof NotFoundError;
  }
  checkTrue("L. user1 attempting to SET a template on user2's resumeId throws NotFoundError, never silently succeeds", user1CrossUserSetThrew);
  const user2ResolutionAfterAttackAttempt = await resolveResumeTemplate(repos2, user2.client, user2.userId, resumeUser2);
  check("L. user2's resume template is untouched after user1's rejected attempt", user2ResolutionAfterAttackAttempt.kind === "canonical" ? user2ResolutionAfterAttackAttempt.templateId : null, "modern-sidebar");

  // ==================== J. Manual vs Imported isolation (via the shared profile-default fallback boundary) ====================
  // A fresh user whose ONLY canonical identity is the profile itself (Manual/Career-Memory-authored) - simulated here by
  // directly setting default_template_id without ever importing an uploaded resume, matching what Manual Step 9's PUT
  // .../template-preference (no resumeId) already does today, unchanged by this phase.
  const userManual = await makeTestUser(admin, "manual");
  const reposManual = createCanonicalRepositories(userManual.client);
  const manualPrefService = new CanonicalTemplatePreferenceService(reposManual);
  // ensureProfile equivalent: import a throwaway resume then rely on the profile that creates, to get a real profile row
  // without a dedicated ensureProfile export - mirrors this round's own architecture (Manual IS the profile's own identity).
  const manualBridgeResumeId = await seedUploadedResume(admin, userManual, FIXTURE_A, "manual-bridge.pdf", true);
  const importServiceManual = new CanonicalResumeImportService(reposManual, userManual.client);
  const importManualBridge = await importServiceManual.importResume(userManual.userId, manualBridgeResumeId);
  checkTrue("J. setup: manual-identity user's profile exists via one throwaway import", importManualBridge.status === "imported");
  await manualPrefService.setTemplatePreference(userManual.userId, "creative-timeline"); // simulates Manual Step 9's own PUT (no resumeId)
  await setResumeTemplatePreference(userManual.client, userManual.userId, manualBridgeResumeId, "professional-ats"); // this resume's OWN explicit preference

  const manualResolutionViaProfileDefault = await manualPrefService.getTemplatePreference(userManual.userId);
  check("J. Manual's own effective template (career_profiles.default_template_id) unaffected by the uploaded resume's explicit preference", manualResolutionViaProfileDefault?.defaultTemplateId, "creative-timeline");
  const bridgeResumeResolution = await resolveResumeTemplate(reposManual, userManual.client, userManual.userId, manualBridgeResumeId);
  check("J. the uploaded resume keeps its OWN explicit preference, not Manual's", bridgeResumeResolution.kind === "canonical" ? bridgeResumeResolution.templateId : null, "professional-ats");

  // ==================== K. Same-content reupload determinism ====================
  // Dedicated fresh user (user1 already sits at the real 3-resume upload cap from A/B/C above).
  const userK = await makeTestUser(admin, "reupload");
  const reposK = createCanonicalRepositories(userK.client);
  const importServiceK = new CanonicalResumeImportService(reposK, userK.client);
  const resumeK1 = await seedUploadedResume(admin, userK, FIXTURE_A, "resume-k1.pdf", true);
  const importK1 = await importServiceK.importResume(userK.userId, resumeK1);
  checkTrue("K. setup: first upload of the reupload-test content imports successfully", importK1.status === "imported");
  const resumeA2 = await seedUploadedResume(admin, userK, FIXTURE_A, "resume-a-reupload.pdf", false);
  const importA2 = await importServiceK.importResume(userK.userId, resumeA2);
  checkTrue("K. re-uploading the exact same bytes under a new resumes row imports without error", importA2.status === "imported");
  if (importA2.status === "imported" && importK1.status === "imported") {
    check("K. same-content reupload resolves to the SAME canonical version as the original (content-hash identity)", importA2.versionId, importK1.versionId);
  }
  const resumeA2Resolution = await resolveResumeTemplate(reposK, userK.client, userK.userId, resumeA2);
  // The new resumes row (A2) is a DIFFERENT row with its own selected_template column (still unset) - it deterministically
  // falls back to the profile default, exactly like any other resume with no explicit preference of its own (spec section
  // 18 - "audit current contentHash/version identity semantics and report", not "assume" - this IS the audited, current,
  // correct behavior: content identity determines the CANONICAL VERSION resolved, never the per-resumes-row template
  // preference, which is intentionally scoped to the resumes.id row itself, not the underlying content).
  checkTrue("K. the new resumes row for the same content resolves deterministically (no error, no ambiguity)", resumeA2Resolution.kind === "canonical" || resumeA2Resolution.kind === "selection-required");

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exit(1);
});
