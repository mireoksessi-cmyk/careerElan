/*
  Phase 6F / 6F.1 - Professional ATS real-render test category (spec
  section 19). This template is a thin wrapper around the EXISTING,
  unmodified-in-Phase-6F Phase 3/4/5A/5B pipeline (see
  templates/professionalAts/index.ts's own header comment) - it
  inherits that pipeline's own already-tested validation.

  Phase 6F.1 update: the pipeline's PDF/DOCX text-preservation
  validators (pdfTextPreservationValidator.ts, docxTextPreservationValidator.ts)
  were themselves hardened this round - proven root cause: their safe-
  punctuation leftover-removal regex was missing "/" (present at the
  HTML/parity layer, absent at PDF/DOCX), so any renderer-emitted " / "
  join (e.g. multiple institutions/fieldsOfStudy) left a stray bare "/"
  that got flagged as invented-text. Now fixed at the proven failure
  layer (see that fix's own header comment for the full evidence
  chain). This template's own render output is therefore now fully
  clean end-to-end - the previously-disclosed 1-invented-fragment gap
  no longer exists and is asserted as GONE below (not just tolerated).
  Run with:
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

  /* --- HTML result --- */
  check("html: templateId is professional-ats", html.templateId, "professional-ats");
  checkTrue("html: html string is non-empty", html.html.length > 0);
  checkTrue("html: pageCount is at least 1", html.pageCount >= 1);
  checkTrue("html: contains identity full name", html.html.includes("Jordan Ellis"));
  checkTrue("html: validation.passed is true", html.validation.passed);
  check("html: validation.missingTextCount is 0", html.validation.missingTextCount, 0);
  check("html: validation.inventedTextCount is 0", html.validation.inventedTextCount, 0);
  check("html: validation.issues is empty", html.validation.issues, []);

  /* --- PDF result: real, selectable-text, structurally valid, fully clean after the Phase 6F.1 slash-normalization fix --- */
  check("pdf: templateId is professional-ats", pdf.templateId, "professional-ats");
  checkTrue("pdf: bytes buffer is non-empty", pdf.bytes.length > 0);
  checkTrue("pdf: bytes start with the %PDF magic header", pdf.bytes.subarray(0, 5).toString("latin1") === "%PDF-");
  checkTrue("pdf: hasSelectableText is true (real text layer, never rasterized)", pdf.hasSelectableText);
  checkTrue("pdf: pageCount is at least 1", pdf.pageCount >= 1);
  checkTrue("pdf: validation.passed is true (Phase 6F.1: the previously-disclosed stray-slash gap is now fixed at its proven root cause)", pdf.validation.passed);
  check("pdf: validation.missingTextCount is 0 (no real content loss)", pdf.validation.missingTextCount, 0);
  check("pdf: validation.inventedTextCount is 0 (stray-slash false positive eliminated, not merely tolerated)", pdf.validation.inventedTextCount, 0);
  check("pdf: validation.issues is empty", pdf.validation.issues, []);
  check("pdf: validation.sectionOrderPreserved is true", pdf.validation.sectionOrderPreserved, true);
  check("pdf: validation.protectedFactsUnchanged is true", pdf.validation.protectedFactsUnchanged, true);

  /* --- DOCX result: same fix, same structural soundness --- */
  check("docx: templateId is professional-ats", docx.templateId, "professional-ats");
  checkTrue("docx: bytes buffer is non-empty", docx.bytes.length > 0);
  checkTrue("docx: bytes start with the PK zip magic header", docx.bytes.subarray(0, 2).toString("latin1") === "PK");
  checkTrue("docx: isEditableNativeDocx is true", docx.isEditableNativeDocx);
  checkTrue("docx: validation.passed is true", docx.validation.passed);
  check("docx: validation.missingTextCount is 0", docx.validation.missingTextCount, 0);
  check("docx: validation.inventedTextCount is 0 (Phase 6F.1 fix)", docx.validation.inventedTextCount, 0);
  check("docx: validation.issues is empty", docx.validation.issues, []);

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
