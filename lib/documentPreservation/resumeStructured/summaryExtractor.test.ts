/*
  TASK 3 gate test - summary extraction. Run with
  `npx tsx lib/documentPreservation/resumeStructured/summaryExtractor.test.ts`.
*/
import { extractSummary } from "./summaryExtractor";
import type { LosslessResumeSection, SemanticContentBlock } from "../losslessSemantic/types";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
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

function makeSection(blocks: SemanticContentBlock[]): LosslessResumeSection {
  return {
    id: "section-s1",
    originalHeading: "Summary",
    normalizedHeading: "summary",
    normalizedType: "summary",
    displayHeading: "Summary",
    sourceOrder: 1,
    startPageIndex: 0,
    endPageIndex: 0,
    confidence: 0.95,
    classificationMethod: "dictionary",
    reasonCodes: ["known-heading-alias-exact-match"],
    blocks,
    rawText: blocks.map((b) => b.rawText).join("\n"),
    isUncertain: false,
  };
}

// --- single paragraph ---
const single = makeSection([block("Summary", "heading"), block("Operations analyst with 4 years of experience.")]);
check("single paragraph: heading excluded from text", extractSummary(single).text, "Operations analyst with 4 years of experience.");
check("single paragraph: source trace covers ALL blocks including the heading", extractSummary(single).source.sourceBlockIds.length, 2);

// --- multi paragraph, order preserved ---
counter = 0;
const multi = makeSection([
  block("Summary", "heading"),
  block("First paragraph of the summary."),
  block("Second paragraph, continuing the narrative."),
]);
check(
  "multi paragraph: joined with blank line, source order preserved, no rewriting",
  extractSummary(multi).text,
  "First paragraph of the summary.\n\nSecond paragraph, continuing the narrative."
);

// --- no-heading fallback section (headingText null) ---
counter = 0;
const noHeading = makeSection([block("Just a narrative paragraph with no heading label at all.")]);
noHeading.originalHeading = null;
check("no-heading section: still extracts the full paragraph verbatim", extractSummary(noHeading).text, "Just a narrative paragraph with no heading label at all.");

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
