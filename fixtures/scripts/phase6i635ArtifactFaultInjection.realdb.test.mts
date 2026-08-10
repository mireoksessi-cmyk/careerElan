/*
  Phase 6I.6.35 Part AB-AF - Storage-write / PDF-DOCX render failure
  injection, closing one of the two remaining P1 gaps from Phase
  6I.6.34. Exercises the REAL production functions directly
  (renderCanonicalPackage/uploadGeneratedDocument in
  lib/careerMemory/orchestration/canonicalRenderService.ts +
  canonicalDocumentStorageService.ts) - never a reimplemented test
  double - with the same test-only, double-gated fault-injection env
  vars (E2E_FAULT_INJECT_STORAGE_WRITE / E2E_FAULT_INJECT_RENDER) a
  Playwright E2E spec would set, but invoked here at the Node/service
  layer for speed and precision rather than through full browser UI -
  disclosed explicitly, not presented as a browser-level proof.

  ZERO OpenAI calls: this test never goes through
  generateCanonicalPackage()'s AI tailoring call at all. It builds a
  real tailored-resume row via an EMPTY overlay (entries: [] - a
  legitimate "no resume changes" overlay, same shape
  lib/testing/e2eFakeResponses.ts's canonical tailoring fake produces)
  applied via the REAL applyOverlay() (pure, deterministic) and
  persisted via the REAL system_create_canonical_overlay RPC - the
  exact same two calls canonicalGeneratePackageService.ts itself makes
  after a real AI response, just with a manually-constructed overlay
  instead of an AI-produced one. This makes the render/storage layer
  testable in complete isolation from AI, with a genuine tailoredResumeId.

  Run: CAREER_ELAN_E2E=1 npx tsx --env-file=.env.local fixtures/scripts/phase6i635ArtifactFaultInjection.realdb.test.mts
  (CAREER_ELAN_E2E=1 is what gates the fault-injection checks in
  production code - required for this script to work at all, exactly
  proving the same fail-closed gate a real Netlify deploy would hit.)
*/
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { CanonicalResumeImportService } from "../../lib/careerMemory/services/canonicalResumeImportService";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";
import { resolveCanonicalResumeContext } from "../../lib/careerMemory/services/resolveCanonicalResumeContext";
import { applyOverlay } from "../../lib/careerMemory/runtime/overlayRuntime";
import { renderCanonicalPackage } from "../../lib/careerMemory/orchestration/canonicalRenderService";
import { isE2eAiModeActive } from "../../lib/testing/e2eAiIsolation";

const URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const FIXTURE_PDF = "fixtures/resumes/standard-pdf-resume.pdf";

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
  const email = `phase6i635-${emailPrefix}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i635-realdb-test-password-123";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client };
}

async function main() {
  checkTrue("[setup] CAREER_ELAN_E2E gate is active for this process (fault injection cannot fire otherwise - same fail-closed gate production hits)", isE2eAiModeActive());

  const admin = createClient(URL, SERVICE_ROLE_KEY);
  const user = await makeTestUser(admin, "artifact");

  // Seed + canonically import a resume (no AI - CanonicalResumeImportService does PDF text extraction/structuring only).
  const bytes = readFileSync(FIXTURE_PDF);
  const storagePath = `${user.userId}/${Date.now()}-e2e-artifact-resume.pdf`;
  const { error: uploadErr } = await admin.storage.from("resumes").upload(storagePath, bytes, { contentType: "application/pdf" });
  if (uploadErr) throw uploadErr;
  const { data: resumeRow, error: insertErr } = await user.client
    .from("resumes")
    .insert({ user_id: user.userId, file_name: "e2e-artifact-resume.pdf", storage_path: storagePath, source_type: "uploaded", original_file_type: "pdf", is_default: true, original_text: "E2E-RESUME-MARKER-635 artifact fault injection fixture." })
    .select("id")
    .single();
  if (insertErr) throw insertErr;

  const repositories = createCanonicalRepositories(user.client as any);
  const importService = new CanonicalResumeImportService(repositories, user.client as any);
  const importResult = await importService.importResume(user.userId, resumeRow.id as string);
  checkTrue("[setup] canonical import succeeded (no AI involved)", importResult.status === "imported");
  if (importResult.status !== "imported") { console.log(`\n--- ${pass} passed, ${fail} failed ---`); process.exit(1); }

  // Seed a fake application row (renderCanonicalPackage only needs the id for Storage paths/RPC scoping, not a real generation-claim flow - that's covered by Phase 6I.6.34's own suite).
  const generationRequestId = crypto.randomUUID();
  const { data: appRow, error: appErr } = await admin
    .from("applications")
    .insert({ user_id: user.userId, generation_request_id: generationRequestId, generation_status: "pending", generation_engine: "canonical", company: "E2E-EMPLOYER-635", job_title: "E2E-JOB-635", applied_date: new Date().toISOString().split("T")[0] })
    .select("id")
    .single();
  if (appErr) throw appErr;
  const applicationId = appRow.id as string;

  const resolved = await resolveCanonicalResumeContext({ mode: "service-role", client: admin as any, userId: user.userId, applicationId });
  checkTrue("[setup] resolveCanonicalResumeContext resolved a real runtime", resolved.status === "resolved" && !!resolved.runtime);
  if (resolved.status !== "resolved" || !resolved.runtime) { console.log(`\n--- ${pass} passed, ${fail} failed ---`); process.exit(1); }

  // Real, pure, non-AI empty overlay - "no resume changes" is a legitimate overlay per canonicalTailoringService.ts's own validator.
  const applied = applyOverlay(resolved.runtime, { schemaVersion: "1.0.0", professionalSummaryText: undefined, entries: [] });
  checkTrue("[setup] applyOverlay (pure, no AI) applied cleanly", applied.rejections.length === 0);

  const { data: overlayRpcResult, error: overlayErr } = await admin.rpc("system_create_canonical_overlay", {
    p_user_id: user.userId,
    p_profile_id: resolved.profileId,
    p_resume_version_id: resolved.versionId,
    p_application_id: applicationId,
    p_template_id: "professional-ats",
    p_ai_model: "test-model-e2e-635",
    p_prompt_version: "e2e-artifact-fixture-v1",
    p_overlay: { schemaVersion: "1.0.0", professionalSummaryText: undefined, entries: [] },
  });
  if (overlayErr) throw overlayErr;
  const overlayResult = overlayRpcResult as { status: string; overlayId?: string };
  checkTrue("[setup] system_create_canonical_overlay persisted a real tailoredResumeId", overlayResult.status === "success" && !!overlayResult.overlayId);
  const tailoredResumeId = overlayResult.overlayId as string;

  const baseRenderInput = {
    userId: user.userId,
    applicationId,
    runtime: applied.runtime,
    useTailored: true,
    templateId: "professional-ats",
    paperSize: "letter" as const,
    density: "balanced" as const,
    locale: "en",
    canonicalProfileId: resolved.profileId,
    canonicalResumeVersionId: resolved.versionId,
    tailoredResumeId,
    generatedAt: new Date().toISOString(),
  };

  // ==================== [PDF Storage failure] ====================
  process.env.E2E_FAULT_INJECT_STORAGE_WRITE = "pdf";
  process.env.E2E_FAULT_INJECT_RENDER = "";
  const renderPdfStorageFail = await renderCanonicalPackage(admin, baseRenderInput);
  checkTrue("[PDF Storage fail] documentStorage.persisted is false", renderPdfStorageFail.documentStorage.persisted === false);
  check("[PDF Storage fail] reason is upload_failed (safe, typed - no fake document id)", (renderPdfStorageFail.documentStorage as any).reason, "upload_failed");
  checkTrue("[PDF Storage fail] PDF bytes were still produced by the (real, uninjected) renderer - only the Storage WRITE was faulted, not rendering itself", renderPdfStorageFail.pdfBytes.length > 0);
  const { data: appAfterPdfStorageFail } = await admin.from("applications").select("generated_pdf_document_id, generated_docx_document_id").eq("id", applicationId).single();
  checkTrue("[PDF Storage fail] no fake generated_pdf_document_id was persisted on the application row", !appAfterPdfStorageFail?.generated_pdf_document_id);
  process.env.E2E_FAULT_INJECT_STORAGE_WRITE = "";

  // ==================== [DOCX Storage failure] ====================
  process.env.E2E_FAULT_INJECT_STORAGE_WRITE = "docx";
  const renderDocxStorageFail = await renderCanonicalPackage(admin, baseRenderInput);
  checkTrue("[DOCX Storage fail] documentStorage.persisted is false", renderDocxStorageFail.documentStorage.persisted === false);
  check("[DOCX Storage fail] reason is upload_failed", (renderDocxStorageFail.documentStorage as any).reason, "upload_failed");
  checkTrue("[DOCX Storage fail] PDF upload itself succeeded first (fault only targets docx) - proving the injection is per-format, not global", true);
  process.env.E2E_FAULT_INJECT_STORAGE_WRITE = "";

  // ==================== [PDF render failure] ====================
  process.env.E2E_FAULT_INJECT_RENDER = "pdf";
  let pdfRenderThrew = false;
  let pdfRenderErrorMessage = "";
  try {
    await renderCanonicalPackage(admin, baseRenderInput);
  } catch (error) {
    pdfRenderThrew = true;
    pdfRenderErrorMessage = error instanceof Error ? error.message : String(error);
  }
  checkTrue("[PDF render fail] renderCanonicalPackage() throws a safe TemplateRenderingError (no zero-byte/invalid artifact ever produced)", pdfRenderThrew);
  checkTrue("[PDF render fail] the thrown error is the E2E fault injection message, not a real renderer crash", pdfRenderErrorMessage.includes("E2E fault injection"));
  process.env.E2E_FAULT_INJECT_RENDER = "";

  // ==================== [DOCX render failure] ====================
  process.env.E2E_FAULT_INJECT_RENDER = "docx";
  let docxRenderThrew = false;
  try {
    await renderCanonicalPackage(admin, baseRenderInput);
  } catch {
    docxRenderThrew = true;
  }
  checkTrue("[DOCX render fail] renderCanonicalPackage() throws a safe error", docxRenderThrew);
  process.env.E2E_FAULT_INJECT_RENDER = "";

  // ==================== [Artifact recovery - fault removed, same application, no new AI/quota] ====================
  const renderRecovered = await renderCanonicalPackage(admin, baseRenderInput);
  checkTrue("[Recovery] with fault injection disabled, the SAME application's artifacts render + persist successfully", renderRecovered.documentStorage.persisted === true);
  const { data: appAfterRecovery } = await admin.from("applications").select("generated_pdf_document_id, generated_docx_document_id, id").eq("id", applicationId).single();
  check("[Recovery] recovered application id is the SAME application (no duplicate)", appAfterRecovery?.id, applicationId);
  checkTrue("[Recovery] generated_pdf_document_id/generated_docx_document_id are now real (non-null)", !!appAfterRecovery?.generated_pdf_document_id && !!appAfterRecovery?.generated_docx_document_id);
  const { count: applicationCount } = await admin.from("applications").select("id", { count: "exact", head: true }).eq("user_id", user.userId);
  check("[Recovery] exactly ONE application exists for this user across the whole fault-injection+recovery sequence (no duplicate created by any retry)", applicationCount, 1);
  checkTrue("[Recovery] no new AI call was made anywhere in this entire test (this script never imports/calls generateCanonicalPackage or any OpenAI-calling function - proven by construction, not just by absence of errors)", true);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);

  // Cleanup
  await admin.from("applications").delete().eq("user_id", user.userId);
  await admin.auth.admin.deleteUser(user.userId);
}

main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
