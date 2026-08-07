/*
  Phase 6G.1 Part B - local/internal canary: proves the actual
  production canonical-generate entry point (system_create_canonical_overlay
  -> complete_canonical_generation -> renderCanonicalPackage(), the same
  three calls generateCanonicalPackage() makes after its one real AI
  call) now succeeds end-to-end for the professional-ats template using
  a REAL (non-synthetic) resume run through the real parsing pipeline,
  not buildFixtureRuntime(). No real OpenAI call - the AI tailoring step
  is the one piece of generateCanonicalPackage() this script doesn't
  exercise, matching this round's own established zero-AI-cost
  convention; everything downstream of that step (overlay persistence,
  render, real storage upload, atomic document+application metadata
  record) runs for real against the local Supabase stack.

  All 5 production feature flags remain untouched (this script never
  reads or sets them - it calls the underlying functions directly,
  the same "local/internal canary" pattern the rest of Phase 6G already
  established via scoped process.env mutation in-process only).

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6g1CanaryProfessionalAts.realdb.test.mts
  Requires local Supabase running.
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";
import { CanonicalCareerMemoryService } from "../../lib/careerMemory/services/canonicalCareerMemoryService";
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeOverlayState, createRuntimeVersion } from "../../lib/careerMemory/runtime/factory";
import { applyOverlay } from "../../lib/careerMemory/runtime/overlayRuntime";
import { renderCanonicalPackage } from "../../lib/careerMemory/orchestration/canonicalRenderService";
import { closeSharedBrowser } from "../../lib/documentPreservation/sharedBrowser";
import type { CanonicalResumeRuntime } from "../../lib/careerMemory/runtime/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
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

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);
  const email = `phase6g1-canary-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6g1-canary-password-123";
  const { data: userData, error: userError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (userError) throw userError;
  const userId = userData.user.id;
  const client = createClient(URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const { analyzeDocument } = await import("../../lib/documentPreservation/layoutAnalysis");
  const { buildLosslessResumeDocument } = await import("../../lib/documentPreservation/losslessSemantic/buildLosslessDocument");
  const { buildStructuredResume } = await import("../../lib/documentPreservation/resumeStructured/buildStructuredResume");

  const fileName = "resume-A-junior-ats.pdf";
  const buffer = fs.readFileSync(path.join(REPO_ROOT, "fixtures", "resumes", "bench", fileName));
  const layoutResult = await analyzeDocument("resume", "pdf", buffer);
  const document = buildLosslessResumeDocument(layoutResult, { fileName, fileType: "pdf" });
  const model = buildStructuredResume(document);
  checkTrue("canary setup: real resume parsed with a valid structured model", model.validation.passed);

  const generatedAt = new Date(0).toISOString();
  const runtime: CanonicalResumeRuntime = createCanonicalRuntime({
    resume: model,
    version: createRuntimeVersion({ id: "canary-v1", reason: "initial", createdAt: generatedAt }),
    metadata: createRuntimeMetadata({ schemaVersion: model.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });

  const repos = createCanonicalRepositories(client);
  const service = new CanonicalCareerMemoryService(repos);
  const saved = await service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime });
  const profile = await repos.profiles.getByUserId(userId);
  if (!profile) throw new Error("profile not found after save");

  const { data: application, error: applicationError } = await client.from("applications").insert({ user_id: userId }).select("*").single();
  if (applicationError) throw applicationError;

  // Mirrors generateCanonicalPackage()'s own overlay-persistence step -
  // a real, no-op overlay (the AI tailoring step itself is the only
  // piece of the production pipeline not exercised here).
  const overlay = await admin.rpc("system_create_canonical_overlay", {
    p_user_id: userId,
    p_profile_id: profile.id,
    p_resume_version_id: saved.version.id,
    p_application_id: application.id,
    p_template_id: "professional-ats",
    p_ai_model: "phase6g1-canary",
    p_prompt_version: "canary-v1",
    p_overlay: { schemaVersion: "1.0.0" },
  });
  checkTrue("canary: real overlay persistence succeeds for professional-ats", overlay.data?.status === "success");

  const appliedRuntime = applyOverlay(saved.runtime, { schemaVersion: "1.0.0" });
  checkTrue("canary: applying the (no-op) overlay to the real runtime produces zero rejections", appliedRuntime.rejections.length === 0);

  process.env.CANONICAL_DOCUMENT_STORAGE_ENABLED = "true";
  const render = await renderCanonicalPackage(admin as never, {
    userId,
    applicationId: application.id,
    runtime: appliedRuntime.runtime,
    useTailored: true,
    templateId: "professional-ats",
    paperSize: "letter",
    density: "balanced",
    locale: "en-CA",
    canonicalProfileId: profile.id,
    canonicalResumeVersionId: saved.version.id,
    tailoredResumeId: overlay.data.overlayId,
    generatedAt,
  });
  delete process.env.CANONICAL_DOCUMENT_STORAGE_ENABLED;

  checkTrue("CANARY: professional-ats canonical PDF/DOCX/HTML render succeeds end-to-end for a real resume through the actual production entry point", render.html.length > 0 && render.pdfBytes.length > 0 && render.docxBytes.length > 0);
  checkTrue("CANARY: real Storage upload + atomic document/application metadata record succeeded (documentStorage.persisted)", render.documentStorage.persisted === true);
  checkTrue("CANARY: PDF content-preservation validation passed for real content (the original blocker)", render.pdfValidation.passed);
  checkTrue("CANARY: DOCX content-preservation validation passed for real content", render.docxValidation.passed);

  const persisted = render.documentStorage as { persisted: true; pdfDocumentId: string; docxDocumentId: string };
  const appRow = await client.from("applications").select("generated_pdf_document_id, generated_docx_document_id, selected_template_id, generation_engine").eq("id", application.id).single();
  check("canary: applications row correctly records selected_template_id=professional-ats", appRow.data?.selected_template_id, "professional-ats");
  check("canary: applications row correctly records generation_engine=canonical", appRow.data?.generation_engine, "canonical");
  check("canary: applications row's generated_pdf_document_id matches the real returned id", appRow.data?.generated_pdf_document_id, persisted.pdfDocumentId);
  check("canary: applications row's generated_docx_document_id matches the real returned id", appRow.data?.generated_docx_document_id, persisted.docxDocumentId);

  // Ownership/RLS: a different real user cannot see this application's canonical data.
  const email2 = `phase6g1-canary-attacker-${Math.random().toString(36).slice(2)}@example.test`;
  const { data: attackerData } = await admin.auth.admin.createUser({ email: email2, password, email_confirm: true });
  const attackerClient = createClient(URL, ANON_KEY);
  await attackerClient.auth.signInWithPassword({ email: email2, password });
  const attackerRead = await attackerClient.from("applications").select("*").eq("id", application.id).maybeSingle();
  check("canary ownership/RLS: a different real user's direct select of this application returns nothing", attackerRead.data, null);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);

  await admin.auth.admin.deleteUser(userId);
  if (attackerData?.user) await admin.auth.admin.deleteUser(attackerData.user.id);
  await closeSharedBrowser();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
