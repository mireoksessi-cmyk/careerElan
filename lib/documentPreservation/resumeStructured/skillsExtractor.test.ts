/*
  TASK 3 gate test - skills extraction. Synthetic unit tests calibrated
  against real fixture shapes already verified via the dev inspection
  API (regtest4-repeated-tokens-pdf.pdf, lossless-synthetic/f6, bench/
  resume-E-senior-ats.pdf). Run with
  `npx tsx lib/documentPreservation/resumeStructured/skillsExtractor.test.ts`.
*/
import { extractSkillGroups } from "./skillsExtractor";
import type { SemanticContentBlock } from "../losslessSemantic/types";

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

let counter = 0;
function block(text: string, blockType: SemanticContentBlock["blockType"] = "paragraph"): SemanticContentBlock {
  const i = counter++;
  return {
    id: `block-p0-b${i}`,
    sourceElementIds: [`el-p0-e${i}`],
    text,
    rawText: text,
    pageIndex: 0,
    sourceOrder: i,
    blockType,
  };
}

// --- comma-separated single line (regtest4/f4 real shape) ---
const comma = extractSkillGroups("s1", [block("React, TypeScript, Node.js, Express, PostgreSQL, Git")]);
check("comma-separated: split into individual skills, order preserved", comma[0]?.skills, ["React", "TypeScript", "Node.js", "Express", "PostgreSQL", "Git"]);
check("comma-separated: ungrouped (no label)", comma[0]?.label, undefined);
check("comma-separated: single group produced", comma.length, 1);

// --- category label lines (spec section 8's own example) ---
counter = 0;
const labeled = extractSkillGroups("s1", [block("Technical Skills: Excel, SQL, Power BI"), block("Languages: English, Korean, French")]);
check("category label: two distinct groups", labeled.length, 2);
check("category label: first group label+skills", [labeled[0].label, labeled[0].skills], ["Technical Skills", ["Excel", "SQL", "Power BI"]]);
check("category label: second group label+skills", [labeled[1].label, labeled[1].skills], ["Languages", ["English", "Korean", "French"]]);

// --- single multi-word skill phrase never split into words ---
counter = 0;
const phrase = extractSkillGroups("s1", [block("Communication Skills")]);
check("single skill phrase: not split into individual words", phrase[0]?.skills, ["Communication Skills"]);

// --- sentence-shaped line is NOT treated as a skill list, but its
// block is still traced (never silently dropped from coverage) ---
counter = 0;
const sentenceBlock = block("Managed a team of 5, collaborated with stakeholders, and delivered results.");
const sentence = extractSkillGroups("s1", [sentenceBlock]);
check("sentence-shaped line (ends in period): not extracted as skills", sentence[0]?.skills, []);
check("sentence-shaped line: block still covered by a (skill-less) group source", sentence[0]?.source.sourceBlockIds, [sentenceBlock.id]);

// --- DOCX table / level-suffix shape (real fixture f6) ---
counter = 0;
const tableRows = extractSkillGroups("s1", [
  block("Skill Level"),
  block("Excel Advanced"),
  block("SQL Intermediate"),
  block("Power BI Advanced"),
]);
check("table/level-row shape: multi-word skill name with level suffix stripped correctly", tableRows[0]?.skills, ["Excel", "SQL", "Power BI"]);
checkTrue("table/level-row shape: header row block still counted in source trace (block coverage)", tableRows[0]?.source.sourceBlockIds.length === 4);

// --- bullet-separated skills ---
counter = 0;
const bullets = extractSkillGroups("s1", [block("• Excel", "bullet"), block("• Power BI", "bullet"), block("• SQL", "bullet")]);
check("bullet-separated: each bullet becomes one skill, glyph stripped", bullets[0]?.skills, ["Excel", "Power BI", "SQL"]);

