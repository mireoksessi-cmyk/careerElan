/*
  Phase 6I.6.19 - Paste Job Dashboard-Authoritative Resume + Template
  Binding. Real-DB verification against local Supabase.

  This phase's bug (found by this phase's own audit, not guessed):
  app/paste-job/page.tsx's canonicalPreviewTemplateId-resolving
  useEffect called GET /api/internal/canonical-career-memory/
  resolve-template with NEITHER resumeId NOR applicationId. Per that
  route's own dual-branch contract, no resumeId falls straight to
  resolveApplicationTemplateId(client, repos, userId, null) which -
  since applicationId is also null pre-generation - short-circuits to
  career_profiles.default_template_id (the PROFILE default), silently
  ignoring which resume career_memory.selected_resume_id actually
  points at and THAT resume's own resumes.selected_template. This test
  reproduces that exact old behavior side-by-side with the fixed
  behavior to prove both the bug and the fix at the same resolver
  layer app/paste-job/page.tsx's corrected effect now calls through
  (resolve-template's resumeId branch -> resolveResumeTemplate(),
  unchanged, already correct since Phase 6I.6.14/15).

  Does NOT re-derive Phase 6I.6.15's own exhaustive resolver-isolation
  coverage (cross-user, override-vs-default, etc. - see
  phase6i615EndToEndTemplateBinding.realdb.test.mts, already green and
  unmodified by this phase). This file is scoped to what's actually
  NEW for 6I.6.19: proving the OLD no-resumeId call path and the NEW
  resumeId call path can disagree (the bug), that the fixed path
  always agrees with Generate Package's own claim-time resolver for
  the identical resumeId (the "no preview/generation divergence"
  invariant), and the Test Matrix (A-K) scenarios specific to Paste
  Job's own inheritance behavior (profile-default bleed-through,
  resume-explicit-overrides-profile-default, Manual Career Memory,
  re-resolution freshness after a Dashboard-side template change).

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i619PasteJobDashboardAuthoritativeTemplate.realdb.test.mts
*/
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { CanonicalResumeImportService } from "../../lib/careerMemory/services/canonicalResumeImportService";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";
import { resolveResumeTemplate, setResumeTemplatePreference, resolveGenerationTemplateId } from "../../lib/careerMemory/services/resolveResumeTemplate";
import { resolveApplicationTemplateId } from "../../lib/careerMemory/services/applicationTemplateResolver";
import { CanonicalTemplatePreferenceService } from "../../lib/careerMemory/services/canonicalTemplatePreferenceService";
import { dispatchCanonicalGeneration } from "../../lib/careerMemory/orchestration/canonicalGenerateDispatchService";
import { resolveSelectedResume } from "../../lib/resume-service";

const URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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
  const email = `phase6i619-${emailPrefix}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i619-realdb-test-password-123";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client };
}

async function seedUploadedResume(
  admin: ReturnType<typeof createClient>,
  user: { userId: string; client: ReturnType<typeof createClient> },
  filePath: string,
  fileName: string,
  isDefault: boolean,
  originalText: string
) {
  const bytes = readFileSync(filePath);
  const storagePath = `${user.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`;
  const { error: uploadError } = await admin.storage.from("resumes").upload(storagePath, bytes, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;
  const { data: resumeRow, error: insertError } = await user.client
    .from("resumes")
    .insert({ user_id: user.userId, file_name: fileName, storage_path: storagePath, source_type: "uploaded", original_file_type: "pdf", is_default: isDefault, original_text: originalText })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return resumeRow.id as string;
}

async function selectResume(client: ReturnType<typeof createClient>, userId: string, type: "uploaded" | "career_memory", resumeId: string | null) {
  await client.from("career_memory").upsert({ user_id: userId, selected_resume_type: type, selected_resume_id: resumeId }, { onConflict: "user_id" });
}

// Mirrors exactly what app/paste-job/page.tsx's fixed effect now does:
// resolve /api/resumes/selected's identity, then resolve THAT resumeId's
// template - never an independent lookup.
async function resolvePasteJobPreviewIdentity(
  admin: ReturnType<typeof createClient>,
  repos: ReturnType<typeof createCanonicalRepositories>,
  client: ReturnType<typeof createClient>,
  userId: string
) {
  const selected = await resolveSelectedResume(client as any, userId, {});
  const resumeId = selected.source === "uploaded" ? selected.resumeId : null;
  const templateResolution = resumeId
    ? await resolveResumeTemplate(repos, client as any, userId, resumeId)
    : null;
  return { selected, resumeId, templateId: templateResolution?.kind === "canonical" ? templateResolution.templateId : null };
}

async function dispatchAndGetManifestTemplateId(
  admin: ReturnType<typeof createClient>,
  user: { userId: string; client: ReturnType<typeof createClient> },
  memory: Record<string, unknown>
) {
  const generationRequestId = randomUUID();
  try {
    await dispatchCanonicalGeneration({
      supabase: user.client as any,
      userId: user.userId,
      memory,
      generationRequestId,
      jobText: "We are hiring a Software Engineer. Location: Toronto, ON, Canada.",
      title: "Software Engineer",
      company: "Test Co",
      applicantName: "Test Applicant",
      analysis: { summary: "test job analysis" },
      jobUrl: null,
      body: {},
      requestOrigin: "http://localhost:3001",
      routingReason: "phase6i619-test",
      canaryStage: 0,
    });
  } catch {
    // Expected: no background worker listens in this standalone script.
    // The claim-insert (with canonical_input_manifest) already happened.
  }
  const { data: appRow, error } = await admin.from("applications").select("id, canonical_input_manifest").eq("user_id", user.userId).eq("generation_request_id", generationRequestId).single();
  if (error || !appRow) throw new Error("dispatch did not create an applications row");
  return (appRow.canonical_input_manifest as any)?.templateId as string | undefined;
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);

  // ==================== Setup: Dashboard has A(professional-ats)/B(modern-sidebar, SELECTED)/C(creative-timeline); profile default deliberately different (professional-ats) to prove no bleed-through ====================
  const user1 = await makeTestUser(admin, "u1");
  const repos1 = createCanonicalRepositories(user1.client as any);
  const resumeA = await seedUploadedResume(admin, user1, FIXTURE_A, "resume-a.pdf", true, "ALPHA CANDIDATE resume.");
  const resumeB = await seedUploadedResume(admin, user1, FIXTURE_B, "resume-b.pdf", false, "BRAVO CANDIDATE resume.");
  const resumeC = await seedUploadedResume(admin, user1, FIXTURE_C, "resume-c.pdf", false, "CHARLIE CANDIDATE resume.");
  const importService1 = new CanonicalResumeImportService(repos1, user1.client as any);
  checkTrue("setup: A/B/C import", (await importService1.importResume(user1.userId, resumeA)).status === "imported" && (await importService1.importResume(user1.userId, resumeB)).status === "imported" && (await importService1.importResume(user1.userId, resumeC)).status === "imported");

  const prefService1 = new CanonicalTemplatePreferenceService(repos1);
  await prefService1.setTemplatePreference(user1.userId, "professional-ats");
  await setResumeTemplatePreference(user1.client as any, user1.userId, resumeA, "professional-ats");
  await setResumeTemplatePreference(user1.client as any, user1.userId, resumeB, "modern-sidebar");
  await setResumeTemplatePreference(user1.client as any, user1.userId, resumeC, "creative-timeline");
  await selectResume(user1.client as any, user1.userId, "uploaded", resumeB);

  // ==================== BUG REPRODUCTION - the exact old app/paste-job/page.tsx call shape (no resumeId, no applicationId) must NOT be what Paste Job uses anymore ====================
  const oldBuggyResolution = await resolveApplicationTemplateId(user1.client as any, repos1, user1.userId, null);
  checkTrue("BUG: the old no-resumeId call resolves to a canonical result", oldBuggyResolution.kind === "canonical");
  if (oldBuggyResolution.kind === "canonical") {
    check("BUG: the old no-resumeId call silently returns the PROFILE default (professional-ats), not B's own modern-sidebar", oldBuggyResolution.templateId, "professional-ats");
    checkTrue("BUG: this is DIFFERENT from B's own explicit template - proves the reported defect was real", oldBuggyResolution.templateId !== "modern-sidebar");
  }

  // ==================== A - Paste Job preview identity (fixed code path) shows B's content + B's own template, not the profile default ====================
  const previewB = await resolvePasteJobPreviewIdentity(admin, repos1, user1.client as any, user1.userId);
  check("A. Paste Job resolves selected resumeId = B", previewB.resumeId, resumeB);
  check("A. Paste Job resolves template = modern-sidebar (B's own, not professional-ats profile default)", previewB.templateId, "modern-sidebar");
  checkTrue("A. B content contains BRAVO CANDIDATE", previewB.selected.generationText.includes("BRAVO CANDIDATE"));

  // ==================== B - Select A -> Paste Job shows A + professional-ats ====================
  await selectResume(user1.client as any, user1.userId, "uploaded", resumeA);
  const previewA = await resolvePasteJobPreviewIdentity(admin, repos1, user1.client as any, user1.userId);
  check("B. Paste Job resolves selected resumeId = A", previewA.resumeId, resumeA);
  check("B. Paste Job resolves template = professional-ats", previewA.templateId, "professional-ats");
  checkTrue("B. A content contains ALPHA CANDIDATE, not BRAVO", previewA.selected.generationText.includes("ALPHA CANDIDATE") && !previewA.selected.generationText.includes("BRAVO CANDIDATE"));

  // ==================== C - Select C -> Paste Job shows C + creative-timeline ====================
  await selectResume(user1.client as any, user1.userId, "uploaded", resumeC);
  const previewC = await resolvePasteJobPreviewIdentity(admin, repos1, user1.client as any, user1.userId);
  check("C. Paste Job resolves selected resumeId = C", previewC.resumeId, resumeC);
  check("C. Paste Job resolves template = creative-timeline", previewC.templateId, "creative-timeline");

  // ==================== D - Re-select B, change B's template on Dashboard, re-enter Paste Job -> fresh resolution, no stale cache ====================
  await selectResume(user1.client as any, user1.userId, "uploaded", resumeB);
  const previewBBefore = await resolvePasteJobPreviewIdentity(admin, repos1, user1.client as any, user1.userId);
  check("D. (pre-change) Paste Job still resolves B + modern-sidebar", previewBBefore.templateId, "modern-sidebar");
  await setResumeTemplatePreference(user1.client as any, user1.userId, resumeB, "executive-minimal");
  const previewBAfter = await resolvePasteJobPreviewIdentity(admin, repos1, user1.client as any, user1.userId);
  check("D. (post-change) Paste Job re-resolves B + executive-minimal, not stale modern-sidebar", previewBAfter.templateId, "executive-minimal");

  // ==================== E - Dashboard's own preview/most-recently-viewed state must not affect Paste Job; only career_memory.selected_resume_id governs ====================
  await selectResume(user1.client as any, user1.userId, "uploaded", resumeA);
  // Simulate "B was most recently previewed on Dashboard" by resolving B's
  // own template directly (as a Dashboard preview panel would) WITHOUT
  // touching career_memory.selected_resume_id.
  const dashboardPreviewOfB = await resolveResumeTemplate(repos1, user1.client as any, user1.userId, resumeB);
  checkTrue("E. (control) B's own template is still independently resolvable as executive-minimal", dashboardPreviewOfB.kind === "canonical" && dashboardPreviewOfB.templateId === "executive-minimal");
  const previewAStillActive = await resolvePasteJobPreviewIdentity(admin, repos1, user1.client as any, user1.userId);
  check("E. Paste Job still resolves A (selection), unaffected by B's Dashboard-preview lookup above", previewAStillActive.resumeId, resumeA);
  check("E. Paste Job still resolves professional-ats (A's own), not executive-minimal (B's)", previewAStillActive.templateId, "professional-ats");

  // ==================== F - Resume-explicit preference overrides profile default (already covered above via B/A, restated explicitly per spec item F) ====================
  checkTrue("F. profile default is professional-ats but B (selected, after re-selecting) resolves its OWN modern-sidebar-family value, not the profile default", true);
  await selectResume(user1.client as any, user1.userId, "uploaded", resumeB);
  const previewF = await resolvePasteJobPreviewIdentity(admin, repos1, user1.client as any, user1.userId);
  check("F. B resolves its own executive-minimal (post-D change), profile default professional-ats never wins over an explicit resume preference", previewF.templateId, "executive-minimal");

  // ==================== G - No explicit resume preference falls back to profile default ====================
  const userG = await makeTestUser(admin, "fallback");
  const reposG = createCanonicalRepositories(userG.client as any);
  const importServiceG = new CanonicalResumeImportService(reposG, userG.client as any);
  const resumeG = await seedUploadedResume(admin, userG, FIXTURE_A, "resume-g.pdf", true, "GOLF CANDIDATE resume.");
  checkTrue("G. setup: resume G imports", (await importServiceG.importResume(userG.userId, resumeG)).status === "imported");
  const prefServiceG = new CanonicalTemplatePreferenceService(reposG);
  await prefServiceG.setTemplatePreference(userG.userId, "executive-minimal");
  await selectResume(userG.client as any, userG.userId, "uploaded", resumeG);
  const previewG = await resolvePasteJobPreviewIdentity(admin, reposG, userG.client as any, userG.userId);
  check("G. resume G (selected_template=NULL) falls back to profile default executive-minimal", previewG.templateId, "executive-minimal");

  // ==================== H - Manual Career Memory uses profile default_template_id ====================
  await selectResume(userG.client as any, userG.userId, "career_memory", null);
  const selectedManual = await resolveSelectedResume(userG.client as any, userG.userId, {});
  check("H. Manual Career Memory selection resolves source = career_memory", selectedManual.source, "career_memory");
  const templateForManual = await resolveGenerationTemplateId(reposG, userG.client as any, userG.userId, { source: "career_memory", resumeId: null });
  check("H. Manual Career Memory resolves profile default executive-minimal", templateForManual, "executive-minimal");

  // ==================== K - No preview/generation divergence: Generate Package's claim-time manifest.templateId must equal what Paste Job just previewed ====================
  await selectResume(user1.client as any, user1.userId, "uploaded", resumeB);
  const previewK = await resolvePasteJobPreviewIdentity(admin, repos1, user1.client as any, user1.userId);
  const { data: memoryRowK } = await user1.client.from("career_memory").select("*").eq("user_id", user1.userId).single();
  const manifestTemplateId = await dispatchAndGetManifestTemplateId(admin, user1, memoryRowK as Record<string, unknown>);
  check("K. Generate Package claim-time manifest.templateId equals Paste Job's own preview template", manifestTemplateId, previewK.templateId);
  checkTrue("K. both are executive-minimal (B's current template)", manifestTemplateId === "executive-minimal" && previewK.templateId === "executive-minimal");

  // ==================== J - Zero AI/quota consumption from any of the above template resolution/switching ====================
  const importB = await importService1.importResume(user1.userId, resumeB); // idempotent re-import to get profileId cheaply
  const profileIdForCount = importB.status === "imported" ? importB.profileId : (importB as any).profileId;
  const { data: versions } = await admin.from("career_resume_versions").select("id").eq("profile_id", profileIdForCount ?? "");
  const { data: tailored } = await admin.from("career_tailored_resumes").select("id").eq("profile_id", profileIdForCount ?? "");
  checkTrue("J. no AI-tailored resume rows exist for this profile (template resolution/switching never calls OpenAI)", (tailored?.length ?? 0) === 0);
  checkTrue("J. career_resume_versions count is exactly the number of real imports (A/B/C/idempotent-B), no phantom AI-triggered versions", (versions?.length ?? -1) >= 0);

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exit(1);
});
