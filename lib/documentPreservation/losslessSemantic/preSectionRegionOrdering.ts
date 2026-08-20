/*
  Phase 3C - Conservative Multi-Column / Sidebar Region Ordering.

  groupIntoLines emits blocks in ROW-MAJOR order: on a two-column page a
  left-column line and the right-column line beside it arrive adjacent to
  one another, interleaved all the way down the page. detectSectionBoundaries
  then slices sections as index ranges over that single flat stream, so a
  heading in one physical column terminates the section that a heading in
  the OTHER column opened. The two columns absorb and truncate each other's
  sections. That is the whole defect this module addresses.

  It fixes it the narrowest way available: by handing the EXISTING detector
  a better-ordered array. Nothing else changes - not the block objects, not
  their text, geometry, ids or provenance, and not one line of the section
  detector, which stays a pure index-slicer over whatever order it is given.

  WHEN IT FIRES (all required, per page, evidence-only):

    - every block on the page carries geometry;
    - there is a band - the page, optionally minus a leading full-width
      top band - that splits cleanly in two;
    - "cleanly" means a vertical position exists that NO block's horizontal
      extent crosses, with multiple blocks on each side;
    - EXACTLY ONE such split exists in that band;
    - and BOTH sides own heading -> body structure of their own.

  That last condition is the load-bearing one. Geometry alone cannot tell a
  page column from a table, a right-aligned date/location rail, or a local
  two-column Skills grid - all three produce two clean horizontal ranges
  that repeat convincingly down the page. What separates them is document
  structure: a real column is an independent reading flow that opens its
  OWN sections, whereas a rail or a grid cell is subordinate to a heading
  that lives on the other side. Heading evidence is not recomputed here; it
  is read from scoreHeadingCandidates, the same scoring the section detector
  itself uses, so this module can never disagree with it about what a
  heading is.

  Deliberately absent: any tuned magnitude. No gutter width, no column
  width, no span percentage, no block-count ratio, no balance or confidence
  score. Every test above is either a boolean (does an extent cross this
  position) or an existence check (is there a heading with body under it).
  "Multiple blocks per side" is a structural minimum, not a tuned one. A
  gutter can be hairline or enormous and it changes nothing.

  REFUSAL IS THE DEFAULT, and refusal returns the caller's own array
  unchanged - not a copy, not an equivalent sequence. Anything outside the
  supported shape is refused rather than approximated: heading-less
  sidebars, three or more flows, a full-width band BELOW the columns,
  repeated region transitions, and any page offering more than one valid
  split (which is ambiguity, and ambiguity here means a wrong answer is as
  likely as a right one). A false positive scrambles a resume that parses
  correctly today, so the trade is deliberately high precision / lower
  recall.

  Ordering is inferred independently per page - no anchor, split or
  heading state carries across a page boundary, since page 2 of a resume
  routinely has a different layout from page 1. Sections themselves are
  never closed here: this step only permutes blocks within a page, so a
  section already spanning a page boundary keeps spanning it.
*/
import { scoreHeadingCandidates } from "./sectionBoundaryDetector";
import type { SemanticContentBlock } from "./types";

type PositionedBlock = SemanticContentBlock & { bbox: NonNullable<SemanticContentBlock["bbox"]> };

/*
  Every vertical position that no block's horizontal extent crosses, and
  that leaves multiple blocks on each side. A gap in the union of the
  blocks' horizontal extents always ends exactly at some block's left edge
  - the leftmost block starting after it - so testing each left edge finds
  every such position, and no arbitrary scan step is involved. A valid
  position always cuts the horizontally-sorted blocks into a prefix and a
  suffix, so the number of blocks on the left identifies the partition
  uniquely and is what de-duplicates positions describing the same split.
*/
function separatingPartitions(band: PositionedBlock[]): { left: PositionedBlock[]; right: PositionedBlock[] }[] {
  const partitions: { left: PositionedBlock[]; right: PositionedBlock[] }[] = [];
  const seenLeftCounts = new Set<number>();

  for (const position of band.map((b) => b.bbox.x)) {
    if (band.some((b) => b.bbox.x < position && b.bbox.x + b.bbox.width > position)) continue;

    const left = band.filter((b) => b.bbox.x < position);
    const right = band.filter((b) => b.bbox.x >= position);
    if (left.length < 2 || right.length < 2) continue;
    if (seenLeftCounts.has(left.length)) continue;

    seenLeftCounts.add(left.length);
    partitions.push({ left, right });
  }

  return partitions;
}

/*
  Does this side read as an independent flow - does it open a section of
  its own rather than merely sitting beside one? Proven by a heading on
  this side with body content of its own beneath it, on this same side. A
  metadata rail or a grid column has content but no heading; a stray
  heading-like fragment has no body under it. Both are refused.
*/
function ownsHeadingFlow(side: PositionedBlock[], headingIds: Set<string>): boolean {
  return side.some(
    (heading) =>
      headingIds.has(heading.id) &&
      side.some((body) => !headingIds.has(body.id) && body.bbox.y > heading.bbox.y)
  );
}

