/*
  Phase 3C - preSectionRegionOrdering unit tests.

  Every fixture here is built as groupIntoLines would emit it: ROW-MAJOR,
  so side-by-side blocks arrive interleaved. That interleaving is the
  defect, and an accepted page is proved by the two flows coming back
  separated.

  The layouts are geometric, not lexical. Section names appear only where
  the module genuinely needs heading evidence, and that evidence is read
  from scoreHeadingCandidates rather than re-derived here - so a test can
  say "this side owns a heading" using the same signal production uses.
  Nothing in these tests asks the module to understand what a skill, a
  date or a city IS; body text is long prose purely so it does not score
  as a heading, and the negatives are refused on structure alone.

  Run with `npx tsx lib/documentPreservation/losslessSemantic/preSectionRegionOrdering.test.ts`.
*/
import { orderBlocksForSectionDetection } from "./preSectionRegionOrdering";
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

// Long enough to clear MAX_HEADING_TEXT_LENGTH, so body never scores as a heading.
const BODY = "Delivered the programme end to end and reported outcomes to the steering group each quarter.";

let counter = 0;

function blockAt(
  text: string,
  x: number,
  y: number,
  width: number,
  options: { page?: number; type?: SemanticContentBlock["blockType"] } = {}
): SemanticContentBlock {
  const page = options.page ?? 0;
  const i = counter++;
  return {
    id: `block-p${page}-b${i}`,
    sourceElementIds: [`el-p${page}-e${i}`],
    text,
    rawText: text,
    pageIndex: page,
    sourceOrder: i,
    blockType: options.type ?? "paragraph",
    bbox: { x, y, width, height: 10 },
  };
}

const ids = (blocks: SemanticContentBlock[]) => blocks.map((b) => b.id);

/*
  A page that is genuinely two-column, emitted row-major. `leftX/rightX`
  and their widths are the only things a caller varies, which is what lets
  a balanced layout and a narrow-sidebar layout share one builder.
*/
function twoColumnPage(opts: {
  leftX: number;
  leftWidth: number;
  rightX: number;
  rightWidth: number;
  top?: string[];
  page?: number;
}): SemanticContentBlock[] {
  const page = opts.page ?? 0;
  const top = (opts.top ?? []).map((t, i) => blockAt(t, opts.leftX, 40 + i * 16, opts.rightX + opts.rightWidth - opts.leftX, { page }));
  const rows: SemanticContentBlock[][] = [
    [blockAt("Skills", opts.leftX, 100, opts.leftWidth, { page }), blockAt("Experience", opts.rightX, 100, opts.rightWidth, { page })],
    [blockAt(BODY, opts.leftX, 120, opts.leftWidth, { page }), blockAt(BODY, opts.rightX, 120, opts.rightWidth, { page })],
    [blockAt(BODY, opts.leftX, 140, opts.leftWidth, { page }), blockAt(BODY, opts.rightX, 140, opts.rightWidth, { page })],
  ];
  return [...top, ...rows.flat()];
}

// --- POSITIVE A - full-width top band over a balanced two-column body ---
counter = 0;
{
  const blocks = twoColumnPage({ leftX: 40, leftWidth: 200, rightX: 320, rightWidth: 240, top: ["Alex Romero"] });
  const result = orderBlocksForSectionDetection(blocks);
  const [top, lHead, rHead, lBody1, rBody1, lBody2, rBody2] = blocks;
  check("A: input really is row-major (left/right interleaved)", ids(blocks), [top, lHead, rHead, lBody1, rBody1, lBody2, rBody2].map((b) => b.id));
  check("A: output is top band, then left flow, then right flow", ids(result), [top, lHead, lBody1, lBody2, rHead, rBody1, rBody2].map((b) => b.id));
  check("A: output is a permutation - no block gained or lost", result.length, blocks.length);
  check("A: every input block is still present", ids(result).slice().sort(), ids(blocks).slice().sort());
  checkTrue("A: order actually changed", ids(result).join() !== ids(blocks).join());
}

