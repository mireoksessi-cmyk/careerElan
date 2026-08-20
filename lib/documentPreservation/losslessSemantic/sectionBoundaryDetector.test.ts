/*
  TASK 4 gate test - heading candidate scoring + boundary segmentation
  against real fixtures, plus synthetic unit-level checks for the
  no-heading fallback and the date-range disqualifier. Run with
  `npx tsx lib/documentPreservation/losslessSemantic/sectionBoundaryDetector.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { adaptLayoutToBlocks } from "./blockAdapter";
import { detectSectionBoundaries, scoreHeadingCandidates } from "./sectionBoundaryDetector";
import type { SemanticContentBlock } from "./types";

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

function makeBlock(overrides: Partial<SemanticContentBlock>): SemanticContentBlock {
  return {
    id: `block-p0-b${overrides.sourceOrder ?? 0}`,
    sourceElementIds: [`el-p0-e${overrides.sourceOrder ?? 0}`],
    text: "",
    rawText: "",
    pageIndex: 0,
    sourceOrder: 0,
    blockType: "paragraph",
    ...overrides,
  };
}

async function detectFromFixture(fileName: string, sourceFormat: "pdf" | "docx") {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, fileName));
  const layoutResult = await analyzeDocument("resume", sourceFormat, buffer);
  const { blocks } = adaptLayoutToBlocks(layoutResult);
  return { blocks, result: detectSectionBoundaries(blocks) };
}

function headingTexts(result: ReturnType<typeof detectSectionBoundaries>): (string | null)[] {
  return result.sections.map((s) => s.headingText);
}

async function main() {
  // --- real fixture: standard PDF resume ---
  const { blocks: pdfBlocks, result: pdfResult } = await detectFromFixture("standard-pdf-resume.pdf", "pdf");
  checkTrue("standard-pdf-resume: at least 2 section boundaries detected", pdfResult.sections.length >= 2);
  checkTrue(
    "standard-pdf-resume: a Summary-like or Experience-like heading was detected",
    headingTexts(pdfResult).some((h) => h !== null && /summary|experience|profile/i.test(h))
  );
  checkTrue(
    "standard-pdf-resume: every section's block range is non-empty and in bounds",
    pdfResult.sections.every((s) => s.startBlockIndex <= s.endBlockIndex && s.endBlockIndex < pdfBlocks.length)
  );
  // Section ranges must partition [firstHeadingIndex, blocks.length) with no gaps/overlaps.
  let coversWithoutGap = true;
  for (let i = 1; i < pdfResult.sections.length; i++) {
    if (pdfResult.sections[i].startBlockIndex !== pdfResult.sections[i - 1].endBlockIndex + 1) coversWithoutGap = false;
  }
  checkTrue("standard-pdf-resume: consecutive sections have no gap/overlap", coversWithoutGap);
  const identityPlusSections = pdfResult.identityBlockIndices.length + (pdfResult.sections[0]?.startBlockIndex ?? 0);
  check("standard-pdf-resume: identity blocks end exactly where first section starts", identityPlusSections, pdfResult.sections[0]?.startBlockIndex ?? 0);
  // Regression: real bug found via manual dev-UI verification (TASK 7) -
  // job-title/entry-header lines like "Operations Analyst" share the
  // exact body font size (no bold weight available for this PDF) and
  // were false-positively scored as headings purely from short-length +
  // title-case, fragmenting Experience into extra pseudo-sections. Fixed
  // by requiring a structural signal (font-size bump or bold) in
  // addition to shape signals, unless the alias dictionary matched.
  checkTrue(
    "standard-pdf-resume: job-title entry-header lines ('Operations Analyst'/'Junior Analyst') are NOT detected as their own section headings",
    !headingTexts(pdfResult).some((h) => h === "Operations Analyst" || h === "Junior Analyst")
  );

  // --- real fixture: DOCX resume ---
  const { result: docxResult } = await detectFromFixture("word-docx-resume.docx", "docx");
  checkTrue("word-docx-resume: at least 2 section boundaries detected", docxResult.sections.length >= 2);

  // --- real fixture: 2-column PDF (continuity with TASK 3's own regression coverage) ---
  const { result: twoColumnResult } = await detectFromFixture("regtest3-two-column-pdf.pdf", "pdf");
  checkTrue("regtest3-two-column-pdf: at least 2 section boundaries detected", twoColumnResult.sections.length >= 2);

  // --- real fixture: bench senior ATS resume containing "Board & Leadership Activities" custom heading ---
  const { result: benchResult } = await detectFromFixture(
    path.join("bench", "resume-E-senior-ats.pdf"),
    "pdf"
  );
  checkTrue("resume-E-senior-ats: at least 1 section boundary detected", benchResult.sections.length >= 1);

  await closeSharedBrowser();

  // --- synthetic unit tests: no-heading fallback ---
  const noHeadingBlocks: SemanticContentBlock[] = [
    makeBlock({ sourceOrder: 0, text: "John Smith - a long paragraph of running prose with no headings at all in it whatsoever", rawText: "John Smith - a long paragraph of running prose with no headings at all in it whatsoever" }),
    makeBlock({ sourceOrder: 1, text: "It just keeps going, one continuous narrative block describing the person's whole career without any structural breaks.", rawText: "It just keeps going, one continuous narrative block describing the person's whole career without any structural breaks." }),
  ];
  const noHeadingResult = detectSectionBoundaries(noHeadingBlocks);
  check("no-heading document: exactly one fallback section", noHeadingResult.sections.length, 1);
  check("no-heading document: fallback section headingText is null", noHeadingResult.sections[0].headingText, null);
  check("no-heading document: fallback section covers the entire block range", [noHeadingResult.sections[0].startBlockIndex, noHeadingResult.sections[0].endBlockIndex], [0, 1]);
  check("no-heading document: zero identity blocks (nothing pulled out ahead of a heading that doesn't exist)", noHeadingResult.identityBlockIndices, []);

  // --- synthetic unit tests: date-range disqualifier ---
  const dateRangeBlock = makeBlock({ sourceOrder: 0, text: "Senior Developer, 2020 - Present", rawText: "Senior Developer, 2020 - Present", blockType: "entry-header", style: { fontWeight: 700 } });
  const candidatesForDateLine = scoreHeadingCandidates([dateRangeBlock]);
  check("date-range job-title line is NOT scored as a heading candidate despite bold+short+title-case", candidatesForDateLine.length, 0);

  // --- synthetic unit tests: single weak signal alone never confirms a heading ---
  const boldOnlyBlock = makeBlock({ sourceOrder: 0, text: "Managed a cross-functional team of 12 engineers across three product lines", rawText: "Managed a cross-functional team of 12 engineers across three product lines", style: { fontWeight: 700 } });
  check("a long bold sentence (bold-only signal) is NOT scored as a heading candidate", scoreHeadingCandidates([boldOnlyBlock]).length, 0);

  const allCapsOnlyLongBlock = makeBlock({ sourceOrder: 0, text: "ACME CORPORATION GLOBAL TECHNOLOGY SOLUTIONS DIVISION HEADQUARTERS", rawText: "ACME CORPORATION GLOBAL TECHNOLOGY SOLUTIONS DIVISION HEADQUARTERS" });
  check(
    "a long ALL-CAPS line exceeding heading length (all-caps-only, over length threshold) is NOT scored as a heading candidate",
    scoreHeadingCandidates([allCapsOnlyLongBlock]).length,
    0
  );

  // --- synthetic unit test: known alias combined with short length clears threshold ---
  const summaryHeadingBlock = makeBlock({ sourceOrder: 0, text: "Professional Summary", rawText: "Professional Summary" });
  check("a known alias heading ('Professional Summary') IS scored as a heading candidate", scoreHeadingCandidates([summaryHeadingBlock]).length, 1);


  /*
    Section tier vs entry tier. A resume sets its section titles at one
    size and the entry titles inside them at a smaller one, and both are
    larger than body text - so the size the document's own alias-matched
    headings use is what tells the two apart. Built synthetically so the
    rule is exercised directly, with enough body blocks that the median
    body size is unambiguous.
  */
  const tierBody = (order: number, size: number) =>
    makeBlock({ sourceOrder: order, text: `Body prose line ${order} carrying ordinary sentence content for the median.`, rawText: `Body prose line ${order} carrying ordinary sentence content for the median.`, style: { fontSize: size } });
  const tierHeading = (order: number, text: string, size: number) =>
    makeBlock({ sourceOrder: order, text, rawText: text, style: { fontSize: size } });
  const candidateTexts = (bs: SemanticContentBlock[]) => scoreHeadingCandidates(bs).map((c) => bs[c.blockIndex].text);

  // Alias sections at 14, an entry title at 11, a genuine custom section
  // at 14, over body text at 10.
  const tierBlocks: SemanticContentBlock[] = [
    tierHeading(0, "Professional Summary", 14),
    tierBody(1, 10), tierBody(2, 10), tierBody(3, 10),
    tierHeading(4, "Work History", 14),
    tierHeading(5, "Senior Widget Wrangler", 11),
    tierBody(6, 10), tierBody(7, 10), tierBody(8, 10),
    tierHeading(9, "SELECTED PRESS", 14),
    tierBody(10, 10), tierBody(11, 10), tierBody(12, 10),
  ];
  const tierCandidates = scoreHeadingCandidates(tierBlocks);
  const tierTexts = tierCandidates.map((c) => tierBlocks[c.blockIndex].text);
  // The custom heading must be earning its place typographically, not lexically.
  check("section tier: the custom heading is genuinely unaliased", tierCandidates.find((c) => tierBlocks[c.blockIndex].text === "SELECTED PRESS")?.reasonCodes.includes("known-heading-alias"), false);
  checkTrue("section tier: an alias section heading is kept", tierTexts.includes("Professional Summary"));
  checkTrue("section tier: every alias section heading is kept", tierTexts.includes("Work History"));
  checkTrue("section tier: an unaliased heading at the section tier is kept", tierTexts.includes("SELECTED PRESS"));
  checkTrue("section tier: an entry title below the section tier is not a boundary", !tierTexts.includes("Senior Widget Wrangler"));
  check("section tier: exactly the three section headings survive", tierTexts, ["Professional Summary", "Work History", "SELECTED PRESS"]);

  // Above the tier is still a section - the rule is a floor, not a band.
  const aboveTierBlocks: SemanticContentBlock[] = [
    tierHeading(0, "Professional Summary", 14),
    tierBody(1, 10), tierBody(2, 10), tierBody(3, 10),
    tierHeading(4, "SELECTED PRESS", 18),
    tierBody(5, 10), tierBody(6, 10), tierBody(7, 10),
  ];
  checkTrue("section tier: an unaliased heading above the section tier is kept", candidateTexts(aboveTierBlocks).includes("SELECTED PRESS"));

  // The floor is the SMALLEST alias heading, so an alias can never be
  // filtered by a floor derived from its own peers.
  const mixedAliasBlocks: SemanticContentBlock[] = [
    tierHeading(0, "Professional Summary", 14),
    tierBody(1, 10), tierBody(2, 10), tierBody(3, 10),
    tierHeading(4, "Education", 12),
    tierBody(5, 10), tierBody(6, 10), tierBody(7, 10),
    tierHeading(8, "SELECTED PRESS", 12),
    tierBody(9, 10), tierBody(10, 10), tierBody(11, 10),
  ];
  const mixedTexts = candidateTexts(mixedAliasBlocks);
  checkTrue("section tier: the smallest alias heading is never demoted by the floor it sets", mixedTexts.includes("Education"));
  checkTrue("section tier: an unaliased heading matching that smaller floor is kept", mixedTexts.includes("SELECTED PRESS"));

  // No alias matched anywhere - the document states no convention, so
  // nothing may be filtered on typography it never declared.
  const noAliasTierBlocks: SemanticContentBlock[] = [
    tierHeading(0, "SELECTED PRESS", 14),
    tierBody(1, 10), tierBody(2, 10), tierBody(3, 10),
    tierHeading(4, "Senior Widget Wrangler", 11),
    tierBody(5, 10), tierBody(6, 10), tierBody(7, 10),
  ];
  const noAliasTexts = candidateTexts(noAliasTierBlocks);
  check("section tier: with no alias anywhere, no candidate is filtered", noAliasTexts, ["SELECTED PRESS", "Senior Widget Wrangler"]);


  // The floor starts at the first alias heading. Everything above it is
  // the document's header, where a line smaller than the section titles
  // is ordinary rather than an entry inside a section - nothing is open
  // yet for it to be inside of. The same size AFTER that point is an
  // entry title and must not open a section of its own.
  const preAliasBlocks: SemanticContentBlock[] = [
    tierHeading(0, "AVERY LINDQVIST", 16),
    tierHeading(1, "Principal Widget Steward", 12),
    tierHeading(2, "Work History", 14),
    tierBody(3, 10), tierBody(4, 10), tierBody(5, 10),
    tierHeading(6, "Senior Widget Steward", 12),
    tierBody(7, 10), tierBody(8, 10), tierBody(9, 10),
    tierHeading(10, "SELECTED PRESS", 14),
    tierBody(11, 10), tierBody(12, 10), tierBody(13, 10),
  ];
  const preAliasTexts = candidateTexts(preAliasBlocks);
  checkTrue("first-alias floor: a leading line above the section tier is kept", preAliasTexts.includes("AVERY LINDQVIST"));
  checkTrue("first-alias floor: a leading line BELOW the section tier is still kept", preAliasTexts.includes("Principal Widget Steward"));
  checkTrue("first-alias floor: the alias heading that sets the floor is kept", preAliasTexts.includes("Work History"));
  checkTrue("first-alias floor: the same size after that heading is an entry title, not a section", !preAliasTexts.includes("Senior Widget Steward"));
  checkTrue("first-alias floor: a later heading at the section tier is still a section", preAliasTexts.includes("SELECTED PRESS"));
  check("first-alias floor: the header survives whole and only the entry title is dropped", preAliasTexts, ["AVERY LINDQVIST", "Principal Widget Steward", "Work History", "SELECTED PRESS"]);

  // --- synthetic unit test: determinism ---
  const detOnce = detectSectionBoundaries(pdfBlocks);
  const detTwice = detectSectionBoundaries(pdfBlocks);
  check("repeat detectSectionBoundaries run on same blocks yields identical result", detOnce, detTwice);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