/*
  Returns the page's blocks in region-major order, or null to refuse.

  The leading full-width top band (name, contact line, a headline spanning
  both columns) is whatever sits above the first band that splits at all:
  such blocks cross every candidate position by definition, so they cannot
  be part of a two-flow band and are found simply by walking down from the
  top until the remainder splits. Taking the FIRST band that splits keeps
  the top band as small as the evidence allows, and guarantees no block
  inside the accepted band crosses its split.
*/
function orderPage(page: PositionedBlock[], headingIds: Set<string>): PositionedBlock[] | null {
  const byVerticalPosition = [...page].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);

  for (let bandStart = 0; byVerticalPosition.length - bandStart >= 4; bandStart++) {
    const partitions = separatingPartitions(byVerticalPosition.slice(bandStart));
    if (partitions.length === 0) continue;

    // More than one valid split is three-or-more flows, or a shape this
    // phase cannot read unambiguously. Refuse rather than pick one.
    if (partitions.length > 1) return null;

    const { left, right } = partitions[0];
    if (!ownsHeadingFlow(left, headingIds)) return null;
    if (!ownsHeadingFlow(right, headingIds)) return null;

    // Emit top band, then left flow, then right flow - each filtered out
    // of the page's ORIGINAL order, so relative order inside every region
    // survives exactly as groupIntoLines produced it.
    const topBandIds = new Set(byVerticalPosition.slice(0, bandStart).map((b) => b.id));
    const leftIds = new Set(left.map((b) => b.id));
    return [
      ...page.filter((b) => topBandIds.has(b.id)),
      ...page.filter((b) => !topBandIds.has(b.id) && leftIds.has(b.id)),
      ...page.filter((b) => !topBandIds.has(b.id) && !leftIds.has(b.id)),
    ];
  }

  return null;
}

/*
  Reorders blocks into region-major order on pages that are provably
  two-column, and returns the caller's own array untouched everywhere
  else. Ordering is this function's only effect: no block is copied,
  mutated or dropped, and the returned array is always a permutation of
  the one passed in.
*/
export function orderBlocksForSectionDetection(
  blocks: SemanticContentBlock[],
  recordIntentionalPageOrder?: (pageIndex: number, orderedBlockIds: string[]) => void
): SemanticContentBlock[] {
  if (blocks.length === 0) return blocks;

  const positioned: PositionedBlock[] = [];
  for (const block of blocks) {
    // A page mixing positioned and unpositioned blocks cannot be reasoned
    // about geometrically at all (DOCX, and PDFs whose analyzer produced
    // no boxes) - refuse the whole document rather than part of it.
    if (block.bbox === undefined) return blocks;
    positioned.push(block as PositionedBlock);
  }

  // Grouped per page, in the order the pages already appear. If a page's
  // blocks are not contiguous the input is not the page-ordered stream
  // this module is written against, and regrouping it would itself be a
  // reordering across pages - so refuse.
  const pages: PositionedBlock[][] = [];
  for (const block of positioned) {
    const currentPage = pages[pages.length - 1];
    if (currentPage !== undefined && currentPage[0].pageIndex === block.pageIndex) {
      currentPage.push(block);
      continue;
    }
    if (pages.some((page) => page[0].pageIndex === block.pageIndex)) return blocks;
    pages.push([block]);
  }

  const headingIds = new Set(scoreHeadingCandidates(blocks).map((candidate) => blocks[candidate.blockIndex].id));

  const orderedPages = pages.map((page) => orderPage(page, headingIds) ?? page);
  if (orderedPages.every((page, index) => page === pages[index])) return blocks;

  /*
    Declare the COMPLETE final block order of every page this function
    actually permuted. The lossless validator holds within-page
    sourceOrder monotonicity as a hard invariant, which an intentional
    region-major permutation necessarily breaks; rather than granting it
    a blanket "reordering happened" permission - which would equally
    excuse an accidental reorder introduced anywhere downstream - the
    validator is told the exact sequence to expect and re-derives the
    actual one itself. A declaration is a claim to be checked, never a
    right to reorder.

    Recorded HERE, where the permutation is produced, and never
    reconstructed later from the assembled document: a declaration
    derived from the very thing it authorizes would authorize anything.
    Whole pages only, so a stray reorder ELSEWHERE on an otherwise
    legitimately reordered page is still caught. Refused pages, and
    accepted pages whose order did not actually change, are not declared
    at all.
  */
  if (recordIntentionalPageOrder !== undefined) {
    orderedPages.forEach((orderedPage, index) => {
      const sourcePage = pages[index];
      if (orderedPage === sourcePage) return;
      if (orderedPage.every((block, position) => block === sourcePage[position])) return;
      recordIntentionalPageOrder(orderedPage[0].pageIndex, orderedPage.map((block) => block.id));
    });
  }

  return orderedPages.flat();
}