// --- POSITIVE B - full-width top band over a narrow sidebar + wide main ---
counter = 0;
{
  const blocks = twoColumnPage({ leftX: 40, leftWidth: 120, rightX: 200, rightWidth: 360, top: ["Priya Nair", "priya@example.com"] });
  const result = orderBlocksForSectionDetection(blocks);
  const [top1, top2, lHead, rHead, lBody1, rBody1, lBody2, rBody2] = blocks;
  check("B: sidebar layout is accepted and separated", ids(result), [top1, top2, lHead, lBody1, lBody2, rHead, rBody1, rBody2].map((b) => b.id));
  check("B: both top-band blocks stay first, in their original order", ids(result).slice(0, 2), [top1.id, top2.id]);
}

// --- POSITIVE C - heading -> body ownership is what is being required ---
counter = 0;
{
  const accepted = twoColumnPage({ leftX: 40, leftWidth: 200, rightX: 320, rightWidth: 240 });
  checkTrue("C: both sides owning heading+body is accepted", ids(orderBlocksForSectionDetection(accepted)).join() !== ids(accepted).join());

  // Same geometry exactly; the right side's heading is replaced by body prose.
  counter = 0;
  const refused = [
    blockAt("Skills", 40, 100, 200), blockAt(BODY, 320, 100, 240),
    blockAt(BODY, 40, 120, 200), blockAt(BODY, 320, 120, 240),
    blockAt(BODY, 40, 140, 200), blockAt(BODY, 320, 140, 240),
  ];
  check("C: identical geometry without a right-side heading is refused", orderBlocksForSectionDetection(refused), refused);

  // A right-side heading with nothing beneath it on its own side is not a flow.
  counter = 0;
  const headingOnly = [
    blockAt("Skills", 40, 100, 200), blockAt(BODY, 320, 100, 240),
    blockAt(BODY, 40, 120, 200), blockAt(BODY, 320, 120, 240),
    blockAt(BODY, 40, 140, 200), blockAt("Experience", 320, 140, 240),
  ];
  check("C: a right-side heading with no body under it is refused", orderBlocksForSectionDetection(headingOnly), headingOnly);
}

