/*
  TASK 6/7 - Pure-TypeScript pagination packer. Consumes ONE
  FlatMeasurementResult (real browser heights, already captured by
  measurement.ts for a specific paperSize+density) plus Phase 3's own
  per-block break/keepTogether/splitStrategy policy and produces a
  PaginationPlan - no browser access here, no re-measurement: this is
  the "gap-adjust in TS" half of the "measure once, pack in TS, verify
  once" design (see measurement.ts's own header comment).

  Core loop: walk visible sections in fixed order, walk each section's
  blocks in order, greedily place whole blocks on the current page while
  they fit; when a block doesn't fit, either move it whole to a fresh
  page (keepTogether === "whole-block", or the block isn't splittable)
  or split it at a sub-item boundary (only ever between-bullets/
  between-paragraphs/between-items - matches breakPolicy.ts's own
  splitStrategy, never mid-item). Content is NEVER dropped: a block
  that's still too tall for an entire empty page is split across as
  many pages as it takes.

  Orphan prevention (spec section 10, A-I):
  - keepHeadingWithFirstBlock: a section heading never appears alone at
    the bottom of a page with its first block pushed to the next page -
    if the heading + first block's minimum keep-together chunk doesn't
    fit, the WHOLE section (heading included) starts a fresh page.
  - keepTogether === "heading-with-first-item" /
    "entry-header-with-first-content": a block's own header is never
    separated from its first sub-item - if header+item0 doesn't fit
    remaining space, the block moves to a fresh page instead of
    splitting immediately after the header.

  Gaps between blocks (entryGapPx) and between sections (sectionGapPx)
  are known density constants (designTokens.ts), not measured - they're
  added directly in the packing math below, mirroring measurement.ts's
  own "gaps are constants, content wrapping needs a real browser" split.
*/
import { DENSITY_SPACING, PAPER_DIMENSIONS } from "./designTokens";
import type { PaginationPlan, FlatMeasurementResult, BlockPlacement, SectionHeadingPlacement, PaperSize, MeasuredBlock } from "./types";
import type { AssemblyDensity, ProfessionalAtsAssemblyDocument, AssemblyBlock, ProfessionalAtsSectionKey } from "../professionalAtsAssembly/types";

const MM_TO_PX = 96 / 25.4;
const IN_TO_PX = 96;

function paperHeightPx(paperSize: PaperSize): number {
  return paperSize === "letter" ? 11 * IN_TO_PX : 297 * MM_TO_PX;
}

type PageCursor = {
  pageIndex: number;
  remainingPx: number;
};

function newPage(index: number, usableHeightPx: number): PageCursor {
  return { pageIndex: index, remainingPx: usableHeightPx };
}

/*
  Phase 5D.6 TASK A - single source of truth for "does this block need
  to move to a fresh page AS A WHOLE (header + every sub-item), rather
  than just its header + first sub-item, when it doesn't fit as-is".
  Real bug this fixes: the heading pre-check below used to compute its
  own, DIFFERENT estimate of the first block's minimum keep-together
  chunk (canSplit + subItems.length only), while the per-block
  placement loop further down separately decided whether to move the
  WHOLE block based on canSplit AND keepTogether ("whole-block"/
  "whole-entry-if-fits"). Those two decisions could diverge: a block
  like education-entry with 2+ details gets canSplit:true (so the
  pre-check assumed only "header + first detail" was needed) but
  keepTogether:"whole-entry-if-fits" (so the real placement loop, when
  the whole entry didn't fit, moved the ENTIRE entry to the next page
  anyway) - stranding the section heading, already placed on the
  previous page by the pre-check's too-small estimate, alone at the
  bottom of that page. Both call sites now call this one function, so
  they can never again disagree about how much room a block needs.
*/
function requiresWholeBlock(block: AssemblyBlock, measured: MeasuredBlock): boolean {
  const canReallySplit = block.canSplit && measured.subItems.length > 0;
  return !canReallySplit || block.keepTogether === "whole-block" || block.keepTogether === "whole-entry-if-fits";
}