// --- real fixture phrase-with-internal-punctuation not over-split (bench-E shape) ---
counter = 0;
const complexPhrases = extractSkillGroups("s1", [
  block("Multi-site operations leadership, P&L management, Lean manufacturing / Kaizen, Health and safety leadership"),
]);
check(
  "complex real-shaped phrases: split only at commas, internal punctuation preserved",
  complexPhrases[0]?.skills,
  ["Multi-site operations leadership", "P&L management", "Lean manufacturing / Kaizen", "Health and safety leadership"]
);

// --- empty section ---
counter = 0;
check("empty body blocks: yields zero groups", extractSkillGroups("s1", []), []);

// --- Phase 3A: colon-marked spatial skill grid ---
// A two-column layout where the category and its members are separate
// blocks. Geometry only says which cells share a row; the trailing colon
// is what proves the left cell is a category. Unmarked grids stay with
// the existing flat behaviour.
function cell(text: string, x: number, y: number, width: number, page = 0): SemanticContentBlock {
  const i = counter++;
  return {
    id: `block-p${page}-b${i}`,
    sourceElementIds: [`el-p${page}-e${i}`],
    text,
    rawText: text,
    pageIndex: page,
    sourceOrder: i,
    blockType: "paragraph",
    bbox: { x, y, width, height: 10 },
  };
}
function gridRows(pairs: Array<[string, string]>, page = 0): SemanticContentBlock[] {
  return pairs.flatMap(([left, right], i) => [cell(left, 40, 100 + i * 18, 60, page), cell(right, 220, 100 + i * 18, 90, page)]);
}

// P3A-1 - the primary shape: three colon-marked rows become three groups.
counter = 0;
{
  const groups = extractSkillGroups("s1", gridRows([
    ["Programming:", "Python, Java"],
    ["CAD:", "CATIA V5, NX"],
    ["Simulation:", "ANSYS"],
  ]));
  check("P3A grid: three colon-marked rows become three groups", groups.length, 3);
  check("P3A grid: row order preserved", groups.map((g) => g.label), ["Programming", "CAD", "Simulation"]);
  check("P3A grid: multi-value right cell is split", groups[0]?.skills, ["Python", "Java"]);
  check("P3A grid: multi-word member preserved", groups[1]?.skills, ["CATIA V5", "NX"]);
  check("P3A grid: single-value right cell yields one skill", groups[2]?.skills, ["ANSYS"]);
  check("P3A grid: label normalization strips the trailing colon", groups[0]?.label, "Programming");
  check("P3A grid: no label retains a colon", groups.some((g) => (g.label ?? "").includes(":")), false);
}

// P3A-2 - provenance: each group traces to its own row's two blocks.
counter = 0;
{
  const blocks = gridRows([
    ["Programming:", "Python, Java"],
    ["CAD:", "CATIA V5, NX"],
  ]);
  const groups = extractSkillGroups("s1", blocks);
  check("P3A provenance: first group traces to its own left+right blocks", groups[0]?.source.sourceBlockIds, [blocks[0].id, blocks[1].id]);
  check("P3A provenance: second group traces to its own left+right blocks", groups[1]?.source.sourceBlockIds, [blocks[2].id, blocks[3].id]);
  check("P3A provenance: element ids come from the same two blocks", groups[0]?.source.sourceElementIds, [blocks[0].sourceElementIds[0], blocks[1].sourceElementIds[0]]);
  check("P3A provenance: section id preserved", groups[0]?.source.sourceSectionId, "s1");
  check("P3A provenance: no leakage from another row", groups[0]?.source.sourceBlockIds.includes(blocks[2].id), false);
}

// P3A-3 - NEGATIVE: an unmarked grid has no category evidence (Phase 3B).
counter = 0;
{
  const groups = extractSkillGroups("s1", gridRows([
    ["Programming", "Python"],
    ["CAD", "CATIA"],
    ["Simulation", "ANSYS"],
  ]));
  check("P3A unmarked grid: no labelled groups are invented", groups.some((g) => g.label !== undefined), false);
  check("P3A unmarked grid: falls back to a single flat group", groups.length, 1);
}

