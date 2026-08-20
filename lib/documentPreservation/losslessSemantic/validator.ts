/*
  TASK 6 - Lossless Validator. Section 11 of the spec defines six check
  categories (A-F); this file implements A-E as structural checks
  against a single assembled LosslessResumeDocument + the original
  LayoutAnalysisResult it was built from. F (determinism) is NOT a field
  on LosslessValidationReport (see types.ts's own shape, matching the
  spec verbatim) - it can only be proven by invoking the builder twice
  on the same input and diffing the two results, which is a TEST-level
  concern (see buildLosslessDocument.test.ts), not something a single
  document instance can self-report.

  Gate rule (repeated from the spec, not softened here): even ONE
  missing element, ONE duplicate element, or ANY invented text is an
  automatic FAIL. Landing on "custom" is explicitly NOT a failure and
  never affects `passed`.
*/
import type { ElementMetadata, LayoutAnalysisResult } from "../layoutAnalysis/types";
import { elementId } from "./ids";
import { shouldInsertSpaceBetween } from "./blockAdapter";
import type { LosslessResumeDocument, LosslessValidationReport, SemanticContentBlock } from "./types";

/*
  Phase 6I.1 bug fix - reconstructing "expected text" by unconditionally
  joining source elements with a literal space (the old behavior) does
  not match how blockAdapter.ts's own lineText() actually joins them:
  shouldInsertSpaceBetween() deliberately omits the space when the real
  horizontal gap between two elements is too small to be a genuine word
  boundary (the ligature/kerning fix documented in blockAdapter.ts's own
  SPACE_GAP_RATIO comment - e.g. a pdfjs-split "fi"/"fl" glyph run).
  Reconstructing "expected" with the SAME conditional-space rule the
  producer actually used is what makes this a true byte-for-byte
  fidelity check again, rather than a check against a joining rule the
  document was never built with. Found via a real user's real resume,
  which always failed here through no fault of that resume's content -
  any PDF with a ligature-adjacent element pair anywhere would trigger
  the same false "missing text span".
*/
function expectedTextFor(owningElements: ElementMetadata[]): string {
  let joined = "";
  for (let i = 0; i < owningElements.length; i++) {
    const element = owningElements[i];
    const text = element.text ?? "";
    if (i === 0) {
      joined = text;
      continue;
    }
    const needsSpace = shouldInsertSpaceBetween(owningElements[i - 1], element);
    joined += (needsSpace ? " " : "") + text;
  }
  return joined;
}

function collectAllBlocks(doc: LosslessResumeDocument): SemanticContentBlock[] {
  return [...doc.identityBlocks, ...doc.sections.flatMap((s) => s.blocks), ...doc.unassignedBlocks];
}

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildElementById(layoutResult: LayoutAnalysisResult): Map<string, ElementMetadata> {
  const map = new Map<string, ElementMetadata>();
  for (const page of layoutResult.pages) {
    page.elements.forEach((element, index) => {
      map.set(elementId(page.pageNumber, index), element);
    });
  }
  return map;
}

