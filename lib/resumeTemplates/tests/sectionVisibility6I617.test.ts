/*
  Phase 6I.6.17 - Canonical Templates Real-Data Section Visibility,
  Empty-Item Filtering & Section Spacing regression suite. Covers:
    - Professional ATS Education standalone-bullet root cause (H)
    - Empty/whitespace-only sections hidden across all 4 templates (A-D)
    - Whitespace-only items never render as empty bullets (E/F)
    - Mixed empty+valid entries -> only the valid entry renders (G)
    - Real content is never altered (I)
  Uses trimmed/mutated variants of the Jordan Ellis synthetic fixture,
  same convention as unicodeAndEdgeCases.test.ts. No DB, no AI, no
  network calls. Run with:
    npx tsx lib/resumeTemplates/tests/sectionVisibility6I617.test.ts
*/
import { ensureTemplatesRegistered } from "../registry/bootstrap";
import { renderTemplateFromRuntime } from "../engine/renderTemplate";
import { closeSharedBrowser } from "../../documentPreservation/sharedBrowser";
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeOverlayState, createRuntimeVersion } from "../../careerMemory/runtime/factory";
import { buildJordanEllisResume } from "../../../fixtures/resumes/template-preview/jordanEllisFixture";
import type { ResumeStructuredModel, EducationEntry, StructuredTextValue, SourceTrace } from "../../documentPreservation/resumeStructured/types";
import type { TemplateId } from "../contracts/types";

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
function checkFalse(label: string, actual: boolean) {
  check(label, actual, false);
}

const GENERATED_AT = "2026-01-01T00:00:00.000Z";
const TEMPLATES: TemplateId[] = ["professional-ats", "modern-sidebar", "executive-minimal", "creative-timeline"];

function trace(id: string): SourceTrace {
  return { sourceSectionId: id, sourceBlockIds: [], sourceElementIds: [] };
}
function sv(value: string, id = "sec-test"): StructuredTextValue {
  return { value, confidence: 0.9, extractionMethod: "explicit-label", source: trace(id) };
}

/* An education entry every field of which is blank/whitespace-only - must never contribute a heading or a bullet. */
function blankEducationEntry(id: string): EducationEntry {
  return {
    id,
    institution: sv("   "),
    credential: sv(""),
    fieldOfStudy: undefined,
    credentials: [],
    fieldsOfStudy: [],
    institutions: [],
    dateRangeText: undefined,
    honors: [sv("  "), sv("\t")],
    details: [sv("")],
    rawHeaderText: "",
    source: trace("sec-edu-blank"),
    isUncertain: false,
    reasonCodes: [],
  };
}

/* A REAL, valid education entry whose honors/details ALSO contain
   blank/whitespace items mixed in with real ones - the exact PART G
   case 7 shape (an otherwise-valid entry with an empty bullet). */
function validEducationWithBlankBullet(id: string): EducationEntry {
  return {
    id,
    institution: sv("Test University", "sec-edu-valid"),
    credential: sv("Bachelor of Science", "sec-edu-valid"),
    fieldOfStudy: sv("Computer Science", "sec-edu-valid"),
    credentials: [sv("Bachelor of Science", "sec-edu-valid")],
    fieldsOfStudy: [sv("Computer Science", "sec-edu-valid")],
    institutions: [sv("Test University", "sec-edu-valid")],
    dateRangeText: sv("2010 – 2014", "sec-edu-valid"),
    honors: [sv("Deans List"), sv("   "), sv("")],
    details: [sv("")],
    rawHeaderText: "Bachelor of Science — Test University — 2010 – 2014",
    source: trace("sec-edu-valid"),
    isUncertain: false,
    reasonCodes: [],
  };
}

function withEducation(entries: EducationEntry[]): ResumeStructuredModel {
  const full = buildJordanEllisResume();
  return { ...full, education: entries, projects: [], credentials: [], awards: [], publications: [], customSections: [] };
}