export function buildPaginationPlan(
  assembly: ProfessionalAtsAssemblyDocument,
  measurement: FlatMeasurementResult,
  paperSize: PaperSize,
  density: AssemblyDensity
): PaginationPlan {
  const tokens = DENSITY_SPACING[density];
  const usableHeightPx = paperHeightPx(paperSize) - 2 * tokens.pagePaddingPx;

  const measuredBlockById = new Map(measurement.blocks.map((b) => [b.blockId, b]));
  const measuredHeadingBySection = new Map(measurement.sectionHeadings.map((h) => [h.sectionKey, h.heightPx]));

  const sectionHeadingPlacements: SectionHeadingPlacement[] = [];
  const blockPlacements: BlockPlacement[] = [];

  let cursor = newPage(0, usableHeightPx);
  let isFirstElementOnPage = true;

  function consume(heightPx: number, gapBeforeIfNotFirst: number) {
    const gap = isFirstElementOnPage ? 0 : gapBeforeIfNotFirst;
    cursor.remainingPx -= gap + heightPx;
    isFirstElementOnPage = false;
  }

  function advancePage() {
    cursor = newPage(cursor.pageIndex + 1, usableHeightPx);
    isFirstElementOnPage = true;
  }

  const visibleSections = assembly.sections.filter((s) => s.visible);

  for (let sectionIdx = 0; sectionIdx < visibleSections.length; sectionIdx++) {
    const section = visibleSections[sectionIdx];
    const headingHeight = measuredHeadingBySection.get(section.key) ?? 0;
    const headingTotalSpace = headingHeight > 0 ? headingHeight + tokens.headingMarginBottomPx : 0;
    const sectionGap = sectionIdx === 0 ? 0 : tokens.sectionGapPx;

    // Estimate the minimum chunk of the section's FIRST block that must
    // stay with the heading (whole block if requiresWholeBlock() says
    // so - unsplittable OR keepTogether demands the entire entry, else
    // header+first-subitem only) - used to decide whether the heading
    // itself needs to move to a fresh page. Uses the exact same
    // requiresWholeBlock() the per-block placement loop below uses, so
    // this estimate can never again diverge from what actually happens
    // when that block is placed.
    const firstBlock = section.blocks[0];
    let firstBlockMinChunk = 0;
    if (firstBlock && section.keepHeadingWithFirstBlock) {
      const measured = measuredBlockById.get(firstBlock.id);
      if (measured) {
        firstBlockMinChunk = requiresWholeBlock(firstBlock, measured)
          ? measured.totalHeightPx
          : measured.headerHeightPx + tokens.bulletGapPx + measured.subItems[0].heightPx;
      }
    }

    // No entryGapPx term here: gapBeforeBlock is always 0 for a
    // section's first block (see isFirstBlockInSection below) - the
    // heading's own headingMarginBottomPx (already folded into
    // headingTotalSpace) is the only gap the real render puts between
    // the heading and its first block.
    const neededForHeadingAndFirstBlock = (isFirstElementOnPage ? 0 : sectionGap) + headingTotalSpace + firstBlockMinChunk;

    if (headingTotalSpace > 0 && section.keepHeadingWithFirstBlock && firstBlockMinChunk > 0 && neededForHeadingAndFirstBlock > cursor.remainingPx && !isFirstElementOnPage) {
      advancePage();
    }

    if (headingTotalSpace > 0) {
      // Consume headingTotalSpace (heading's own rect height PLUS its
      // marginBottom), not just headingHeight - the marginBottom IS the
      // visual gap before the section's first block (see
      // SectionHeadingView's own marginBottom style), so omitting it
      // here would silently let the planner believe it has more room
      // than a real render does (caught by htmlValidator.ts's
      // independent overflow recomputation, which DOES include it).
      consume(headingTotalSpace, sectionGap);
      sectionHeadingPlacements.push({ pageIndex: cursor.pageIndex, sectionKey: section.key });
    } else if (!isFirstElementOnPage) {
      // No heading (e.g. identity) but still a new section - account for
      // the section gap before its first block via the entry-gap path
      // below by NOT resetting isFirstElementOnPage; entryGapPx already
      // covers inter-block spacing, sectionGap is folded in here once.
      cursor.remainingPx -= sectionGap;
    }

    let isFirstBlockInSection = true;

    for (const block of section.blocks) {
      const measured = measuredBlockById.get(block.id);
      if (!measured) continue; // defensive - every visible block is always measured

      const gapBeforeBlock = isFirstElementOnPage ? 0 : isFirstBlockInSection ? 0 : tokens.entryGapPx;
      isFirstBlockInSection = false;

      // Whole block fits as-is.
      if (gapBeforeBlock + measured.totalHeightPx <= cursor.remainingPx) {
        consume(measured.totalHeightPx, gapBeforeBlock);
        blockPlacements.push({ pageIndex: cursor.pageIndex, sectionKey: section.key, isContinuation: false, blockId: block.id });
        continue;
      }

      // Doesn't fit here. If it's not splittable, or keepTogether
      // demands the whole block stay together, move it whole to a
      // fresh page (even if it will overflow that page too - never
      // silently drop content; overflow is what triggers density
      // escalation one level up in densityAutoFit.ts).
      const total = measured.subItems.length;

      if (requiresWholeBlock(block, measured)) {
        if (!isFirstElementOnPage) advancePage();
        consume(measured.totalHeightPx, 0);
        blockPlacements.push({ pageIndex: cursor.pageIndex, sectionKey: section.key, isContinuation: false, blockId: block.id });
        continue;
      }

      // Splittable: place as many leading sub-items (with header) as
      // fit on the CURRENT page; if not even header+item0 fits, move
      // the whole attempt to a fresh page first (entry-header-with-
      // first-content keep-together).
      let startIndex = 0;
      let remainingOnThisPage = cursor.remainingPx - gapBeforeBlock;
      const headerAndFirst = measured.headerHeightPx + tokens.bulletGapPx + measured.subItems[0].heightPx;

      if (headerAndFirst > remainingOnThisPage && !isFirstElementOnPage) {
        advancePage();
        remainingOnThisPage = cursor.remainingPx;
      } else {
        cursor.remainingPx -= gapBeforeBlock;
        isFirstElementOnPage = false;
      }

      while (startIndex < total) {
        let endIndex = startIndex;
        let usedPx = measured.headerHeightPx;
        let firstOnThisFragment = true;

        while (endIndex < total) {
          const itemGap = firstOnThisFragment ? tokens.bulletGapPx : tokens.bulletGapPx;
          const itemHeight = measured.subItems[endIndex].heightPx;
          const candidate = usedPx + itemGap + itemHeight;
          if (candidate > remainingOnThisPage && endIndex > startIndex) break;
          usedPx = candidate;
          firstOnThisFragment = false;
          endIndex++;
          if (candidate > remainingOnThisPage) break; // forced single-item overflow fragment
        }

        const actualEndIndex = Math.max(startIndex, endIndex - 1);
        blockPlacements.push({
          pageIndex: cursor.pageIndex,
          sectionKey: section.key,
          isContinuation: startIndex > 0,
          blockId: block.id,
          subRange: { startIndex, endIndex: actualEndIndex },
        });
        cursor.remainingPx -= usedPx;
        isFirstElementOnPage = false;

        startIndex = actualEndIndex + 1;
        if (startIndex < total) {
          advancePage();
          remainingOnThisPage = cursor.remainingPx;
        }
      }
    }
  }

  return {
    density,
    pageCount: cursor.pageIndex + 1,
    sectionHeadingPlacements,
    blockPlacements,
  };
}
