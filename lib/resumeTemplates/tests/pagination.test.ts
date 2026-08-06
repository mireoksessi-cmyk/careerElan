/*
  Phase 6F - Pagination algorithm test category (spec section 19, item
  16/17 - "buildGenericPaginationPlan in isolation"). Hand-constructed
  PaginatableBlock[] inputs, no rendering involved. Run with:
    npx tsx lib/resumeTemplates/tests/pagination.test.ts
*/
import { buildGenericPaginationPlan, type PaginatableBlock, type PaginationPageBudget } from "../shared/pagination";

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

function block(overrides: Partial<PaginatableBlock> & { id: string }): PaginatableBlock {
  return {
    sectionKey: "experience",
    heightPx: 100,
    headerHeightPx: 20,
    subItemHeightsPx: [],
    keepTogether: "none",
    canSplit: false,
    splitStrategy: "none",
    isFirstBlockInSection: false,
    ...overrides,
  };
}

const BUDGET: PaginationPageBudget = { usableHeightPx: 1000 };

function main() {
  /* --- empty input --- */
  const emptyPlan = buildGenericPaginationPlan([], BUDGET);
  check("empty blocks[]: pageCount is 1 (one blank page, never 0)", emptyPlan.pageCount, 1);
  check("empty blocks[]: placements is empty", emptyPlan.placements, []);

  /* --- single-page fits-everything case --- */
  const smallBlocks = [block({ id: "a", heightPx: 100 }), block({ id: "b", heightPx: 200 }), block({ id: "c", heightPx: 300 })];
  const smallPlan = buildGenericPaginationPlan(smallBlocks, BUDGET);
  check("fits-everything: pageCount is 1", smallPlan.pageCount, 1);
  check("fits-everything: 3 placements, one per block", smallPlan.placements.length, 3);
  checkTrue("fits-everything: every placement is on pageIndex 0", smallPlan.placements.every((p) => p.pageIndex === 0));
  checkTrue("fits-everything: no placement is a continuation", smallPlan.placements.every((p) => !p.isContinuation));
  check("fits-everything: placement order matches input block order", smallPlan.placements.map((p) => p.blockId), ["a", "b", "c"]);

  /* --- force-to-next-page: a whole atomic block doesn't fit remaining space --- */
  const overflowBlocks = [block({ id: "a", heightPx: 700 }), block({ id: "b", heightPx: 700, keepTogether: "whole-block" })];
  const overflowPlan = buildGenericPaginationPlan(overflowBlocks, BUDGET);
  check("overflow: pageCount is 2", overflowPlan.pageCount, 2);
  const placedA = overflowPlan.placements.find((p) => p.blockId === "a");
  const placedB = overflowPlan.placements.find((p) => p.blockId === "b");
  check("overflow: block 'a' stays on page 0", placedA?.pageIndex, 0);
  check("overflow: block 'b' (doesn't fit remaining 300px) moves to page 1", placedB?.pageIndex, 1);
  checkTrue("overflow: block 'b' is not marked a continuation (it was never split)", placedB?.isContinuation === false);

  /* --- exact-fit boundary: a block exactly matching remaining space stays on the current page --- */
  const exactBlocks = [block({ id: "a", heightPx: 600 }), block({ id: "b", heightPx: 400, keepTogether: "whole-block" })];
  const exactPlan = buildGenericPaginationPlan(exactBlocks, BUDGET);
  check("exact-fit: pageCount is 1 (600+400 == 1000 budget)", exactPlan.pageCount, 1);

  /* --- keepTogether: heading-with-first-item forces the heading to a fresh page when its first item won't also fit --- */
  const headingBlocks = [
    block({ id: "filler", heightPx: 900 }),
    block({ id: "heading", heightPx: 30, headerHeightPx: 30, subItemHeightsPx: [200], keepTogether: "heading-with-first-item", isFirstBlockInSection: true, canSplit: true, splitStrategy: "between-items" }),
  ];
  const headingPlan = buildGenericPaginationPlan(headingBlocks, BUDGET);
  const headingPlacement = headingPlan.placements.find((p) => p.blockId === "heading");
  check("heading-with-first-item: heading forced to page 1 since heading+first-item (230px) doesn't fit the 100px left on page 0", headingPlacement?.pageIndex, 1);

  /* --- keepTogether: heading-with-first-item does NOT force a page break when there's enough room --- */
  const headingFitsBlocks = [
    block({ id: "filler", heightPx: 500 }),
    block({ id: "heading", heightPx: 30, headerHeightPx: 30, subItemHeightsPx: [200], keepTogether: "heading-with-first-item", isFirstBlockInSection: true, canSplit: true, splitStrategy: "between-items" }),
  ];
  const headingFitsPlan = buildGenericPaginationPlan(headingFitsBlocks, BUDGET);
  const headingFitsPlacement = headingFitsPlan.placements.find((p) => p.blockId === "heading");
  check("heading-with-first-item: heading stays on page 0 when there's enough room (500px left, needs 230px)", headingFitsPlacement?.pageIndex, 0);

  /* --- multi-page: a run of large atomic blocks spans 3 pages --- */
  const manyBlocks = Array.from({ length: 5 }, (_, i) => block({ id: `blk-${i}`, heightPx: 450, keepTogether: "whole-block" }));
  const manyPlan = buildGenericPaginationPlan(manyBlocks, BUDGET);
  check("multi-page: 5 blocks of 450px each (2/page) span pageCount 3", manyPlan.pageCount, 3);
  check("multi-page: placements count matches block count (nothing dropped)", manyPlan.placements.length, 5);
  check("multi-page: all 5 unique block ids are present exactly once", new Set(manyPlan.placements.map((p) => p.blockId)).size, 5);

  /* --- splittable block: splits between sub-items across a page boundary, never drops one --- */
  const splittable = block({
    id: "split-entry",
    heightPx: 900,
    headerHeightPx: 20,
    subItemHeightsPx: [200, 200, 200, 200, 100],
    keepTogether: "entry-header-with-first-content",
    canSplit: true,
    splitStrategy: "between-bullets",
  });
  const splitPlan = buildGenericPaginationPlan([block({ id: "pad", heightPx: 200 }), splittable], BUDGET);
  const splitPlacements = splitPlan.placements.filter((p) => p.blockId === "split-entry");
  checkTrue("splittable: produces more than one placement (it was split)", splitPlacements.length > 1);
  const coveredIndices = new Set<number>();
  for (const p of splitPlacements) {
    if (!p.subRange) continue;
    for (let i = p.subRange.startIndex; i <= p.subRange.endIndex; i++) coveredIndices.add(i);
  }
  check("splittable: every sub-item index (0-4) is covered exactly once across placements, none dropped", coveredIndices.size, 5);
  checkTrue("splittable: the first placement of the split entry is not a continuation", splitPlacements[0].isContinuation === false);
  checkTrue("splittable: a later placement of the split entry (if any) is marked isContinuation", splitPlacements.length === 1 || splitPlacements.slice(1).every((p) => p.isContinuation));

  /* --- keepTogether: whole-block with canSplit=true is still never split --- */
  const forcedWhole = block({ id: "forced-whole", heightPx: 900, subItemHeightsPx: [100, 100], keepTogether: "whole-block", canSplit: true, splitStrategy: "between-bullets" });
  const forcedWholePlan = buildGenericPaginationPlan([block({ id: "pad2", heightPx: 500 }), forcedWhole], BUDGET);
  const forcedWholePlacements = forcedWholePlan.placements.filter((p) => p.blockId === "forced-whole");
  check("keepTogether=whole-block: never split even though canSplit=true and it doesn't fit remaining space", forcedWholePlacements.length, 1);
  checkTrue("keepTogether=whole-block: the single placement has no subRange", forcedWholePlacements[0].subRange === undefined);

  /* --- never drops content: a large batch of mixed atomic + splittable blocks accounts for every id --- */
  const mixedBlocks = [
    block({ id: "m1", heightPx: 300 }),
    block({ id: "m2", heightPx: 300, keepTogether: "whole-block" }),
    block({ id: "m3", heightPx: 900, subItemHeightsPx: [300, 300, 300], canSplit: true, splitStrategy: "between-paragraphs" }),
    block({ id: "m4", heightPx: 250 }),
    block({ id: "m5", heightPx: 250, keepTogether: "whole-block" }),
  ];
  const mixedPlan = buildGenericPaginationPlan(mixedBlocks, BUDGET);
  const mixedIds = new Set(mixedPlan.placements.map((p) => p.blockId));
  check("mixed batch: every distinct input block id appears at least once in placements", mixedIds.size, 5);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
