/*
  TASK 8 - Full Fixture Gate. Runs the assembled engine
  (buildLosslessResumeDocument) against every real+synthetic fixture and
  builds a pass/fail matrix on the core lossless invariants (element
  coverage, text preservation, order preservation - i.e.
  validation.passed). The 6 synthetic fixtures also get hand-authored
  expectations (written by hand from what was PUT INTO
  generateLosslessSyntheticFixtures.mts, not derived by running the
  parser and copying its output - see spec section 13's own warning
  against tautological fixtures).

  Run with `npx tsx lib/documentPreservation/losslessSemantic/fixtureGate.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "./buildLosslessDocument";
import { adaptLayoutToBlocks } from "./blockAdapter";
import { orderBlocksForSectionDetection } from "./preSectionRegionOrdering";
import { buildStructuredResume } from "../resumeStructured/buildStructuredResume";
import type { LosslessResumeDocument } from "./types";

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

const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");

const ALL_FIXTURES: { file: string; format: "pdf" | "docx" }[] = [
  { file: "bench/resume-A-junior-ats.pdf", format: "pdf" },
  { file: "bench/resume-B-junior-canva.pdf", format: "pdf" },
  { file: "bench/resume-C-mid-ats.pdf", format: "pdf" },
  { file: "bench/resume-D-mid-canva.pdf", format: "pdf" },
  { file: "bench/resume-E-senior-ats.pdf", format: "pdf" },
  { file: "bench/resume-F-senior-canva.pdf", format: "pdf" },
  { file: "canva-pdf-resume.pdf", format: "pdf" },
  { file: "generated-sidebar-professional.pdf", format: "pdf" },
  { file: "generated-table-resume.pdf", format: "pdf" },
  { file: "google-docs-resume.docx", format: "docx" },
  { file: "regtest1-regulated-nurse-resume.docx", format: "docx" },
  { file: "regtest3-two-column-pdf.pdf", format: "pdf" },
  { file: "regtest4-repeated-tokens-pdf.pdf", format: "pdf" },
  { file: "standard-pdf-resume.pdf", format: "pdf" },
  { file: "threepage-pdf-resume.pdf", format: "pdf" },
  { file: "word-docx-resume.docx", format: "docx" },
  { file: "lossless-synthetic/f1-career-profile-awards-custom.docx", format: "docx" },
  { file: "lossless-synthetic/f2-work-history-licenses-community.docx", format: "docx" },
  { file: "lossless-synthetic/f3-combined-licenses-certifications.docx", format: "docx" },
  { file: "lossless-synthetic/f4-projects.docx", format: "docx" },
  { file: "lossless-synthetic/f5-no-heading-document.docx", format: "docx" },
  { file: "lossless-synthetic/f6-docx-table-skills.docx", format: "docx" },
];

type MatrixRow = { file: string; passed: boolean; sections: number; sourceElements: number; represented: number };
const matrix: MatrixRow[] = [];

async function runFixture(entry: { file: string; format: "pdf" | "docx" }): Promise<LosslessResumeDocument> {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, entry.file));
  const layoutResult = await analyzeDocument("resume", entry.format, buffer);
  const doc = buildLosslessResumeDocument(layoutResult, { fileName: entry.file, fileType: entry.format });

  matrix.push({
    file: entry.file,
    passed: doc.validation.passed,
    sections: doc.sections.length,
    sourceElements: doc.validation.sourceElementCount,
    represented: doc.validation.representedElementCount,
  });

  checkTrue(`${entry.file}: core lossless gate (validation.passed)`, doc.validation.passed);
  return doc;
}

function headingTexts(doc: LosslessResumeDocument): (string | null)[] {
  return doc.sections.map((s) => s.originalHeading);
}
function typeOf(doc: LosslessResumeDocument, heading: string) {
  return doc.sections.find((s) => s.originalHeading === heading)?.normalizedType;
}

async function main() {
  for (const entry of ALL_FIXTURES.filter((e) => !e.file.startsWith("lossless-synthetic/"))) {
    await runFixture(entry);
  }

  // --- F1: Career Profile + Employment History + Awards + unknown custom heading ---
  const f1 = await runFixture({ file: "lossless-synthetic/f1-career-profile-awards-custom.docx", format: "docx" });
  check("f1: Career Profile classified via alias", typeOf(f1, "Career Profile"), "summary");
  check("f1: Employment History classified via alias", typeOf(f1, "Employment History"), "experience");
  check("f1: Awards classified via alias", typeOf(f1, "Awards"), "awards");
  checkTrue(
    "f1: unknown 'Speaking & Media Appearances' heading preserved (as its own section, custom or otherwise - never dropped)",
    headingTexts(f1).includes("Speaking & Media Appearances")
  );
  check(
    "f1: unknown heading is not force-classified into a wrong known type without at least being flagged uncertain if guessed",
    f1.sections.find((s) => s.originalHeading === "Speaking & Media Appearances")?.isUncertain,
    true
  );

  // --- F2: Work History + Licenses-only + Community Involvement ---
  const f2 = await runFixture({ file: "lossless-synthetic/f2-work-history-licenses-community.docx", format: "docx" });
  check("f2: Work History classified via alias", typeOf(f2, "Work History"), "experience");
  check("f2: Licenses classified via alias", typeOf(f2, "Licenses"), "licenses");
  check("f2: Community Involvement classified via alias", typeOf(f2, "Community Involvement"), "volunteering");

  // --- F3: combined "Licenses & Certifications" + Professional Development + Publications ---
  const f3 = await runFixture({ file: "lossless-synthetic/f3-combined-licenses-certifications.docx", format: "docx" });
  checkTrue(
    "f3: combined 'Licenses & Certifications' heading preserved whole, not force-split",
    headingTexts(f3).includes("Licenses & Certifications")
  );
  check("f3: Professional Development classified via alias", typeOf(f3, "Professional Development"), "professional_development");
  check("f3: Publications classified via alias", typeOf(f3, "Publications"), "publications");

  // --- F4: Projects section ---
  const f4 = await runFixture({ file: "lossless-synthetic/f4-projects.docx", format: "docx" });
  check("f4: Projects classified via alias", typeOf(f4, "Projects"), "projects");
  checkTrue(
    "f4: project titles ('Shift Scheduler'/'Transit Delay Tracker') preserved as real text somewhere in the document",
    f4.sections.some((s) => s.rawText.includes("Shift Scheduler")) && f4.sections.some((s) => s.rawText.includes("Transit Delay Tracker"))
  );

  // --- F5: zero section headings ---
  const f5 = await runFixture({ file: "lossless-synthetic/f5-no-heading-document.docx", format: "docx" });
  check("f5: no-heading document produces exactly one fallback section", f5.sections.length, 1);
  check("f5: fallback section originalHeading is null", f5.sections[0]?.originalHeading, null);
  checkTrue(
    "f5: full narrative text preserved in the single fallback section",
    f5.sections[0]?.rawText.includes("Angela is a bilingual customer support specialist") ?? false
  );

  // --- F6: DOCX table-based resume ---
  const f6 = await runFixture({ file: "lossless-synthetic/f6-docx-table-skills.docx", format: "docx" });
  checkTrue(
    "f6: table cell content ('Power BI'/'Advanced') preserved somewhere in the document",
    f6.sections.some((s) => s.rawText.includes("Power BI")) && f6.sections.some((s) => s.rawText.includes("Advanced"))
  );

  // --- Phase 3C negative-evidence fixtures ---
  // Two single-column resumes that only LOOK columnar. They exist so a
  // future page-column/region detector has real PDFs it must never
  // misclassify; there is no such detector yet, so what is asserted here
  // is the fixtures' own validity: the geometry really is the intended
  // shape, and the current pipeline reads them as ordinary one-flow
  // resumes with no content lost.
  const railText = (doc: LosslessResumeDocument) => doc.sections.map((sec) => sec.rawText).join("\n");

  const n2 = await runFixture({ file: "single-column-right-metadata-rail.pdf", format: "pdf" });
  const n2Text = railText(n2);
  checkTrue("N2 rail: repeated right-side dates survive extraction", ["2023", "2020", "2018"].every((t) => n2Text.includes(t)));
  checkTrue("N2 rail: right-side locations survive extraction", ["Toronto, ON", "Ottawa, ON", "Montreal, QC"].every((t) => n2Text.includes(t)));
  checkTrue("N2 rail: left/main entry text survives extraction", ["Senior Reliability Engineer", "Northwind Instruments", "Gamma Precision Works"].every((t) => n2Text.includes(t)));
  checkTrue("N2 rail: full-width bullet bodies survive extraction", n2Text.includes("automated regression harness") && n2Text.includes("accelerated life-test procedures"));
  check("N2 rail: the expected single-column section order is recovered", n2.sections.map((sec) => sec.normalizedType), ["custom", "custom", "summary", "experience", "education", "skills"]);
  checkTrue("N2 rail: every section heading sits in the main left flow, none in the right rail", n2.sections.every((sec) => sec.blocks[0]?.bbox === undefined || sec.blocks[0].bbox.x < 200));

  const n3 = await runFixture({ file: "single-column-local-skills-grid.pdf", format: "pdf" });
  const n3Text = railText(n3);
  checkTrue("N3 grid: Skills grid label cells survive extraction", ["Programming:", "CAD:", "Simulation:"].every((t) => n3Text.includes(t)));
  checkTrue("N3 grid: Skills grid value cells survive extraction", ["Python, Java", "CATIA V5, NX", "ANSYS"].every((t) => n3Text.includes(t)));
  checkTrue("N3 grid: single-column content above the grid survives", n3Text.includes("thermal management assemblies") && n3Text.includes("Harrow Components"));
  checkTrue("N3 grid: single-column Education below the grid survives", n3Text.includes("Westbrook University") && n3Text.includes("finite element analysis"));
  check("N3 grid: Skills is followed by Education in the recovered order", n3.sections.map((sec) => sec.normalizedType), ["custom", "custom", "summary", "experience", "skills", "education"]);
  check("N3 grid: exactly one Skills section owns the whole grid", n3.sections.filter((sec) => sec.normalizedType === "skills").length, 1);

  /*
    --- Phase 3C: conservative multi-column / sidebar region ordering ---

    Six real fixtures whose two physical columns each open sections of
    their own, and seven that only look columnar. The engine has no way to
    tell them apart by geometry alone, so what is checked here is the
    decision itself: fires or refuses, on real PDFs. For the six positives
    the lossless gate must STILL pass - the reorder is intentional and
    exactly declared, not an excuse to lose content - and for the seven
    negatives the returned sequence must be the input sequence, block for
    block.
  */
  async function phase3c(file: string) {
    const layout = await analyzeDocument("resume", "pdf", fs.readFileSync(path.join(FIXTURES_DIR, file)));
    const { blocks } = adaptLayoutToBlocks(layout);
    const ordered = orderBlocksForSectionDetection(blocks);
    const doc = buildLosslessResumeDocument(layout, { fileName: file, fileType: "pdf" });
    return { blocks, ordered, fired: ordered !== blocks, doc, model: buildStructuredResume(doc) };
  }

  for (const file of [
    "regtest3-two-column-pdf.pdf",
    "generated-sidebar-professional.pdf",
    "bench/resume-B-junior-canva.pdf",
    "bench/resume-D-mid-canva.pdf",
    "bench/resume-F-senior-canva.pdf",
    "canva-pdf-resume.pdf",
  ]) {
    const { blocks, ordered, fired, doc } = await phase3c(file);
    checkTrue(`Phase 3C ${file}: multi-column layout is recognised`, fired);
    checkTrue(`Phase 3C ${file}: the order really changed from row-major`, ordered.map((b) => b.id).join() !== blocks.map((b) => b.id).join());
    check(`Phase 3C ${file}: output is a permutation - nothing gained or lost`, ordered.map((b) => b.id).slice().sort(), blocks.map((b) => b.id).slice().sort());
    checkTrue(`Phase 3C ${file}: the lossless gate still passes on the reordered document`, doc.validation.passed);
    check(`Phase 3C ${file}: every source element is still represented`, doc.validation.representedElementCount, doc.validation.sourceElementCount);
    check(`Phase 3C ${file}: no content was lost or invented`, [doc.validation.missingElementIds.length, doc.validation.duplicateElementIds.length, doc.validation.missingTextSpans.length, doc.validation.inventedTextSpans.length], [0, 0, 0, 0]);
  }

  for (const file of [
    "generated-table-resume.pdf",
    "single-column-right-metadata-rail.pdf",
    "single-column-local-skills-grid.pdf",
    "standard-pdf-resume.pdf",
    "bench/resume-A-junior-ats.pdf",
    "bench/resume-C-mid-ats.pdf",
    "bench/resume-E-senior-ats.pdf",
  ]) {
    const { blocks, ordered, fired, doc } = await phase3c(file);
    check(`Phase 3C ${file}: refused - not treated as page columns`, fired, false);
    check(`Phase 3C ${file}: the exact input sequence is returned`, ordered.map((b) => b.id), blocks.map((b) => b.id));
    checkTrue(`Phase 3C ${file}: ordinary validator behaviour is unchanged`, doc.validation.passed && doc.validation.orderViolations.length === 0);
  }

  // The local Skills grid must survive as Phase 3A semantics, not as columns.
  const gridGroups = (await phase3c("single-column-local-skills-grid.pdf")).model.skillGroups;
  check("Phase 3C N3: Phase 3A skill groups are exactly preserved", gridGroups.map((g) => ({ label: g.label, skills: g.skills })), [
    { label: "Programming", skills: ["Python", "Java"] },
    { label: "CAD", skills: ["CATIA V5", "NX"] },
    { label: "Simulation", skills: ["ANSYS"] },
  ]);

  await closeSharedBrowser();

  console.log("\n--- Fixture Pass/Fail Matrix ---");
  for (const row of matrix) {
    console.log(
      `${row.passed ? "PASS" : "FAIL"}  ${row.file.padEnd(55)} sections=${row.sections} elements=${row.represented}/${row.sourceElements}`
    );
  }
  const failedFixtures = matrix.filter((r) => !r.passed);
  console.log(`\n${matrix.length - failedFixtures.length}/${matrix.length} fixtures pass the core lossless gate.`);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
