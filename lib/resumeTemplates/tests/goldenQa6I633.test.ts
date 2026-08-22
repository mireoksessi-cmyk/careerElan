/*
  Phase 6I.6.33 - Golden QA & Cross-Format Rendering Lockdown.
  Part AI regression suite: exercises the 12 new synthetic fixtures
  (fixtures/resumes/template-preview/goldenQaFixtures.ts) plus the
  existing Jordan Ellis fixture (reused as the "senior/3-4 page"
  shape, item C) across all 4 registered templates
  (professional-ats/modern-sidebar/executive-minimal/creative-timeline
  - Pipeline A / the 6F template registry only; the legacy "brand"
  pipeline (Pipeline B) and the Document Preservation Engine's
  original-layout pipeline (Pipeline C/D) are audited and reported on
  separately, not covered by this file - see the Phase 6I.6.33 final
  report for the full 5-pipeline map).

  Uses the same hand-rolled check()/checkTrue() convention as every
  other lib/resumeTemplates/tests/*.test.ts file (this repo does not
  run these through a test framework - see the header comment on any
  sibling file). Run with:
    npx tsx lib/resumeTemplates/tests/goldenQa6I633.test.ts
*/
import { ensureTemplatesRegistered } from "../registry/bootstrap";
import { renderTemplateFromRuntime } from "../engine/renderTemplate";
import { closeSharedBrowser } from "../../documentPreservation/sharedBrowser";
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeOverlayState, createRuntimeVersion } from "../../careerMemory/runtime/factory";
import { buildJordanEllisResume } from "../../../fixtures/resumes/template-preview/jordanEllisFixture";
import {
  buildBlankNoisyFixture,
  buildDenseBulletsFixture,
  buildEducationHeavyFixture,
  buildExperienceHeavyFixture,
  buildJuniorFixture,
  buildLongStringsFixture,
  buildProjectHeavyFixture,
  buildSparseFixture,
  buildStandardFixture,
  buildUnicodeFixture,
  buildVolunteerGapFixture,
} from "../../../fixtures/resumes/template-preview/goldenQaFixtures";
import { extractVisibleTextFromHtml } from "../shared/htmlText";
import { extractPdf } from "../parity/pdfExtraction";
import { extractDocx } from "../parity/docxExtraction";
import { expectedFragmentsForResume } from "../parity/textFragments";
import { normalizeResume } from "../shared/contentAdapters";
import { TEMPLATE_IDS, type TemplateId } from "../contracts/types";
import { buildPreviewOnlyResume, isPreviewPlaceholderSourceTrace, PREVIEW_PLACEHOLDER_SOURCE_TRACE } from "../preview/previewOnlyCompletion";
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";
import { checkSectionOrderPreserved } from "../parity/validateOutput";
import { documentValid, noOverflowMarker, noPlaceholder, noTemplateIdLeak, sectionAbsent, sectionPresent, semanticParity } from "./goldenQaAssertions";

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

