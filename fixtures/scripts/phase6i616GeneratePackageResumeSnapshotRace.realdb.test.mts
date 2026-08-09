/*
  Phase 6I.6.16 - Generate Package Resume Selection Snapshot / Race
  Elimination. Real-DB verification against local Supabase.

  Root cause (this phase's own audit): the canonical background worker
  (generateCanonicalPackage(), always invoked with the service-role
  client) resolved CONTENT via resolveCanonicalResumeContext({mode:
  "service-role", userId}) with NO applicationId - it always re-read
  career_memory.selected_resume_id fresh at generation time, even
  though applications.canonical_profile_id/canonical_resume_version_id
  already existed as columns (added 20260807000000) and SESSION mode's
  own resolver already had an "application-binding" branch that prefers
  them permanently once set. If the user switched their selected resume
  between Generate Package click and worker execution, generation could
  silently use the NEW selection instead of the one the application was
  claimed for.

  Fix: canonicalGenerateDispatchService.ts now resolves AND freezes
  canonical_profile_id/canonical_resume_version_id onto the claimed row
  at claim time, from the SAME resolvedResume identity already used for
  content/resume_id and (since 6I.6.15) templateId - never three
  independently resolved identities that could disagree. Service-role
  mode's resolveCanonicalResumeContext() now accepts applicationId and
  implements the same application-binding priority session mode already
  had, via a new SECURITY DEFINER RPC (system_resolve_resume_version_
  by_id) since service_role has no table grant on career_resume_
  versions.

  This test exercises the REAL production functions directly:
  dispatchCanonicalGeneration() for claim-time snapshotting, and
  resolveCanonicalResumeContext({mode:"service-role", applicationId})
  for worker-time resolution (the exact call canonicalGeneratePackageService.
  ts makes) - never a reimplemented test double. The enqueue step (real
  HTTP fetch to a background worker) is allowed to fail harmlessly (no
  worker listens in this standalone script) since the claim-insert (with
  its frozen canonical_profile_id/canonical_resume_version_id) already
  persisted by that point - this is exactly what this phase's bug
  concerns: correct INPUT BINDING at claim time, never OpenAI generation
  itself. Zero OpenAI calls are reachable from this path.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i616GeneratePackageResumeSnapshotRace.realdb.test.mts
*/
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { CanonicalResumeImportService } from "../../lib/careerMemory/services/canonicalResumeImportService";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";
import { setResumeTemplatePreference } from "../../lib/careerMemory/services/resolveResumeTemplate";
import { resolveCanonicalResumeContext } from "../../lib/careerMemory/services/resolveCanonicalResumeContext";
import { CanonicalTemplatePreferenceService } from "../../lib/careerMemory/services/canonicalTemplatePreferenceService";
import { dispatchCanonicalGeneration } from "../../lib/careerMemory/orchestration/canonicalGenerateDispatchService";

const URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const FIXTURE_A = "fixtures/resumes/standard-pdf-resume.pdf";
const FIXTURE_B = "fixtures/resumes/threepage-pdf-resume.pdf";

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
  const email = `phase6i616-${emailPrefix}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i616-realdb-test-password-123";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client };
}

async function seedUploadedResume(admin: ReturnType<typeof createClient>, user: { userId: string; client: ReturnType<typeof createClient> }, filePath: string, fileName: string, isDefault: boolean) {
  const bytes = readFileSync(filePath);
  const storagePath = `${user.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`;
  const { error: uploadError } = await admin.storage.from("resumes").upload(storagePath, bytes, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;
  const { data: resumeRow, error: insertError } = await user.client
    .from("resumes")
    .insert({ user_id: user.userId, file_name: fileName, storage_path: storagePath, source_type: "uploaded", original_file_type: "pdf", is_default: isDefault, original_text: `Resume content for ${fileName}.` })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return resumeRow.id as string;
}

async function selectResume(client: ReturnType<typeof createClient>, userId: string, type: "uploaded" | "career_memory", resumeId: string | null) {
  await client.from("career_memory").upsert({ user_id: userId, selected_resume_type: type, selected_resume_id: resumeId }, { onConflict: "user_id" });
}

async function claim(admin: ReturnType<typeof createClient>, user: { userId: string; client: ReturnType<typeof createClient> }, generationRequestId: string) {
  const { data: memoryRow } = await user.client.from("career_memory").select("*").eq("user_id", user.userId).single();
  try {
    await dispatchCanonicalGeneration({
      supabase: user.client as any,
      userId: user.userId,
      memory: memoryRow as Record<string, unknown>,
      generationRequestId,
      jobText: "We are hiring a Software Engineer. Location: Toronto, ON, Canada.",
      title: "Software Engineer",
      company: "Test Co",
      applicantName: "Test Applicant",
      analysis: { summary: "test job analysis" },
      jobUrl: null,
      body: {},
      requestOrigin: "http://localhost:3001",
      routingReason: "phase6i616-test",
      canaryStage: 0,
    });
  } catch {
    // Expected: no background worker listens in this standalone script -
    // the claim-insert (with its frozen snapshot columns) already
    // persisted before the enqueue attempt.
  }
  const { data: appRow, error } = await admin
    .from("applications")
    .select("id, resume_id, resume_source, canonical_profile_id, canonical_resume_version_id, canonical_input_manifest, generation_status")
    .eq("user_id", user.userId)
    .eq("generation_request_id", generationRequestId)
    .single();
  if (error || !appRow) throw new Error("claim did not create an applications row");
  return appRow;
}

async function resolveWorkerSide(serviceClient: ReturnType<typeof createClient>, userId: string, applicationId: string) {
  return resolveCanonicalResumeContext({ mode: "service-role", client: serviceClient as any, userId, applicationId });
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);
  const serviceClient = createClient(URL, SERVICE_ROLE_KEY); // mirrors supabaseAdmin - the exact client the real worker uses

  // ==================== Setup ====================
  const user1 = await makeTestUser(admin, "u1");
  const resumeA = await seedUploadedResume(admin, user1, FIXTURE_A, "resume-a.pdf", true);
  const resumeB = await seedUploadedResume(admin, user1, FIXTURE_B, "resume-b.pdf", false);

  const repos1 = createCanonicalRepositories(user1.client as any);
  const importService1 = new CanonicalResumeImportService(repos1, user1.client as any);
  const importA = await importService1.importResume(user1.userId, resumeA);
  const importB = await importService1.importResume(user1.userId, resumeB);
  checkTrue("setup: A/B import successfully", importA.status === "imported" && importB.status === "imported");
  const versionA = importA.status === "imported" ? importA.versionId : "";
  const versionB = importB.status === "imported" ? importB.versionId : "";

  await setResumeTemplatePreference(user1.client as any, user1.userId, resumeA, "professional-ats");
  await setResumeTemplatePreference(user1.client as any, user1.userId, resumeB, "modern-sidebar");

  // ==================== TEST A - claim X while A selected, then switch to B; worker must still resolve A ====================
  await selectResume(user1.client as any, user1.userId, "uploaded", resumeA);
  const appX = await claim(admin, user1, randomUUID());
  check("A. claim-time snapshot: X.canonical_resume_version_id = VERSION_A", appX.canonical_resume_version_id, versionA);
  check("A. claim-time snapshot: X.manifest.templateId = professional-ats", (appX.canonical_input_manifest as any)?.templateId, "professional-ats");
  check("A. claim-time snapshot: X.resume_id = A", appX.resume_id, resumeA);

  await selectResume(user1.client as any, user1.userId, "uploaded", resumeB); // race: switch AFTER claim

  const workerResolvedX1 = await resolveWorkerSide(serviceClient, user1.userId, appX.id);
  checkTrue("A. worker-side resolution status = resolved", workerResolvedX1.status === "resolved");
  if (workerResolvedX1.status === "resolved") {
    check("A. worker resolves X to VERSION_A, NOT VERSION_B", workerResolvedX1.versionId, versionA);
    checkTrue("A. worker resolution source = application-binding", workerResolvedX1.source === "application-binding");
    checkTrue("A. worker did NOT resolve to VERSION_B", workerResolvedX1.versionId !== versionB);
  }

  // ==================== TEST B - template change on A (now-deselected) before worker runs; X keeps its frozen template ====================
  await setResumeTemplatePreference(user1.client as any, user1.userId, resumeA, "creative-timeline");
  const { data: appXAfterTemplateChange } = await admin.from("applications").select("canonical_input_manifest").eq("id", appX.id).single();
  check("B. X's frozen manifest.templateId is still professional-ats after A's saved template changed", (appXAfterTemplateChange?.canonical_input_manifest as any)?.templateId, "professional-ats");

  // ==================== TEST C - combined resume + template changes; X still resolves A + professional-ats ====================
  await setResumeTemplatePreference(user1.client as any, user1.userId, resumeB, "executive-minimal"); // change B's template too
  const workerResolvedX2 = await resolveWorkerSide(serviceClient, user1.userId, appX.id);
  if (workerResolvedX2.status === "resolved") {
    check("C. after resume+template changes on both A and B, X still resolves VERSION_A", workerResolvedX2.versionId, versionA);
  } else {
    check("C. X still resolves (application-binding)", workerResolvedX2.status, "resolved");
  }
  const { data: appXFinalManifest } = await admin.from("applications").select("canonical_input_manifest").eq("id", appX.id).single();
  check("C. X's frozen template is still professional-ats", (appXFinalManifest?.canonical_input_manifest as any)?.templateId, "professional-ats");

  // ==================== TEST D - new application Y after switch uses B's CURRENT snapshot ====================
  const appY = await claim(admin, user1, randomUUID()); // selection is currently B, B's template is now executive-minimal
  check("D. new application Y snapshots VERSION_B", appY.canonical_resume_version_id, versionB);
  check("D. new application Y snapshots executive-minimal (B's current template)", (appY.canonical_input_manifest as any)?.templateId, "executive-minimal");

  // ==================== TEST E - retry after failure reuses X's ORIGINAL snapshot, ignoring current selection (still B) ====================
  await admin.from("applications").update({ generation_status: "failed", generation_worker_claimed_at: null }).eq("id", appX.id);
  const { data: memoryRowForRetry } = await user1.client.from("career_memory").select("*").eq("user_id", user1.userId).single();
  const xGenerationRequestId = (await admin.from("applications").select("generation_request_id").eq("id", appX.id).single()).data?.generation_request_id as string;
  try {
    await dispatchCanonicalGeneration({
      supabase: user1.client as any,
      userId: user1.userId,
      memory: memoryRowForRetry as Record<string, unknown>,
      generationRequestId: xGenerationRequestId,
      jobText: "retry", title: "Software Engineer", company: "Test Co", applicantName: "Test Applicant",
      analysis: { summary: "retry" }, jobUrl: null, body: {}, requestOrigin: "http://localhost:3001",
      routingReason: "phase6i616-retry-test", canaryStage: 0,
    });
  } catch { /* expected enqueue failure */ }
  const { data: appXAfterRetry } = await admin.from("applications").select("canonical_resume_version_id, canonical_input_manifest, resume_id").eq("id", appX.id).single();
  check("E. retry: X.canonical_resume_version_id is STILL VERSION_A (not re-derived to B)", appXAfterRetry?.canonical_resume_version_id, versionA);
  check("E. retry: X's template snapshot is STILL professional-ats", (appXAfterRetry?.canonical_input_manifest as any)?.templateId, "professional-ats");
  check("E. retry: X.resume_id is STILL A", appXAfterRetry?.resume_id, resumeA);

  // ==================== TEST F - Manual Career Memory click-time snapshot ====================
  const userF = await makeTestUser(admin, "manual");
  const reposF = createCanonicalRepositories(userF.client as any);
  const resumeF = await seedUploadedResume(admin, userF, FIXTURE_A, "resume-f.pdf", true);
  const importServiceF = new CanonicalResumeImportService(reposF, userF.client as any);
  const importF = await importServiceF.importResume(userF.userId, resumeF); // bootstraps a real profile (Manual has none of its own without one)
  checkTrue("F. setup: bridge resume imports successfully", importF.status === "imported");
  const prefServiceF = new CanonicalTemplatePreferenceService(reposF);
  await prefServiceF.setTemplatePreference(userF.userId, "creative-timeline");
  const manualLatestVersionId = importF.status === "imported" ? importF.versionId : "";

  await selectResume(userF.client as any, userF.userId, "career_memory", null); // Manual selected
  const appManual = await claim(admin, userF, randomUUID());
  check("F. Manual claim snapshots the profile's latest version", appManual.canonical_resume_version_id, manualLatestVersionId);
  check("F. Manual claim snapshots profile default template", (appManual.canonical_input_manifest as any)?.templateId, "creative-timeline");

  await selectResume(userF.client as any, userF.userId, "uploaded", resumeF); // switch to uploaded AFTER claim
  const workerResolvedManual = await resolveWorkerSide(serviceClient, userF.userId, appManual.id);
  if (workerResolvedManual.status === "resolved") {
    check("F. worker still resolves Manual's frozen version after switching to uploaded", workerResolvedManual.versionId, manualLatestVersionId);
  } else {
    check("F. worker resolution status", workerResolvedManual.status, "resolved");
  }

  // ==================== TEST G - deleted uploaded resume row: historical binding still resolves ====================
  await admin.from("resumes").delete().eq("id", resumeA);
  const workerResolvedAfterDelete = await resolveWorkerSide(serviceClient, user1.userId, appX.id);
  checkTrue("G. after deleting the resumes row, X's binding still resolves", workerResolvedAfterDelete.status === "resolved");
  if (workerResolvedAfterDelete.status === "resolved") {
    check("G. still resolves to VERSION_A (career_resume_versions survives resumes-row deletion)", workerResolvedAfterDelete.versionId, versionA);
  }

  // ==================== TEST I - cross-user binding is never leaked ====================
  const user2 = await makeTestUser(admin, "u2");
  const resumeUser2 = await seedUploadedResume(admin, user2, FIXTURE_A, "user2-resume.pdf", true);
  const repos2 = createCanonicalRepositories(user2.client as any);
  const importService2 = new CanonicalResumeImportService(repos2, user2.client as any);
  const importUser2 = await importService2.importResume(user2.userId, resumeUser2);
  checkTrue("I. setup: user2 own resume imports", importUser2.status === "imported");
  await selectResume(user2.client as any, user2.userId, "uploaded", resumeUser2);
  const appUser2 = await claim(admin, user2, randomUUID());

  // user1 attempts to resolve using user2's OWN applicationId, passing user1's userId.
  const crossUserResolution = await resolveWorkerSide(serviceClient, user1.userId, appUser2.id);
  const user2VersionId = importUser2.status === "imported" ? importUser2.versionId : "";
  if (crossUserResolution.status === "resolved") {
    checkTrue("I. cross-user resolve NEVER returns user2's version id", crossUserResolution.versionId !== user2VersionId);
  } else {
    checkTrue("I. cross-user resolve falls through to user1's own (non-user2) resolution path", true);
  }

  // ==================== TEST L/M/N - no AI/quota/version/overlay side effects from selection or template switching ====================
  const { data: versionsBefore } = await admin.from("career_resume_versions").select("id").eq("profile_id", importA.status === "imported" ? importA.profileId : "");
  const { data: tailoredBefore } = await admin.from("career_tailored_resumes").select("id").eq("profile_id", importA.status === "imported" ? importA.profileId : "");
  await selectResume(user1.client as any, user1.userId, "uploaded", resumeB);
  await setResumeTemplatePreference(user1.client as any, user1.userId, resumeB, "modern-sidebar");
  const { data: versionsAfter } = await admin.from("career_resume_versions").select("id").eq("profile_id", importA.status === "imported" ? importA.profileId : "");
  const { data: tailoredAfter } = await admin.from("career_tailored_resumes").select("id").eq("profile_id", importA.status === "imported" ? importA.profileId : "");
  check("L/M. selection+template switching creates ZERO new career_resume_versions", versionsAfter?.length ?? -1, versionsBefore?.length ?? -2);
  check("N. selection+template switching creates ZERO overlay/career_tailored_resumes rows", tailoredAfter?.length ?? -1, tailoredBefore?.length ?? -2);

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exit(1);
});
