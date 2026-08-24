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

/*
  Structured-languages variant of the same fixture. The base fixture ships
  languages: [] plus a raw "Language Proficiency" section, which is the
  empty-languages fallback every assertion above already covers. A resume
  that DOES yield structured languages carries BOTH - paired name/
  proficiency entries and the same section still preserved raw, its lines
  unpaired. This reproduces that exact shape (same section, same
  provenance) and adds an unrelated "Programming Languages" section from a
  DIFFERENT source section, which must survive untouched: the suppression
  is keyed on provenance, never on the word "language" in a heading.
*/
const UNPAIRED_LANGUAGE_LINES = ["English", "Native", "Français", "Courant"];
const PROGRAMMING_LANGUAGES_TEXT = "TypeScript, Python, SQL";

function buildStructuredLanguagesResume() {
  const resume = buildJordanEllisResume();
  const raw = resume.customSections.find((s) => s.id === "custom-languages")!;
  const progTrace = { ...raw.source, sourceSectionId: "sec-custom-prog-lang" };
  raw.paragraphs = UNPAIRED_LANGUAGE_LINES.map((text) => ({ value: text, confidence: 0.7, extractionMethod: "explicit-label" as const, source: raw.source }));
  raw.content = UNPAIRED_LANGUAGE_LINES.map((text, i) => ({ id: `custom-lang-c${i + 1}`, kind: "paragraph" as const, text, source: raw.source }));
  resume.languages = [
    { name: "English", proficiency: "Native", source: raw.source },
    { name: "Français", proficiency: "Courant", source: raw.source },
  ];
  resume.customSections.push({
    id: "custom-programming-languages",
    originalHeading: "Programming Languages",
    displayHeading: "Programming Languages",
    paragraphs: [],
    bullets: [],
    content: [{ id: "custom-prog-c1", kind: "paragraph" as const, text: PROGRAMMING_LANGUAGES_TEXT, source: progTrace }],
    sourceOrder: 99,
    source: progTrace,
  });
  return resume;
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

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


  /*
    Structured-languages regression (see buildStructuredLanguagesResume
    above). Before this fix the raw section rendered its four unpaired
    lines while the structured pairs were dropped on the floor, so a reader
    saw four detached lines instead of two entries.
  */
  const langResume = buildStructuredLanguagesResume();
  const langRuntime = createCanonicalRuntime({
    resume: langResume,
    version: createRuntimeVersion({ id: "creative-timeline-test-lang-v1", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: langResume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });
  const langHtml = await renderTemplateFromRuntime(langRuntime, { templateId: "creative-timeline", generatedAt: GENERATED_AT }, "html");
  const langDocx = await renderTemplateFromRuntime(langRuntime, { templateId: "creative-timeline", generatedAt: GENERATED_AT }, "docx");
  const langDocumentXml = await (await JSZip.loadAsync(langDocx.bytes)).file("word/document.xml")!.async("string");

  checkTrue("languages/html: renders the paired English entry", langHtml.html.includes("English — Native"));
  checkTrue("languages/html: renders the paired Français entry", langHtml.html.includes("Français — Courant"));
  check("languages/html: the source section's own heading appears exactly once (the paired block replaces the raw one, never doubles it)", occurrences(langHtml.html, "Language Proficiency"), 1);
  checkTrue("languages/html: the unrelated Programming Languages section survives (suppression is by provenance, not by heading text)", langHtml.html.includes(PROGRAMMING_LANGUAGES_TEXT));
  checkTrue("languages/html: validation.passed is true", langHtml.validation.passed);
  check("languages/html: validation.missingTextCount is 0", langHtml.validation.missingTextCount, 0);
  check("languages/html: validation.inventedTextCount is 0", langHtml.validation.inventedTextCount, 0);

  checkTrue("languages/docx: renders the paired English entry", langDocumentXml.includes("English — Native"));
  checkTrue("languages/docx: renders the paired Français entry", langDocumentXml.includes("Français — Courant"));
  check("languages/docx: the source section's own heading appears exactly once", occurrences(langDocumentXml, "LANGUAGE PROFICIENCY"), 1);
  checkTrue("languages/docx: the unrelated Programming Languages section survives", langDocumentXml.includes(PROGRAMMING_LANGUAGES_TEXT));
  checkTrue("languages/docx: validation.passed is true", langDocx.validation.passed);
  check("languages/docx: validation.missingTextCount is 0", langDocx.validation.missingTextCount, 0);
  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
