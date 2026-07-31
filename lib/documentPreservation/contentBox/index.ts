/*
  Document Preservation Engine (DPE) - Phase 3 (Content Box & Template
  Layer) entry point. Not called from anywhere yet - no route, worker, or
  existing Generate Package/Renderer code imports this module (see the
  final report's "Generate Package/Renderer/Dashboard 변경 여부"
  sections). Wiring this into a real caller, and everything downstream of
  it (Text Replacement, Overflow, Page Clone), is out of scope here.
*/
import type { LayoutAnalysisResult } from "../layoutAnalysis/types";
import type { DPEDocumentType } from "../types";
import type { DocumentLayerModel } from "./types";
import { generatePdfContentBoxes } from "./pdfContentBoxGenerator";
import { generateDocxContentBoxes } from "./docxContentBoxGenerator";
import { classifyTemplateRegions } from "./templateRegionClassifier";

/*
  Minimal structural integrity check only, per this phase's own scope
  ("Content Box 구조의 최소 무결성 검사만 허용한다") - not a real
  DPEValidator (lib/documentPreservation/validation.ts stays an
  unimplemented interface). Only confirms every box's own required fields
  are internally consistent, never anything about layout correctness.
*/
function assertWellFormed(model: DocumentLayerModel): void {
  const seenIds = new Set<string>();

  for (const box of model.boxes) {
    if (seenIds.has(box.id)) {
      throw new Error(`Duplicate ContentBox id: ${box.id}`);
    }
    seenIds.add(box.id);

    if (box.elements.length === 0) {
      throw new Error(`ContentBox ${box.id} has no underlying elements.`);
    }

    if (box.source === "geometry" && box.boundingBox === null) {
      throw new Error(`ContentBox ${box.id} claims source "geometry" but has no boundingBox.`);
    }

    /*
      A "logical" (DOCX) box MAY now carry a real boundingBox too (Phase 2
      completion: docxGeometryRenderer.ts backfills real Playwright-
      measured geometry onto DOCX elements) - `source` still describes how
      the box's GROUPING was decided (1:1 logical order, never geometry
      clustering), independent of whether its geometry field happens to be
      populated. The old "logical implies null boundingBox" invariant no
      longer holds and is intentionally not enforced here.
    */
  }

  const bucketedCount = model.templateBoxes.length + model.editableBoxes.length + model.unknownBoxes.length;
  if (bucketedCount !== model.boxes.length) {
    throw new Error(
      `templateBoxes/editableBoxes/unknownBoxes (${bucketedCount}) do not partition boxes (${model.boxes.length}).`
    );
  }
}

export function generateContentBoxes(
  documentType: DPEDocumentType,
  layoutResult: LayoutAnalysisResult
): DocumentLayerModel {
  const model =
    layoutResult.metadata.sourceFormat === "pdf"
      ? generatePdfContentBoxes(documentType, layoutResult)
      : generateDocxContentBoxes(documentType, layoutResult);

  assertWellFormed(model);

  // Template Region classification (Phase 3 completion) - a real
  // enrichment pass over the full multi-page model, run here (not inside
  // each per-page generator) because header/footer/page-number detection
  // needs to compare boxes ACROSS pages. Never fails the whole model on
  // its own error - a classification bug must not block Content Box
  // generation, which downstream callers depend on regardless of whether
  // any Template Region was found.
  try {
    const classified = classifyTemplateRegions(model, layoutResult);
    assertWellFormed(classified.model);
    return { ...classified.model, templateRegionReasons: classified.reasons };
  } catch (error) {
    return {
      ...model,
      templateRegionReasons: [
        `Template Region classification failed and was skipped: ${(error as Error).message}`,
      ],
    };
  }
}

export * from "./types";
export { generatePdfContentBoxes } from "./pdfContentBoxGenerator";
export { generateDocxContentBoxes } from "./docxContentBoxGenerator";
export { createSequentialRoleClassifier } from "./roleClassifier";
export { classifyTemplateRegions } from "./templateRegionClassifier";
