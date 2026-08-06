/*
  Phase 6F - Professional ATS real-render test category (spec section
  19). This template is a thin wrapper around the EXISTING, unmodified
  Phase 3/4/5A/5B pipeline (see templates/professionalAts/index.ts's own
  header comment) - it inherits that pipeline's own already-tested
  validation. One disclosed, pre-existing cosmetic gap in that
  UNMODIFIED code (not something this round is permitted to fix, see
  the Phase 6F pre-report's Error #7/#8 root-causing): its PDF/DOCX
  fragment-removal detector leaves a stray "/" character as a false
  "invented-text" flag after removing the shortened custom-section URL
  fragment. This is asserted EXPLICITLY below (not silently tolerated)
  so a regression that introduces a SECOND, different false positive -
  or that somehow makes HTML fail too - would be caught. Run with:
    npx tsx lib/resumeTemplates/tests/professionalAtsWrapper.test.ts
*/
import { ensureTemplatesRegistered } from "../registry/bootstrap";
import { renderTemplateFromRuntime } from "../engine/renderTemplate";
import { closeSharedBrowser } from "../../documentPreservation/sharedBrowser";
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeOverlayState, createRuntimeVersion } from "../../careerMemory/runtime/factory";
import { buildJordanEllisResume } from "../../../fixtures/resumes/template-preview/jordanEllisFixture";
import JSZip from "jszip";

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

const GENERATED_AT = "2026-01-01T00:00:00.000Z";

async function main() {
  ensureTemplatesRegistered();
  const resume = buildJordanEllisResume();
  const runtime = createCanonicalRuntime({
    resume,
    version: createRuntimeVersion({ id: "pro-ats-test-v1", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: resume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });

  const html = await renderTemplateFromRuntime(runtime, { templateId: "professional-ats", generatedAt: GENERATED_AT }, "html");
  const pdf = await renderTemplateFromRuntime(runtime, { templateId: "professional-ats", generatedAt: GENERATED_AT }, "pdf");
  const docx = await renderTemplateFromRuntime(runtime, { templateId: "professional-ats", generatedAt: GENERATED_AT }, "docx");

  /* --- HTML result: the existing pipeline's own validation is expected to fully pass --- */
  check("html: templateId is professional-ats", html.templateId, "professional-ats");
  checkTrue("html: html string is non-empty", html.html.length > 0);
  checkTrue("html: pageCount is at least 1", html.pageCount >= 1);
  checkTrue("html: contains identity full name", html.html.includes("Jordan Ellis"));
  checkTrue("html: validation.passed is true (fully clean, no known gaps at the HTML layer)", html.validation.passed);
  check("html: validation.missingTextCount is 0", html.validation.missingTextCount, 0);
  check("html: validation.inventedTextCount is 0", html.validation.inventedTextCount, 0);
  check("html: validation.issues is empty", html.validation.issues, []);

  /* --- PDF result: real, selectable-text, structurally valid, but carries the ONE disclosed pre-existing cosmetic gap --- */
  check("pdf: templateId is professional-ats", pdf.templateId, "professional-ats");
  checkTrue("pdf: bytes buffer is non-empty", pdf.bytes.length > 0);
  checkTrue("pdf: bytes start with the %PDF magic header", pdf.bytes.subarray(0, 5).toString("latin1") === "%PDF-");
  checkTrue("pdf: hasSelectableText is true (real text layer, never rasterized)", pdf.hasSelectableText);
  checkTrue("pdf: pageCount is at least 1", pdf.pageCount >= 1);
  check("pdf: validation.missingTextCount is 0 (no real content loss)", pdf.validation.missingTextCount, 0);
  check("pdf: validation.inventedTextCount is exactly 1 (the known, disclosed stray-slash false positive, not a new/different gap)", pdf.validation.inventedTextCount, 1);
  checkTrue("pdf: the one invented-text issue's message is exactly the disclosed stray '/' (not a different, undisclosed defect)", pdf.validation.issues.some((i) => i.code === "invented-text" && i.message.trim().endsWith("/")));
  check("pdf: validation.sectionOrderPreserved is true (the known gap is text-fragment-only, not structural)", pdf.validation.sectionOrderPreserved, true);
  check("pdf: validation.protectedFactsUnchanged is true", pdf.validation.protectedFactsUnchanged, true);

  /* --- DOCX result: same disclosed gap, same structural soundness --- */
  check("docx: templateId is professional-ats", docx.templateId, "professional-ats");
  checkTrue("docx: bytes buffer is non-empty", docx.bytes.length > 0);
  checkTrue("docx: bytes start with the PK zip magic header", docx.bytes.subarray(0, 2).toString("latin1") === "PK");
  checkTrue("docx: isEditableNativeDocx is true", docx.isEditableNativeDocx);
  check("docx: validation.missingTextCount is 0", docx.validation.missingTextCount, 0);
  check("docx: validation.inventedTextCount is exactly 1 (same disclosed stray-slash gap as PDF)", docx.validation.inventedTextCount, 1);
  checkTrue("docx: the one invented-text issue's message is exactly the disclosed stray '/'", docx.validation.issues.some((i) => i.code === "invented-text" && i.message.trim().endsWith("/")));

  const docxZip = await JSZip.loadAsync(docx.bytes);
  checkTrue("docx: contains word/document.xml", docxZip.file("word/document.xml") !== null);
  const documentXml = await docxZip.file("word/document.xml")!.async("string");
  checkTrue("docx: document.xml contains identity full name as real text", documentXml.includes("Jordan Ellis"));
  checkTrue("docx: document.xml contains real <w:t> text runs (not an image-only wrapper)", documentXml.includes("<w:t"));

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
