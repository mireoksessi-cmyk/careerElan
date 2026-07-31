/*
  Document Preservation Engine (DPE) - Phase 3 (Content Box & Template
  Layer). DOCX Content Box Generator - Logical Structure-based, per this
  phase's own instruction ("DOCX는 Geometry 기반이 아니라 Logical
  Structure 기반으로 Content Box를 생성한다... 좌표를 추측해서 생성하지
  않는다"). Consumes Phase 2's LayoutAnalysisResult exactly as produced -
  no new DOCX parsing.

  1:1 mapping only: each Phase 2 ElementMetadata becomes exactly one
  ContentBox, in document order. This phase's own example hierarchy
  (Heading -> Paragraph -> Bullet Group -> Table -> Image -> Section)
  implies merging paragraphs into bullet groups and sections - but Phase
  2's DOCX ElementMetadata.type collapses every <p>, <h1>-<h6>, and <li>
  tag into the same "text" type (see lib/documentPreservation/layoutAnalysis/
  docxLayoutAnalyzer.ts's BLOCK_ELEMENT_TYPE map) - there is no signal
  left in Phase 2's output to tell a heading, a paragraph, and a bullet
  item apart by tag, and re-reading the DOCX HTML with finer tag
  granularity here would be a new/improved DOCX parser, which this phase
  explicitly forbids ("새로운 DOCX Parser를 만들지 않는다"). The one
  distinction Phase 2 DID preserve - "table" vs "image" vs "text" - is
  kept as each box's `type`. See the final report's "unknown/null로 남긴
  정보와 이유" section for the full explanation of what "Bullet Group"
  grouping specifically could not be attempted here.
*/
import type { DPEDocumentType } from "../types";
import type { LayoutAnalysisResult, PageMetadata } from "../layoutAnalysis/types";
import type { ContentBox, DocumentLayerModel } from "./types";
import { defaultFlowAttributes } from "./types";
import { createSequentialRoleClassifier } from "./roleClassifier";

function generatePageContentBoxes(
  documentType: DPEDocumentType,
  page: PageMetadata,
  classifier: ReturnType<typeof createSequentialRoleClassifier>
): ContentBox[] {
  return page.elements.map((element, index) => {
    const classification = classifier.classify({
      documentType,
      boxType: element.type,
      text: element.text,
    });

    return {
      id: `docx-p${page.pageNumber}-b${index}`,
      page: page.pageNumber,
      type: element.type,
      layer: classification.layer,
      role: classification.role,
      source: "logical",
      confidence: classification.confidence,
      generationMethod:
        element.x !== null
          ? "docx_logical_1to1_with_renderer_geometry"
          : "docx_logical_1to1",
      // Real when docxGeometryRenderer.ts successfully matched this
      // element back to a measured DOM node (Phase 2 completion pass) -
      // still null when it could not (never invented).
      boundingBox:
        element.x !== null && element.y !== null && element.width !== null && element.height !== null
          ? { x: element.x, y: element.y, width: element.width, height: element.height }
          : null,
      text: element.text,
      elements: [element],
      templateRegionId: null,
      flow: defaultFlowAttributes(),
    };
  });
}

export function generateDocxContentBoxes(
  documentType: DPEDocumentType,
  layoutResult: LayoutAnalysisResult
): DocumentLayerModel {
  const classifier = createSequentialRoleClassifier();

  const boxes = layoutResult.pages.flatMap((page) =>
    generatePageContentBoxes(documentType, page, classifier)
  );

  return {
    documentType,
    sourceFormat: "docx",
    boxes,
    templateBoxes: boxes.filter((box) => box.layer === "template"),
    editableBoxes: boxes.filter((box) => box.layer === "editable"),
    unknownBoxes: boxes.filter((box) => box.layer === "unknown"),
    templateRegions: [],
    templateRegionReasons: [],
  };
}
