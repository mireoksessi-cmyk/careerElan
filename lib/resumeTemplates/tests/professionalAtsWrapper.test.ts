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

/*
  Structured-Languages variants of the same fixture. The base fixture
  ships languages: [] plus a raw language section, which is the
  empty-languages fallback every assertion above already covers.

  A resume that DOES yield structured languages carries BOTH - the pairs
  in model.languages and the same section still preserved raw, its lines
  unpaired. These builders reproduce that exact shape, provenance and
  all, plus an unrelated section whose heading ALSO contains the word
  "Languages" (suppression is keyed on provenance, never on heading text)
  whose body lives in `paragraphs`, which is what visibilityPolicy
  actually reads.

  The language names are invented tokens rather than real languages, on
  purpose: nothing in the production path may key on a language name.
*/
const LANG_A = "Alphish";
const LANG_B = "Betish";
const PROFICIENCY = "Gammish";
const UNPAIRED_NOTE = "Certified interpreter since 2019";
const UNRELATED_HEADING = "Programming Languages";
const UNRELATED_BODY = "TypeScript, Python, SQL";

function traceFor(sectionId: string, blockIds: string[]) {
  return { sourceSectionId: sectionId, sourceBlockIds: blockIds, sourceElementIds: [sectionId + "-el"] };
}

