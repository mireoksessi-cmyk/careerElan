/*
  Phase 6I.6.18 - Three Canonical Templates Intra-Section Entry
  Spacing / Excessive Gap regression suite (modern-sidebar,
  executive-minimal, creative-timeline only - professional-ats is
  untouched by this phase and has no coverage here).

  Root cause (see this phase's own report): each template's flat
  measurement HTML omitted font-size (and the CJK fallback family),
  so Playwright measured every entry at the browser's default font
  size instead of the ~10.5pt actually used in the final page render -
  a confirmed ~60% per-entry height over-measurement that pushed the
  next same-section entry to a fresh page well before the current page
  was actually full. Fixed by mirroring pageStyles()'s font-size/
  font-family exactly in the measurement stylesheet, plus containing
  each entry's own trailing margin via display:flow-root so it can't
  collapse through the unpadded flow-item wrapper and go unmeasured.

  Uses trimmed/extended variants of the Jordan Ellis synthetic
  fixture. No DB, no AI, no network calls. Run with:
    npx tsx lib/resumeTemplates/tests/entrySpacing6I618.test.ts
*/
import { ensureTemplatesRegistered } from "../registry/bootstrap";
import { renderTemplateFromRuntime } from "../engine/renderTemplate";
import { closeSharedBrowser } from "../../documentPreservation/sharedBrowser";
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeOverlayState, createRuntimeVersion } from "../../careerMemory/runtime/factory";
import { buildJordanEllisResume } from "../../../fixtures/resumes/template-preview/jordanEllisFixture";
import { HTML_DENSITY_SPACING } from "../shared/spacing";
import type { ResumeStructuredModel, ExperienceEntry, EducationEntry, ProjectEntry, StructuredTextValue, SourceTrace } from "../../documentPreservation/resumeStructured/types";
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

const GENERATED_AT = "2026-01-01T00:00:00.000Z";
const TEMPLATES: TemplateId[] = ["modern-sidebar", "executive-minimal", "creative-timeline"];

function trace(id: string): SourceTrace {
  return { sourceSectionId: id, sourceBlockIds: [], sourceElementIds: [] };
}
function sv(value: string, id = "sec-test"): StructuredTextValue {
  return { value, confidence: 0.9, extractionMethod: "explicit-label", source: trace(id) };
}
function bullets(prefix: string, id: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `${id}-b${i}`, text: `${prefix} responsibility number ${i + 1} handled with real operational detail.`, source: trace(id) }));
}
function contentBlocks(prefix: string, id: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `${id}-c${i}`, kind: "bullet" as const, text: `${prefix} responsibility number ${i + 1} handled with real operational detail.`, source: trace(id) }));
}

function volunteerEntry(id: string, org: string, role: string, bulletCount: number): ExperienceEntry {
  return {
    id,
    organization: sv(org, id),
    role: sv(role, id),
    location: sv("Toronto, ON", id),
    startDateText: sv("Jun 2019", id),
    endDateText: sv("Aug 2020", id),
    dateRangeText: sv("Jun 2019 – Aug 2020", id),
    bullets: bullets(role, id, bulletCount),
    descriptionParagraphs: [],
    content: contentBlocks(role, id, bulletCount),
    hierarchicalContent: [],
    hasHierarchicalStructure: false,
    rawHeaderText: `${role} — ${org}`,
    source: trace(id),
    isVolunteer: true,
    isUncertain: false,
    reasonCodes: [],
  };
}

function blankVolunteerEntry(id: string): ExperienceEntry {
  return {
    id,
    organization: undefined,
    role: undefined,
    location: undefined,
    startDateText: undefined,
    endDateText: undefined,
    dateRangeText: undefined,
    bullets: [],
    descriptionParagraphs: [],
    content: [],
    hierarchicalContent: [],
    hasHierarchicalStructure: false,
    rawHeaderText: "",
    source: trace(`${id}-blank`),
    isVolunteer: true,
    isUncertain: false,
    reasonCodes: [],
  };
}

