/*
  Phase 1 - focused regression matrix for wrappedLineReconstruction.ts.

  Pure unit tests over synthetic SemanticContentBlock geometry: no PDF
  fixture, no browser, no database, no snapshot. Every case states the
  geometry it relies on explicitly, so a threshold change in the layer
  shows up here as a named failure rather than a diff in an opaque
  fixture.

  Column model used throughout - one 450px-wide text column:
    left margin  x = 72
    right margin x = 522
    line height  12, baseline-to-baseline 14 (i.e. 2px leading)
  A line "reaches the right edge" when it ends at/after 477
  (522 - 450 * RIGHT_EDGE_TOLERANCE_RATIO).
*/
import { reconstructBlockRun, reconstructWrappedLines } from "./wrappedLineReconstruction";
import type {
  LosslessResumeDocument,
  LosslessResumeSection,
  SemanticBlockType,
  SemanticContentBlock,
} from "./types";

const LEFT = 72;
const RIGHT = 522;
const LINE_HEIGHT = 12;
const LINE_ADVANCE = 14;

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
}

type BlockSpec = {
  text: string;
  x?: number;
  /* Line index within the run; y is derived so lines are exactly one
     LINE_ADVANCE apart unless `y` is given explicitly. */
  line: number;
  y?: number;
  width: number;
  blockType?: SemanticBlockType;
  fontSize?: number;
  order?: number;
};

function block(spec: BlockSpec, index: number): SemanticContentBlock {
  const x = spec.x ?? LEFT;
  const y = spec.y ?? 100 + spec.line * LINE_ADVANCE;
  return {
    id: `b${index}`,
    sourceElementIds: [`e${index}`],
    text: spec.text,
    rawText: spec.text,
    pageIndex: 0,
    sourceOrder: spec.order ?? index,
    bbox: { x, y, width: spec.width, height: LINE_HEIGHT },
    style: { fontSize: spec.fontSize ?? 10 },
    blockType: spec.blockType ?? "paragraph",
  };
}

function run(specs: BlockSpec[]): SemanticContentBlock[] {
  return reconstructBlockRun(specs.map(block));
}

function texts(blocks: SemanticContentBlock[]): string[] {
  return blocks.map((b) => b.text);
}

/* A line that ends flush against the right margin. */
function fullWidth(x: number): number {
  return RIGHT - x;
}

// =====================================================================
// POSITIVE CASES - must merge
// =====================================================================

// 1. Soft-wrap hyphenation: the compound survives, no space is inserted.
{
  const out = run([
    { text: "Led new-business discovery and government-", line: 0, width: fullWidth(LEFT) },
    { text: "funded project management", line: 1, width: 180 },
  ]);
  check("1. government-/funded merges into one block", out.length, 1);
  check(
    "1. government-/funded joins without a space, hyphen kept",
    texts(out),
    ["Led new-business discovery and government-funded project management"]
  );
}

// 2. Plain wrapped prose: joined with a single space.
{
  const out = run([
    { text: "Delivered the automated factory", line: 0, width: fullWidth(LEFT) },
    { text: "solutions for battery plants", line: 1, width: 190 },
  ]);
  check("2. factory/solutions merges into one block", out.length, 1);
  check("2. factory/solutions joins with one space", texts(out), [
    "Delivered the automated factory solutions for battery plants",
  ]);
}

// 3. A line ending on a dangling connector still merges.
{
  const out = run([
    { text: "Designed embedded software &", line: 0, width: fullWidth(LEFT) },
    { text: "algorithms", line: 1, width: 80 },
  ]);
  check("3. software &/algorithms merges into one block", out.length, 1);
  check("3. software &/algorithms joins with one space", texts(out), [
    "Designed embedded software & algorithms",
  ]);
}

// 4. A bullet wrapped over three visual lines stays ONE bullet - the
//    continuation lines sit at a hanging indent, and the block keeps
//    blockType "bullet" so experienceExtractor still files it as a
//    bullet rather than as orphan description text.
{
  const out = run([
    { text: "• Led new-customer development and order acquisition,", line: 0, width: fullWidth(LEFT), blockType: "bullet" },
    { text: "new-business incubation and government-", line: 1, x: 86, width: fullWidth(86) },
    { text: "funded project management", line: 2, x: 86, width: 180 },
  ]);
  check("4. wrapped bullet collapses to one block", out.length, 1);
  check("4. wrapped bullet keeps blockType bullet", out[0].blockType, "bullet");
  check("4. wrapped bullet text is rejoined in order", texts(out), [
    "• Led new-customer development and order acquisition, new-business incubation and government-funded project management",
  ]);
  check("4. wrapped bullet keeps every source element id", out[0].sourceElementIds, ["e0", "e1", "e2"]);
  check("4. wrapped bullet keeps the first block's id", out[0].id, "b0");
}

// =====================================================================
// NEGATIVE CASES - must NOT merge
// =====================================================================

// 5. Two separate bullets, even when the first reaches the right edge.
{
  const out = run([
    { text: "• Owned the full P&L for the components division", line: 0, width: fullWidth(LEFT), blockType: "bullet" },
    { text: "• Grew revenue 40% year over year", line: 1, width: 220, blockType: "bullet" },
  ]);
  check("5. two bullets stay separate", out.length, 2);
}

