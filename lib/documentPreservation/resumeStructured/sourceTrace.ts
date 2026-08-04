/*
  TASK 2 - source trace construction helpers. Every helper here only
  COPIES ids that already exist on Phase 1 blocks/sections - never mints
  a new id, never guesses which block a value "probably" came from.
*/
import type { SemanticContentBlock } from "../losslessSemantic/types";
import type { SourceTrace } from "./types";

export function traceFromBlocks(sectionId: string, blocks: SemanticContentBlock[]): SourceTrace {
  return {
    sourceSectionId: sectionId,
    sourceBlockIds: blocks.map((b) => b.id),
    sourceElementIds: blocks.flatMap((b) => b.sourceElementIds),
  };
}

export function traceFromBlock(sectionId: string, block: SemanticContentBlock): SourceTrace {
  return traceFromBlocks(sectionId, [block]);
}

export function mergeTraces(...traces: SourceTrace[]): SourceTrace {
  const sourceSectionId = traces[0]?.sourceSectionId ?? "";
  const sourceBlockIds: string[] = [];
  const sourceElementIds: string[] = [];
  for (const t of traces) {
    for (const id of t.sourceBlockIds) if (!sourceBlockIds.includes(id)) sourceBlockIds.push(id);
    for (const id of t.sourceElementIds) if (!sourceElementIds.includes(id)) sourceElementIds.push(id);
  }
  return { sourceSectionId, sourceBlockIds, sourceElementIds };
}