// P3A-4 - NEGATIVE: two independent skill columns must never be paired.
counter = 0;
{
  const groups = extractSkillGroups("s1", gridRows([
    ["Python", "Leadership"],
    ["MATLAB", "Communication"],
    ["CATIA", "Teamwork"],
  ]));
  check("P3A independent columns: no labelled groups", groups.some((g) => g.label !== undefined), false);
  check("P3A independent columns: every term survives as a skill", groups[0]?.skills, ["Python", "Leadership", "MATLAB", "Communication", "CATIA", "Teamwork"]);
}

// P3A-5 - NEGATIVE: tool/tool columns are equally ineligible.
counter = 0;
{
  const groups = extractSkillGroups("s1", gridRows([
    ["Python", "Java"],
    ["MATLAB", "Simulink"],
    ["CATIA", "NX"],
  ]));
  check("P3A tool columns: no labelled groups", groups.some((g) => g.label !== undefined), false);
}

// P3A-6 - NEGATIVE: a single pair is not repeated-grid evidence.
counter = 0;
{
  const groups = extractSkillGroups("s1", gridRows([["Programming:", "Python"]]));
  check("P3A single pair: no labelled grid group", groups.some((g) => g.label === "Programming"), false);
}

// P3A-7 - NEGATIVE: rows on different pages are never one grid.
counter = 0;
{
  const groups = extractSkillGroups("s1", [
    ...gridRows([["Programming:", "Python, Java"]], 0),
    ...gridRows([["CAD:", "CATIA, NX"]], 1),
  ]);
  check("P3A cross-page: no labelled grid group", groups.some((g) => g.label === "Programming"), false);
}

// P3A-8 - NEGATIVE: a three-column row is out of scope this phase.
counter = 0;
{
  const groups = extractSkillGroups("s1", [
    cell("Language:", 40, 100, 55), cell("Level", 220, 100, 30), cell("Cert", 340, 100, 30),
    cell("French:", 40, 118, 40), cell("B1", 220, 118, 15), cell("DELF", 340, 118, 30),
  ]);
  check("P3A three columns: no labelled grid group", groups.some((g) => g.label !== undefined), false);
}

// P3A-9 - NEGATIVE: a missing right cell refuses the whole grid.
counter = 0;
{
  const groups = extractSkillGroups("s1", [
    cell("Programming:", 40, 100, 60), cell("Python, Java", 220, 100, 90),
    cell("CAD:", 40, 118, 40),
  ]);
  check("P3A empty cell: no labelled grid group", groups.some((g) => g.label !== undefined), false);
}

// P3A-10 - NEGATIVE: blocks without geometry cannot form a grid.
counter = 0;
{
  const groups = extractSkillGroups("s1", [
    block("Programming:"), block("Python, Java"),
    block("CAD:"), block("CATIA, NX"),
  ]);
  check("P3A no geometry: no labelled grid group", groups.some((g) => g.label !== undefined), false);
}

// P3A-11 - NEGATIVE: bullets keep their existing list behaviour.
counter = 0;
{
  const bulletCell = (text: string, x: number, y: number): SemanticContentBlock => {
    const b = cell(text, x, y, 50);
    return { ...b, blockType: "bullet" };
  };
  const groups = extractSkillGroups("s1", [
    bulletCell("Programming:", 40, 100), bulletCell("Python, Java", 220, 100),
    bulletCell("CAD:", 40, 118), bulletCell("CATIA, NX", 220, 118),
  ]);
  check("P3A bullets: no labelled grid group", groups.some((g) => g.label !== undefined), false);
}

// P3A-12 - NEGATIVE: an already-fused textual line stays on the textual route.
counter = 0;
{
  const groups = extractSkillGroups("s1", [
    cell("Programming: Python, Java", 40, 100, 200),
    cell("CAD: CATIA, NX", 40, 118, 190),
  ]);
  check("P3A fused line: existing textual route still produces both groups", groups.map((g) => g.label), ["Programming", "CAD"]);
  check("P3A fused line: existing textual skills unchanged", groups[0]?.skills, ["Python", "Java"]);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
