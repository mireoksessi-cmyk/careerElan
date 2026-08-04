/*
  Deterministic ID helpers - every id generated anywhere in this module
  must be a pure function of (page index, position), never
  Date.now()/Math.random()/crypto.randomUUID(). This is what makes
  TASK 6's determinism check (same input -> byte-identical JSON on
  repeat runs) hold structurally rather than by luck.
*/

export function elementId(pageIndex: number, indexWithinPage: number): string {
  return `el-p${pageIndex}-e${indexWithinPage}`;
}

export function blockId(pageIndex: number, indexWithinPage: number): string {
  return `block-p${pageIndex}-b${indexWithinPage}`;
}

export function sectionId(sourceOrder: number): string {
  return `section-s${sourceOrder}`;
}
