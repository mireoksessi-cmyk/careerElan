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
import type { LosslessResumeDocument, LosslessValidationReport, SemanticContentBlock } from "./types";

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
  layoutResult: LayoutAnalysisResult
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
    const expectedText = normalizeForCompare(owningElements.map((e) => e.text ?? "").join(" "));
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

  const passed =
    missingElementIds.length === 0 &&
    duplicateElementIds.length === 0 &&
    missingTextSpans.length === 0 &&
    inventedTextSpans.length === 0 &&
    orderViolations.length === 0;

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
