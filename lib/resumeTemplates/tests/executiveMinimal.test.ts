/*
  Phase 6F - Executive Minimal real-render test category (spec section
  19, item "each template's own real HTML/PDF/DOCX render output").
  Renders the real Playwright PDF and real docx-package DOCX exactly
  once each (reused across all assertions below, per the round's own
  "reuse render calls" convention) against the Jordan Ellis synthetic
  fixture. Run with:
    npx tsx lib/resumeTemplates/tests/executiveMinimal.test.ts
*/
import { ensureTemplatesRegistered } from "../registry/bootstrap";
import { renderTemplateFromRuntime } from "../engine/renderTemplate";
import { closeSharedBrowser } from "../../documentPreservation/sharedBrowser";
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeOverlayState, createRuntimeVersion } from "../../careerMemory/runtime/factory";
import { buildJordanEllisResume } from "../../../fixtures/resumes/template-preview/jordanEllisFixture";
import { EXECUTIVE_MINIMAL_SECTION_LABELS } from "../templates/executiveMinimal/sectionPolicy";
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
    version: createRuntimeVersion({ id: "exec-min-test-v1", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: resume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });

  const html = await renderTemplateFromRuntime(runtime, { templateId: "executive-minimal", generatedAt: GENERATED_AT }, "html");
  const pdf = await renderTemplateFromRuntime(runtime, { templateId: "executive-minimal", generatedAt: GENERATED_AT }, "pdf");
  const docx = await renderTemplateFromRuntime(runtime, { templateId: "executive-minimal", generatedAt: GENERATED_AT }, "docx");

  /* --- HTML result --- */
  check("html: templateId is executive-minimal", html.templateId, "executive-minimal");
  check("html: format is html", html.format, "html");
  checkTrue("html: html string is non-empty", html.html.length > 0);
  checkTrue("html: pageCount is at least 1", html.pageCount >= 1);
  checkTrue("html: contains identity full name", html.html.includes("Jordan Ellis"));
  /* Headings are rendered via label.toUpperCase() (html.tsx's own h2 styling) - assert against the uppercase form actually emitted, not the mixed-case label constant. */
  checkTrue("html: contains the Executive Summary label (rendered uppercase)", html.html.includes((EXECUTIVE_MINIMAL_SECTION_LABELS.summary as string).toUpperCase()));
  checkTrue("html: contains the Professional Experience label (rendered uppercase)", html.html.includes((EXECUTIVE_MINIMAL_SECTION_LABELS.experience as string).toUpperCase()));
  checkTrue("html: contains the Core Competencies label (rendered uppercase)", html.html.includes((EXECUTIVE_MINIMAL_SECTION_LABELS.skills as string).toUpperCase()));
  checkTrue("html: validation.passed is true", html.validation.passed);
  check("html: validation.missingTextCount is 0", html.validation.missingTextCount, 0);
  check("html: validation.inventedTextCount is 0", html.validation.inventedTextCount, 0);
  checkTrue("html: validation.sectionOrderPreserved is true", html.validation.sectionOrderPreserved);
  checkTrue("html: validation.protectedFactsUnchanged is true", html.validation.protectedFactsUnchanged);
  checkTrue("html: does not literally leak a StructuredTextValue object shape (no '[object Object]')", !html.html.includes("[object Object]"));
  checkTrue("html: single-column layout - no CSS grid-template-areas (no sidebar in this template)", !html.html.includes("grid-template-areas"));

  /* --- PDF result --- */
  check("pdf: templateId is executive-minimal", pdf.templateId, "executive-minimal");
  check("pdf: format is pdf", pdf.format, "pdf");
  checkTrue("pdf: bytes buffer is non-empty", pdf.bytes.length > 0);
  checkTrue("pdf: bytes start with the %PDF magic header (real PDF, not some other format)", pdf.bytes.subarray(0, 5).toString("latin1") === "%PDF-");
  checkTrue("pdf: pageCount is at least 1", pdf.pageCount >= 1);
  checkTrue("pdf: hasSelectableText is true (real text layer, never a rasterized image)", pdf.hasSelectableText);
  checkTrue("pdf: validation.passed is true", pdf.validation.passed);
  check("pdf: paperSize matches the template's default", pdf.paperSize, html.paperSize);
  check("pdf: density matches the template's default", pdf.density, html.density);

  /* --- DOCX result --- */
  check("docx: templateId is executive-minimal", docx.templateId, "executive-minimal");
  check("docx: format is docx", docx.format, "docx");
  checkTrue("docx: bytes buffer is non-empty", docx.bytes.length > 0);
  checkTrue("docx: bytes start with the PK zip magic header (real OOXML container)", docx.bytes.subarray(0, 2).toString("latin1") === "PK");
  checkTrue("docx: isEditableNativeDocx is true", docx.isEditableNativeDocx);
  checkTrue("docx: validation.passed is true", docx.validation.passed);

  const docxZip = await JSZip.loadAsync(docx.bytes);
  checkTrue("docx: contains word/document.xml (real Word package structure)", docxZip.file("word/document.xml") !== null);
  checkTrue("docx: contains [Content_Types].xml", docxZip.file("[Content_Types].xml") !== null);
  const documentXml = await docxZip.file("word/document.xml")!.async("string");
  checkTrue("docx: document.xml contains identity full name as real text content", documentXml.includes("Jordan Ellis"));
  checkTrue("docx: document.xml is NOT an image-only wrapper (contains real <w:t> text runs)", documentXml.includes("<w:t"));
  checkTrue("docx: document.xml does not embed a full-page raster image as its only content (no w:drawing wrapping the entire body would be unusual, spot-check for excessive base64 blob markers absent)", !documentXml.includes("data:image"));

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
