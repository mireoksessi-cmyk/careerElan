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

/*
  Every raw line carries its OWN source block, and a structured entry
  carries the blocks its name and proficiency came from - which is what the
  DPE emits for a one-value-per-line Languages section. The templates only
  treat structured pairs as authoritative when they are a lossless
  regrouping of that section, i.e. each of its blocks is claimed exactly
  once, so a fixture that left the block list empty (as this one first did)
  reads as "nothing to regroup" and correctly keeps the raw section.
*/
const trace = (sourceSectionId: string, sourceBlockIds: string[] = []) => ({ sourceSectionId, sourceBlockIds, sourceElementIds: [] });
const blockOf = (sectionId: string, i: number) => `${sectionId}-b${i}`;

function paragraph(id: string, text: string, sectionId: string, blockId?: string) {
  return { id, kind: "paragraph" as const, text, indentLevel: 0, source: trace(sectionId, blockId ? [blockId] : []) };
}

function customSection(id: string, heading: string, sectionId: string, texts: string[]) {
  return {
    id,
    originalHeading: heading,
    displayHeading: heading,
    paragraphs: [],
    bullets: [],
    content: texts.map((t, i) => paragraph(`${id}-c${i}`, t, sectionId, blockOf(sectionId, i))),
    sourceOrder: 90,
    source: trace(sectionId, texts.map((_, i) => blockOf(sectionId, i))),
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
      { name: "English", proficiency: "Native or Bilingual", source: trace("section-spoken", [blockOf("section-spoken", 0), blockOf("section-spoken", 2)]) },
      { name: "French", proficiency: "Native or Bilingual", source: trace("section-spoken", [blockOf("section-spoken", 1), blockOf("section-spoken", 3)]) },
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


  /*
    T12 - the source names its own section. The heading regex that decides
    sidebar-vs-main placement does not match "Idiomas del Candidato", so
    before provenance governed suppression the pairs rendered in the
    sidebar AND the raw lines rendered again in the main column.
  */
  const OWN_HEADING = "Idiomas del Candidato";
  const ownHeading = resumeWith({
    languages: [
      { name: "English", proficiency: "Native or Bilingual", source: trace("section-spoken", [blockOf("section-spoken", 0), blockOf("section-spoken", 2)]) },
      { name: "French", proficiency: "Native or Bilingual", source: trace("section-spoken", [blockOf("section-spoken", 1), blockOf("section-spoken", 3)]) },
    ],
    customSections: [
      customSection("spoken", OWN_HEADING, "section-spoken", ["English", "French", "Native or Bilingual", "Native or Bilingual"]),
      customSection("affil", "Professional Affiliations", "section-affil", ["Member, Example Association"]),
    ] as ResumeStructuredModel["customSections"],
  });
  const ownHeadingHtml = (await renderModernSidebarHtml(context(ownHeading))).html;
  check("T12 a source-named Languages section still renders both pairs", languageLines(ownHeadingHtml), ["English — Native or Bilingual", "French — Native or Bilingual"]);
  check("T12 the source heading is used, not the fixed template label", (ownHeadingHtml.match(new RegExp(OWN_HEADING, "g")) ?? []).length, 1);
  checkTrue("T12 the raw copy is not repeated in the main column", !/>English<[\s\S]{0,200}>French</.test(ownHeadingHtml));
  checkTrue("T12 an unrelated custom section is untouched", ownHeadingHtml.includes("Member, Example Association"));

  /*
    T13 - one raw line no structured entry accounts for. Pairing would have
    to drop it, so the whole section stays raw.
  */
  const NOTE = "Certified interpreter since 2019";
  const partial = resumeWith({
    languages: [{ name: "English", proficiency: "Native or Bilingual", source: trace("section-spoken", [blockOf("section-spoken", 0), blockOf("section-spoken", 1)]) }],
    customSections: [customSection("spoken", "LANGUAGES", "section-spoken", ["English", "Native or Bilingual", NOTE])] as ResumeStructuredModel["customSections"],
  });
  const partialHtml = (await renderModernSidebarHtml(context(partial))).html;
  checkTrue("T13 the unaccounted line is never dropped", partialHtml.includes(NOTE));
  check("T13 incomplete coverage declines pairing", languageLines(partialHtml), []);
  checkTrue("T13 the raw lines still render", partialHtml.includes("English") && partialHtml.includes("Native or Bilingual"));

  /*
    T14 - both entries came from ONE inline line, which already reads as
    correctly paired prose. Re-emitting it as two rows would discard the
    document's own punctuation, so the raw line is preserved verbatim.
  */
  const INLINE = "English (fluent), Italian (native)";
  const inline = resumeWith({
    languages: [
      { name: "English", proficiency: "fluent", source: trace("section-spoken", [blockOf("section-spoken", 0)]) },
      { name: "Italian", proficiency: "native", source: trace("section-spoken", [blockOf("section-spoken", 0)]) },
    ],
    customSections: [customSection("spoken", "LANGUAGES", "section-spoken", [INLINE])] as ResumeStructuredModel["customSections"],
  });
  const inlineHtml = (await renderModernSidebarHtml(context(inline))).html;
  checkTrue("T14 the original inline line is preserved verbatim", inlineHtml.includes(INLINE));
  check("T14 one shared source block declines pairing", languageLines(inlineHtml), []);

  /* T12-T14 make the same decision in DOCX. */
  const ownHeadingDocxText = (await extractDocx((await renderModernSidebarDocx(context(ownHeading))).bytes)).text;
  const partialDocxText = (await extractDocx((await renderModernSidebarDocx(context(partial))).bytes)).text;
  const inlineDocxText = (await extractDocx((await renderModernSidebarDocx(context(inline))).bytes)).text;
  checkTrue("T12 DOCX pairs the same two entries under the source heading", ownHeadingDocxText.includes("English — Native or Bilingual") && ownHeadingDocxText.includes("French — Native or Bilingual"));
  check("T12 DOCX emits the source heading exactly once", (ownHeadingDocxText.match(new RegExp(OWN_HEADING, "gi")) ?? []).length, 1);
  checkTrue("T13 DOCX keeps the unaccounted line", partialDocxText.includes(NOTE) && !partialDocxText.includes("English — Native or Bilingual"));
  checkTrue("T14 DOCX keeps the inline line verbatim", inlineDocxText.includes(INLINE) && !inlineDocxText.includes("English — fluent"));
  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
