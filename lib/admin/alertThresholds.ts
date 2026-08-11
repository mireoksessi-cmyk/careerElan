/*
  Phase 6I.6.37 - Part N: code-based alert/budget thresholds. Explicitly
  NOT a database settings table (ADMIN_SETTINGS_SCHEMA_CHANGE_REQUIRED
  was avoided per the round spec's own "a code/env based initial
  threshold is acceptable" allowance). Changing a number here requires
  a code change + deploy, which is the intentional, disclosed trade-off
  for this phase - a future settings UI would move these into
  lib/admin/queries/apiCosts.ts-adjacent persisted config, not before.
*/

export const ALERT_THRESHOLDS = {
  enqueueFailuresCriticalCount: 3, // BACKGROUND_ENQUEUE_FAILED in a 15-minute window
  stuckSevereAgeMs: 30 * 60 * 1000, // 30 minutes past the 5-minute reclaim threshold
  highFailureCount15m: 5,
  highFailureRate: 0.3, // 30%
  minAttemptsForRateAlert: 10,

  // Phase 6I.6.38A Part O - OpenAI call-level spikes, computed from
  // openai_usage_events (independent of the applications-table-based
  // Generate Package thresholds above, since these cover every
  // operation, not just Generate Package).
  openAiRateLimitSpike15m: 5, // 429 responses in a 15-minute window
  openAiTimeoutSpike15m: 5, // timeout responses in a 15-minute window
  openAiFailureRate15m: 0.3, // 30%
  minOpenAiCallsForRateAlert: 10,
};

export const BUDGET_THRESHOLDS_USD = {
  openAiMonthlyWarning: 50,
  openAiMonthlyCritical: 80,
};
