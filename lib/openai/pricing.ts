/*
  Phase 6I.6.38A - the ONE controlled place model prices are looked up
  from (Part E's explicit "do not scatter model prices throughout the
  repository" instruction). Every price here must be a real, sourced
  rate from OpenAI's own published pricing page as of `effectiveDate` -
  never guessed.

  This codebase's own lib/config/aiModels.ts (cross-checked against
  every real call site in Phase 6I.6.38A Part A's audit) names exactly
  three models actually in production use: "gpt-5.5", "gpt-4.1",
  "gpt-4.1-mini". All three are now confirmed below (Phase 6I.6.38A
  Operational Activation) against OpenAI's own first-party developer
  docs at https://developers.openai.com/api/docs/pricing - fetched
  twice independently (once asking for these 3 models directly, once
  asking for the full raw pricing table) with identical, mutually
  consistent numbers both times. No third-party aggregator site was
  used for any of the three confirmed rates below.

  gpt-5.5's confirmed rate is specifically the "<272K context" tier -
  the table also lists a separate, higher rate for requests exceeding
  272K input tokens, which this codebase's call sites (job postings,
  resumes, cover letters - all well under that threshold) never
  approach in practice; the <272K rate is therefore the one that
  applies to every real gpt-5.5 call this app makes. This is disclosed
  here rather than silently assumed, per this phase's own "never
  guess" standard - if a future call site's context length grows large
  enough to matter, this note is the flag to revisit it.
*/

export type ModelPricing = {
  model: string;
  /** USD per 1,000,000 input tokens. */
  inputPricePerMillion: number;
  /** USD per 1,000,000 output tokens. */
  outputPricePerMillion: number;
  /** ISO date this rate was confirmed effective, e.g. "2026-01-01". */
  effectiveDate: string;
  /** Where this rate was confirmed (URL or "OpenAI dashboard" etc). */
  sourceNote: string;
};

/*
  Models with a confirmed rate, sourced from OpenAI's own developer
  docs (see header comment). Add an entry here (and nothing else,
  anywhere) once a real rate is confirmed for a model this codebase
  actually calls.
*/
const CONFIRMED_PRICING: ModelPricing[] = [
  {
    model: "gpt-5.5",
    inputPricePerMillion: 5.0,
    outputPricePerMillion: 30.0,
    effectiveDate: "2026-08-11",
    sourceNote: "https://developers.openai.com/api/docs/pricing (Standard pricing table, <272K context tier)",
  },
  {
    model: "gpt-4.1",
    inputPricePerMillion: 2.0,
    outputPricePerMillion: 8.0,
    effectiveDate: "2026-08-11",
    sourceNote: "https://developers.openai.com/api/docs/pricing (Standard pricing table)",
  },
  {
    model: "gpt-4.1-mini",
    inputPricePerMillion: 0.4,
    outputPricePerMillion: 1.6,
    effectiveDate: "2026-08-11",
    sourceNote: "https://developers.openai.com/api/docs/pricing (Standard pricing table)",
  },
];

const PRICING_BY_MODEL = new Map<string, ModelPricing>(CONFIRMED_PRICING.map((p) => [p.model, p]));

export type CostEstimate =
  | { classification: "ESTIMATED_COST"; costUsd: number }
  | { classification: "UNKNOWN_PRICING"; costUsd: null };

/*
  Never throws, never fabricates. A model with no confirmed entry above
  always returns UNKNOWN_PRICING/null - the caller (lib/openai/
  telemetry.ts) persists that honestly rather than substituting a
  guessed number.
*/
export function estimateCostUsd(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null
): CostEstimate {
  const pricing = PRICING_BY_MODEL.get(model);
  if (!pricing || inputTokens === null || outputTokens === null) {
    return { classification: "UNKNOWN_PRICING", costUsd: null };
  }

  const costUsd =
    (inputTokens / 1_000_000) * pricing.inputPricePerMillion +
    (outputTokens / 1_000_000) * pricing.outputPricePerMillion;

  return { classification: "ESTIMATED_COST", costUsd: Math.round(costUsd * 1_000_000) / 1_000_000 };
}

export function isPricingKnown(model: string): boolean {
  return PRICING_BY_MODEL.has(model);
}

export function listUnpricedModelsEncountered(modelsSeen: string[]): string[] {
  return Array.from(new Set(modelsSeen)).filter((m) => !isPricingKnown(m));
}