export function validateLosslessDocument(
  doc: LosslessResumeDocument,
  layoutResult: LayoutAnalysisResult,
  intentionalPageOrder?: ReadonlyMap<number, readonly string[]>
): LosslessValidationReport {
  const warnings: string[] = [];
  const elementById = buildElementById(layoutResult);
  const expectedIds = new Set(elementById.keys());
  const allBlocks = collectAllBlocks(doc);

  // --- A. Element coverage ---
  const referenceCounts = new Map<string, number>();
  for (const block of allBlocks) {
    for (const id of block.sourceElementIds) {
      referenceCounts.set(id, (referenceCounts.get(id) ?? 0) + 1);
    }
  }
  const missingElementIds = [...expectedIds].filter((id) => !referenceCounts.has(id));
  const duplicateElementIds = [...referenceCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  const unknownReferencedIds = [...referenceCounts.keys()].filter((id) => !expectedIds.has(id));
  if (unknownReferencedIds.length > 0) {
    warnings.push(`block references element id(s) not present in the source document: ${unknownReferencedIds.join(", ")}`);
  }
  const representedElementCount = [...referenceCounts.keys()].filter((id) => expectedIds.has(id)).length;

  // --- B. Text preservation (+ E. fact safety, since Phase 1 has zero
  // AI/free-text generation - the ONLY way invented text could exist is
  // a block whose rawText doesn't reduce exactly to its own source
  // elements' text, so this single per-block equality check covers
  // both "nothing missing" and "nothing invented" for this pipeline) ---
  const missingTextSpans: string[] = [];
  const inventedTextSpans: string[] = [];
  for (const block of allBlocks) {
    const owningElements = block.sourceElementIds.map((id) => elementById.get(id)).filter((e): e is ElementMetadata => e !== undefined);
    const expectedText = normalizeForCompare(expectedTextFor(owningElements));
    const actualText = normalizeForCompare(block.rawText);
    if (expectedText === actualText) continue;
    if (!actualText.includes(expectedText)) {
      missingTextSpans.push(`${block.id}: expected "${expectedText}" not found in actual "${actualText}"`);
    } else if (actualText.length > expectedText.length) {
      inventedTextSpans.push(`${block.id}: actual "${actualText}" contains text beyond source "${expectedText}"`);
    }
  }

  // --- C. Section preservation ---
  const sectionOrderSequence = doc.sections.map((s) => s.sourceOrder);
  const denseSectionOrder = sectionOrderSequence.every((value, index) => value === index);
  if (!denseSectionOrder) {
    warnings.push(`section sourceOrder is not a dense 0..n-1 sequence: ${JSON.stringify(sectionOrderSequence)}`);
  }
  for (const section of doc.sections) {
    if (section.originalHeading === "") {
      warnings.push(`section ${section.id} has an empty-string originalHeading instead of null - an absent heading must be null, never ""`);
    }
    if ((section.normalizedType === "custom") !== section.isUncertain) {
      warnings.push(`section ${section.id} has normalizedType=custom/isUncertain mismatch (custom sections must always have isUncertain=true)`);
    }
    if (section.displayHeading !== section.originalHeading) {
      warnings.push(`section ${section.id} displayHeading diverges from originalHeading - this round requires verbatim passthrough, no standardization`);
    }
  }

  // --- D. Order preservation ---
  const orderViolations: Array<{ beforeId: string; afterId: string }> = [];
  const sequence = allBlocks;
  for (let i = 1; i < sequence.length; i++) {
    const prev = sequence[i - 1];
    const curr = sequence[i];
    const wentBackAPage = curr.pageIndex < prev.pageIndex;
    const wentBackWithinPage = curr.pageIndex === prev.pageIndex && curr.sourceOrder < prev.sourceOrder;
    if (wentBackAPage || wentBackWithinPage) {
      orderViolations.push({ beforeId: prev.id, afterId: curr.id });
    }
  }

  /*
    --- D2. Exact declared-permutation authorization ---

    A layer that intentionally reorders blocks within a page (the
    region-ordering step, on genuinely multi-column pages) breaks D by
    construction. It may declare the COMPLETE final block-id order of
    each page it permuted, and those violations then stop failing the
    gate - but only after this block re-derives that page's canonical
    order from the blocks' own sourceOrder and confirms the assembled
    document matches the declaration exactly, id for id, position for
    position.

    A declaration is therefore not permission. Marking a page as
    reordered grants nothing by itself: one extra swap, one missing or
    extra block, one duplicated id, one violation on a page nobody
    declared, or a declaration for a page that was not actually
    permuted, and authorization collapses to false and the gate stays
    red. Every condition fails closed, and a page sequence that went
    BACKWARDS is never authorizable whatever was declared.

    D itself is untouched: violations are still detected and reported
    verbatim, so validation.orderViolations remains an honest record of
    physical divergence from source order. Only whether those exact,
    pre-declared violations invalidate `passed` changes - and with no
    declaration supplied, behaviour is identical to none of this
    existing.
  */
  const declaredPageOrderVerified = ((): boolean => {
    if (intentionalPageOrder === undefined || intentionalPageOrder.size === 0) return false;

    const actualByPage = new Map<number, string[]>();
    for (const block of allBlocks) {
      const seen = actualByPage.get(block.pageIndex);
      if (seen === undefined) actualByPage.set(block.pageIndex, [block.id]);
      else seen.push(block.id);
    }

    for (let i = 1; i < allBlocks.length; i++) {
      const prev = allBlocks[i - 1];
      const curr = allBlocks[i];
      // A page that went backwards is never an authorizable permutation.
      if (curr.pageIndex < prev.pageIndex) return false;
      const pageWasDeclared = intentionalPageOrder.has(curr.pageIndex);
      if (curr.pageIndex === prev.pageIndex && curr.sourceOrder < prev.sourceOrder && !pageWasDeclared) return false;
    }

    for (const [pageIndex, declared] of [...intentionalPageOrder]) {
      const actual = actualByPage.get(pageIndex);
      if (actual === undefined) return false;
      if (new Set(declared).size !== declared.length) return false;
      if (new Set(actual).size !== actual.length) return false;
      if (declared.length !== actual.length) return false;
      if (declared.some((id, position) => id !== actual[position])) return false;

      // Canonical order is re-derived here from the blocks' own immutable
      // sourceOrder - never taken from the caller.
      const canonical = allBlocks
        .filter((b) => b.pageIndex === pageIndex)
        .slice()
        .sort((a, b) => a.sourceOrder - b.sourceOrder)
        .map((b) => b.id);
      if (declared.length !== canonical.length) return false;
      const canonicalIds = new Set(canonical);
      if (declared.some((id) => !canonicalIds.has(id))) return false;
      // A page that was not actually permuted has nothing to authorize.
      if (declared.every((id, position) => id === canonical[position])) return false;
    }

    return true;
  })();

  const passed =
    missingElementIds.length === 0 &&
    duplicateElementIds.length === 0 &&
    missingTextSpans.length === 0 &&
    inventedTextSpans.length === 0 &&
    (orderViolations.length === 0 || declaredPageOrderVerified);

  return {
    passed,
    sourceElementCount: expectedIds.size,
    representedElementCount,
    missingElementIds,
    duplicateElementIds,
    missingTextSpans,
    inventedTextSpans,
    orderViolations,
    warnings,
  };
}
