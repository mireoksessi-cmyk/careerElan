/*
  Phase 6F - shared real-browser measurement + pagination orchestration
  for the 3 NEW templates (Modern Sidebar, Executive Minimal, Creative
  Timeline). Reuses the SAME shared Playwright singleton the existing
  Professional ATS pipeline uses (lib/documentPreservation/
  sharedBrowser.ts) so no second browser instance is launched, and
  feeds real measured heights into this round's own generic
  pagination.ts planner.

  Simplification, disclosed: every flow item here is treated as an
  atomic, non-splittable block (canSplit: false) - an entire
  experience/education/credential/project/award/publication/custom-
  section entry is placed as a whole on whichever page it fits,
  page-broken only BETWEEN entries, never mid-entry between bullets.
  This is a real scope reduction versus the existing Professional ATS
  pipeline (whose paginationPlanner.ts DOES split a long entry's
  bullets across a page boundary) - see the Phase 6F final report's
  Known Limitations section. It was chosen because a genuine per-
  sub-item splitting implementation for 3 independently-designed
  layouts (single column, sidebar, timeline) within this round's scope
  would each need their own sub-item measurement/placement logic,
  whereas whole-entry placement is a single, template-agnostic
  algorithm that still produces correct, non-overlapping, zero-content-
  loss pagination from real measured heights - just with a coarser
  granularity than the existing pipeline.
*/
import { getSharedBrowser } from "../../documentPreservation/sharedBrowser";
import { buildGenericPaginationPlan, type GenericPaginationPlan, type PaginatableBlock, type PaginationKeepTogether, type PaginationPageBudget } from "./pagination";

export type FlowBlockSpec = {
  id: string;
  sectionKey: string;
  keepTogether: PaginationKeepTogether;
  isFirstBlockInSection: boolean;
};

/*
  flatHtml must render every flow item inside an element carrying
  data-flow-id="<id>" matching FlowBlockSpec.id, laid out at the same
  content width the final paginated page will use (margins already
  subtracted) - a flat, unbounded-height single container, never
  page-broken itself (this call's only purpose is measurement).
*/
export async function measureFlowLayout(flatHtml: string, blockSpecs: FlowBlockSpec[], budget: PaginationPageBudget): Promise<GenericPaginationPlan> {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(flatHtml, { waitUntil: "load" });
    const heights: Record<string, number> = await page.evaluate((ids: string[]) => {
      const out: Record<string, number> = {};
      for (const id of ids) {
        const el = document.querySelector(`[data-flow-id="${CSS.escape(id)}"]`);
        out[id] = el ? el.getBoundingClientRect().height : 0;
      }
      return out;
    }, blockSpecs.map((b) => b.id));

    const blocks: PaginatableBlock[] = blockSpecs.map((spec) => ({
      id: spec.id,
      sectionKey: spec.sectionKey,
      heightPx: heights[spec.id] ?? 0,
      headerHeightPx: heights[spec.id] ?? 0,
      subItemHeightsPx: [],
      keepTogether: spec.keepTogether,
      canSplit: false,
      splitStrategy: "none",
      isFirstBlockInSection: spec.isFirstBlockInSection,
    }));

    return buildGenericPaginationPlan(blocks, budget);
  } finally {
    await page.close();
  }
}

export function groupPlacementsByPage(plan: GenericPaginationPlan): string[][] {
  const pages: string[][] = Array.from({ length: plan.pageCount }, () => []);
  for (const placement of plan.placements) {
    pages[placement.pageIndex].push(placement.blockId);
  }
  return pages;
}
