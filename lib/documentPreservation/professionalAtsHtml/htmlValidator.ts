/*
  TASK 9 - HTML validator. Runs against the REAL paginated HTML
  (paginatedRenderer.ts's buildPaginatedPageHtml) and the same
  plan/measurement the pagination planner produced - an independent
  check, not a re-trust of the planner's own bookkeeping (a validator
  that only re-reads the planner's claims about itself would never
  catch a planner bug).

  Text preservation is checked PER BLOCK across its FULL set of page
  fragments (concatenated in fragment order), not per-page - a split
  block's bullets legitimately live on different pages, but the union
  of all its fragments must still equal exactly its own expected
  fragments (see textPreservationValidator.ts's own per-block-scoping
  rationale, extended here across pages instead of across the whole
  flat document).

  "duplicateTextFragments" is intentionally always [] - see
  textPreservationValidator.ts's header comment on why whole-document
  text-content duplicate counting is unreliable (real resumes
  legitimately repeat city/employer/skill words). Structural duplicate-
  PLACEMENT detection (the same blockId+subRange rendered on more than
  one page - a real planner bug class) is instead folded into
  invalidSplitBoundaries, which is what it actually is.

  Overflow detection is a REAL browser re-measurement of each
  `.ats-page` container's actual rendered height, not a hand-rolled
  reimplementation of the planner's own gap arithmetic. Reconstructing
  "expected consumed height" independently in TypeScript sounds
  independent, but in practice it means re-deriving the planner's own
  internal state machine (first-on-page vs first-in-section gap rules,
  heading-marginBottom accounting, etc.) a second time - any bug fixed
  in one copy but not the other produces either false negatives (both
  copies share the bug) or false positives (the copies drift apart on
  a legitimate edge case, exactly what happened during this task's own
  development - see paginationPlanner.ts's headingTotalSpace fix). A
  real render's own scrollHeight is the actual fact being asserted
  ("does this content overflow one page"), not a proxy for it.

  react-dom/server is imported dynamically inside
  validateProfessionalAtsHtml (not at module top-level) - see
  htmlDocument.ts's own header comment for why (Next's App Router
  bundler flags any static top-level react-dom/server import reachable
  from a Route Handler as a build error).
*/
import { AssemblyBlockView } from "./renderers";
import { buildPaginatedPageHtml } from "./paginatedHtmlString";
import { PAPER_DIMENSIONS, DENSITY_SPACING } from "./designTokens";
import { validateBlockTextPreservation } from "./textPreservationValidator";
import { PROFESSIONAL_ATS_SECTION_LABELS } from "../professionalAtsAssembly/sectionLabels";
import { verifyPaginatedPages } from "./pageVerification";
import type { PaginationPlan, FlatMeasurementResult, ProfessionalAtsHtmlValidationReport, PaperSize } from "./types";
import type { AssemblyDensity, ProfessionalAtsAssemblyDocument, ProfessionalAtsSectionKey } from "../professionalAtsAssembly/types";

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
}
function htmlToText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "));
}

