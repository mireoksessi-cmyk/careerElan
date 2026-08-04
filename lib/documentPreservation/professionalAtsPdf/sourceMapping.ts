/*
  TASK 6 - Projects Phase 4's own PaginationPlan.blockPlacements into a
  per-PDF-page source mapping. No new computation: this is a pure
  grouping of already-decided placements, so a PDF page's source is
  always traceable back to the exact Phase 3/4 decision that put it
  there.
*/
import type { PaginationPlan } from "../professionalAtsHtml/types";
import type { PdfSourcePage } from "./types";

export function buildSourcePagePlan(plan: PaginationPlan): PdfSourcePage[] {
  const pages = new Map<number, PdfSourcePage>();
  for (let i = 0; i < plan.pageCount; i++) {
    pages.set(i, { pageIndex: i, sourceBlockIds: [], sourceEntryIds: [] });
  }

  for (const placement of plan.blockPlacements) {
    const page = pages.get(placement.pageIndex);
    if (!page) continue;
    if (!page.sourceBlockIds.includes(placement.blockId)) page.sourceBlockIds.push(placement.blockId);
    const entryId = placement.subRange ? `${placement.blockId}#${placement.subRange.startIndex}-${placement.subRange.endIndex}` : placement.blockId;
    page.sourceEntryIds.push(entryId);
  }

  return [...pages.values()].sort((a, b) => a.pageIndex - b.pageIndex);
}
