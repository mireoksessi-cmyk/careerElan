/*
  Phase 6F - Modern Sidebar real-render test category (spec section 19),
  including the two-stream sidebar-continuation behavior specific to
  this template (main column and sidebar column are paginated
  independently via two buildGenericPaginationPlan calls - see
  html.tsx's own header comment). Run with:
    npx tsx lib/resumeTemplates/tests/modernSidebar.test.ts
*/
import { ensureTemplatesRegistered } from "../registry/bootstrap";
import { renderTemplateFromRuntime } from "../engine/renderTemplate";
import { closeSharedBrowser } from "../../documentPreservation/sharedBrowser";
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeOverlayState, createRuntimeVersion } from "../../careerMemory/runtime/factory";
import { buildJordanEllisResume } from "../../../fixtures/resumes/template-preview/jordanEllisFixture";
import { MODERN_SIDEBAR_LABELS } from "../templates/modernSidebar/sectionPolicy";
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
    version: createRuntimeVersion({ id: "modern-sidebar-test-v1", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: resume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });

  const html = await renderTemplateFromRuntime(runtime, { templateId: "modern-sidebar", generatedAt: GENERATED_AT }, "html");
  const pdf = await renderTemplateFromRuntime(runtime, { templateId: "modern-sidebar", generatedAt: GENERATED_AT }, "pdf");
  const docx = await renderTemplateFromRuntime(runtime, { templateId: "modern-sidebar", generatedAt: GENERATED_AT }, "docx");

  /* --- HTML result --- */
  check("html: templateId is modern-sidebar", html.templateId, "modern-sidebar");
  checkTrue("html: html string is non-empty", html.html.length > 0);
  checkTrue("html: contains identity full name", html.html.includes("Jordan Ellis"));
  checkTrue("html: uses CSS Grid named areas (2-column layout, per spec section 3)", html.html.includes("grid-template-areas"));
  checkTrue("html: grid-template-areas keeps DOM order identity->main->sidebar regardless of visual placement", html.html.includes('"identity main" "sidebar main"'));
  checkTrue("html: contains the Profile label (summary)", html.html.includes(MODERN_SIDEBAR_LABELS.summary));
  checkTrue("html: contains the Experience label", html.html.includes(MODERN_SIDEBAR_LABELS.experience));
  checkTrue("html: contains the Skills label (sidebar stream)", html.html.includes(MODERN_SIDEBAR_LABELS.skills));
  checkTrue("html: contains the actual custom-section heading text for the language section, not a generic 'Languages' substitution (spec section 7 content-substitution fix)", html.html.includes("Language Proficiency"));
  checkTrue("html: contains Korean text from the language proficiency section", /[가-힣]/.test(html.html));
  checkTrue("html: validation.passed is true", html.validation.passed);
  check("html: validation.missingTextCount is 0", html.validation.missingTextCount, 0);
  check("html: validation.inventedTextCount is 0", html.validation.inventedTextCount, 0);
  checkTrue("html: validation.sectionOrderPreserved is true (independentOrderedSequences: main+sidebar streams each internally ordered)", html.validation.sectionOrderPreserved);
  checkTrue("html: photo placeholder slot is present (supportsPhoto=true, default photoOption=placeholder)", html.html.includes("border-radius:50%"));

  /* --- PDF result --- */
  check("pdf: templateId is modern-sidebar", pdf.templateId, "modern-sidebar");
  checkTrue("pdf: bytes buffer is non-empty", pdf.bytes.length > 0);
  checkTrue("pdf: bytes start with the %PDF magic header", pdf.bytes.subarray(0, 5).toString("latin1") === "%PDF-");
  checkTrue("pdf: hasSelectableText is true", pdf.hasSelectableText);
  checkTrue("pdf: validation.passed is true", pdf.validation.passed);
  checkTrue("pdf: pageCount is at least 1", pdf.pageCount >= 1);

  /* --- DOCX result --- */
  check("docx: templateId is modern-sidebar", docx.templateId, "modern-sidebar");
  checkTrue("docx: bytes buffer is non-empty", docx.bytes.length > 0);
  checkTrue("docx: isEditableNativeDocx is true", docx.isEditableNativeDocx);
  checkTrue("docx: validation.passed is true", docx.validation.passed);

  const docxZip = await JSZip.loadAsync(docx.bytes);
  const documentXml = await docxZip.file("word/document.xml")!.async("string");
  checkTrue("docx: document.xml contains identity full name", documentXml.includes("Jordan Ellis"));
  /* docx.ts renders the sidebar language heading via section.heading.toUpperCase() (its own uppercase styling convention) - assert the uppercase form actually emitted. */
  checkTrue("docx: document.xml contains the real language section heading, uppercased (not a generic substitution)", documentXml.includes("LANGUAGE PROFICIENCY"));
  checkTrue("docx: document.xml contains the project's role text 'Executive Sponsor' (spec-7 content-loss fix: role was previously dropped in this template's DOCX renderer)", documentXml.includes("Executive Sponsor"));

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
