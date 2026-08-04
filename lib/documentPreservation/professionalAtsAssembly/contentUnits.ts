/*
  TASK 7 - Deterministic, renderer-agnostic content-unit heuristics. Spec
  section 8: these numbers are NOT pixel heights, NOT line counts - they
  exist only to compare relative content size across blocks/fixtures
  within one document. A future renderer measurement layer (Phase 4/5)
  decides real overflow; this module must never be extended to approach
  that responsibility (no font metrics, no DOM, no Math.random/Date).

  Heuristic: roughly 60 characters ~= one "line unit" of ATS-style body
  text. This is a coarse, intentionally simple constant - the goal is a
  believable RELATIVE ordering across entries, not typographic accuracy.
*/
const CHARS_PER_UNIT = 60;

export function textUnit(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return Math.ceil(trimmed.length / CHARS_PER_UNIT);
}

export function sumTextUnits(texts: string[]): number {
  return texts.reduce((sum, t) => sum + textUnit(t), 0);
}

/* Every entry/section header itself counts as 1 baseline unit -
   matches minVisibleContentUnits in blockBuilders.ts, the anchor that
   keepTogether policies protect. */
export const HEADER_BASELINE_UNITS = 1;
