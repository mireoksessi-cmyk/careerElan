/*
  TASK 7 - Density / compaction policy. Spec section 9: Professional
  ATS v1 defines exactly 4 density steps and what spacing MAY shrink at
  each - never what content may be dropped. All four destructive flags
  are hard-coded false at the type level (see types.ts's
  AssemblyCompactionPolicy) and re-asserted here so no future edit to
  this one function can silently start allowing content loss.
*/
import type { AssemblyCompactionPolicy } from "./types";

export const PROFESSIONAL_ATS_COMPACTION_POLICY: AssemblyCompactionPolicy = {
  allowedDensities: ["comfortable", "balanced", "compact", "ultra-compact"],
  canReduceSectionSpacing: true,
  canReduceEntrySpacing: true,
  canReduceBulletSpacing: true,
  canTightenSkillLayout: true,
  canTrimContent: false,
  canDropSections: false,
  canDropEntries: false,
  canDropBullets: false,
};

export function getDefaultDensity(): "comfortable" {
  return "comfortable";
}
