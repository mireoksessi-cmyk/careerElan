/*
  Phase 6I.6.38A - the ONE controlled place model prices are looked up
  from (Part E's explicit "do not scatter model prices throughout the
  repository" instruction). Every price here must be a real, sourced
  rate from OpenAI's own published pricing page as of `effectiveDate` -
  never guessed.

  As of this phase, this codebase's own lib/config/aiModels.ts names
  three models actually in use: "gpt-5.5", "gpt-4.1", "gpt-4.1-mini".
  None of their exact per-token USD rates could be independently
  verified against an authoritative, dated OpenAI pricing source at the
  time this file was written, so all three are intentionally left
  UNPRICED below rather than guessed (Part E: "Do NOT silently assume a
  price" / "If pricing for an encountered model is unknown:
  estimated_cost_usd = NULL and report OPENAI_PRICING_UNKNOWN"). Once an
  operator confirms the real per-1M-token input/output rates from
  https://openai.com/api/pricing/ (or the OpenAI dashboard), fill them
  in below - cost estimation activates automatically for every call site
  the next time this file is deployed, with no other code changes
  needed anywhere.
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
  Models with a confirmed rate. Empty today - see header comment. Add an
  entry here (and nothing else, anywhere) once a real rate is confirmed
  for a model this codebase actually calls.
*/
const CONFIRMED_PRICING: ModelPricing[] = [];

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
