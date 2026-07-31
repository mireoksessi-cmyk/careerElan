/*
  Document Preservation Engine (DPE) - Phase 4A (Generated Content
  Mapping). Shared pairing primitive behind both the Bullet Matcher
  (resumeMapping.ts, Experience/Volunteer bullets) and the Paragraph
  Matcher (coverLetterMapping.ts, Cover Letter paragraphs) - both need
  the exact same rule: keep original order, pair unit[i] with box[i], and
  when counts differ leave the surplus on whichever side has more rather
  than guessing which items should combine or split. This is a direct
  implementation of this phase's own "기존 순서를 유지한다... 부족하거나
  넘치는 Bullet을 조정하지 않는다. 그대로 Mapping만 한다" rule - not a
  heuristic invented for this phase, just that rule made generic enough
  to serve both bullets and paragraphs without two near-identical copies.
*/
import type { ContentBox } from "../contentBox/types";
import type { ContentBoxAssignment, MappingStatus, MappingUnit } from "./types";

export type PositionalPairingResult = {
  assignments: ContentBoxAssignment[];
  unassignedUnits: MappingUnit[];
  status: MappingStatus;
};

export function pairPositionally(
  units: MappingUnit[],
  boxes: ContentBox[]
): PositionalPairingResult {
  if (units.length === 0 || boxes.length === 0) {
    return {
      assignments: boxes.map((contentBox) => ({ contentBox, unit: null })),
      unassignedUnits: [...units],
      status: "unmapped",
    };
  }

  const pairedCount = Math.min(units.length, boxes.length);

  const assignments: ContentBoxAssignment[] = boxes.map((contentBox, index) => ({
    contentBox,
    unit: index < pairedCount ? units[index] : null,
  }));

  const unassignedUnits = units.slice(pairedCount);

  const status: MappingStatus =
    units.length === boxes.length ? "mapped" : "partially_mapped";

  return { assignments, unassignedUnits, status };
}
