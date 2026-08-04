/*
  TASK 6 - Custom/residual section preservation. Section 16 of the
  spec: Phase 1 custom sections are NEVER deleted, never restructured
  into a guessed known type - paragraphs and bullets are simply split
  apart (same distinction Phase 1's own blockType already carries) and
  sourceOrder/originalHeading/displayHeading are kept verbatim.
*/
import type { LosslessResumeSection } from "../losslessSemantic/types";
import { traceFromBlock, traceFromBlocks } from "./sourceTrace";
import { customSectionId, bulletId } from "./ids";
import type { CustomResumeSection } from "./types";

export function adaptCustomSection(section: LosslessResumeSection): CustomResumeSection {
  const bodyBlocks = section.blocks.filter((b) => b.blockType !== "heading" && b.rawText.length > 0);

  const paragraphs = bodyBlocks
    .filter((b) => b.blockType !== "bullet")
    .map((b) => ({ value: b.rawText, confidence: 1, extractionMethod: "explicit-label" as const, source: traceFromBlock(section.id, b) }));

  const id = customSectionId(section.id);
  const bullets = bodyBlocks
    .filter((b) => b.blockType === "bullet")
    .map((b, i) => ({ id: bulletId(id, i), text: b.rawText, source: traceFromBlock(section.id, b) }));

  return {
    id,
    originalHeading: section.originalHeading,
    displayHeading: section.displayHeading,
    paragraphs,
    bullets,
    sourceOrder: section.sourceOrder,
    source: traceFromBlocks(section.id, section.blocks),
  };
}
