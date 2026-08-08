/*
  Phase 6I.6.9 - Empty / Partial Manual Career Memory Canonical Template
  Preview. Real-DB test suite covering:

  - Test A: empty Manual resume - all 4 canonical templates render
  - Test B: partial identity - real values win, nothing fabricated
  - Test C: more complete Manual - real values replace placeholders
  - Test D: complete Manual - normal Phase 6I.6.8 behavior, no injection
  - Test E: same-user Manual A / Imported B / Imported C isolation
  - Test F: stale-state isolation (B previewed first, then A)
  - Test G: placeholder persistence isolation (DB inspection)
  - Test H: template switching (identity/profile/version stability)
  - Test I: uploaded-resume regression (no unnecessary placeholders)
  - Test J: cross-user security (RLS-enforced, not bypassed)

  Every "Imported" resume here is SIMULATED via the same technique
  Phase 6I.6.8's own test suite established (simulateUploadedVersion) -
  register a real career_source_documents row, then save a runtime that
  references it - never a real uploaded file, never real personal data.
  All identities are synthetic test markers ("Imported Fixture Alpha",
  etc.), never a real customer/tester/developer name.

  Calls the resume-preview route's OWN underlying functions directly
  (resolveCanonicalResumeContext -> buildPreviewOnlyResume ->
  renderTemplateFromRuntime), in the same sequence and with the same
  session-authenticated client the real HTTP route uses - not a second,
  parallel preview implementation.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i69EmptyPartialManualPreview.realdb.test.mts
  Requires local Supabase running.
*/
import { createClient } from "@supabase/supabase-js";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";
import { CanonicalCareerMemoryService } from "../../lib/careerMemory/services/canonicalCareerMemoryService";
import { resolveCanonicalResumeContext, loadRuntimeForResolvedVersion } from "../../lib/careerMemory/services/resolveCanonicalResumeContext";
import { buildManualCanonicalRuntime, classifyPreviousVersionSource, type ManualCareerMemoryInput } from "../../lib/careerMemory/services/manualResumeRuntimeMapper";
import { buildPreviewOnlyResume, PREVIEW_PLACEHOLDER_SOURCE_SECTION_ID } from "../../lib/resumeTemplates/preview/previewOnlyCompletion";
import { renderTemplateFromRuntime } from "../../lib/resumeTemplates/engine/renderTemplate";
import { ensureTemplatesRegistered } from "../../lib/resumeTemplates/registry/bootstrap";
import { TEMPLATE_IDS, type TemplateId } from "../../lib/resumeTemplates/contracts/types";
import type { CanonicalResumeRuntime } from "../../lib/careerMemory/runtime/types";

const URL = "http://127.0.0.1:54321";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

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

