/*
  Section 2 of the spec: an AI-assisted ambiguity classifier may only be
  DESIGNED as a stub/interface this round - never implemented, never
  called from classifier.ts's main execution path. This file exists so
  the eventual next-phase shape is on record without doing any of the
  actual work now (no network calls, no API key usage, no dependency on
  an AI SDK).
*/
import type { SemanticContentBlock, SemanticSectionType } from "./types";

export type AiClassificationInput = {
  headingText: string | null;
  bodyBlocks: SemanticContentBlock[];
};

export type AiClassificationSuggestion = {
  suggestedType: Exclude<SemanticSectionType, "custom">;
  confidence: number;
  rationale: string;
};

/*
  Deliberately unimplemented - throws if ever called, so an accidental
  future wiring-in fails loudly in tests rather than silently degrading
  to a stub response. Out of scope for TASK 5 per the spec's explicit
  "1차 gate는 deterministic rule engine만으로 통과시켜라."
*/
export function classifyAmbiguousSectionWithAi(_input: AiClassificationInput): Promise<AiClassificationSuggestion | null> {
  throw new Error("classifyAmbiguousSectionWithAi is a Phase-2 stub and must not be called in Phase 1.");
}