function experienceEntry(id: string, org: string, role: string, bulletCount: number): ExperienceEntry {
  return {
    id,
    organization: sv(org, id),
    role: sv(role, id),
    location: sv("Toronto, ON", id),
    startDateText: sv("Jan 2015", id),
    endDateText: sv("Dec 2018", id),
    dateRangeText: sv("Jan 2015 – Dec 2018", id),
    bullets: bullets(role, id, bulletCount),
    descriptionParagraphs: [],
    content: contentBlocks(role, id, bulletCount),
    hierarchicalContent: [],
    hasHierarchicalStructure: false,
    rawHeaderText: `${role} — ${org}`,
    source: trace(id),
    isVolunteer: false,
    isUncertain: false,
    reasonCodes: [],
  };
}

function educationEntry(id: string, institution: string): EducationEntry {
  return {
    id,
    institution: sv(institution, id),
    credential: sv("Bachelor of Arts", id),
    fieldOfStudy: sv("Sociology", id),
    credentials: [sv("Bachelor of Arts", id)],
    fieldsOfStudy: [sv("Sociology", id)],
    institutions: [sv(institution, id)],
    dateRangeText: sv("2010 – 2014", id),
    gpa: undefined,
    honors: [],
    details: [],
    rawHeaderText: institution,
    source: trace(id),
    isUncertain: false,
    reasonCodes: [],
  };
}

function projectEntry(id: string, name: string, bulletCount: number): ProjectEntry {
  return {
    id,
    name: sv(name, id),
    role: sv("Lead", id),
    dateRangeText: sv("2021", id),
    technologies: [sv("TypeScript", id)],
    bullets: bullets(name, id, bulletCount),
    descriptionParagraphs: [],
    content: contentBlocks(name, id, bulletCount),
    rawHeaderText: name,
    source: trace(id),
    isUncertain: false,
    reasonCodes: [],
  };
}

function baseResume(): ResumeStructuredModel {
  return buildJordanEllisResume();
}