async function makeTestUser(admin: ReturnType<typeof createClient>) {
  const email = `phase6i69-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i69-realdb-pw-12345";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client };
}

/* Mirrors Phase 6I.6.8's own import-manual route sequence exactly, called
   directly rather than through import-manual's own POST handler (this
   file exercises the persistence layer the SAME way; the resume-preview
   route call sequence below is what this suite is actually testing). */
async function importManualForUser(client: ReturnType<typeof createClient>, userId: string, input: ManualCareerMemoryInput) {
  const repos = createCanonicalRepositories(client as any);
  const service = new CanonicalCareerMemoryService(repos);
  const existing = await service.getCanonicalRuntime(userId);
  const previousVersionSource = classifyPreviousVersionSource(existing);
  const runtime = buildManualCanonicalRuntime(input, { reason: existing ? "user_edit" : "initial", parentVersionId: existing?.version.id ?? null });
  const saveResult = await service.saveCanonicalRuntimeAcknowledgingGap(userId, {
    runtime,
    expectedCurrentVersionId: existing ? existing.version.id : undefined,
    idempotencyKey: null,
  });
  return { previousVersionSource, saveResult, repos, service };
}

/* Simulates "an Imported Resume with identity X" without running the real
   parser - same technique Phase 6I.6.8's own test suite established
   (simulateUploadedVersion): register a real career_source_documents
   row, then save a runtime that references it. `identity` is a synthetic
   test-fixture marker only, never a real person. */
async function simulateImportedResume(client: ReturnType<typeof createClient>, userId: string, identityFullName: string) {
  const repos = createCanonicalRepositories(client as any);
  const service = new CanonicalCareerMemoryService(repos);
  const existing = await service.getCanonicalRuntime(userId);
  const profile = existing ? { id: existing.version.parentVersionId ? existing.version.parentVersionId : undefined } : undefined;
  const resolvedProfile = await repos.profiles.getByUserId(userId);
  const profileRow = resolvedProfile ?? (await repos.profiles.insert({ user_id: userId, schema_version: "1.0.0", serializer_version: "career-memory-runtime-v1" }));

  const sourceDocRow = await repos.sourceDocuments.insert({
    profile_id: profileRow.id,
    storage_bucket: "test-fixtures",
    storage_path: `test/${userId}/fixture-${Math.random().toString(36).slice(2)}.pdf`,
    original_file_name: "fixture-resume.pdf",
    file_type: "pdf",
    content_hash: `test-${Math.random().toString(36).slice(2)}`,
  });

  const manualShape: ManualCareerMemoryInput = {
    firstName: identityFullName.split(" ")[0],
    lastName: identityFullName.split(" ").slice(1).join(" ") || "Fixture",
    email: `${identityFullName.toLowerCase().replace(/\s+/g, ".")}@example.invalid`,
  };
  const fakeManual = buildManualCanonicalRuntime(manualShape, { reason: existing ? "user_edit" : "initial", parentVersionId: existing?.version.id ?? null });
  const runtimeWithSource: CanonicalResumeRuntime = {
    ...fakeManual,
    sourceDocuments: [{ id: sourceDocRow.id, fileName: sourceDocRow.original_file_name ?? "fixture-resume.pdf", fileType: "pdf" as const, contentHash: sourceDocRow.content_hash ?? undefined, addedAt: sourceDocRow.created_at }],
    version: { ...fakeManual.version, reason: "import" as const },
  };

  const saveResult = await service.saveCanonicalRuntimeAcknowledgingGap(userId, {
    runtime: runtimeWithSource,
    expectedCurrentVersionId: existing ? existing.version.id : undefined,
    idempotencyKey: null,
  });
  return { profileId: profileRow.id, versionId: saveResult.version.id, repos };
}

/* Exactly the resume-preview route's own sequence (resolve -> build
   preview-only completion -> render), called directly with an explicit
   versionId override so each test targets a known resume unambiguously. */
async function previewAs(client: ReturnType<typeof createClient>, userId: string, templateId: TemplateId, explicitVersionId?: string) {
  const repos = createCanonicalRepositories(client as any);
  const resolved = await resolveCanonicalResumeContext({ mode: "session", repos, client: client as any, userId, versionId: explicitVersionId });
  if (resolved.status !== "resolved") throw new Error(`expected resolved status, got ${resolved.status}`);
  const runtime = resolved.runtime ?? (await loadRuntimeForResolvedVersion(repos, resolved.versionId));
  const previewRuntime: CanonicalResumeRuntime = { ...runtime, resume: buildPreviewOnlyResume(runtime.resume) };
  const result = await renderTemplateFromRuntime(previewRuntime, { templateId, useTailored: false, generatedAt: new Date(0).toISOString() }, "html");
  return { resolved, runtime, previewRuntime, html: result.html };
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);
  ensureTemplatesRegistered();

  // ============================================================
  // TEST A - empty Manual resume, all 4 templates render.
  // ============================================================
  const userA = await makeTestUser(admin);
  const importA = await importManualForUser(userA.client, userA.userId, {});
  check("A: import of a fully empty Manual resume still succeeds", importA.saveResult.roundTripValid !== undefined, true);

  for (const templateId of TEMPLATE_IDS) {
    let threw: string | null = null;
    let html = "";
    try {
      const result = await previewAs(userA.client, userA.userId, templateId, importA.saveResult.version.id);
      html = result.html;
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    checkTrue(`A: ${templateId} renders successfully for an empty Manual resume (no throw)`, threw === null);
    checkTrue(`A: ${templateId} produced non-empty HTML`, html.length > 0);
    checkFalse(`A: ${templateId} HTML does not contain PERSISTENCE_ERROR`, html.includes("PERSISTENCE_ERROR"));
    checkFalse(`A: ${templateId} HTML does not contain identity.fullName raw error text`, html.includes("identity.fullName"));
    checkFalse(`A: ${templateId} HTML does not contain 'template rendering failed'`, html.includes("template rendering failed"));
    checkTrue(`A: ${templateId} HTML contains the neutral placeholder name`, html.includes("YOUR NAME"));
  }

  // ============================================================
  // TEST B - partial identity: real values win, nothing fabricated.
  // ============================================================
  const userB = await makeTestUser(admin);
  const importB = await importManualForUser(userB.client, userB.userId, { firstName: "Sample", lastName: "Candidate", email: "candidate@example.invalid" });
  const previewB = await previewAs(userB.client, userB.userId, "professional-ats", importB.saveResult.version.id);
  checkTrue("B: real identity fullName appears in rendered HTML", previewB.html.includes("Sample Candidate"));
  checkFalse("B: placeholder identity YOUR NAME does not appear (real identity present)", previewB.html.includes("YOUR NAME"));
  checkFalse("B: no fabricated Experience org text appears", previewB.html.includes("Senior Software Engineer"));
  check("B: previewRuntime.resume.professionalExperience is still empty (nothing fabricated as real data)", previewB.runtime.resume.professionalExperience.length, 0);
  checkTrue("B: previewRuntime (post-placeholder) DOES get a placeholder Experience section for layout only", previewB.previewRuntime.resume.professionalExperience.length === 1);
  check("B: the placeholder Experience entry's source is the preview-placeholder sentinel, not real data", previewB.previewRuntime.resume.professionalExperience[0]?.source.sourceSectionId, PREVIEW_PLACEHOLDER_SOURCE_SECTION_ID);

  // ============================================================
  // TEST C - more complete Manual: real values replace placeholders.
  // ============================================================
  const userC = await makeTestUser(admin);
  const importC = await importManualForUser(userC.client, userC.userId, {
    firstName: "Sample",
    lastName: "Candidate",
    email: "candidate@example.invalid",
    skills: ["Excel", "Communication"],
    experience: [{ company: "Fixture Logistics Co", jobTitle: "Coordinator", startDate: "2021-01", isCurrent: true, description: "Coordinated fixture operations." }],
  });
  const previewC = await previewAs(userC.client, userC.userId, "modern-sidebar", importC.saveResult.version.id);
  checkTrue("C: real identity appears", previewC.html.includes("Sample Candidate"));
  checkTrue("C: real Experience organization appears", previewC.html.includes("Fixture Logistics Co"));
  checkFalse("C: placeholder EXPERIENCE label does not appear (real experience present)", previewC.previewRuntime.resume.professionalExperience.some((e) => e.source.sourceSectionId === PREVIEW_PLACEHOLDER_SOURCE_SECTION_ID));
  checkTrue("C: Education still gets a placeholder (never supplied)", previewC.previewRuntime.resume.education.some((e) => e.source.sourceSectionId === PREVIEW_PLACEHOLDER_SOURCE_SECTION_ID));
  checkFalse("C: no fabricated Education institution text appears", previewC.html.includes("University of Example"));

  // ============================================================
  // TEST D - complete Manual: normal 6I.6.8 behavior, no injection.
  // ============================================================
  const userD = await makeTestUser(admin);
  const importD = await importManualForUser(userD.client, userD.userId, {
    firstName: "Sample",
    lastName: "Candidate",
    email: "candidate@example.invalid",
    summary: "Detail-oriented fixture candidate.",
    skills: ["Excel", "Communication"],
    experience: [{ company: "Fixture Logistics Co", jobTitle: "Coordinator", startDate: "2021-01", isCurrent: true, description: "Coordinated fixture operations." }],
    education: [{ school: "Fixture College", program: "Business Diploma", startDate: "2017-09", endDate: "2019-06" }],
    certifications: [{ name: "Fixture Certificate", issuer: "Fixture Board", date: "2022-03" }],
    projects: [{ name: "Fixture Project", role: "Lead", dates: "2022", description: "Fixture project description." }],
  });
  const previewD = await previewAs(userD.client, userD.userId, "executive-minimal", importD.saveResult.version.id);
  check("D: buildPreviewOnlyResume returns the SAME resume object unchanged for a complete resume", previewD.previewRuntime.resume === previewD.runtime.resume, true);
  checkTrue("D: real identity/experience/education all appear, unmodified", previewD.html.includes("Sample Candidate") && previewD.html.includes("Fixture Logistics Co") && previewD.html.includes("Fixture College"));

  // ============================================================
  // TEST E - same-user Manual A / Imported B / Imported C isolation.
  // ============================================================
  const userE = await makeTestUser(admin);
  const manualEImport = await importManualForUser(userE.client, userE.userId, { firstName: "Sample", lastName: "ManualUser" });
  const importedB = await simulateImportedResume(userE.client, userE.userId, "Imported Fixture Alpha");
  const importedC = await simulateImportedResume(userE.client, userE.userId, "Imported Fixture Beta");

  const previewManualE = await previewAs(userE.client, userE.userId, "professional-ats", manualEImport.saveResult.version.id);
  checkTrue("E: Manual A's own explicit-version preview shows A's real identity", previewManualE.html.includes("Sample ManualUser"));
  checkFalse("E: Manual A's preview does NOT show Imported B's identity", previewManualE.html.includes("Imported Fixture Alpha"));
  checkFalse("E: Manual A's preview does NOT show Imported C's identity", previewManualE.html.includes("Imported Fixture Beta"));
  check("E: resolveCanonicalResumeContext with explicit versionId resolves to A's own profileId", previewManualE.resolved.status === "resolved" ? previewManualE.resolved.profileId : null, manualEImport.saveResult.version.profile_id);
  check("E: resolveCanonicalResumeContext source is explicit-version", previewManualE.resolved.status === "resolved" ? (previewManualE.resolved as any).source : null, "explicit-version");

  const previewImportedB = await previewAs(userE.client, userE.userId, "professional-ats", importedB.versionId);
  checkTrue("E: Imported B's own explicit-version preview shows B's real identity", previewImportedB.html.includes("Imported Fixture Alpha"));
  checkFalse("E: Imported B's preview does NOT show Manual A's identity", previewImportedB.html.includes("Sample ManualUser"));

  const previewImportedC = await previewAs(userE.client, userE.userId, "professional-ats", importedC.versionId);
  checkTrue("E: Imported C's own explicit-version preview shows C's real identity", previewImportedC.html.includes("Imported Fixture Beta"));
  checkFalse("E: Imported C's preview does NOT show Manual A's identity", previewImportedC.html.includes("Sample ManualUser"));

  // ============================================================
  // TEST F - stale-state isolation: B previewed first, then A.
  // ============================================================
  const userF = await makeTestUser(admin);
  const importedFB = await simulateImportedResume(userF.client, userF.userId, "Imported Fixture Alpha");
  const previewFB = await previewAs(userF.client, userF.userId, "professional-ats", importedFB.versionId);
  checkTrue("F: step 1 - Imported B previews successfully with B's own identity", previewFB.html.includes("Imported Fixture Alpha"));

  /* This is the exact real-world scenario the round's own root-cause
     trace found broken: after Dashboard selects an uploaded resume
     (career_memory.selected_resume_type='uploaded'), a brand-new Manual
     resume must still preview as itself, not silently resolve to the
     stale Dashboard selection. Manual A's own preview passes an
     explicit versionId (Branch A2) and must therefore never consult
     career_memory.selected_resume_type/selected_resume_id at all. */
  const manualFImport = await importManualForUser(userF.client, userF.userId, { firstName: "Sample", lastName: "ManualUser" });
  const previewFA = await previewAs(userF.client, userF.userId, "professional-ats", manualFImport.saveResult.version.id);
  checkTrue("F: step 2 - after switching to empty Manual A, its own explicit-version preview shows A's own content", previewFA.html.includes("YOUR NAME") || previewFA.html.includes("Sample ManualUser"));
  checkFalse("F: step 2 - stale Imported B identity is absent from Manual A's preview", previewFA.html.includes("Imported Fixture Alpha"));
  check("F: step 2 - resolver resolves to Manual A's own profileId, not B's", previewFA.resolved.status === "resolved" ? previewFA.resolved.profileId : null, manualFImport.saveResult.version.profile_id);

  // ============================================================
  // TEST G - placeholder persistence isolation (DB inspection).
  // ============================================================
  const placeholderMarkers = ["YOUR NAME", "PROFESSIONAL SUMMARY", PREVIEW_PLACEHOLDER_SOURCE_SECTION_ID];
  const { data: careerMemoryRowG } = await admin.from("career_memory").select("*").eq("user_id", userA.userId).maybeSingle();
  const { data: profileRowG } = await admin.from("career_profiles").select("*").eq("id", importA.saveResult.version.profile_id).maybeSingle();
  const { data: versionRowG } = await admin.from("career_resume_versions").select("*").eq("id", importA.saveResult.version.id).maybeSingle();
  const { data: sourceDocsG } = await admin.from("career_source_documents").select("*").eq("profile_id", importA.saveResult.version.profile_id);
  const { data: applicationsG } = await admin.from("applications").select("*").eq("user_id", userA.userId);

  for (const marker of placeholderMarkers) {
    checkFalse(`G: career_memory row does not contain placeholder marker "${marker}"`, JSON.stringify(careerMemoryRowG ?? {}).includes(marker));
    checkFalse(`G: career_profiles row does not contain placeholder marker "${marker}"`, JSON.stringify(profileRowG ?? {}).includes(marker));
    checkFalse(`G: career_resume_versions row (incl. snapshot) does not contain placeholder marker "${marker}"`, JSON.stringify(versionRowG ?? {}).includes(marker));
    checkFalse(`G: career_source_documents rows do not contain placeholder marker "${marker}"`, JSON.stringify(sourceDocsG ?? []).includes(marker));
    checkFalse(`G: applications rows do not contain placeholder marker "${marker}"`, JSON.stringify(applicationsG ?? []).includes(marker));
  }
  check("G: preview operations created zero application rows for this user", (applicationsG ?? []).length, 0);

  // ============================================================
  // TEST H - template switching: identity/profile/version stability, zero AI.
  // ============================================================
  const userH = await makeTestUser(admin);
  const importH = await importManualForUser(userH.client, userH.userId, {});
  const versionBeforeSwitch = importH.saveResult.version.id;
  const profileBeforeSwitch = importH.saveResult.version.profile_id;
  for (const templateId of TEMPLATE_IDS) {
    const result = await previewAs(userH.client, userH.userId, templateId, versionBeforeSwitch);
    check(`H: switching to ${templateId} keeps the same resolved profileId`, result.resolved.status === "resolved" ? result.resolved.profileId : null, profileBeforeSwitch);
    check(`H: switching to ${templateId} keeps the same resolved versionId (preview never creates a new version)`, result.resolved.status === "resolved" ? result.resolved.versionId : null, versionBeforeSwitch);
  }
  const repos_H = createCanonicalRepositories(userH.client as any);
  const versionsAfterH = await repos_H.resumeVersions.listByProfileId(profileBeforeSwitch);
  check("H: exactly 1 canonical version exists after previewing all 4 templates (no overlay/version created)", versionsAfterH.length, 1);

  // ============================================================
  // TEST I - uploaded (imported) resume regression: no unnecessary placeholders.
  // ============================================================
  const userI = await makeTestUser(admin);
  const importedI = await simulateImportedResume(userI.client, userI.userId, "Imported Fixture Alpha");
  const previewI = await previewAs(userI.client, userI.userId, "creative-timeline", importedI.versionId);
  checkTrue("I: imported resume renders with its own real identity", previewI.html.includes("Imported Fixture Alpha"));
  checkFalse("I: imported resume preview does not show the empty-state placeholder name", previewI.html.includes("YOUR NAME"));

  // ============================================================
  // TEST J - cross-user security (RLS-enforced).
  // ============================================================
  const userJ1 = await makeTestUser(admin);
  const userJ2 = await makeTestUser(admin);
  const manualJ1 = await importManualForUser(userJ1.client, userJ1.userId, { firstName: "Sample", lastName: "UserOne" });
  const importedJ1B = await simulateImportedResume(userJ1.client, userJ1.userId, "Imported Fixture Alpha");
  const importedJ2D = await simulateImportedResume(userJ2.client, userJ2.userId, "Cross User Fixture");

  let userJ1ThrewOnUserJ2Version = false;
  try {
    await previewAs(userJ1.client, userJ1.userId, "professional-ats", importedJ2D.versionId);
  } catch {
    userJ1ThrewOnUserJ2Version = true;
  }
  checkTrue("J: User 1 cannot preview User 2's Imported D version via explicit versionId (RLS-enforced, not silently substituted)", userJ1ThrewOnUserJ2Version);

  const previewJ1Manual = await previewAs(userJ1.client, userJ1.userId, "professional-ats", manualJ1.saveResult.version.id);
  checkFalse("J: User 1's own Manual preview never falls back to User 1's own Imported B", previewJ1Manual.html.includes("Imported Fixture Alpha"));
  checkFalse("J: User 1's own Manual preview never leaks User 2's Cross User Fixture identity", previewJ1Manual.html.includes("Cross User Fixture"));
  void importedJ1B;

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exit(1);
});
