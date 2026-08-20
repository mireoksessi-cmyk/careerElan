/*
  Orchestrator tying TASK 3 (blockAdapter) -> TASK 4
  (sectionBoundaryDetector) -> TASK 5 (classifier) -> TASK 6 (validator)
  into one LosslessResumeDocument. This is the single function TASK 7's
  dev-only inspection route/UI calls - it does not touch, import from,
  or get imported by any existing production route.
*/
import type { LayoutAnalysisResult } from "../layoutAnalysis/types";
import { adaptLayoutToBlocks } from "./blockAdapter";
import { detectSectionBoundaries } from "./sectionBoundaryDetector";
import { orderBlocksForSectionDetection } from "./preSectionRegionOrdering";
import { classifySection } from "./classifier";
import { normalizeHeadingForMatching } from "./textNormalize";
import { sectionId } from "./ids";
import { validateLosslessDocument } from "./validator";
import type { LosslessResumeDocument, LosslessResumeSection, SemanticContentBlock } from "./types";

export type LosslessDocumentSource = {
  fileName: string;
  fileType: "pdf" | "docx";
};

function sectionRawText(blocks: SemanticContentBlock[]): string {
  return blocks
    .map((b) => b.rawText)
    .filter((t) => t.length > 0)
    .join("\n");
}

export function buildLosslessResumeDocument(
  layoutResult: LayoutAnalysisResult,
  source: LosslessDocumentSource
): LosslessResumeDocument {
  const { blocks: adaptedBlocks } = adaptLayoutToBlocks(layoutResult);
  const intentionalPageOrder = new Map<number, readonly string[]>();
  const blocks = orderBlocksForSectionDetection(adaptedBlocks, (pageIndex, orderedBlockIds) => {
    intentionalPageOrder.set(pageIndex, orderedBlockIds);
  });
  const boundaries = detectSectionBoundaries(blocks);

  const identityBlocks = boundaries.identityBlockIndices.map((i) => blocks[i]);

  const sections: LosslessResumeSection[] = boundaries.sections.map((boundary, index) => {
    const headingText = boundary.headingText;
    const bodyStartIndex = boundary.headingBlockIndex !== null ? boundary.startBlockIndex + 1 : boundary.startBlockIndex;
    const bodyBlocks = blocks.slice(bodyStartIndex, boundary.endBlockIndex + 1);
    const headingBlock = boundary.headingBlockIndex !== null ? blocks[boundary.headingBlockIndex] : null;
    // Promote in place, as blockAdapter.ts's own header comment
    // documents TASK 4 would do once it has real scoring evidence -
    // the block object is the SAME reference held by the flat `blocks`
    // array, so this mutation is visible everywhere consistently.
    if (headingBlock) headingBlock.blockType = "heading";

    const classification = classifySection(headingText, bodyBlocks, {
      isFirstSectionInDocument: index === 0,
      immediatelyFollowsIdentityBlocks: index === 0 && identityBlocks.length > 0,
    });

    const sectionBlocks = headingBlock ? [headingBlock, ...bodyBlocks] : bodyBlocks;
    const pageIndices = sectionBlocks.map((b) => b.pageIndex);

    return {
      id: sectionId(index),
      originalHeading: headingText,
      normalizedHeading: headingText !== null ? normalizeHeadingForMatching(headingText) : null,
      normalizedType: classification.normalizedType,
      displayHeading: headingText,
      sourceOrder: index,
      startPageIndex: pageIndices.length > 0 ? Math.min(...pageIndices) : 0,
      endPageIndex: pageIndices.length > 0 ? Math.max(...pageIndices) : 0,
      confidence: classification.confidence,
      classificationMethod: classification.classificationMethod,
      reasonCodes: classification.reasonCodes,
      blocks: sectionBlocks,
      rawText: sectionRawText(sectionBlocks),
      isUncertain: classification.normalizedType === "custom",
    };
  });

  const document: LosslessResumeDocument = {
    schemaVersion: "1.0.0",
    source: { fileName: source.fileName, fileType: source.fileType, pageCount: layoutResult.pages.length },
    identityBlocks,
    sections,
    unassignedBlocks: [],
    validation: {
      passed: false,
      sourceElementCount: 0,
      representedElementCount: 0,
      missingElementIds: [],
      duplicateElementIds: [],
      missingTextSpans: [],
      inventedTextSpans: [],
      orderViolations: [],
      warnings: [],
    },
  };

  document.validation = validateLosslessDocument(document, layoutResult, intentionalPageOrder);
  return document;
}
