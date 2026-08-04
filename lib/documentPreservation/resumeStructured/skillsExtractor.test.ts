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

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