/* Empty-shell entries for projects/credentials/awards - all fields blank. */
function withEmptySections(): ResumeStructuredModel {
  const full = buildJordanEllisResume();
  return {
    ...full,
    education: [],
    projects: [{ id: "proj-blank", name: sv("   "), role: undefined, dateRangeText: undefined, technologies: [], bullets: [], descriptionParagraphs: [], content: [], rawHeaderText: "", source: trace("sec-proj-blank"), isUncertain: false, reasonCodes: [] }],
    credentials: [{ id: "cred-blank", name: sv(""), issuer: undefined, credentialId: undefined, issueDateText: undefined, expiryDateText: undefined, location: undefined, names: [], issuers: [], details: [sv(" ")], kind: "certification", rawHeaderText: "", source: trace("sec-cred-blank"), isUncertain: false, reasonCodes: [] }],
    awards: [{ id: "award-blank", name: sv("\t"), issuer: undefined, dateText: undefined, names: [], details: [], content: [], rawHeaderText: "", source: trace("sec-award-blank"), isUncertain: false, reasonCodes: [] }],
    publications: [],
    customSections: [],
  };
}

async function renderHtml(templateId: TemplateId, resume: ResumeStructuredModel, id: string): Promise<string> {
  const runtime = createCanonicalRuntime({
    resume,
    version: createRuntimeVersion({ id, reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: resume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });
  const result = await renderTemplateFromRuntime(runtime, { templateId, generatedAt: GENERATED_AT }, "html");
  return result.html;
}

/* Matches an unfilled bullet: <li></li>, <li> </li>, or a bullet whose
   only content is whitespace before the closing tag. */
const EMPTY_LI_RE = /<li[^>]*>\s*<\/li>/i;

async function main() {
  ensureTemplatesRegistered();

  /* --- H: Professional ATS Education standalone-bullet regression --- */
  {
    const resume = withEducation([validEducationWithBlankBullet("edu-h")]);
    const html = await renderHtml("professional-ats", resume, "h-repro");
    checkFalse("H: professional-ats no empty <li></li> for education with a blank bullet mixed in", EMPTY_LI_RE.test(html));
    checkTrue("H: professional-ats still renders the real honor 'Deans List'", html.includes("Deans List"));
    checkTrue("H: professional-ats still renders EDUCATION heading (entry has real fields)", html.includes("EDUCATION"));
  }

  /* --- G / F: mixed blank+valid education entry, all 4 templates --- */
  for (const templateId of TEMPLATES) {
    const resume = withEducation([blankEducationEntry("edu-blank"), validEducationWithBlankBullet("edu-valid")]);
    const html = await renderHtml(templateId, resume, `mixed-${templateId}`);
    checkFalse(`G/F: ${templateId} no empty <li></li> in mixed blank+valid education`, EMPTY_LI_RE.test(html));
    checkTrue(`G/F: ${templateId} the valid entry's institution 'Test University' renders`, html.includes("Test University"));
    checkFalse(`G/F: ${templateId} the blank entry contributes no stray content`, html.includes("sec-edu-blank"));
  }

  /* --- A-D: empty-shell Projects/Credentials/Awards hidden, all 4 templates --- */
  for (const templateId of TEMPLATES) {
    const resume = withEmptySections();
    const html = await renderHtml(templateId, resume, `empty-${templateId}`);
    checkFalse(`A-D: ${templateId} no PROJECTS heading for an all-blank project entry`, /PROJECTS|Projects/.test(html));
    checkFalse(`A-D: ${templateId} no CERTIFICATIONS/CREDENTIALS heading for an all-blank credential entry`, /CERTIFICATIONS|CREDENTIALS|Credentials/.test(html));
    checkFalse(`A-D: ${templateId} no AWARDS heading for an all-blank award entry`, /AWARDS|Awards/.test(html));
    checkFalse(`A-D: ${templateId} no empty <li></li> anywhere`, EMPTY_LI_RE.test(html));
  }

  /* --- I: real, fully-populated content is never altered by this phase's changes --- */
  {
    const resume = buildJordanEllisResume();
    for (const templateId of TEMPLATES) {
      const html = await renderHtml(templateId, resume, `full-${templateId}`);
      checkTrue(`I: ${templateId} full fixture still contains 'Jordan Ellis'`, html.includes("Jordan Ellis"));
      checkTrue(`I: ${templateId} full fixture still contains real education 'York University'`, html.includes("York University"));
      checkTrue(`I: ${templateId} full fixture still contains real honor 'Summa Cum Laude'`, html.includes("Summa Cum Laude"));
    }
  }

  await closeSharedBrowser();
  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
