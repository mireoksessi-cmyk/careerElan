/*
  Phase 6F - Creative Timeline real-render test category (spec section
  19), including the timeline-specific decorative elements: the CSS
  left-border/dot marker in HTML (aria-hidden, per html.tsx's own
  header comment) and the docx Paragraph left-border (TIMELINE_BORDER,
  color D1603D) used as the editable-native-OOXML equivalent instead of
  an embedded drawing. Run with:
    npx tsx lib/resumeTemplates/tests/creativeTimeline.test.ts
*/
import { ensureTemplatesRegistered } from "../registry/bootstrap";
import { renderTemplateFromRuntime } from "../engine/renderTemplate";
import { closeSharedBrowser } from "../../documentPreservation/sharedBrowser";
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeOverlayState, createRuntimeVersion } from "../../careerMemory/runtime/factory";
import { buildJordanEllisResume } from "../../../fixtures/resumes/template-preview/jordanEllisFixture";
import { CREATIVE_TIMELINE_LABELS } from "../templates/creativeTimeline/sectionPolicy";
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
    version: createRuntimeVersion({ id: "creative-timeline-test-v1", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: resume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });

  const html = await renderTemplateFromRuntime(runtime, { templateId: "creative-timeline", generatedAt: GENERATED_AT }, "html");
  const pdf = await renderTemplateFromRuntime(runtime, { templateId: "creative-timeline", generatedAt: GENERATED_AT }, "pdf");
  const docx = await renderTemplateFromRuntime(runtime, { templateId: "creative-timeline", generatedAt: GENERATED_AT }, "docx");

  /* --- HTML result --- */
  check("html: templateId is creative-timeline", html.templateId, "creative-timeline");
  checkTrue("html: html string is non-empty", html.html.length > 0);
  checkTrue("html: contains identity full name", html.html.includes("Jordan Ellis"));
  checkTrue("html: uses CSS Grid named areas (2-column layout)", html.html.includes("grid-template-areas"));
  checkTrue("html: contains the Work Experience label", html.html.includes(CREATIVE_TIMELINE_LABELS.experience));
  checkTrue("html: contains the Contact label on the identity masthead", html.html.includes(CREATIVE_TIMELINE_LABELS.contact));
  checkTrue("html: timeline marker/line elements are present (border-left decoration on entries)", html.html.includes("border-left"));
  checkTrue("html: timeline decorative marker carries aria-hidden (never announced as real text to a screen reader)", html.html.includes('aria-hidden="true"'));
  checkTrue("html: contains the real language section heading, not a generic substitution", html.html.includes("Language Proficiency"));
  checkTrue("html: validation.passed is true", html.validation.passed);
  check("html: validation.missingTextCount is 0", html.validation.missingTextCount, 0);
  check("html: validation.inventedTextCount is 0 (decorative timeline markers never leak into the text-extraction stream)", html.validation.inventedTextCount, 0);
  checkTrue("html: validation.sectionOrderPreserved is true", html.validation.sectionOrderPreserved);

  /* --- PDF result --- */
  check("pdf: templateId is creative-timeline", pdf.templateId, "creative-timeline");
  checkTrue("pdf: bytes buffer is non-empty", pdf.bytes.length > 0);
  checkTrue("pdf: bytes start with the %PDF magic header", pdf.bytes.subarray(0, 5).toString("latin1") === "%PDF-");
  checkTrue("pdf: hasSelectableText is true", pdf.hasSelectableText);
  checkTrue("pdf: validation.passed is true", pdf.validation.passed);

  /* --- DOCX result --- */
  check("docx: templateId is creative-timeline", docx.templateId, "creative-timeline");
  checkTrue("docx: bytes buffer is non-empty", docx.bytes.length > 0);
  checkTrue("docx: isEditableNativeDocx is true", docx.isEditableNativeDocx);
  checkTrue("docx: validation.passed is true", docx.validation.passed);

  const docxZip = await JSZip.loadAsync(docx.bytes);
  const documentXml = await docxZip.file("word/document.xml")!.async("string");
  checkTrue("docx: document.xml contains identity full name", documentXml.includes("Jordan Ellis"));
  checkTrue("docx: document.xml uses a real paragraph left-border for the timeline decoration (spec section 11: prefer border/table over embedded drawings)", documentXml.includes("D1603D"));
  checkTrue("docx: document.xml contains NO embedded drawing/shape object for the timeline (no <w:drawing> full-page graphic standing in for the line)", !documentXml.includes("<w:pict"));
  checkTrue("docx: document.xml contains the real language section heading, uppercased", documentXml.includes("LANGUAGE PROFICIENCY"));
  checkTrue("docx: document.xml contains real <w:t> text runs", documentXml.includes("<w:t"));

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