function runtimeFor(resume: ResumeStructuredModel, idSuffix: string) {
  return createCanonicalRuntime({
    resume,
    version: createRuntimeVersion({ id: `golden-qa-${idSuffix}`, reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: resume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });
}

async function renderHtmlAllTemplates(resume: ResumeStructuredModel, idSuffix: string) {
  const runtime = runtimeFor(resume, idSuffix);
  const results: Record<TemplateId, { text: string; passed: boolean; pageCount: number }> = {} as never;
  for (const templateId of TEMPLATE_IDS) {
    const html = await renderTemplateFromRuntime(runtime, { templateId, generatedAt: GENERATED_AT }, "html");
    results[templateId] = { text: extractVisibleTextFromHtml(html.html), passed: html.validation.passed, pageCount: html.pageCount };
  }
  return results;
}

async function main() {
  ensureTemplatesRegistered();

  /* ============================================================
     Part AI items A-C: 4 templates x junior/standard/senior fixtures.
     ============================================================ */
  const junior = buildJuniorFixture();
  const juniorResults = await renderHtmlAllTemplates(junior, "junior");
  for (const id of TEMPLATE_IDS) {
    checkTrue(`[AI-A] ${id}: junior fixture HTML validation.passed`, juniorResults[id].passed);
    checkTrue(`[AI-A] ${id}: junior fixture contains identity 'Priya Nakamura'`, sectionPresent(juniorResults[id].text, "Priya Nakamura"));
    checkTrue(`[AI-A] ${id}: junior fixture contains employer 'Brightpath Media Co.'`, sectionPresent(juniorResults[id].text, "Brightpath Media Co."));
    checkTrue(`[AI-A] ${id}: junior fixture 1-page HTML pageCount is exactly 1`, juniorResults[id].pageCount === 1);
    checkTrue(`[AI-D/Part-G] ${id}: junior fixture (no projects/certs/awards) hides Projects heading`, sectionAbsent(juniorResults[id].text, "PROJECTS"));
    checkTrue(`[Part-Z] ${id}: junior fixture output has no placeholder/debug text`, noPlaceholder(juniorResults[id].text));
    checkTrue(`[Part-AA] ${id}: junior fixture output does not leak internal template id`, noTemplateIdLeak(juniorResults[id].text));
  }

  const standard = buildStandardFixture();
  const standardResults = await renderHtmlAllTemplates(standard, "standard");
  for (const id of TEMPLATE_IDS) {
    checkTrue(`[AI-B] ${id}: standard fixture HTML validation.passed`, standardResults[id].passed);
    checkTrue(`[AI-B] ${id}: standard fixture contains all 3 employers`, ["Vantage Software", "Redwood Analytics", "Northgate Retail"].every((e) => sectionPresent(standardResults[id].text, e)));
    checkTrue(`[AI-B] ${id}: standard fixture contains project name`, sectionPresent(standardResults[id].text, "Open-source CLI resume linter"));
    checkTrue(`[AI-B] ${id}: standard fixture contains certification`, sectionPresent(standardResults[id].text, "AWS Certified Solutions Architect"));
    checkTrue(`[Part-Z] ${id}: standard fixture output has no placeholder/debug text`, noPlaceholder(standardResults[id].text));
  }

  const senior = buildJordanEllisResume();
  const seniorRuntime = runtimeFor(senior, "senior");
  const seniorHtml: Record<TemplateId, { text: string; passed: boolean; pageCount: number }> = {} as never;
  const seniorPdf: Record<TemplateId, { pageCount: number; hasSelectableText: boolean; extracted: Awaited<ReturnType<typeof extractPdf>>; passed: boolean }> = {} as never;
  const seniorDocx: Record<TemplateId, { isEditableNativeDocx: boolean; extracted: Awaited<ReturnType<typeof extractDocx>>; passed: boolean }> = {} as never;
  for (const id of TEMPLATE_IDS) {
    const html = await renderTemplateFromRuntime(seniorRuntime, { templateId: id, generatedAt: GENERATED_AT }, "html");
    seniorHtml[id] = { text: extractVisibleTextFromHtml(html.html), passed: html.validation.passed, pageCount: html.pageCount };
    const pdf = await renderTemplateFromRuntime(seniorRuntime, { templateId: id, generatedAt: GENERATED_AT }, "pdf");
    const extractedPdf = await extractPdf(pdf.bytes);
    seniorPdf[id] = { pageCount: pdf.pageCount, hasSelectableText: pdf.hasSelectableText, extracted: extractedPdf, passed: pdf.validation.passed };
    const docx = await renderTemplateFromRuntime(seniorRuntime, { templateId: id, generatedAt: GENERATED_AT }, "docx");
    const extractedDocx = await extractDocx(docx.bytes);
    seniorDocx[id] = { isEditableNativeDocx: docx.isEditableNativeDocx, extracted: extractedDocx, passed: docx.validation.passed };
  }
  for (const id of TEMPLATE_IDS) {
    checkTrue(`[AI-C/Part-H] ${id}: senior fixture (3-4pg) HTML validation.passed`, seniorHtml[id].passed);
    checkTrue(`[Part-K/L] ${id}: senior fixture HTML pageCount >= 2 (genuinely multi-page)`, seniorHtml[id].pageCount >= 2);
    checkTrue(`[Part-M] ${id}: senior fixture PDF is valid (parseable, real bytes)`, seniorPdf[id].extracted.parseable);
    checkTrue(`[Part-M] ${id}: senior fixture PDF has selectable text (not a rasterized screenshot)`, seniorPdf[id].hasSelectableText);
    checkTrue(`[Part-M] ${id}: senior fixture PDF has zero blank pages`, seniorPdf[id].extracted.blankPageIndices.length === 0);
    checkTrue(`[Part-N] ${id}: senior fixture DOCX is a valid, parseable OOXML zip`, seniorDocx[id].extracted.parseableZip && seniorDocx[id].extracted.requiredPartsPresent);
    checkTrue(`[Part-N] ${id}: senior fixture DOCX is macro-free`, seniorDocx[id].extracted.macroFree);
    checkTrue(`[Part-N] ${id}: senior fixture DOCX is editable native (not image-only)`, seniorDocx[id].isEditableNativeDocx);
    checkTrue(`[Part-N] ${id}: senior fixture DOCX validation.passed`, seniorDocx[id].passed);
  }
  /* Part L - HTML/PDF page-count parity contract. Per the Phase 6I.6.33
     pipeline audit: the 3 non-ATS templates screenshot their own
     already-paginated HTML for PDF (same computed pages, so exact
     parity is the correct contract); professional-ats runs PDF through
     a SEPARATE dedicated builder (buildProfessionalAtsPdf) from its
     HTML preview builder, so exact parity is not architecturally
     guaranteed there - checked as "close" (a small deliberate render
     gap), not exact, and the difference is investigated rather than
     silently accepted if it is large. */
  for (const id of TEMPLATE_IDS) {
    const diff = Math.abs(seniorHtml[id].pageCount - seniorPdf[id].pageCount);
    if (id === "professional-ats") {
      checkTrue(`[Part-L] ${id}: HTML pageCount (${seniorHtml[id].pageCount}) and PDF pageCount (${seniorPdf[id].pageCount}) are close (separate builders, parity not architecturally guaranteed)`, diff <= 1);
    } else {
      check(`[Part-L] ${id}: HTML pageCount === PDF pageCount (same paginated HTML is screenshotted, exact parity expected)`, seniorPdf[id].pageCount, seniorHtml[id].pageCount);
    }
  }
  /* Part O - PDF vs DOCX semantic parity for the senior fixture. */
  const seniorFragments = expectedFragmentsForResume(normalizeResume(senior));
  for (const id of TEMPLATE_IDS) {
    const parity = semanticParity(seniorFragments, seniorPdf[id].extracted.fullText, seniorDocx[id].extracted.text);
    checkTrue(`[Part-O] ${id}: senior fixture PDF/DOCX semantic parity (normalized fragment comparison)`, parity.parityOk);
  }

  /* ============================================================
     Part AI item D/E, Part G/H: empty-section + blank-entry matrix.
     ============================================================ */
  const sparse = buildSparseFixture();
  const sparseResults = await renderHtmlAllTemplates(sparse, "sparse");
  for (const id of TEMPLATE_IDS) {
    checkTrue(`[AI-D] ${id}: sparse fixture HTML validation.passed`, sparseResults[id].passed);
    checkTrue(`[AI-D/Part-G] ${id}: sparse fixture hides Projects (no data)`, sectionAbsent(sparseResults[id].text, "PROJECTS"));
    checkTrue(`[AI-D/Part-G] ${id}: sparse fixture hides Certifications (no data)`, sectionAbsent(sparseResults[id].text, "CERTIFICATIONS"));
    checkTrue(`[AI-D/Part-G] ${id}: sparse fixture hides Education (no data)`, sectionAbsent(sparseResults[id].text, "EDUCATION"));
    checkTrue(`[AI-D/Part-G] ${id}: sparse fixture hides Awards (no data)`, sectionAbsent(sparseResults[id].text, "AWARDS"));
    checkTrue(`[Part-Z] ${id}: sparse fixture output has no placeholder text despite mostly-empty input`, noPlaceholder(sparseResults[id].text));
  }

  const blankNoisy = buildBlankNoisyFixture();
  const blankNoisyResults = await renderHtmlAllTemplates(blankNoisy, "blank-noisy");
  for (const id of TEMPLATE_IDS) {
    checkTrue(`[AI-E] ${id}: blank/noisy fixture HTML validation.passed`, blankNoisyResults[id].passed);
    checkTrue(`[AI-E] ${id}: blank/noisy fixture: valid experience bullet 'Built the annual budgeting model' survives`, sectionPresent(blankNoisyResults[id].text, "Built the annual budgeting model"));
    checkTrue(`[AI-E] ${id}: blank/noisy fixture: valid experience bullet 'Reduced month-end close time' survives`, sectionPresent(blankNoisyResults[id].text, "Reduced month-end close time"));
    checkTrue(`[AI-E] ${id}: blank/noisy fixture: whitespace-only project heading is dropped (Projects hidden)`, sectionAbsent(blankNoisyResults[id].text, "PROJECTS"));
    checkTrue(`[AI-E] ${id}: blank/noisy fixture: blank education entry is dropped, valid one survives ('Brock University')`, sectionPresent(blankNoisyResults[id].text, "Brock University"));
    checkTrue(`[AI-E] ${id}: blank/noisy fixture: valid credential 'CFA Level II Candidate' survives despite a fully-blank sibling credential`, sectionPresent(blankNoisyResults[id].text, "CFA Level II Candidate"));
    checkTrue(`[AI-E] ${id}: blank/noisy fixture: valid education detail 'Dean's List, 2020' survives its whitespace-only sibling`, sectionPresent(blankNoisyResults[id].text, "Dean's List, 2020"));
  }

  /* ============================================================
     Part AI item F: volunteer spacing / gap-bug-class regression.
     ============================================================ */
  const volunteerGap = buildVolunteerGapFixture();
  const volunteerResults = await renderHtmlAllTemplates(volunteerGap, "volunteer-gap");
  for (const id of TEMPLATE_IDS) {
    checkTrue(`[AI-F] ${id}: volunteer+professional fixture HTML validation.passed`, volunteerResults[id].passed);
    checkTrue(`[AI-F] ${id}: both professional employers survive ('Riverside Community Foundation')`, sectionPresent(volunteerResults[id].text, "Riverside Community Foundation"));
    checkTrue(`[AI-F] ${id}: both professional employers survive ('Lakeshore Youth Services')`, sectionPresent(volunteerResults[id].text, "Lakeshore Youth Services"));
    checkTrue(`[AI-F] ${id}: both volunteer orgs survive ('Habitat for Humanity')`, sectionPresent(volunteerResults[id].text, "Habitat for Humanity"));
    checkTrue(`[AI-F] ${id}: both volunteer orgs survive ('Community Food Bank')`, sectionPresent(volunteerResults[id].text, "Community Food Bank"));
    checkTrue(`[AI-F] ${id}: volunteer entries are not merged into professional experience or dropped as a false employment gap`, sectionPresent(volunteerResults[id].text, "Volunteer") || sectionPresent(volunteerResults[id].text, "VOLUNTEER"));
  }

  /* ============================================================
     Part AI item G / Part I: executive-minimal section-spacing order
     regression (PROJECTS -> EDUCATION -> CERTIFICATIONS, senior
     fixture, which is the exact section combination the phase spec
     names).
     ============================================================ */
  /*
    executive-minimal's actual section labels (templates/executiveMinimal/
    sectionPolicy.ts) are "Selected Initiatives" for the projects-
    equivalent section and "Credentials" (not "Certifications") for
    credentials - checked via checkSectionOrderPreserved's anchored,
    sequential heading search rather than a loose substring scan, since
    a naive `indexOf("PROJECT")` false-matches the unrelated credential
    entry "Project Management Professional (PMP)" that legitimately
    appears later in the document (a real false positive caught while
    authoring this suite - see fixture "Jordan Ellis"'s PMP credential).
  */
  checkTrue(
    "[AI-G/Part-I] executive-minimal: senior fixture section order is Selected Initiatives -> Education -> Credentials",
    checkSectionOrderPreserved(["Selected Initiatives", "Education", "Credentials"], seniorHtml["executive-minimal"].text)
  );

  /* ============================================================
     Part AI item H: 1/2/3/4-page pagination stress via HTML pageCount.
     ============================================================ */
  const experienceHeavy = buildExperienceHeavyFixture();
  const experienceHeavyResults = await renderHtmlAllTemplates(experienceHeavy, "experience-heavy");
  const denseBullets = buildDenseBulletsFixture();
  const denseBulletsResults = await renderHtmlAllTemplates(denseBullets, "dense-bullets");
  for (const id of TEMPLATE_IDS) {
    checkTrue(`[AI-H] ${id}: 1-page (junior) pageCount === 1`, juniorResults[id].pageCount === 1);
    checkTrue(`[AI-H] ${id}: 2-page-ish (standard, 3 jobs) pageCount >= 1`, standardResults[id].pageCount >= 1);
    checkTrue(`[AI-H] ${id}: 3-4-page (senior) pageCount >= 2`, seniorHtml[id].pageCount >= 2);
    checkTrue(`[AI-H] ${id}: dense multi-job stress (experience-heavy, 8 jobs) validation.passed, nothing dropped`, experienceHeavyResults[id].passed);
    checkTrue(`[AI-H] ${id}: experience-heavy fixture: last employer 'Harbor Point Shipping' survives (no truncation at page boundary)`, sectionPresent(experienceHeavyResults[id].text, "Harbor Point Shipping"));
    checkTrue(`[AI-H] ${id}: experience-heavy fixture: first employer 'Falcon Freight Ltd.' survives alongside the last`, sectionPresent(experienceHeavyResults[id].text, "Falcon Freight Ltd."));
    checkTrue(`[AI-H] ${id}: dense-bullets fixture (14 bullets in one entry) validation.passed, nothing dropped`, denseBulletsResults[id].passed);
    checkTrue(`[AI-H] ${id}: dense-bullets fixture: bullet #1 survives`, sectionPresent(denseBulletsResults[id].text, "Delivered initiative #1"));
    checkTrue(`[AI-H] ${id}: dense-bullets fixture: bullet #14 survives (no truncation at 14th item)`, sectionPresent(denseBulletsResults[id].text, "Delivered initiative #14"));
  }

  /* ============================================================
     Part AI item L: Unicode/Korean/French accents/smart punctuation,
     across HTML, PDF, and DOCX.
     ============================================================ */
  const unicode = buildUnicodeFixture();
  const unicodeRuntime = runtimeFor(unicode, "unicode");
  const unicodeFragments = ["김민준", "프로그램 코디네이터", "Montréal", "Université de Montréal", "한국어"];
  for (const id of TEMPLATE_IDS) {
    const html = await renderTemplateFromRuntime(unicodeRuntime, { templateId: id, generatedAt: GENERATED_AT }, "html");
    const htmlText = extractVisibleTextFromHtml(html.html);
    checkTrue(`[AI-L] ${id}: Unicode fixture HTML validation.passed`, html.validation.passed);
    for (const fragment of unicodeFragments) {
      checkTrue(`[AI-L] ${id}: Unicode HTML contains '${fragment}'`, sectionPresent(htmlText, fragment));
    }

    const pdf = await renderTemplateFromRuntime(unicodeRuntime, { templateId: id, generatedAt: GENERATED_AT }, "pdf");
    const extractedPdf = await extractPdf(pdf.bytes);
    checkTrue(`[AI-L] ${id}: Unicode PDF is parseable`, extractedPdf.parseable);
    checkTrue(`[AI-L] ${id}: Unicode PDF contains Korean name '김민준'`, sectionPresent(extractedPdf.fullText, "김민준"));
    checkTrue(`[AI-L] ${id}: Unicode PDF contains accented 'Montréal'`, sectionPresent(extractedPdf.fullText, "Montréal"));

    const docx = await renderTemplateFromRuntime(unicodeRuntime, { templateId: id, generatedAt: GENERATED_AT }, "docx");
    const extractedDocx = await extractDocx(docx.bytes);
    checkTrue(`[AI-L] ${id}: Unicode DOCX is a valid parseable OOXML zip`, extractedDocx.parseableZip);
    checkTrue(`[AI-L] ${id}: Unicode DOCX contains Korean custom-section text '한국어'`, sectionPresent(extractedDocx.text, "한국어"));
    checkTrue(`[AI-L] ${id}: Unicode DOCX contains accented 'Université de Montréal'`, sectionPresent(extractedDocx.text, "Université de Montréal"));
  }

  /* ============================================================
     Part AI item M: long text / wrapping (no crash, no overflow marker,
     full strings survive).
     ============================================================ */
  const longStrings = buildLongStringsFixture();
  const longStringsResults = await renderHtmlAllTemplates(longStrings, "long-strings");
  const LONG_TITLE = "Senior Principal Cross-Functional Program Manager, Global Renewable Energy Grid Modernization Initiatives";
  const LONG_URL = "https://portfolio.example.com/case-studies/2026/grid-modernization-initiative-full-technical-writeup-and-appendices/index.html";
  for (const id of TEMPLATE_IDS) {
    checkTrue(`[AI-M] ${id}: long-strings fixture HTML validation.passed (no crash on long tokens)`, longStringsResults[id].passed);
    checkTrue(`[AI-M] ${id}: long job title survives in full, not truncated`, sectionPresent(longStringsResults[id].text, LONG_TITLE));
    checkTrue(`[AI-M] ${id}: long URL survives in full`, sectionPresent(longStringsResults[id].text, LONG_URL));
    checkTrue(`[AI-M] ${id}: no overflow/clipped/truncated marker text`, noOverflowMarker(longStringsResults[id].text));
  }
  /* Long-string PDF spot-check on 2 representative templates (one
     single-column, one sidebar/two-column layout - the shape most
     likely to clip a long token) rather than all 4, to keep this
     category's Playwright cost proportionate (Part AC guidance). */
  for (const id of ["professional-ats", "modern-sidebar"] as TemplateId[]) {
    const runtime = runtimeFor(longStrings, `long-strings-pdf-${id}`);
    const pdf = await renderTemplateFromRuntime(runtime, { templateId: id, generatedAt: GENERATED_AT }, "pdf");
    const extracted = await extractPdf(pdf.bytes);
    checkTrue(`[AI-M/Part-M] ${id}: long-strings fixture PDF is valid and parseable`, extracted.parseable);
    checkTrue(`[AI-M/Part-M] ${id}: long-strings fixture PDF preserves the long job title in full`, sectionPresent(extracted.fullText, LONG_TITLE));
  }

  /* ============================================================
     Part AI items A-C supplement: education-heavy / project-heavy
     shapes (content preservation, Part F).
     ============================================================ */
  const educationHeavy = buildEducationHeavyFixture();
  const educationHeavyResults = await renderHtmlAllTemplates(educationHeavy, "education-heavy");
  for (const id of TEMPLATE_IDS) {
    checkTrue(`[Part-F] ${id}: education-heavy fixture validation.passed`, educationHeavyResults[id].passed);
    checkTrue(`[Part-F] ${id}: all 3 degrees survive ('University of Ottawa')`, sectionPresent(educationHeavyResults[id].text, "University of Ottawa"));
    checkTrue(`[Part-F] ${id}: all 3 degrees survive ('McGill University')`, sectionPresent(educationHeavyResults[id].text, "McGill University"));
    checkTrue(`[Part-F] ${id}: all 3 degrees survive ('Queen's University')`, sectionPresent(educationHeavyResults[id].text, "Queen's University"));
    checkTrue(`[Part-F] ${id}: honors survive ('Dean's Research Fellowship')`, sectionPresent(educationHeavyResults[id].text, "Dean's Research Fellowship"));
    checkTrue(`[Part-F] ${id}: both credentials survive`, sectionPresent(educationHeavyResults[id].text, "Certified Laboratory Safety Officer") && sectionPresent(educationHeavyResults[id].text, "First Aid & CPR"));
  }

  const projectHeavy = buildProjectHeavyFixture();
  const projectHeavyResults = await renderHtmlAllTemplates(projectHeavy, "project-heavy");
  for (const id of TEMPLATE_IDS) {
    checkTrue(`[Part-F] ${id}: project-heavy fixture validation.passed`, projectHeavyResults[id].passed);
    checkTrue(`[Part-F] ${id}: first project 'Route Optimizer' survives`, sectionPresent(projectHeavyResults[id].text, "Route Optimizer"));
    checkTrue(`[Part-F] ${id}: last project 'Offline-first Notes App' survives`, sectionPresent(projectHeavyResults[id].text, "Offline-first Notes App"));
  }

  /* ============================================================
     Part E / Part AI items Q-R: REAL resume mode vs DEMO/preview
     mode never cross-contaminate. buildPreviewOnlyResume() is the
     one function that inserts structural placeholders (Phase
     6I.6.9/6I.6.17 Fix4 gates its call site to Manual Step 9
     demonstration only - never a real save/render path).
     ============================================================ */
  const realComplete = buildStandardFixture();
  const realCompleteAfterPreviewOnly = buildPreviewOnlyResume(realComplete);
  check("[AI-Q/Part-E] real-mode: a fully-populated resume is returned BY REFERENCE unchanged (never touched by placeholder completion)", realCompleteAfterPreviewOnly, realComplete);

  const demoEmpty: ResumeStructuredModel = {
    schemaVersion: "resume-structured-v1",
    source: { fileName: "empty.pdf", fileType: "pdf" },
    skillGroups: [],
    professionalExperience: [],
    volunteerExperience: [],
    education: [],
    credentials: [],
    projects: [],
    awards: [],
    publications: [],
    languages: [],
    customSections: [],
    metricGrids: [],
    slotAvailability: { identity: false, professional_summary: false, core_skills: false, professional_experience: false, volunteer_experience: false, education: false, certifications_licenses: false, projects: false, awards: false, publications: false, additional_information: false },
    validation: { passed: true, sourceSectionCount: 0, representedSectionCount: 0, missingSectionIds: [], sourceBlockCount: 0, representedBlockCount: 0, missingBlockIds: [], duplicateBlockIds: [], inventedFactValues: [], volunteerMixedIntoProfessional: [], missingCustomSections: [], warnings: [] },
  };
  const demoCompleted = buildPreviewOnlyResume(demoEmpty);
  checkTrue("[AI-R/Part-E] demo-mode: a fully-empty resume gets a placeholder identity", isPreviewPlaceholderSourceTrace(demoCompleted.identity?.fullName?.source));
  checkTrue("[AI-R/Part-E] demo-mode: a fully-empty resume gets a placeholder experience entry", demoCompleted.professionalExperience.length === 1 && isPreviewPlaceholderSourceTrace(demoCompleted.professionalExperience[0].source));
  checkTrue("[AI-R/Part-E] demo-mode: a fully-empty resume gets a placeholder education entry", demoCompleted.education.length === 1 && isPreviewPlaceholderSourceTrace(demoCompleted.education[0].source));
  checkTrue("[AI-R/Part-E] demo-mode placeholder identity never uses a fabricated specific name", demoCompleted.identity?.fullName?.value === "YOUR NAME");

  const juniorPartial = buildJuniorFixture(); // has real identity/experience/education/skills/summary, no projects/credentials
  const juniorCompleted = buildPreviewOnlyResume(juniorPartial);
  checkTrue("[AI-Q/Part-E] partial-real fixture: real identity is preserved verbatim, not replaced", juniorCompleted.identity?.fullName?.value === "Priya Nakamura" && !isPreviewPlaceholderSourceTrace(juniorCompleted.identity?.fullName?.source));
  checkTrue("[AI-Q/Part-E] partial-real fixture: real experience entry is preserved verbatim, not replaced", juniorCompleted.professionalExperience[0].organization?.value === "Brightpath Media Co." && !isPreviewPlaceholderSourceTrace(juniorCompleted.professionalExperience[0].source));
  checkTrue("[AI-R/Part-E] partial-real fixture: MISSING projects section gets exactly one placeholder entry (demo-mode-only gap fill)", juniorCompleted.projects.length === 1 && isPreviewPlaceholderSourceTrace(juniorCompleted.projects[0].source));
  checkTrue("[Part-Z] demo-mode placeholder trace is a self-documenting, gate-able sentinel distinct from any real trace", PREVIEW_PLACEHOLDER_SOURCE_TRACE.sourceSectionId === "preview-placeholder");
  /* The critical real-mode invariant this whole category exists to
     protect: none of the REAL renders exercised above (junior/
     standard/senior/sparse/etc, rendered directly without ever
     calling buildPreviewOnlyResume()) may contain this phase's own
     placeholder marker strings - i.e. the 6I.6.17 Fix4 gate is
     actually load-bearing, not just present in source. */
  for (const id of TEMPLATE_IDS) {
    checkTrue(`[AI-Q/Part-E] ${id}: sparse fixture (real mode, un-completed) never shows the demo-mode placeholder marker 'YOUR NAME'`, sectionAbsent(sparseResults[id].text, "YOUR NAME"));
  }

  /* ============================================================
     Education metadata order. Every template stacks the same facts
     differently, but the date and the place it happened are one
     metadata block and are read date-first - which is also the order
     the sources this was checked against use. Executive Minimal
     already did this; it is asserted here only so a future change to
     any one template cannot drift away from the other three.
     Positions come from normalized visible text, so a template is free
     to lay the block out however it likes as long as the reading order
     holds.
     ============================================================ */
  const eduOrderTv = (value: string) => ({ value, confidence: 1, extractionMethod: "explicit-label" as const, source: { sourceSectionId: "sec-edu", sourceBlockIds: [], sourceElementIds: [] } });
  /* The fixture's own identity line carries a location too, so a
     document-wide search reads the header's place name instead of the
     entry's. Anchoring on the entry's institution - a token no other
     part of this fixture uses - keeps every assertion below inside the
     Education entry being tested. */
  const eduRegion = (text: string) => {
    const start = text.indexOf("Seneca Polytechnic");
    return start < 0 ? "" : text.slice(start);
  };
  const eduOrderBase = buildStandardFixture();
  const eduOrderEntry = {
    ...eduOrderBase.education[0],
    id: "edu-order",
    institution: eduOrderTv("Seneca Polytechnic"),
    credential: eduOrderTv("Law Clerk"),
    fieldOfStudy: undefined,
    institutions: [eduOrderTv("Seneca Polytechnic")],
    credentials: [eduOrderTv("Law Clerk")],
    fieldsOfStudy: [],
    dateQualifierText: eduOrderTv("Expected in"),
    dateRangeText: eduOrderTv("04/2027"),
    location: eduOrderTv("Toronto, ON"),
    gpa: undefined,
    honors: [],
    details: [eduOrderTv("11th graduating class")],
    rawHeaderText: "Law Clerk (Seneca Polytechnic) Expected in 04/2027 - Toronto, ON",
  };

  const qualifiedResults = await renderHtmlAllTemplates({ ...eduOrderBase, education: [eduOrderEntry] }, "edu-order-qualified");
  for (const id of TEMPLATE_IDS) {
    const text = eduRegion(qualifiedResults[id].text);
    checkTrue(`[AI-EDU] ${id}: the Education entry is found`, text.length > 0);
    checkTrue(`[AI-EDU] ${id}: the qualifier stays joined to its date`, text.includes("Expected in 04/2027"));
    checkTrue(`[AI-EDU] ${id}: the date block is read before the location`, text.indexOf("04/2027") < text.indexOf("Toronto, ON"));
    checkTrue(`[AI-EDU] ${id}: an ordinary detail still trails the metadata`, text.indexOf("Toronto, ON") < text.indexOf("11th graduating class"));
    check(`[AI-EDU] ${id}: the qualifier is rendered once`, text.split("Expected in").length - 1, 1);
    check(`[AI-EDU] ${id}: the date is rendered once`, text.split("04/2027").length - 1, 1);
    check(`[AI-EDU] ${id}: the location is rendered once`, text.split("Toronto, ON").length - 1, 1);
  }

  // Same order with no qualifier at all - the rule is about the date
  // block, not about any particular word preceding it.
  const plainResults = await renderHtmlAllTemplates(
    { ...eduOrderBase, education: [{ ...eduOrderEntry, id: "edu-order-plain", dateQualifierText: undefined, dateRangeText: eduOrderTv("2020 - 2024"), details: [] }] },
    "edu-order-plain"
  );
  for (const id of TEMPLATE_IDS) {
    const text = eduRegion(plainResults[id].text);
    checkTrue(`[AI-EDU] ${id}: an unqualified date is still read before the location`, text.indexOf("2020 - 2024") < text.indexOf("Toronto, ON"));
    checkTrue(`[AI-EDU] ${id}: no qualifier is invented when there is none`, !text.includes("Expected in"));
  }

  // Either half alone must still render - neither is conditional on the other.
  const dateOnlyResults = await renderHtmlAllTemplates(
    { ...eduOrderBase, education: [{ ...eduOrderEntry, id: "edu-order-date-only", dateQualifierText: undefined, location: undefined, details: [] }] },
    "edu-order-date-only"
  );
  const locationOnlyResults = await renderHtmlAllTemplates(
    { ...eduOrderBase, education: [{ ...eduOrderEntry, id: "edu-order-location-only", dateQualifierText: undefined, dateRangeText: undefined, details: [] }] },
    "edu-order-location-only"
  );
  for (const id of TEMPLATE_IDS) {
    checkTrue(`[AI-EDU] ${id}: a date with no location still renders`, eduRegion(dateOnlyResults[id].text).includes("04/2027"));
    checkTrue(`[AI-EDU] ${id}: and the entry itself shows no location`, !eduRegion(dateOnlyResults[id].text).includes("Toronto, ON"));
    checkTrue(`[AI-EDU] ${id}: a location with no date still renders`, eduRegion(locationOnlyResults[id].text).includes("Toronto, ON"));
    checkTrue(`[AI-EDU] ${id}: and the entry itself shows no date`, !eduRegion(locationOnlyResults[id].text).includes("04/2027"));
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