// --- POSITIVE D - page-local reset ---
counter = 0;
{
  const twoCol = twoColumnPage({ leftX: 40, leftWidth: 200, rightX: 320, rightWidth: 240, page: 0 });
  const singleCol = [
    blockAt("Education", 40, 100, 520, { page: 1 }),
    blockAt(BODY, 40, 120, 520, { page: 1 }),
    blockAt(BODY, 40, 140, 520, { page: 1 }),
    blockAt(BODY, 40, 160, 520, { page: 1 }),
  ];
  const result = orderBlocksForSectionDetection([...twoCol, ...singleCol]);
  const [lHead, rHead, lBody1, rBody1, lBody2, rBody2] = twoCol;
  check("D: page 0 is reordered on its own evidence", ids(result).slice(0, 6), [lHead, lBody1, lBody2, rHead, rBody1, rBody2].map((b) => b.id));
  check("D: page 1 keeps its own single-column order", ids(result).slice(6), ids(singleCol));
  check("D: pages stay in page order", result.map((b) => b.pageIndex), [0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
}

// --- POSITIVE E - relative order is preserved inside each flow ---
counter = 0;
{
  const blocks = [
    blockAt("Skills", 40, 100, 200), blockAt("Experience", 320, 100, 240),
    blockAt(`${BODY} L1`, 40, 120, 200), blockAt(`${BODY} R1`, 320, 120, 240),
    blockAt(`${BODY} L2`, 40, 140, 200), blockAt(`${BODY} R2`, 320, 140, 240),
    blockAt(`${BODY} L3`, 40, 160, 200), blockAt(`${BODY} R3`, 320, 160, 240),
  ];
  const result = orderBlocksForSectionDetection(blocks);
  const left = result.filter((b) => b.bbox!.x === 40);
  const right = result.filter((b) => b.bbox!.x === 320);
  check("E: left flow keeps its internal order", left.map((b) => b.sourceOrder), [0, 2, 4, 6]);
  check("E: right flow keeps its internal order", right.map((b) => b.sourceOrder), [1, 3, 5, 7]);
  check("E: the two flows are contiguous, not interleaved", ids(result), [...ids(left), ...ids(right)]);
}

// --- POSITIVE F - source blocks are never mutated ---
counter = 0;
{
  const blocks = twoColumnPage({ leftX: 40, leftWidth: 200, rightX: 320, rightWidth: 240, top: ["Alex Romero"] });
  const before = JSON.parse(JSON.stringify(blocks));
  const result = orderBlocksForSectionDetection(blocks);
  check("F: every source block object is byte-identical afterwards", JSON.parse(JSON.stringify(blocks)), before);
  check("F: the caller's array itself is not reordered in place", ids(blocks), before.map((b: SemanticContentBlock) => b.id));
  checkTrue("F: returned entries are the SAME objects, not copies", result.every((b) => blocks.includes(b)));
  check("F: sourceOrder is never rewritten", result.map((b) => b.sourceOrder).slice().sort((a, z) => a - z), blocks.map((b) => b.sourceOrder));
}

// --- POSITIVE G / NEGATIVE H - nothing to split returns the input array ---
counter = 0;
{
  const singleColumn = [
    blockAt("Summary", 40, 100, 520),
    blockAt(BODY, 40, 120, 520),
    blockAt("Experience", 40, 140, 520),
    blockAt(BODY, 40, 160, 520),
  ];
  const result = orderBlocksForSectionDetection(singleColumn);
  checkTrue("G: refusal returns the caller's own array, not a copy", result === singleColumn);
  check("G: no valid split anywhere - sequence identical", ids(result), ids(singleColumn));
  check("G: empty input is returned untouched", orderBlocksForSectionDetection([]), []);

  counter = 0;
  const noGeometry: SemanticContentBlock[] = singleColumn.map((b) => ({ ...b, bbox: undefined }));
  checkTrue("G: blocks without geometry are refused outright", orderBlocksForSectionDetection(noGeometry) === noGeometry);
}

// --- NEGATIVE A - embedded table: two ranges, heading flow on one side only ---
counter = 0;
{
  const table = [
    blockAt("Skills", 40, 100, 200),
    blockAt("Power BI", 40, 120, 200), blockAt("Advanced", 320, 120, 120),
    blockAt("Python", 40, 140, 200), blockAt("Advanced", 320, 140, 120),
    blockAt("Tableau", 40, 160, 200), blockAt("Intermediate", 320, 160, 120),
  ];
  checkTrue("N-A: embedded table is refused (right cells own no heading)", orderBlocksForSectionDetection(table) === table);
}

// --- NEGATIVE B - right metadata rail ---
counter = 0;
{
  const rail = [
    blockAt("Experience", 40, 100, 300),
    blockAt("Senior Reliability Engineer", 40, 120, 300), blockAt("2023 - Present", 430, 120, 130),
    blockAt(BODY, 40, 140, 300), blockAt("Toronto, ON", 430, 140, 130),
    blockAt("Reliability Engineer", 40, 160, 300), blockAt("2020 - 2023", 430, 160, 130),
    blockAt(BODY, 40, 180, 300), blockAt("Ottawa, ON", 430, 180, 130),
  ];
  checkTrue("N-B: right metadata rail is refused", orderBlocksForSectionDetection(rail) === rail);
}

// --- NEGATIVE C - local Skills grid owned by a single heading ---
counter = 0;
{
  const grid = [
    blockAt("Skills", 40, 100, 300),
    blockAt("Programming:", 40, 120, 120), blockAt("Python, Java", 220, 120, 200),
    blockAt("CAD:", 40, 140, 120), blockAt("CATIA V5, NX", 220, 140, 200),
    blockAt("Simulation:", 40, 160, 120), blockAt("ANSYS", 220, 160, 200),
  ];
  checkTrue("N-C: local Skills grid is refused as page columns", orderBlocksForSectionDetection(grid) === grid);
}

// --- NEGATIVE D - right-aligned dates and locations, no heading ---
counter = 0;
{
  const dated = [
    blockAt("Education", 40, 100, 300),
    blockAt("B.A.Sc. in Mechanical Engineering", 40, 120, 300), blockAt("2014 - 2018", 430, 120, 130),
    blockAt("Lakeshore Polytechnic Institute", 40, 140, 300), blockAt("Hamilton, ON", 430, 140, 130),
    blockAt(BODY, 40, 160, 300), blockAt("2012 - 2014", 430, 160, 130),
  ];
  checkTrue("N-D: right-aligned date/location column is refused", orderBlocksForSectionDetection(dated) === dated);
}

// --- NEGATIVE E - many right-side blocks, large span, still no heading flow ---
counter = 0;
{
  const wide: SemanticContentBlock[] = [blockAt("Experience", 40, 80, 300)];
  for (let row = 0; row < 12; row++) {
    wide.push(blockAt(BODY, 40, 100 + row * 20, 300));
    wide.push(blockAt(`Entry ${row}`, 430, 100 + row * 20, 130));
  }
  checkTrue("N-E: 12 right-side blocks over a large span are still refused", orderBlocksForSectionDetection(wide) === wide);
}

// --- NEGATIVE F - nested indentation is not a column boundary ---
counter = 0;
{
  const indented = [
    blockAt("Experience", 40, 100, 520),
    blockAt("Operations Analyst", 40, 120, 520),
    blockAt(BODY, 60, 140, 500, { type: "bullet" }),
    blockAt(BODY, 60, 160, 500, { type: "bullet" }),
    blockAt("Education", 40, 180, 520),
    blockAt(BODY, 60, 200, 500, { type: "bullet" }),
  ];
  checkTrue("N-F: indented bullets never form a second flow", orderBlocksForSectionDetection(indented) === indented);
}

// --- NEGATIVE G - one accidental side-by-side pair ---
counter = 0;
{
  const accidental = [
    blockAt("Summary", 40, 100, 520),
    blockAt(BODY, 40, 120, 520),
    blockAt("Experience", 40, 140, 200), blockAt("2020 - 2024", 430, 140, 130),
    blockAt(BODY, 40, 160, 520),
    blockAt(BODY, 40, 180, 520),
  ];
  checkTrue("N-G: a single side-by-side pair is not a column", orderBlocksForSectionDetection(accidental) === accidental);
}

// --- NEGATIVE I / J - three flows, and ambiguity in general, are refused ---
counter = 0;
{
  const threeColumn = [
    blockAt("Skills", 40, 100, 100), blockAt("Experience", 200, 100, 100), blockAt("Education", 360, 100, 100),
    blockAt(BODY, 40, 120, 100), blockAt(BODY, 200, 120, 100), blockAt(BODY, 360, 120, 100),
    blockAt(BODY, 40, 140, 100), blockAt(BODY, 200, 140, 100), blockAt(BODY, 360, 140, 100),
  ];
  checkTrue("N-J: a three-column page is refused, not split arbitrarily", orderBlocksForSectionDetection(threeColumn) === threeColumn);

  // Two structurally valid splits, both with heading+body on either side:
  // exactly the ambiguity the module must refuse rather than rank.
  counter = 0;
  const ambiguous = [
    blockAt("Skills", 40, 100, 100), blockAt("Experience", 200, 100, 100), blockAt("Education", 360, 100, 100),
    blockAt(BODY, 40, 120, 100), blockAt(BODY, 200, 120, 100), blockAt(BODY, 360, 120, 100),
  ];
  checkTrue("N-I: multiple valid splits are refused (no best-split ranking)", orderBlocksForSectionDetection(ambiguous) === ambiguous);
}

// --- DECLARATION - the exact permutation handed to the lossless validator ---
// The validator holds within-page sourceOrder monotonicity as a hard
// invariant, so an accepted reorder has to say precisely what it did. What
// matters below is that the declaration is COMPLETE (the whole page, not
// just the moved blocks), EXACT (identical to what was actually returned),
// and ABSENT whenever nothing was reordered - a declaration for an
// untouched page would be an authorization nobody earned.
function record(blocks: SemanticContentBlock[]) {
  const declarations: Array<{ pageIndex: number; ids: string[] }> = [];
  const result = orderBlocksForSectionDetection(blocks, (pageIndex, ids) => declarations.push({ pageIndex, ids }));
  return { declarations, result };
}

// D1 - an accepted page declares itself, once, completely and exactly.
counter = 0;
{
  const blocks = twoColumnPage({ leftX: 40, leftWidth: 200, rightX: 320, rightWidth: 240, top: ["Alex Romero"] });
  const { declarations, result } = record(blocks);
  check("D1: exactly one page is declared", declarations.length, 1);
  check("D1: the declared pageIndex is the page that moved", declarations[0]?.pageIndex, 0);
  check("D1: the declaration covers every block on the page, not just the moved ones", declarations[0]?.ids.length, blocks.length);
  check("D1: the declaration is exactly the returned order", declarations[0]?.ids, ids(result));
  check("D1: the declaration holds no duplicate ids", new Set(declarations[0]?.ids).size, blocks.length);
  check("D1: the declaration is the same block set as the input", declarations[0]?.ids.slice().sort(), ids(blocks).slice().sort());
  checkTrue("D1: the declaration differs from source order - there was something to declare", declarations[0]?.ids.join() !== ids(blocks).join());
}

// D2 - a refused page declares nothing at all.
counter = 0;
{
  const singleColumn = [
    blockAt("Summary", 40, 100, 520),
    blockAt(BODY, 40, 120, 520),
    blockAt("Experience", 40, 140, 520),
    blockAt(BODY, 40, 160, 520),
  ];
  check("D2: a refused page emits no declaration", record(singleColumn).declarations.length, 0);

  counter = 0;
  const rail = [
    blockAt("Experience", 40, 100, 300),
    blockAt("Senior Reliability Engineer", 40, 120, 300), blockAt("2023 - Present", 430, 120, 130),
    blockAt(BODY, 40, 140, 300), blockAt("Toronto, ON", 430, 140, 130),
    blockAt("Reliability Engineer", 40, 160, 300), blockAt("2020 - 2023", 430, 160, 130),
  ];
  check("D2: a refused metadata rail emits no declaration", record(rail).declarations.length, 0);

  counter = 0;
  const threeColumn = [
    blockAt("Skills", 40, 100, 100), blockAt("Experience", 200, 100, 100), blockAt("Education", 360, 100, 100),
    blockAt(BODY, 40, 120, 100), blockAt(BODY, 200, 120, 100), blockAt(BODY, 360, 120, 100),
    blockAt(BODY, 40, 140, 100), blockAt(BODY, 200, 140, 100), blockAt(BODY, 360, 140, 100),
  ];
  check("D2: an ambiguous/three-flow page emits no declaration", record(threeColumn).declarations.length, 0);
}

// D3 - in a multi-page document only the page that actually moved is declared.
counter = 0;
{
  const twoCol = twoColumnPage({ leftX: 40, leftWidth: 200, rightX: 320, rightWidth: 240, page: 0 });
  const singleCol = [
    blockAt("Education", 40, 100, 520, { page: 1 }),
    blockAt(BODY, 40, 120, 520, { page: 1 }),
    blockAt(BODY, 40, 140, 520, { page: 1 }),
    blockAt(BODY, 40, 160, 520, { page: 1 }),
  ];
  const { declarations, result } = record([...twoCol, ...singleCol]);
  check("D3: only the reordered page is declared", declarations.map((d) => d.pageIndex), [0]);
  check("D3: the untouched page is never declared", declarations.some((d) => d.pageIndex === 1), false);
  check("D3: the declaration matches that page's returned slice exactly", declarations[0]?.ids, ids(result.slice(0, twoCol.length)));
  check("D3: page-local reset still holds - page 1 keeps source order", ids(result.slice(twoCol.length)), ids(singleCol));
}

// D4 - recording changes nothing: same classification, same order, same objects.
counter = 0;
{
  const blocks = twoColumnPage({ leftX: 40, leftWidth: 120, rightX: 200, rightWidth: 360, top: ["Priya Nair"] });
  const before = JSON.parse(JSON.stringify(blocks));
  const withoutRecorder = orderBlocksForSectionDetection(blocks);
  const { result: withRecorder } = record(blocks);
  check("D4: the recorder does not change the resulting order", ids(withRecorder), ids(withoutRecorder));
  check("D4: the recorder does not mutate the source blocks", JSON.parse(JSON.stringify(blocks)), before);
  check("D4: the caller's array is still not reordered in place", ids(blocks), before.map((b: SemanticContentBlock) => b.id));

  counter = 0;
  const refused = [
    blockAt("Summary", 40, 100, 520), blockAt(BODY, 40, 120, 520),
    blockAt("Experience", 40, 140, 520), blockAt(BODY, 40, 160, 520),
  ];
  checkTrue("D4: refusal still returns the caller's own array when recording", record(refused).result === refused);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
