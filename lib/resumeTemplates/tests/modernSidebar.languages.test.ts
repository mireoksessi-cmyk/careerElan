/*
  Modern Sidebar Languages consumption. ResumeStructuredModel.languages is
  already correctly paired by the extractor; these cases prove the template
  path now consumes those pairs instead of falling back to the raw, unpaired
  custom section, and that the raw duplicate is suppressed ONLY when its own
  source section is the one that produced the structured entries. Run with:
    npx tsx lib/resumeTemplates/tests/modernSidebar.languages.test.ts
*/
import { renderModernSidebarHtml } from "../templates/modernSidebar/html";
import { renderModernSidebarDocx } from "../templates/modernSidebar/docx";
import { extractDocx } from "../parity/docxExtraction";
import { buildFixtureResume } from "../../careerMemory/persistence/testFixtures";
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";

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

const trace = (sourceSectionId: string) => ({ sourceSectionId, sourceBlockIds: [], sourceElementIds: [] });

function paragraph(id: string, text: string, sectionId: string) {
  return { id, kind: "paragraph" as const, text, indentLevel: 0, source: trace(sectionId) };
}

function customSection(id: string, heading: string, sectionId: string, texts: string[]) {
  return {
    id,
    originalHeading: heading,
    displayHeading: heading,
    paragraphs: [],
    bullets: [],
    content: texts.map((t, i) => paragraph(`${id}-c${i}`, t, sectionId)),
    sourceOrder: 90,
    source: trace(sectionId),
  };
}

function resumeWith(options: {
  languages?: ResumeStructuredModel["languages"];
  customSections?: ResumeStructuredModel["customSections"];
}): ResumeStructuredModel {
  const resume = buildFixtureResume();
  resume.languages = options.languages ?? [];
  if (options.customSections) resume.customSections = options.customSections;
  return resume;
}

const context = (resume: ResumeStructuredModel) => ({
  resume,
  templateId: "modern-sidebar" as const,
  paperSize: "letter" as const,
  density: "balanced" as const,
  locale: "en-CA",
  photoOption: "none" as const,
  generatedAt: "2026-01-01T00:00:00.000Z",
});

/* Structured languages render one <div> per entry as "Name — Proficiency".
   Credential and publication lines elsewhere in the document also contain an
   em dash but always lead with one, so they are excluded here. */
function languageLines(html: string): string[] {
  const matches = html.match(/>([^<>]*—[^<>]*)</g) ?? [];
  return matches.map((m) => m.slice(1, -1).trim()).filter((line) => !line.startsWith("—"));
}

async function main() {
  // --- T1: same proficiency must stay paired, not collapse to four lines ---
  const sameProf = resumeWith({
    languages: [
      { name: "English", proficiency: "Native or Bilingual", source: trace("section-spoken") },
      { name: "French", proficiency: "Native or Bilingual", source: trace("section-spoken") },
    ],
    customSections: [customSection("spoken", "LANGUAGES", "section-spoken", ["English", "French", "Native or Bilingual", "Native or Bilingual"])] as ResumeStructuredModel["customSections"],
  });
  const sameProfHtml = (await renderModernSidebarHtml(context(sameProf))).html;
  check("T1 same proficiency renders exactly two paired entries", languageLines(sameProfHtml), ["English — Native or Bilingual", "French — Native or Bilingual"]);

  // --- T4: the raw duplicate from the SAME source section is suppressed ---
  checkTrue("T4 raw four-line duplicate is not rendered", !/>English<[\s\S]{0,200}>French<[\s\S]{0,200}>Native or Bilingual</.test(sameProfHtml));
  check("T4 only one Languages heading is emitted", (sameProfHtml.match(/>LANGUAGES</gi) ?? []).length, 1);

  // --- T2: different proficiencies stay with the right language ---
  const diffProf = resumeWith({
    languages: [
      { name: "English", proficiency: "Native", source: trace("section-spoken") },
      { name: "French", proficiency: "Professional Working", source: trace("section-spoken") },
    ],
  });
  check("T2 different proficiencies stay correctly paired", languageLines((await renderModernSidebarHtml(context(diffProf))).html), ["English — Native", "French — Professional Working"]);

  // --- T3: a language without proficiency renders as the bare name ---
  const noProf = resumeWith({ languages: [{ name: "Spanish", source: trace("section-spoken") }] });
  const noProfHtml = (await renderModernSidebarHtml(context(noProf))).html;
  checkTrue("T3 language without proficiency renders its name", noProfHtml.includes(">Spanish<"));
  checkTrue("T3 no undefined/null/dangling separator leaks", !/Spanish\s*—/.test(noProfHtml) && !noProfHtml.includes("undefined") && !noProfHtml.includes("Spanish — null"));

  // --- T5: a language-looking section from a DIFFERENT section is kept ---
  const mismatch = resumeWith({
    languages: [{ name: "English", proficiency: "Native", source: trace("section-spoken") }],
    customSections: [customSection("other", "LANGUAGES", "section-other", ["Klingon"])] as ResumeStructuredModel["customSections"],
  });
  checkTrue("T5 provenance mismatch keeps the raw custom content", (await renderModernSidebarHtml(context(mismatch))).html.includes("Klingon"));

  // --- T6: "Programming Languages" must never be suppressed by its heading ---
  const programming = resumeWith({
    languages: [{ name: "English", proficiency: "Native", source: trace("section-spoken") }],
    customSections: [customSection("prog", "Programming Languages", "section-programming", ["Python", "TypeScript"])] as ResumeStructuredModel["customSections"],
  });
  const progHtml = (await renderModernSidebarHtml(context(programming))).html;
  checkTrue("T6 Programming Languages survives alongside structured languages", progHtml.includes("Python") && progHtml.includes("TypeScript"));

  // --- T7: with no structured languages the raw fallback still renders ---
  const fallback = resumeWith({
    languages: [],
    customSections: [customSection("spoken", "LANGUAGES", "section-spoken", ["German", "Professional"])] as ResumeStructuredModel["customSections"],
  });
  const fallbackHtml = (await renderModernSidebarHtml(context(fallback))).html;
  checkTrue("T7 raw fallback still renders when structured languages are empty", fallbackHtml.includes("German") && fallbackHtml.includes("Professional"));

  // --- T8: source order is never re-sorted ---
  const ordered = resumeWith({
    languages: [
      { name: "French", proficiency: "Native", source: trace("section-spoken") },
      { name: "English", proficiency: "Fluent", source: trace("section-spoken") },
      { name: "Korean", proficiency: "Basic", source: trace("section-spoken") },
    ],
  });
  check("T8 source order is preserved", languageLines((await renderModernSidebarHtml(context(ordered))).html).map((l) => l.split(" — ")[0]), ["French", "English", "Korean"]);

  // --- T11: DOCX consumes the same structured entries ---
  const docx = await renderModernSidebarDocx(context(sameProf));
  const docxText = (await extractDocx(docx.bytes)).text;
  checkTrue("T11 DOCX renders both languages paired with their proficiency", docxText.includes("English — Native or Bilingual") && docxText.includes("French — Native or Bilingual"));
  check("T11 DOCX emits exactly one Languages heading", (docxText.match(/LANGUAGES/g) ?? []).length, 1);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