async function renderBoth(templateId: TemplateId, resume: ResumeStructuredModel, id: string) {
  const runtime = createCanonicalRuntime({
    resume,
    version: createRuntimeVersion({ id, reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: resume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });
  const html = await renderTemplateFromRuntime(runtime, { templateId, generatedAt: GENERATED_AT }, "html");
  const pdf = await renderTemplateFromRuntime(runtime, { templateId, generatedAt: GENERATED_AT }, "pdf");
  return { html, pdf };
}

/* Splits the rendered HTML string into its top-level `.page` blocks in
   document order, so we can assert which literal page a given entry's
   own identifying text landed on - the most direct, template-agnostic
   way to check "did these two same-section entries share a page". */
function splitPages(html: string): string[] {
  return html.split(/<div class="page"/).slice(1);
}

async function main() {
  ensureTemplatesRegistered();

  /* --- E: entryGap < sectionGap invariant, for every density --- */
  for (const density of Object.keys(HTML_DENSITY_SPACING) as Array<keyof typeof HTML_DENSITY_SPACING>) {
    const tokens = HTML_DENSITY_SPACING[density];
    checkTrue(`E: ${density} density entryGapPx (${tokens.entryGapPx}) < sectionGapPx (${tokens.sectionGapPx})`, tokens.entryGapPx < tokens.sectionGapPx);
  }

  /* --- Fixture A: 2 short Volunteer Experience entries (Phone Banker / Court Clerk shape) --- */
  {
    const full = baseResume();
    const resume: ResumeStructuredModel = {
      ...full,
      volunteerExperience: [volunteerEntry("vol-phone", "RBC", "Phone Banker", 3), volunteerEntry("vol-clerk", "City of Toronto", "Court Clerk", 2)],
    };
    for (const templateId of TEMPLATES) {
      const { html, pdf } = await renderBoth(templateId, resume, `fixA-${templateId}`);
      const pages = splitPages(html.html);
      const phonePageIndex = pages.findIndex((p) => p.includes("Phone Banker"));
      const clerkPageIndex = pages.findIndex((p) => p.includes("Court Clerk"));
      checkTrue(`A/B/C: ${templateId} Phone Banker and Court Clerk both found on a real page`, phonePageIndex >= 0 && clerkPageIndex >= 0);
      check(`A/B/C: ${templateId} two short same-section volunteer entries share one page (no spurious mid-section page break)`, phonePageIndex, clerkPageIndex);
      const headingOccurrences = (html.html.match(/volunteer/gi) ?? []).length;
      check(`D: ${templateId} Volunteer Experience heading renders exactly once (not treated as 2 sections)`, headingOccurrences, 1);
      check(`L: ${templateId} HTML pageCount matches PDF pageCount for fixture A`, html.pageCount, pdf.pageCount);
    }
  }

  /* --- Fixture B: 3 Professional Experience entries, 4 bullets each --- */
  {
    const full = baseResume();
    const resume: ResumeStructuredModel = {
      ...full,
      professionalExperience: [experienceEntry("exp-a", "Acme Corp", "Program Coordinator", 4), experienceEntry("exp-b", "Beta Inc", "Administrative Assistant", 4), experienceEntry("exp-c", "Gamma LLC", "Operations Analyst", 4)],
    };
    for (const templateId of TEMPLATES) {
      const { html, pdf } = await renderBoth(templateId, resume, `fixB-${templateId}`);
      checkTrue(`Professional Experience: ${templateId} all 3 entries present`, html.html.includes("Program Coordinator") && html.html.includes("Administrative Assistant") && html.html.includes("Operations Analyst"));
      check(`L: ${templateId} HTML/PDF pageCount match for fixture B`, html.pageCount, pdf.pageCount);
    }
  }

  /* --- Fixture C: 2 Education entries --- */
  {
    const full = baseResume();
    const resume: ResumeStructuredModel = { ...full, education: [educationEntry("edu-a", "Western University"), educationEntry("edu-b", "Queen's University")] };
    for (const templateId of TEMPLATES) {
      const { html } = await renderBoth(templateId, resume, `fixC-${templateId}`);
      checkTrue(`G: ${templateId} multiple Education entries both render`, html.html.includes("Western University") && html.html.includes("Queen's University".replace("'", "&#x27;")) || html.html.includes("Queen's University"));
    }
  }

  /* --- Fixture D: 3 Project entries --- */
  {
    const full = baseResume();
    const resume: ResumeStructuredModel = { ...full, projects: [projectEntry("proj-a", "Inventory Rebuild", 2), projectEntry("proj-b", "Portal Migration", 2), projectEntry("proj-c", "Analytics Dashboard", 2)] };
    for (const templateId of TEMPLATES) {
      const { html } = await renderBoth(templateId, resume, `fixD-${templateId}`);
      checkTrue(`H: ${templateId} multiple Project entries all render`, html.html.includes("Inventory Rebuild") && html.html.includes("Portal Migration") && html.html.includes("Analytics Dashboard"));
    }
  }

  /* --- Fixture E/F: short-then-long and long-then-short entry pairs --- */
  {
    const full = baseResume();
    const shortThenLong: ResumeStructuredModel = { ...full, volunteerExperience: [volunteerEntry("vol-short", "Org A", "Volunteer Greeter", 1), volunteerEntry("vol-long", "Org B", "Lead Coordinator", 6)] };
    const longThenShort: ResumeStructuredModel = { ...full, volunteerExperience: [volunteerEntry("vol-long2", "Org C", "Lead Coordinator", 6), volunteerEntry("vol-short2", "Org D", "Volunteer Greeter", 1)] };
    for (const templateId of TEMPLATES) {
      const a = await renderBoth(templateId, shortThenLong, `fixE-${templateId}`);
      const b = await renderBoth(templateId, longThenShort, `fixF-${templateId}`);
      checkTrue(`J: ${templateId} short-then-long entries both render without throwing`, a.html.html.includes("Volunteer Greeter") && a.html.html.includes("Lead Coordinator"));
      checkTrue(`J: ${templateId} long-then-short entries both render without throwing`, b.html.html.includes("Volunteer Greeter") && b.html.html.includes("Lead Coordinator"));
      check(`L: ${templateId} HTML/PDF pageCount match (short-then-long)`, a.html.pageCount, a.pdf.pageCount);
      check(`L: ${templateId} HTML/PDF pageCount match (long-then-short)`, b.html.pageCount, b.pdf.pageCount);
    }
  }

  /* --- Fixture H: empty entry sandwiched between two valid volunteer entries --- */
  {
    const full = baseResume();
    const resume: ResumeStructuredModel = {
      ...full,
      volunteerExperience: [volunteerEntry("vol-phone2", "RBC", "Phone Banker", 3), blankVolunteerEntry("vol-blank"), volunteerEntry("vol-clerk2", "City of Toronto", "Court Clerk", 2)],
    };
    for (const templateId of TEMPLATES) {
      const { html } = await renderBoth(templateId, resume, `fixH-${templateId}`);
      const pages = splitPages(html.html);
      const phonePageIndex = pages.findIndex((p) => p.includes("Phone Banker"));
      const clerkPageIndex = pages.findIndex((p) => p.includes("Court Clerk"));
      check(`F: ${templateId} empty intermediate entry does not create a ghost gap - Phone Banker/Court Clerk still share one page`, phonePageIndex, clerkPageIndex);
      checkTrue(`F: ${templateId} the blank intermediate entry's own trace id never appears in output`, !html.html.includes("vol-blank-blank"));
      const headingOccurrences = (html.html.match(/volunteer/gi) ?? []).length;
      check(`D: ${templateId} heading still renders exactly once with a hidden entry sandwiched between two valid ones`, headingOccurrences, 1);
    }
  }

  /* --- Fixture G: page-boundary - enough entries to force 2+ pages, verify consistency holds --- */
  {
    const full = baseResume();
    const manyEntries = Array.from({ length: 10 }, (_, i) => experienceEntry(`exp-many-${i}`, `Company ${i}`, `Role Title ${i}`, 4));
    const resume: ResumeStructuredModel = { ...full, professionalExperience: manyEntries };
    for (const templateId of TEMPLATES) {
      const { html, pdf } = await renderBoth(templateId, resume, `fixG-${templateId}`);
      checkTrue(`K: ${templateId} page-boundary fixture spans more than 1 page`, html.pageCount > 1);
      check(`K/L: ${templateId} HTML/PDF pageCount match for the multi-page fixture`, html.pageCount, pdf.pageCount);
      for (let i = 0; i < manyEntries.length; i++) {
        checkTrue(`K: ${templateId} entry ${i} (Company ${i}) present somewhere in the output`, html.html.includes(`Company ${i}`));
      }
    }
  }

  /* --- M/N/O: hidden-section / whitespace-item / empty-bullet regressions from 6I.6.17 still hold --- */
  {
    const full = baseResume();
    const resume: ResumeStructuredModel = { ...full, projects: [], credentials: [], awards: [] };
    for (const templateId of TEMPLATES) {
      const { html } = await renderBoth(templateId, resume, `fixMNO-${templateId}`);
      checkTrue(`M: ${templateId} empty Projects section stays fully hidden (6I.6.17 regression)`, !/PROJECTS|Projects/.test(html.html.replace(/Technologies:/g, "")));
      checkTrue(`O: ${templateId} no empty <li></li> anywhere (6I.6.17 regression)`, !/<li[^>]*>\s*<\/li>/i.test(html.html));
    }
  }

  await closeSharedBrowser();
  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