/* covered=false leaves one source line unaccounted for by the pairs. */
function buildStructuredLanguagesResume(covered: boolean) {
  const resume = buildJordanEllisResume();
  const raw = resume.customSections.find((s) => s.id === "custom-languages")!;
  const sid = raw.source.sourceSectionId;
  const lines: [string, string][] = covered
    ? [[LANG_A, "lb1"], [LANG_B, "lb2"], [PROFICIENCY, "lb3"], [PROFICIENCY, "lb4"]]
    : [[LANG_A, "lb1"], [PROFICIENCY, "lb3"], [UNPAIRED_NOTE, "lb9"]];
  raw.source = traceFor(sid, ["lb0", ...lines.map(([, b]) => b)]);
  raw.paragraphs = lines.map(([text, b]) => ({ value: text, confidence: 0.7, extractionMethod: "explicit-label" as const, source: traceFor(sid, [b]) }));
  raw.content = lines.map(([text, b], i) => ({ id: "custom-lang-c" + (i + 1), kind: "paragraph" as const, text, source: traceFor(sid, [b]) }));
  resume.languages = covered
    ? [
        { name: LANG_A, proficiency: PROFICIENCY, source: traceFor(sid, ["lb1", "lb3"]) },
        { name: LANG_B, proficiency: PROFICIENCY, source: traceFor(sid, ["lb2", "lb4"]) },
      ]
    : [{ name: LANG_A, proficiency: PROFICIENCY, source: traceFor(sid, ["lb1", "lb3"]) }];

  const unrelatedTrace = traceFor("sec-custom-prog-lang", ["pb1"]);
  resume.customSections.push({
    id: "custom-programming-languages",
    originalHeading: UNRELATED_HEADING,
    displayHeading: UNRELATED_HEADING,
    paragraphs: [{ value: UNRELATED_BODY, confidence: 0.7, extractionMethod: "explicit-label" as const, source: unrelatedTrace }],
    bullets: [],
    content: [{ id: "custom-prog-c1", kind: "paragraph" as const, text: UNRELATED_BODY, source: unrelatedTrace }],
    sourceOrder: 99,
    source: unrelatedTrace,
  });
  return resume;
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
/* Strip tags so a count reflects rendered reading order, not markup. */
function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

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


  /*
    A. through H. - structured Languages in Professional ATS. Before this
    fix the raw section rendered its four unpaired lines while the pairs
    were dropped, so a reader saw four detached lines instead of two
    entries.
  */
  const pairA = LANG_A + " — " + PROFICIENCY;
  const pairB = LANG_B + " — " + PROFICIENCY;

  const covResume = buildStructuredLanguagesResume(true);
  const covRuntime = createCanonicalRuntime({
    resume: covResume,
    version: createRuntimeVersion({ id: "pro-ats-test-lang-covered", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: covResume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });
  const covHtml = await renderTemplateFromRuntime(covRuntime, { templateId: "professional-ats", generatedAt: GENERATED_AT }, "html");
  const covDocx = await renderTemplateFromRuntime(covRuntime, { templateId: "professional-ats", generatedAt: GENERATED_AT }, "docx");
  const covXml = await (await JSZip.loadAsync(covDocx.bytes)).file("word/document.xml")!.async("string");
  const covHtmlText = visibleText(covHtml.html);
  const covXmlText = visibleText(covXml);
  const sourceHeading = covResume.customSections.find((s) => s.id === "custom-languages")!.originalHeading!;

  /* A + B: both languages share ONE proficiency string, which is exactly
     the case that used to collapse into four detached lines. */
  check("languages/html: A. first language renders paired with its proficiency", occurrences(covHtmlText, pairA), 1);
  check("languages/html: B. second language renders as its OWN paired entry despite an identical proficiency", occurrences(covHtmlText, pairB), 1);
  check("languages/html: neither language name appears outside a pair", [occurrences(covHtmlText, LANG_A) - occurrences(covHtmlText, LANG_A + " —"), occurrences(covHtmlText, LANG_B) - occurrences(covHtmlText, LANG_B + " —")], [0, 0]);
  check("languages/html: the proficiency appears exactly twice - once per pair, never as a detached line", occurrences(covHtmlText, PROFICIENCY), 2);
  check("languages/html: C. the source section heading is preserved exactly once", occurrences(covHtmlText, sourceHeading), 1);
  checkTrue("languages/html: D. no second raw copy of the language section", occurrences(covHtmlText, sourceHeading) === 1 && occurrences(covHtmlText, PROFICIENCY) === 2);
  check("languages/html: E. an unrelated section whose heading also says Languages survives", [occurrences(covHtmlText, UNRELATED_HEADING), occurrences(covHtmlText, UNRELATED_BODY)], [1, 1]);
  checkTrue("languages/html: the other custom section is untouched", covHtmlText.includes("Professional Affiliations"));
  checkTrue("languages/html: validation.passed is true", covHtml.validation.passed);
  check("languages/html: no missing or invented text", [covHtml.validation.missingTextCount, covHtml.validation.inventedTextCount], [0, 0]);

  check("languages/docx: H. same paired entries as HTML", [occurrences(covXmlText, pairA), occurrences(covXmlText, pairB)], [1, 1]);
  check("languages/docx: same source heading, once", occurrences(covXmlText, sourceHeading), 1);
  check("languages/docx: same proficiency count as HTML", occurrences(covXmlText, PROFICIENCY), occurrences(covHtmlText, PROFICIENCY));
  check("languages/docx: unrelated section survives", [occurrences(covXmlText, UNRELATED_HEADING), occurrences(covXmlText, UNRELATED_BODY)], [1, 1]);
  checkTrue("languages/docx: validation.passed is true", covDocx.validation.passed);
  check("languages/docx: no missing or invented text", [covDocx.validation.missingTextCount, covDocx.validation.inventedTextCount], [0, 0]);

  /* F. languages: [] - the untouched base fixture render above is the control. */
  check("languages/html: F. with languages [] no pair is synthesised", occurrences(visibleText(html.html), pairA), 0);
  checkTrue("languages/html: F. the raw language line still renders verbatim when languages is []", visibleText(html.html).includes("English (Native), Français (Courant)"));

  /* G. partial provenance coverage must fall back rather than lose the odd line. */
  const partResume = buildStructuredLanguagesResume(false);
  const partRuntime = createCanonicalRuntime({
    resume: partResume,
    version: createRuntimeVersion({ id: "pro-ats-test-lang-partial", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: partResume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });
  const partHtml = await renderTemplateFromRuntime(partRuntime, { templateId: "professional-ats", generatedAt: GENERATED_AT }, "html");
  const partDocx = await renderTemplateFromRuntime(partRuntime, { templateId: "professional-ats", generatedAt: GENERATED_AT }, "docx");
  const partXml = await (await JSZip.loadAsync(partDocx.bytes)).file("word/document.xml")!.async("string");
  const partHtmlText = visibleText(partHtml.html);

  checkTrue("languages/html: G. the line the pairs do not account for is NOT dropped", partHtmlText.includes(UNPAIRED_NOTE));
  check("languages/html: G. incomplete coverage declines pairing and keeps the raw section", occurrences(partHtmlText, pairA), 0);
  checkTrue("languages/html: G. the raw unpaired lines still render", partHtmlText.includes(LANG_A) && partHtmlText.includes(PROFICIENCY));
  checkTrue("languages/docx: G. the unaccounted line survives in DOCX too", visibleText(partXml).includes(UNPAIRED_NOTE));
  check("languages/html: G. validation still clean under fallback", [partHtml.validation.passed, partHtml.validation.missingTextCount, partHtml.validation.inventedTextCount], [true, 0, 0]);
  check("languages/docx: G. validation still clean under fallback", [partDocx.validation.passed, partDocx.validation.missingTextCount], [true, 0]);
  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
