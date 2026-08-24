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
  /*
    Each detached line gets its OWN sourceBlockId, and each language claims
    the two blocks its name and proficiency came from. That is what the DPE
    actually emits for a one-value-per-line Languages section, and it is
    what makes the pairs a lossless regrouping of the source rather than a
    rewrite: every block is claimed exactly once. Reusing one trace for all
    four lines - as this builder first did - describes a single INLINE line
    instead, which the templates deliberately leave unpaired.
  */
  const lineTrace = (blockId: string) => ({ ...raw.source, sourceBlockIds: [blockId] });
  raw.paragraphs = UNPAIRED_LANGUAGE_LINES.map((text, i) => ({ value: text, confidence: 0.7, extractionMethod: "explicit-label" as const, source: lineTrace(`lang-b${i}`) }));
  raw.content = UNPAIRED_LANGUAGE_LINES.map((text, i) => ({ id: `custom-lang-c${i + 1}`, kind: "paragraph" as const, text, source: lineTrace(`lang-b${i}`) }));
  resume.languages = [
    { name: "English", proficiency: "Native", source: { ...raw.source, sourceBlockIds: ["lang-b0", "lang-b1"] } },
    { name: "Français", proficiency: "Courant", source: { ...raw.source, sourceBlockIds: ["lang-b2", "lang-b3"] } },
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

/*
  Two fixtures the paired path must REFUSE, both keyed on provenance alone.

  Partial: one raw line that no structured entry accounts for. Pairing would
  have to drop it, so the section stays raw and the line survives.

  Inline: both entries came from ONE source line, which already reads as
  correctly paired prose - re-emitting it as two rows would discard the
  document's own punctuation, so it is preserved verbatim.
*/
const UNACCOUNTED_NOTE = "Certified interpreter since 2019";
const INLINE_LANGUAGE_LINE = "English (fluent), Italian (native)";

function buildPartialCoverageResume() {
  const resume = buildJordanEllisResume();
  const raw = resume.customSections.find((s) => s.id === "custom-languages")!;
  const lineTrace = (blockId: string) => ({ ...raw.source, sourceBlockIds: [blockId] });
  const lines = ["English", "Native", UNACCOUNTED_NOTE];
  raw.paragraphs = lines.map((text, i) => ({ value: text, confidence: 0.7, extractionMethod: "explicit-label" as const, source: lineTrace(`part-b${i}`) }));
  raw.content = lines.map((text, i) => ({ id: `part-c${i}`, kind: "paragraph" as const, text, source: lineTrace(`part-b${i}`) }));
  resume.languages = [{ name: "English", proficiency: "Native", source: { ...raw.source, sourceBlockIds: ["part-b0", "part-b1"] } }];
  return resume;
}

function buildInlineCoverageResume() {
  const resume = buildJordanEllisResume();
  const raw = resume.customSections.find((s) => s.id === "custom-languages")!;
  const oneBlock = { ...raw.source, sourceBlockIds: ["inline-b0"] };
  raw.paragraphs = [{ value: INLINE_LANGUAGE_LINE, confidence: 0.7, extractionMethod: "explicit-label" as const, source: oneBlock }];
  raw.content = [{ id: "inline-c0", kind: "paragraph" as const, text: INLINE_LANGUAGE_LINE, source: oneBlock }];
  resume.languages = [
    { name: "English", proficiency: "fluent", source: oneBlock },
    { name: "Italian", proficiency: "native", source: oneBlock },
  ];
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

  /* Coverage-safety regressions: the paired path must stand down and leave
     the source untouched whenever pairing would not be a lossless
     regrouping of it. */
  const partialResume = buildPartialCoverageResume();
  const partialRuntime = createCanonicalRuntime({
    resume: partialResume,
    version: createRuntimeVersion({ id: "creative-timeline-partial", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: partialResume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });
  const partialHtml = await renderTemplateFromRuntime(partialRuntime, { templateId: "creative-timeline", generatedAt: GENERATED_AT }, "html");
  const partialDocx = await renderTemplateFromRuntime(partialRuntime, { templateId: "creative-timeline", generatedAt: GENERATED_AT }, "docx");
  const partialXml = await (await JSZip.loadAsync(partialDocx.bytes)).file("word/document.xml")!.async("string");

  checkTrue("languages/partial: the line no structured entry accounts for is never dropped", partialHtml.html.includes(UNACCOUNTED_NOTE));
  checkTrue("languages/partial: incomplete coverage declines pairing", !partialHtml.html.includes("English — Native"));
  checkTrue("languages/partial: the raw unpaired lines still render", partialHtml.html.includes("English") && partialHtml.html.includes("Native"));
  checkTrue("languages/partial: DOCX makes the same decision", partialXml.includes(UNACCOUNTED_NOTE) && !partialXml.includes("English — Native"));
  check("languages/partial: validation stays clean under fallback", [partialHtml.validation.passed, partialHtml.validation.missingTextCount, partialHtml.validation.inventedTextCount, partialDocx.validation.passed], [true, 0, 0, true]);

  const inlineResume = buildInlineCoverageResume();
  const inlineRuntime = createCanonicalRuntime({
    resume: inlineResume,
    version: createRuntimeVersion({ id: "creative-timeline-inline", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: inlineResume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });
  const inlineHtml = await renderTemplateFromRuntime(inlineRuntime, { templateId: "creative-timeline", generatedAt: GENERATED_AT }, "html");
  const inlineDocx = await renderTemplateFromRuntime(inlineRuntime, { templateId: "creative-timeline", generatedAt: GENERATED_AT }, "docx");
  const inlineXml = await (await JSZip.loadAsync(inlineDocx.bytes)).file("word/document.xml")!.async("string");

  checkTrue("languages/inline: the original inline line is preserved verbatim", inlineHtml.html.includes(INLINE_LANGUAGE_LINE));
  checkTrue("languages/inline: two entries sharing one source block decline pairing", !inlineHtml.html.includes("English — fluent"));
  checkTrue("languages/inline: DOCX makes the same decision", inlineXml.includes(INLINE_LANGUAGE_LINE) && !inlineXml.includes("English — fluent"));
  check("languages/inline: validation stays clean under fallback", [inlineHtml.validation.passed, inlineHtml.validation.missingTextCount, inlineHtml.validation.inventedTextCount, inlineDocx.validation.passed], [true, 0, 0, true]);
  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
