/*
  TASK 3 - Summary extraction. Section 7 of the spec: concatenate all
  paragraph content of a summary/objective section verbatim, in source
  order - no rewriting, no shortening, no keyword injection. The
  section's own heading block ("Summary") is excluded from the text
  (it's a label, not narrative content) but IS still covered by the
  source trace along with every paragraph block.
*/
import type { LosslessResumeSection } from "../losslessSemantic/types";
import { traceFromBlocks } from "./sourceTrace";
import type { ResumeSummary } from "./types";

export function extractSummary(section: LosslessResumeSection): ResumeSummary {
  const paragraphBlocks = section.blocks.filter((b) => b.blockType !== "heading" && b.rawText.length > 0);
  const text = paragraphBlocks.map((b) => b.rawText).join("\n\n");
  return {
    text,
    source: traceFromBlocks(section.id, section.blocks),
  };
}
