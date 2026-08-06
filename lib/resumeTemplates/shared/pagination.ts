/*
  Phase 6F - a template-agnostic pagination planner. Reimplements the
  SAME algorithm shape as the existing, unmodified
  professionalAtsHtml/paginationPlanner.ts (measured-height greedy
  packer; place whole blocks while they fit; split only at legal
  sub-item boundaries; never drop content; a heading is never
  separated from its section's first block; an entry header is never
  separated from its first sub-item) but generalized over an injected
  page budget and block list, so all 3 new templates (and, if ever
  needed, a 5th future one) share ONE pagination implementation instead
  of each hand-rolling its own.

  Deliberately NOT a modification of the existing file: Professional
  ATS's wrapper keeps calling the existing, already-validated planner
  untouched (zero regression risk to that production-adjacent
  pipeline) - see the Phase 6F pre-report's risk #1 for the tradeoff
  this creates (two independently-maintained implementations of the
  same algorithm shape).
*/

export type PaginationKeepTogether = "none" | "whole-block" | "heading-with-first-item" | "entry-header-with-first-content" | "whole-entry-if-fits";
export type PaginationSplitStrategy = "none" | "between-bullets" | "between-paragraphs" | "between-items";

export type PaginatableBlock = {
  id: string;
  sectionKey: string;
  /* Total measured height of this block if rendered whole. */
  heightPx: number;
  /* Height of just the header/first line, when this block has one
     (an entry header, a section heading) - required for
     keepTogether === "entry-header-with-first-content"/"heading-with-first-item". */
  headerHeightPx: number;
  /* Per-sub-item measured heights, in order, for blocks that canSplit.
     Empty for blocks with no legal internal split point. */
  subItemHeightsPx: number[];
  keepTogether: PaginationKeepTogether;
  canSplit: boolean;
  splitStrategy: PaginationSplitStrategy;
  /* True for the first block of a new section - used to enforce
     "heading never separated from first block." */
  isFirstBlockInSection: boolean;
};

export type PaginationPageBudget = {
  usableHeightPx: number;
};

export type BlockPlacement = {
  blockId: string;
  pageIndex: number;
  subRange?: { startIndex: number; endIndex: number };
  isContinuation: boolean;
};

export type GenericPaginationPlan = {
  pageCount: number;
  placements: BlockPlacement[];
};

function requiresWholeBlock(block: PaginatableBlock): boolean {
  return block.keepTogether === "whole-block" || (!block.canSplit && block.splitStrategy === "none");
}

export function buildGenericPaginationPlan(blocks: PaginatableBlock[], budget: PaginationPageBudget): GenericPaginationPlan {
  const placements: BlockPlacement[] = [];
  let pageIndex = 0;
  let remaining = budget.usableHeightPx;

  const startNewPage = () => {
    pageIndex += 1;
    remaining = budget.usableHeightPx;
  };

  for (const block of blocks) {
    if (block.isFirstBlockInSection && block.keepTogether === "heading-with-first-item") {
      const minRequired = block.headerHeightPx + (block.subItemHeightsPx[0] ?? 0);
      if (minRequired > remaining && remaining < budget.usableHeightPx) {
        startNewPage();
      }
    }

    const wholeFits = block.heightPx <= remaining;
    if (wholeFits) {
      placements.push({ blockId: block.id, pageIndex, isContinuation: false });
      remaining -= block.heightPx;
      continue;
    }

    if (requiresWholeBlock(block) || !block.canSplit) {
      if (remaining < budget.usableHeightPx) startNewPage();
      placements.push({ blockId: block.id, pageIndex, isContinuation: false });
      remaining = Math.max(0, budget.usableHeightPx - block.heightPx);
      continue;
    }

    /* Legal split: header + as many whole sub-items as fit on the
       current page, remaining sub-items continue on the next page(s). */
    const minHeaderCommitment = block.keepTogether === "entry-header-with-first-content" || block.keepTogether === "whole-entry-if-fits" ? block.headerHeightPx + (block.subItemHeightsPx[0] ?? 0) : block.headerHeightPx;
    if (minHeaderCommitment > remaining && remaining < budget.usableHeightPx) {
      startNewPage();
    }

    let cursor = 0;
    let usedOnThisPage = block.headerHeightPx;
    let isContinuation = false;
    while (cursor < block.subItemHeightsPx.length) {
      const startIndex = cursor;
      let consumed = 0;
      while (cursor < block.subItemHeightsPx.length && usedOnThisPage + consumed + block.subItemHeightsPx[cursor] <= remaining) {
        consumed += block.subItemHeightsPx[cursor];
        cursor += 1;
      }
      if (cursor === startIndex) {
        /* Not even one sub-item fits on this page - move to a fresh
           page and retry this same sub-item there. */
        startNewPage();
        usedOnThisPage = isContinuation ? 0 : block.headerHeightPx;
        continue;
      }
      placements.push({ blockId: block.id, pageIndex, subRange: { startIndex, endIndex: cursor - 1 }, isContinuation });
      remaining -= usedOnThisPage + consumed;
      usedOnThisPage = 0;
      isContinuation = true;
      if (cursor < block.subItemHeightsPx.length) startNewPage();
    }
  }

  return { pageCount: pageIndex + 1, placements };
}
