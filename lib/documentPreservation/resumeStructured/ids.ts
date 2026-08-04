/*
  Deterministic id generators - same discipline as Phase 1's ids.ts.
  Never Date.now()/Math.random()/crypto.randomUUID() (TASK 7's
  determinism gate depends on this).
*/
export function entryId(sectionId: string, kind: string, index: number): string {
  return `${sectionId}-${kind}-${index}`;
}

export function bulletId(entryId: string, index: number): string {
  return `${entryId}-bullet-${index}`;
}

export function customSectionId(sectionId: string): string {
  return `${sectionId}-custom`;
}
