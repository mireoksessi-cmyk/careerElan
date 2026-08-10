/*
  Phase 6I.6.15 - End-to-End Per-Resume Template Binding Through
  Generate Package. Real-DB verification against local Supabase.

  Proves the bug found by this phase's own audit: the canonical
  Generate Package dispatch path (canonicalGenerateDispatchService.ts)
  NEVER called resolveResumeTemplate() (added in 6I.6.14) at all - it
  always hardcoded "professional-ats" into canonical_input_manifest.
  templateId, since the Paste Job client never sends body.templateId
  (resume identity is resolved entirely server-side). This meant a
  resume's own explicit template preference silently never reached the
  generated application's applications.selected_template_id.

  The fix: lib/careerMemory/services/resolveResumeTemplate.ts's new
  resolveGenerationTemplateId(), wired into
  canonicalGenerateDispatchService.ts at claim-insert time, bound to
  the SAME resolvedResume identity (source+resumeId) already resolved
  for the application's CONTENT via resolveSelectedResume() - never an
  independent lookup that could disagree about which resume is active.

  This test calls dispatchCanonicalGeneration() directly (the real
  production function, not a route-level HTTP mock) and lets the
  background-worker ENQUEUE step fail harmlessly (no worker listens in
  this script) - the row (including its canonical_input_manifest) is
  already durably persisted by that point, which is all this phase's
  bug concerns: correct INPUT BINDING at claim time, not generation
  success. No OpenAI call is ever reachable from this path - Generate
  Package's actual AI call only happens later, inside the background
  worker this test never invokes.

  For applications.selected_template_id itself (only written later, by
  the completion RPC once real generation finishes - see this phase's
  own audit, canonicalGenerationWorker.ts reads manifest.templateId
  verbatim and the RPC sets selected_template_id = p_template_id
  verbatim), this test simulates that ONE column write directly rather
  than running a real OpenAI generation, to prove the snapshot/
  isolation invariants (Part E/F/G/H of the phase spec) without
  consuming AI quota.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i615EndToEndTemplateBinding.realdb.test.mts
*/
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { CanonicalResumeImportService } from "../../lib/careerMemory/services/canonicalResumeImportService";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";
import { resolveResumeTemplate, setResumeTemplatePreference, resolveGenerationTemplateId } from "../../lib/careerMemory/services/resolveResumeTemplate";
import { resolveCanonicalResumeContext } from "../../lib/careerMemory/services/resolveCanonicalResumeContext";
import { CanonicalTemplatePreferenceService } from "../../lib/careerMemory/services/canonicalTemplatePreferenceService";
import { setApplicationTemplate } from "../../lib/careerMemory/services/applicationTemplateSwitchService";
import { dispatchCanonicalGeneration } from "../../lib/careerMemory/orchestration/canonicalGenerateDispatchService";
import { resolveSelectedResume } from "../../lib/resume-service";
import { NotFoundError } from "../../lib/careerMemory/errors/domainErrors";

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
  const email = `phase6i615-${emailPrefix}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i615-realdb-test-password-123";
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

// Simulates the ONE column write complete_canonical_generation() performs
// for this field (selected_template_id = p_template_id, verified via this
// phase's own code audit) - without running a real OpenAI generation.
async function simulateGenerationCompletionTemplateWrite(admin: ReturnType<typeof createClient>, applicationId: string) {
  const { data: row } = await admin.from("applications").select("canonical_input_manifest").eq("id", applicationId).single();
  const templateId = (row?.canonical_input_manifest as { templateId?: string } | null)?.templateId;
  await admin.from("applications").update({ selected_template_id: templateId }).eq("id", applicationId);
  return templateId;
}

async function dispatchAndGetApplication(
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
      // 127.0.0.1:1 is a reserved, never-bound port - the enqueue to a
      // background worker always fails deterministically here, regardless
      // of whether a real Next.js dev server happens to be running on
      // localhost:3001 on the machine executing this script. Using the
      // real dev origin here was found (Phase 6I.6.34 verification) to
      // silently reach a live server and trigger a real OpenAI call when
      // one was running - this file's own header claims "No OpenAI call
      // is ever reachable from this path," so the target must be
      // structurally unreachable, not just usually-idle.
      requestOrigin: "http://127.0.0.1:1",
      routingReason: "phase6i615-test",
      canaryStage: 0,
    });
  } catch {
    // Expected: enqueueCanonicalWorker's fetch to the background function
    // has no listener in this standalone script - the claim-insert (with
    // its canonical_input_manifest) already happened before that point.
  }
  const { data: appRow, error } = await admin.from("applications").select("id, resume_source, resume_id, canonical_input_manifest, selected_template_id").eq("user_id", user.userId).eq("generation_request_id", generationRequestId).single();
  if (error || !appRow) throw new Error("dispatch did not create an applications row");
  return appRow;
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);

  // ==================== Setup: user1 with 3 resumes, distinct content markers, distinct templates ====================
  const user1 = await makeTestUser(admin, "u1");
  const resumeA = await seedUploadedResume(admin, user1, FIXTURE_A, "resume-a.pdf", true, "ALPHA CANDIDATE resume. Experience code ALPHA-EXPERIENCE-61415.");
  const resumeB = await seedUploadedResume(admin, user1, FIXTURE_B, "resume-b.pdf", false, "BRAVO CANDIDATE resume. Experience code BRAVO-EXPERIENCE-61415.");
  const resumeC = await seedUploadedResume(admin, user1, FIXTURE_C, "resume-c.pdf", false, "CHARLIE CANDIDATE resume. Experience code CHARLIE-EXPERIENCE-61415.");

  const repos1 = createCanonicalRepositories(user1.client as any);
  const importService1 = new CanonicalResumeImportService(repos1, user1.client as any);
  const importA = await importService1.importResume(user1.userId, resumeA);
  const importB = await importService1.importResume(user1.userId, resumeB);
  const importC = await importService1.importResume(user1.userId, resumeC);
  checkTrue("setup: A/B/C all import successfully", importA.status === "imported" && importB.status === "imported" && importC.status === "imported");

  await setResumeTemplatePreference(user1.client as any, user1.userId, resumeA, "professional-ats");
  await setResumeTemplatePreference(user1.client as any, user1.userId, resumeB, "modern-sidebar");
  await setResumeTemplatePreference(user1.client as any, user1.userId, resumeC, "creative-timeline");

  await selectResume(user1.client as any, user1.userId, "uploaded", resumeB);
  const { data: memoryRow } = await user1.client.from("career_memory").select("*").eq("user_id", user1.userId).single();

  // ==================== TEST A - Per-resume generation resolution (B selected) ====================
  const resolvedB = await resolveSelectedResume(user1.client as any, user1.userId, { preloadedMemory: memoryRow });
  check("A. selected resume resolves to B (source)", resolvedB.source, "uploaded");
  check("A. selected resume resolves to B (resumeId)", resolvedB.resumeId, resumeB);
  checkTrue("A. B content contains BRAVO CANDIDATE", resolvedB.generationText.includes("BRAVO CANDIDATE"));
  checkTrue("A. B content contains BRAVO-EXPERIENCE-61415", resolvedB.generationText.includes("BRAVO-EXPERIENCE-61415"));

  const templateForB = await resolveGenerationTemplateId(repos1, user1.client as any, user1.userId, { source: resolvedB.source, resumeId: resolvedB.resumeId });
  check("A. resolved template for B is modern-sidebar", templateForB, "modern-sidebar");

  const canonicalCtxB = await resolveCanonicalResumeContext({ mode: "session", repos: repos1, client: user1.client as any, userId: user1.userId, resumeId: resumeB });
  checkTrue("A. canonical context resolved", canonicalCtxB.status === "resolved");
  if (canonicalCtxB.status === "resolved") {
    check("A. resolved canonical version is VERSION_B", canonicalCtxB.versionId, importB.status === "imported" ? importB.versionId : null);
    check("A. resolved source document is SOURCE_B", canonicalCtxB.sourceDocumentId, importB.status === "imported" ? importB.sourceDocumentId : null);
  }

  // ==================== TEST B - Wrong-resume isolation ====================
  checkTrue("B. B content does NOT contain ALPHA CANDIDATE", !resolvedB.generationText.includes("ALPHA CANDIDATE"));
  checkTrue("B. B content does NOT contain CHARLIE CANDIDATE", !resolvedB.generationText.includes("CHARLIE CANDIDATE"));
  checkTrue("B. B content does NOT contain ALPHA-EXPERIENCE-61415", !resolvedB.generationText.includes("ALPHA-EXPERIENCE-61415"));
  checkTrue("B. B content does NOT contain CHARLIE-EXPERIENCE-61415", !resolvedB.generationText.includes("CHARLIE-EXPERIENCE-61415"));
  checkTrue("B. resolved template for B is not A's template", templateForB !== "professional-ats");
  checkTrue("B. resolved template for B is not C's template", templateForB !== "creative-timeline");
  if (canonicalCtxB.status === "resolved" && importA.status === "imported" && importC.status === "imported") {
    checkTrue("B. resolved version is not VERSION_A", canonicalCtxB.versionId !== importA.versionId);
    checkTrue("B. resolved version is not VERSION_C", canonicalCtxB.versionId !== importC.versionId);
  }

  // ==================== TEST C - Initial application template snapshot ====================
  const appB1 = await dispatchAndGetApplication(admin, user1, memoryRow as Record<string, unknown>);
  check("C. application B1 snapshots resume_id = B", appB1.resume_id, resumeB);
  check("C. application B1 manifest.templateId = modern-sidebar", (appB1.canonical_input_manifest as any)?.templateId, "modern-sidebar");
  const b1Written = await simulateGenerationCompletionTemplateWrite(admin, appB1.id);
  check("C. applications.selected_template_id (B1) = modern-sidebar", b1Written, "modern-sidebar");

  // ==================== TEST D - Resume template change after snapshot must NOT mutate existing application ====================
  await setResumeTemplatePreference(user1.client as any, user1.userId, resumeB, "executive-minimal");
  const { data: appB1After } = await admin.from("applications").select("selected_template_id").eq("id", appB1.id).single();
  check("D. existing application B1 remains modern-sidebar after B's default changes", appB1After?.selected_template_id, "modern-sidebar");

  // ==================== TEST E - New application after resume template change uses the NEW template ====================
  const { data: memoryRowAfter } = await user1.client.from("career_memory").select("*").eq("user_id", user1.userId).single();
  const appB2 = await dispatchAndGetApplication(admin, user1, memoryRowAfter as Record<string, unknown>);
  check("E. application B2 manifest.templateId = executive-minimal", (appB2.canonical_input_manifest as any)?.templateId, "executive-minimal");
  const b2Written = await simulateGenerationCompletionTemplateWrite(admin, appB2.id);
  check("E. applications.selected_template_id (B2) = executive-minimal", b2Written, "executive-minimal");

  // ==================== TEST F - A/C unaffected by B's template change ====================
  const templateForA = await resolveGenerationTemplateId(repos1, user1.client as any, user1.userId, { source: "uploaded", resumeId: resumeA });
  const templateForC = await resolveGenerationTemplateId(repos1, user1.client as any, user1.userId, { source: "uploaded", resumeId: resumeC });
  check("F. A remains professional-ats", templateForA, "professional-ats");
  check("F. C remains creative-timeline", templateForC, "creative-timeline");

  // ==================== TEST G - Application-level override does not mutate resume default ====================
  const switchResult = await setApplicationTemplate(user1.client as any, repos1, user1.userId, appB1.id, "creative-timeline", false);
  check("G. application B1 override applied", switchResult.selectedTemplateId, "creative-timeline");
  const { data: appB1AfterOverride } = await admin.from("applications").select("selected_template_id").eq("id", appB1.id).single();
  check("G. applications.selected_template_id (B1) now creative-timeline", appB1AfterOverride?.selected_template_id, "creative-timeline");
  const resumeBAfterOverride = await resolveResumeTemplate(repos1, user1.client as any, user1.userId, resumeB);
  check("G. resume B's own default is STILL executive-minimal (override did not mutate it)", resumeBAfterOverride.kind === "canonical" ? resumeBAfterOverride.templateId : null, "executive-minimal");

  // ==================== TEST H - Profile-default fallback for an uploaded resume with no explicit preference ====================
  const userH = await makeTestUser(admin, "fallback");
  const reposH = createCanonicalRepositories(userH.client as any);
  const importServiceH = new CanonicalResumeImportService(reposH, userH.client as any);
  const resumeD = await seedUploadedResume(admin, userH, FIXTURE_A, "resume-d.pdf", true, "DELTA CANDIDATE resume.");
  const importD = await importServiceH.importResume(userH.userId, resumeD);
  checkTrue("H. setup: resume D imports successfully", importD.status === "imported");
  const prefServiceH = new CanonicalTemplatePreferenceService(reposH);
  await prefServiceH.setTemplatePreference(userH.userId, "executive-minimal");
  const templateForD = await resolveGenerationTemplateId(reposH, userH.client as any, userH.userId, { source: "uploaded", resumeId: resumeD });
  check("H. resume D (no explicit preference) falls back to profile default executive-minimal", templateForD, "executive-minimal");

  // ==================== TEST I - Manual Career Memory continues using profile default only ====================
  const templateForManual = await resolveGenerationTemplateId(reposH, userH.client as any, userH.userId, { source: "career_memory", resumeId: null });
  check("I. Manual Career Memory resolves profile default executive-minimal", templateForManual, "executive-minimal");
  await setResumeTemplatePreference(userH.client as any, userH.userId, resumeD, "creative-timeline");
  const templateForManualAfter = await resolveGenerationTemplateId(reposH, userH.client as any, userH.userId, { source: "career_memory", resumeId: null });
  check("I. Manual Career Memory does NOT inherit uploaded resume D's own override", templateForManualAfter, "executive-minimal");

  // ==================== TEST J - Cross-user isolation ====================
  const user2 = await makeTestUser(admin, "u2");
  const resumeUser2 = await seedUploadedResume(admin, user2, FIXTURE_A, "user2-resume.pdf", true, "ECHO CANDIDATE resume.");
  const repos2 = createCanonicalRepositories(user2.client as any);
  const importService2 = new CanonicalResumeImportService(repos2, user2.client as any);
  const importUser2 = await importService2.importResume(user2.userId, resumeUser2);
  checkTrue("J. setup: user2's own resume imports successfully", importUser2.status === "imported");
  await setResumeTemplatePreference(user2.client as any, user2.userId, resumeUser2, "modern-sidebar");

  let crossUserResolveThrew = false;
  try {
    await resolveResumeTemplate(repos1, user1.client as any, user1.userId, resumeUser2);
  } catch (error) {
    crossUserResolveThrew = error instanceof NotFoundError;
  }
  checkTrue("J. user1 cannot resolve user2's resume template directly (NotFoundError)", crossUserResolveThrew);

  // resolveGenerationTemplateId never throws uncaught (Generate Package
  // must not hard-fail on a bad/foreign id) - it must fall back safely
  // rather than silently returning user2's own template.
  const templateFallbackForUnownedResume = await resolveGenerationTemplateId(repos1, user1.client as any, user1.userId, { source: "uploaded", resumeId: resumeUser2 });
  checkTrue("J. resolveGenerationTemplateId never silently returns user2's template for user1", templateFallbackForUnownedResume !== "modern-sidebar");
  check("J. resolveGenerationTemplateId falls back to the ultimate default for an unowned resumeId", templateFallbackForUnownedResume, "professional-ats");

  const templateForUser2Own = await resolveGenerationTemplateId(repos2, user2.client as any, user2.userId, { source: "uploaded", resumeId: resumeUser2 });
  check("J. user2 resolving their OWN resume still gets modern-sidebar (isolation is per-caller, not global)", templateForUser2Own, "modern-sidebar");

  // ==================== TEST L - No AI/quota side effect from template switching ====================
  const { data: versionsBefore } = await admin.from("career_resume_versions").select("id").eq("profile_id", importB.status === "imported" ? importB.profileId : "");
  const { data: tailoredBefore } = await admin.from("career_tailored_resumes").select("id").eq("profile_id", importB.status === "imported" ? importB.profileId : "");
  await setResumeTemplatePreference(user1.client as any, user1.userId, resumeB, "modern-sidebar");
  const { data: versionsAfter } = await admin.from("career_resume_versions").select("id").eq("profile_id", importB.status === "imported" ? importB.profileId : "");
  const { data: tailoredAfter } = await admin.from("career_tailored_resumes").select("id").eq("profile_id", importB.status === "imported" ? importB.profileId : "");
  check("L. template switching creates ZERO new career_resume_versions", versionsAfter?.length ?? -1, versionsBefore?.length ?? -2);
  check("L. template switching creates ZERO new career_tailored_resumes/overlays", tailoredAfter?.length ?? -1, tailoredBefore?.length ?? -2);

  // ==================== TEST M - Existing application stability (restated with the L-triggered change) ====================
  const { data: appB1Final } = await admin.from("applications").select("selected_template_id").eq("id", appB1.id).single();
  check("M. application B1 (already overridden to creative-timeline) remains stable after B's default changed again", appB1Final?.selected_template_id, "creative-timeline");

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exit(1);
});