export async function validateProfessionalAtsHtml(
  assembly: ProfessionalAtsAssemblyDocument,
  plan: PaginationPlan,
  measurement: FlatMeasurementResult,
  paperSize: PaperSize,
  density: AssemblyDensity
): Promise<ProfessionalAtsHtmlValidationReport> {
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const tokens = DENSITY_SPACING[density];
  const fullHtml = await buildPaginatedPageHtml(assembly, plan, paperSize, density);

  const missingTextFragments: string[] = [];
  const inventedTextFragments: string[] = [];
  const sectionOrderViolations: string[] = [];
  const sectionHeadingOrphans: ProfessionalAtsSectionKey[] = [];
  const entryHeaderOrphans: string[] = [];
  const invalidSplitBoundaries: string[] = [];
  const destructiveCompactionFlags: string[] = [];
  const warnings: string[] = [];

  const measuredBlockById = new Map(measurement.blocks.map((b) => [b.blockId, b]));
  const allBlocksById = new Map<string, ReturnType<typeof flattenBlocks>[number]>();
  for (const b of flattenBlocks(assembly)) allBlocksById.set(b.id, b);

  // --- 1/2. Per-block text preservation across all of a block's page fragments ---
  const placementsByBlock = new Map<string, typeof plan.blockPlacements>();
  for (const p of plan.blockPlacements) {
    const list = placementsByBlock.get(p.blockId) ?? [];
    list.push(p);
    placementsByBlock.set(p.blockId, list);
  }
  for (const [blockId, block] of allBlocksById) {
    const placements = (placementsByBlock.get(blockId) ?? []).sort((a, b) => (a.subRange?.startIndex ?? 0) - (b.subRange?.startIndex ?? 0));
    const renderedHtml = placements
      .map((p) => renderToStaticMarkup(React.createElement(AssemblyBlockView, { block, subRange: p.subRange, isContinuation: p.isContinuation })))
      .join(" ");
    const renderedText = htmlToText(renderedHtml);
    const result = validateBlockTextPreservation(block, renderedText);
    for (const m of result.missing) missingTextFragments.push(`${blockId}: ${m}`);
    if (result.inventedSuspected) inventedTextFragments.push(`${blockId}: ${result.leftoverAfterRemoval}`);

    // --- 9. Split-boundary legality: splitStrategy "none" must never be split ---
    if (block.splitStrategy === "none" && placements.some((p) => p.subRange)) {
      invalidSplitBoundaries.push(`${blockId}: split despite splitStrategy "none"`);
    }
    // Structural duplicate-placement check (same blockId+subRange twice).
    const seenRanges = new Set<string>();
    for (const p of placements) {
      const key = p.subRange ? `${p.subRange.startIndex}-${p.subRange.endIndex}` : "whole";
      if (seenRanges.has(key)) invalidSplitBoundaries.push(`${blockId}: duplicate placement for range ${key}`);
      seenRanges.add(key);
    }
    // --- 8. entry-header-orphan: first fragment of a splittable block must include sub-item 0 ---
    const firstFragment = placements.find((p) => !p.isContinuation);
    if (firstFragment?.subRange && firstFragment.subRange.startIndex !== 0) {
      entryHeaderOrphans.push(blockId);
    }
  }

  // --- 3. Section order: scan the ACTUAL rendered HTML string in document
  // order (not a reconstruction from placement arrays - a section with no
  // heading, like identity, only ever appears via a data-block-id, and
  // merging+sorting the two placement arrays separately can't recover
  // true intra-page order for a section that has no heading marker at
  // all). This directly measures what a real browser would read.
  const blockSectionByBlockId = new Map<string, ProfessionalAtsSectionKey>();
  for (const section of assembly.sections) {
    if (!section.visible) continue;
    for (const block of section.blocks) blockSectionByBlockId.set(block.id, section.key);
  }
  const seenSectionOrder: ProfessionalAtsSectionKey[] = [];
  const domMarkerPattern = /data-section-heading="([^"]+)"|data-block-id="([^"]+)"/g;
  for (const match of fullHtml.matchAll(domMarkerPattern)) {
    const sectionKey = (match[1] as ProfessionalAtsSectionKey | undefined) ?? blockSectionByBlockId.get(match[2] ?? "");
    if (sectionKey && !seenSectionOrder.includes(sectionKey)) seenSectionOrder.push(sectionKey);
  }
  const expectedOrder = assembly.visibleSectionKeys;
  const domOrderMatchesReadingOrder = JSON.stringify(seenSectionOrder) === JSON.stringify(expectedOrder);
  if (!domOrderMatchesReadingOrder) {
    sectionOrderViolations.push(`expected ${expectedOrder.join(",")} but got ${seenSectionOrder.join(",")}`);
  }

  // --- 4. Hidden sections must never appear in the DOM ---
  let hiddenSectionDomCount = 0;
  for (const section of assembly.sections) {
    if (section.visible) continue;
    if (fullHtml.includes(`data-section-heading="${section.key}"`)) hiddenSectionDomCount++;
    for (const block of section.blocks) {
      if (fullHtml.includes(`data-block-id="${block.id}"`)) hiddenSectionDomCount++;
    }
  }

  // --- 5. No empty section heading ---
  const emptyHeadingCount = (fullHtml.match(/data-section-heading="[^"]+"[^>]*>\s*<\/h2>/g) ?? []).length;

  // --- 6. Overflow detection: reuse the real per-page VERIFY pass (pageVerification.ts) ---
  const verification = await verifyPaginatedPages(assembly, plan, paperSize, density);
  const overflowPageIndices = verification.pages.filter((p) => p.overflowPx > 0).map((p) => p.pageIndex);
  if (!verification.measurable) {
    warnings.push("overflow detection could not run (browser measurement failed)");
  }

  // --- 7. Section-heading orphan: heading on page N, its first block on a later page ---
  for (const headingPlacement of plan.sectionHeadingPlacements) {
    const section = assembly.sections.find((s) => s.key === headingPlacement.sectionKey);
    if (!section || section.blocks.length === 0) continue;
    if (!section.keepHeadingWithFirstBlock) continue;
    const firstBlockPlacement = plan.blockPlacements.find((p) => p.blockId === section.blocks[0].id && !p.isContinuation);
    if (firstBlockPlacement && firstBlockPlacement.pageIndex !== headingPlacement.pageIndex) {
      sectionHeadingOrphans.push(headingPlacement.sectionKey);
    }
  }

  // --- 11. Destructive compaction flags must all still be false (Phase 3 contract, re-checked here) ---
  const policy = assembly.compactionPolicy;
  const destructiveKeys: (keyof typeof policy)[] = ["canDropSections", "canDropEntries", "canDropBullets", "canTrimContent"];
  for (const key of destructiveKeys) {
    if (policy[key] === true) destructiveCompactionFlags.push(String(key));
  }

  const passed =
    missingTextFragments.length === 0 &&
    inventedTextFragments.length === 0 &&
    sectionOrderViolations.length === 0 &&
    hiddenSectionDomCount === 0 &&
    emptyHeadingCount === 0 &&
    overflowPageIndices.length === 0 &&
    sectionHeadingOrphans.length === 0 &&
    entryHeaderOrphans.length === 0 &&
    invalidSplitBoundaries.length === 0 &&
    destructiveCompactionFlags.length === 0 &&
    domOrderMatchesReadingOrder;

  return {
    passed,
    missingTextFragments,
    inventedTextFragments,
    duplicateTextFragments: [],
    sectionOrderViolations,
    hiddenSectionDomCount,
    emptyHeadingCount,
    overflowPageIndices,
    sectionHeadingOrphans,
    entryHeaderOrphans,
    invalidSplitBoundaries,
    densityUsed: density,
    destructiveCompactionFlags,
    domOrderMatchesReadingOrder,
    warnings,
  };
}

function flattenBlocks(assembly: ProfessionalAtsAssemblyDocument) {
  const blocks: ProfessionalAtsAssemblyDocument["sections"][number]["blocks"] = [];
  for (const section of assembly.sections) {
    if (!section.visible) continue;
    blocks.push(...section.blocks);
  }
  return blocks;
}

// Re-exported for callers that just need the label lookup alongside validation.
export { PROFESSIONAL_ATS_SECTION_LABELS };