// 6. A heading is never continued by the paragraph beneath it.
{
  const out = run([
    { text: "PROFESSIONAL EXPERIENCE", line: 0, width: fullWidth(LEFT), blockType: "heading" },
    { text: "Fifteen years across automotive and energy storage", line: 1, width: 300 },
  ]);
  check("6. heading + paragraph stay separate", out.length, 2);
}

// 7. An intentional compound on a short, self-contained line is left
//    exactly as authored - the right-edge gate never fires for it.
{
  const out = run([
    { text: "Secured mass-production", line: 0, width: 150 },
    { text: "Improved first-pass yield", line: 1, width: 160 },
  ]);
  check("7. mass-production line stays separate", out.length, 2);
  check("7. mass-production text is untouched", texts(out), [
    "Secured mass-production",
    "Improved first-pass yield",
  ]);
}

// 8. Numbered subsections: neither a following child bullet nor a
//    following numbered heading may be absorbed, even from a line that
//    does reach the right edge.
{
  const withBullet = run([
    { text: "5) FF-PCB Electrical Component Business across the group", line: 0, width: fullWidth(LEFT) },
    { text: "• Identified the initial customer set", line: 1, x: 86, width: 220, blockType: "bullet" },
  ]);
  check("8a. numbered subsection + child bullet stay separate", withBullet.length, 2);

  const withNumbered = run([
    { text: "Ran the incubation programme end to end for the division", line: 0, width: fullWidth(LEFT) },
    { text: "6) New Business Development & Incubation", line: 1, width: 260 },
  ]);
  check("8b. a following numbered heading is never absorbed", withNumbered.length, 2);
}

// 9. Two-column geometry: a right-hand cell sits at the SAME y as the
//    left one, so it is a horizontal neighbour, never a continuation.
{
  const out = run([
    { text: "Total addressable market", line: 0, width: fullWidth(LEFT) },
    { text: "USD 4.2B", line: 0, x: 320, width: 90 },
  ]);
  check("9. same-Y column neighbour stays separate", out.length, 2);
}

// 10. Section boundary: two sections are reconstructed independently,
//     so a run never merges across the boundary.
{
  const first = block({ text: "Scaled the pilot line to volume production at the", line: 0, width: fullWidth(LEFT) }, 0);
  const second = block({ text: "second plant in under a year", line: 1, width: 200 }, 1);

  function section(id: string, blocks: SemanticContentBlock[]): LosslessResumeSection {
    return {
      id,
      originalHeading: null,
      normalizedHeading: null,
      normalizedType: "custom",
      displayHeading: null,
      sourceOrder: 0,
      startPageIndex: 0,
      endPageIndex: 0,
      confidence: 1,
      classificationMethod: "fallback",
      reasonCodes: [],
      blocks,
      rawText: blocks.map((b) => b.rawText).join("\n"),
      isUncertain: true,
    };
  }

  const document: LosslessResumeDocument = {
    schemaVersion: "1.0.0",
    source: { fileName: "r.pdf", fileType: "pdf" },
    identityBlocks: [],
    sections: [section("s0", [first]), section("s1", [second])],
    unassignedBlocks: [],
    validation: {
      passed: true,
      sourceElementCount: 2,
      representedElementCount: 2,
      missingElementIds: [],
      duplicateElementIds: [],
      missingTextSpans: [],
      inventedTextSpans: [],
      orderViolations: [],
      warnings: [],
    },
  };

  const out = reconstructWrappedLines(document);
  check("10. blocks never merge across a section boundary", [out.sections[0].blocks.length, out.sections[1].blocks.length], [1, 1]);
  check("10. the input document is not mutated", document.sections[0].blocks.length, 1);
  check("10. validation report is passed through untouched", out.validation.passed, true);
}

// 11. Alex-Kim-style simple content: every bullet already fits on one
//     line, so reconstruction is a no-op.
{
  const specs: BlockSpec[] = [
    { text: "• Built internal tooling in TypeScript", line: 0, width: 240, blockType: "bullet" },
    { text: "• Automated the release pipeline", line: 1, width: 210, blockType: "bullet" },
    { text: "• Mentored two junior engineers", line: 2, width: 205, blockType: "bullet" },
  ];
  const out = run(specs);
  check("11. simple one-line bullets are unchanged in count", out.length, 3);
  check("11. simple one-line bullets are unchanged in text", texts(out), specs.map((s) => s.text));
  check(
    "11. simple one-line bullets keep their ids",
    out.map((b) => b.id),
    ["b0", "b1", "b2"]
  );
}

// 12. Guard: a large vertical gap reads as paragraph spacing, so even a
//     full-width line does not absorb the block below it.
{
  const out = run([
    { text: "Closed the Series B and set up the R&D organisation", line: 0, width: fullWidth(LEFT) },
    { text: "Advisor, battery materials", line: 0, y: 100 + LINE_ADVANCE * 3, width: 200 },
  ]);
  check("12. a paragraph-sized vertical gap blocks the merge", out.length, 2);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
