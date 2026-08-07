/*
  TASK 6 - PDF text preservation, adapted from Phase 4's
  textPreservationValidator.ts for a PDF native text layer instead of
  per-block isolated HTML markup.

  Two checks at two different granularities, because a PDF page's
  native text (unlike an isolated per-block HTML render) always
  contains EVERY block/heading placed on that page, not just one:

  1. MISSING fragments - checked per BLOCK, by concatenating only the
     PDF pages that block's own placements (from Phase 4's
     PaginationPlan) say it appears on. Reuses expectedBlockFragments()
     from textPreservationValidator.ts, but matches with THIS file's
     own (hyphen-tolerant) boundaryPattern rather than Phase 4's
     validateBlockTextPreservation() - HTML has no hyphen/text-run
     splitting artifact, so reusing Phase 4's HTML-only boundaryPattern
     here would flag real, present text as "missing" whenever pdfjs's
     getTextContent() happens to split a hyphenated word across two
     TextItems (see boundaryPattern's own comment below). Scoped to the
     block's own pages keeps this precise even on a document with many
     blocks per page.

  2. INVENTED fragments - checked per PAGE, not per block: the expected
     set for a page is the UNION of every block's/heading's own
     fragments placed on that page (per the same PaginationPlan), with
     the same longest-fragment-first removal Phase 4's own validator
     uses (see that file's own header comment on why length order
     matters - a block containing one fragment that is itself a
     substring of another must have the longer one consumed first).
     Checking per-block here (like Phase 4 does) would be meaningless
     for a PDF page's UN-isolated text - every OTHER block sharing that
     physical page would show up as "invented" noise. Checking per
     PAGE is the correct PDF-native analogue of Phase 4's per-block
     scoping: it isolates false positives to "stuff on this physical
     page that isn't accounted for by anything the plan put there",
     never polluted by content that's correctly on a DIFFERENT page.
*/
import { expectedBlockFragments } from "../professionalAtsHtml/textPreservationValidator";
import { PROFESSIONAL_ATS_SECTION_LABELS } from "../professionalAtsAssembly/sectionLabels";
import type { AssemblyBlock, ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";
import type { PaginationPlan } from "../professionalAtsHtml/types";
import type { PdfPageText } from "./pdfTextExtraction";
import type { PdfTextValidationResult } from "./types";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/*
  pdfjs-dist's getTextContent() occasionally splits a word across two
  separate TextItems at a line-wrap boundary (e.g. "root-cause" ->
  item "root-" + item "cause", or a long URL wrapped mid-path at a
  "/"), and joining items with a uniform space in
  extractPdfPageText() then introduces a stray space right at that
  boundary ("root- cause", "example.com/ path") that never existed in
  the source content or the Phase-4-validated HTML. This is a text-
  EXTRACTION artifact, not real content loss (confirmed by direct
  inspection: the surrounding text, including the hyphen/slash itself,
  is intact) - so the PDF-native comparison tolerates an optional
  single space immediately after any hyphen OR slash in the expected
  fragment (Chromium's own soft-wrap opportunities inside a long
  unbroken token fall at both characters), unlike Phase 4's own
  textPreservationValidator.ts (HTML has no such artifact, so its
  boundaryPattern doesn't need this).
*/
function boundaryPattern(fragment: string): RegExp {
  const escaped = escapeRegExp(fragment).replace(/-/g, "-\\s?").replace(/\//g, "/\\s?");
  const startsAlnum = /^[A-Za-z0-9]/.test(fragment);
  const endsAlnum = /[A-Za-z0-9]$/.test(fragment);
  return new RegExp(`${startsAlnum ? "\\b" : ""}${escaped}${endsAlnum ? "\\b" : ""}`, "g");
}

function flattenVisibleBlocks(assembly: ProfessionalAtsAssemblyDocument): AssemblyBlock[] {
  const blocks: AssemblyBlock[] = [];
  for (const section of assembly.sections) {
    if (!section.visible) continue;
    blocks.push(...section.blocks);
  }
  return blocks;
}

export function validatePdfTextPreservation(
  assembly: ProfessionalAtsAssemblyDocument,
  plan: PaginationPlan,
  pdfPages: PdfPageText[]
): PdfTextValidationResult {
  const pageTextByIndex = new Map(pdfPages.map((p) => [p.pageIndex, p.text]));
  const blocks = flattenVisibleBlocks(assembly);
  const blockById = new Map(blocks.map((b) => [b.id, b]));

  const placementsByBlock = new Map<string, typeof plan.blockPlacements>();
  for (const p of plan.blockPlacements) {
    const list = placementsByBlock.get(p.blockId) ?? [];
    list.push(p);
    placementsByBlock.set(p.blockId, list);
  }

  /* --- 1. Missing fragments, scoped per block --- */
  const missingFragments: string[] = [];
  let expectedFragmentCount = 0;
  let foundFragmentCount = 0;

  for (const block of blocks) {
    const placements = placementsByBlock.get(block.id) ?? [];
    const pageIndices = [...new Set(placements.map((p) => p.pageIndex))].sort((a, b) => a - b);
    const concatenatedText = pageIndices.map((idx) => pageTextByIndex.get(idx) ?? "").join(" ");

    const expected = expectedBlockFragments(block);
    expectedFragmentCount += expected.length;
    for (const fragment of expected) {
      if (boundaryPattern(fragment).test(concatenatedText)) {
        foundFragmentCount++;
      } else {
        missingFragments.push(`${block.id}: ${fragment}`);
      }
    }
  }

  /* --- 2. Invented fragments, scoped per page --- */
  const blockIdsByPage = new Map<number, string[]>();
  const sectionKeysByPage = new Map<number, Set<string>>();
  for (const p of plan.blockPlacements) {
    const list = blockIdsByPage.get(p.pageIndex) ?? [];
    list.push(p.blockId);
    blockIdsByPage.set(p.pageIndex, list);
  }
  for (const h of plan.sectionHeadingPlacements) {
    const set = sectionKeysByPage.get(h.pageIndex) ?? new Set<string>();
    set.add(h.sectionKey);
    sectionKeysByPage.set(h.pageIndex, set);
  }

  const inventedFragments: string[] = [];
  const safeSectionLabels = Object.values(PROFESSIONAL_ATS_SECTION_LABELS).filter((l): l is string => l !== null);

  for (const pageText of pdfPages) {
    const blockIds = [...new Set(blockIdsByPage.get(pageText.pageIndex) ?? [])];
    const headingLabels = [...(sectionKeysByPage.get(pageText.pageIndex) ?? [])]
      .map((key) => PROFESSIONAL_ATS_SECTION_LABELS[key as keyof typeof PROFESSIONAL_ATS_SECTION_LABELS])
      .filter((l): l is string => !!l);

    const pageExpectedFragments = blockIds
      .flatMap((id) => (blockById.has(id) ? expectedBlockFragments(blockById.get(id)!) : []))
      .concat(headingLabels)
      .map(normalize)
      .filter((f) => f.length > 0);

    let leftover = normalize(pageText.text);
    const byLengthDesc = [...pageExpectedFragments].sort((a, b) => b.length - a.length);
    for (const fragment of byLengthDesc) {
      leftover = leftover.replace(boundaryPattern(fragment), " ");
    }
    for (const safe of safeSectionLabels) leftover = leftover.split(safe).join(" ");
    leftover = leftover.replace(/[·,\-—:/]/g, " ").replace(/\s+/g, " ").trim();

    if (leftover.length > 0) {
      inventedFragments.push(`page ${pageText.pageIndex}: ${leftover}`);
    }
  }

  /* --- Structural duplicate placement check (same class as Phase 4's
     findDuplicateBlockIds, but here checked directly against the
     plan's own blockPlacements rather than a rendered DOM string,
     since PDF text has no data-block-id markers to scan). --- */
  const seen = new Set<string>();
  const duplicateEntryIds: string[] = [];
  for (const p of plan.blockPlacements) {
    const key = p.subRange ? `${p.blockId}#${p.subRange.startIndex}-${p.subRange.endIndex}` : p.blockId;
    if (seen.has(key)) duplicateEntryIds.push(key);
    seen.add(key);
  }

  return {
    expectedFragmentCount,
    foundFragmentCount,
    missingFragments,
    inventedFragments,
    duplicateEntryIds,
  };
}
