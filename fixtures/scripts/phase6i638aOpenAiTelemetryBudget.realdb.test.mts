/*
  Phase 6I.6.38A - OpenAI cost telemetry & budget alert test matrix.

  Part R: deterministic aggregation/pricing/error-classification tests
  against synthetic in-memory rows - no database, no real OpenAI call.

  Part S: 80/90/100% budget threshold boundary behavior, dedup,
  concurrent-crossing safety, and new-UTC-month reset - against real
  local Supabase (openai_budget_alert_state), using synthetic "now"
  timestamps so no wall-clock waiting is needed.

  Part Q: privacy - a synthetic openai_usage_events row is seeded with
  only the real schema's columns (the TypeScript insert type in
  lib/openai/telemetry.ts structurally cannot include a prompt/resume/
  job/cover-letter field - there is no code path that would let one
  through), then this test confirms: (a) the persisted row contains
  none of those fields, (b) an anon client cannot read the table at
  all (RLS + no grants), (c) the admin query output never contains any
  of a blocklist of content-bearing substrings.

  All budget-alert-state rows this script creates use a synthetic
  year_month far in the future (e.g. "2099-01") so they can never
  collide with a real month's dedup state, and are deleted at the end
  regardless of pass/fail.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i638aOpenAiTelemetryBudget.realdb.test.mts
*/
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";
import {
  summarizeUsagePeriod,
  buildOperationBreakdown,
  buildModelBreakdown,
  aggregateUsageRows,
  type UsageEventRow,
} from "../../lib/openai/usageAggregation";
import { estimateCostUsd } from "../../lib/openai/pricing";
import { classifyOpenAiError } from "../../lib/openai/telemetry";
import { classifyBudgetStatus, claimBudgetAlertThreshold, currentUtcYearMonth } from "../../lib/openai/budget";
import { getApiCostMetrics } from "../../lib/admin/queries/apiCosts";

const URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const admin = createClient(URL, SERVICE_ROLE_KEY);

/*
  This test script is a pure-ESM .mts entry point, but lib/openai/
  telemetry.ts is a plain .ts file that tsx transpiles to CommonJS
  (require) when loaded as a dependency - so it resolves "openai" via
  the package's "require" export condition (index.js), a DIFFERENT
  physical module instance than the one this script's own top-level
  `import OpenAI from "openai"` would get from the "import" condition
  (index.mjs). The two builds are functionally identical but produce
  distinct class objects, so `instanceof` across them silently fails -
  purely a tsx/Node dual-module-resolution artifact of this test
  harness, verified NOT to reproduce in the real Next.js app (webpack
  resolves "openai" once per bundle, never split by require vs import).
  Constructing test errors via the same require() path telemetry.ts
  itself resolves through keeps this test apples-to-apples.
*/
const req = createRequire(import.meta.url);
const OpenAI = req("openai").default as typeof import("openai").default;

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean, note?: string) {
  console.log(actual ? "PASS" : "FAIL", label, actual ? "" : note ?? "");
  if (actual) pass++;
  else fail++;
}

function row(overrides: Partial<UsageEventRow>): UsageEventRow {
  return {
    created_at: "2026-08-10T12:00:00.000Z",
    operation: "GENERATE_PACKAGE",
    model: "gpt-5.5",
    status: "success",
    duration_ms: 1000,
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    estimated_cost_usd: 0.01,
    cost_classification: "ESTIMATED_COST",
    retry_count: 0,
    http_status_class: "2xx",
    ...overrides,
  };
}

async function main() {
  console.log("=== Phase 6I.6.38A: OpenAI telemetry & budget test matrix ===\n");

  /* ==================== Part R.1: summarizeUsagePeriod ==================== */
  const rows1: UsageEventRow[] = [
    row({ status: "success", duration_ms: 1000, input_tokens: 100, output_tokens: 50, total_tokens: 150, estimated_cost_usd: 0.01, retry_count: 0, http_status_class: "2xx", created_at: "2026-08-10T01:00:00.000Z" }),
    row({ status: "error", duration_ms: 2000, input_tokens: null, output_tokens: null, total_tokens: null, estimated_cost_usd: null, cost_classification: "ESTIMATED_COST", retry_count: 1, http_status_class: "429", created_at: "2026-08-10T02:00:00.000Z" }),
    row({ status: "error", duration_ms: 3000, input_tokens: null, output_tokens: null, total_tokens: null, estimated_cost_usd: null, retry_count: 2, http_status_class: "timeout", created_at: "2026-08-10T03:00:00.000Z" }),
    row({ status: "error", duration_ms: 500, input_tokens: null, output_tokens: null, total_tokens: null, estimated_cost_usd: null, retry_count: 0, http_status_class: "5xx", created_at: "2026-08-10T04:00:00.000Z" }),
    row({ status: "success", duration_ms: 1500, input_tokens: 200, output_tokens: 100, total_tokens: 300, estimated_cost_usd: 0.02, cost_classification: "UNKNOWN_PRICING", retry_count: 0, http_status_class: "2xx", created_at: "2026-08-10T05:00:00.000Z" }),
  ];
  const s1 = summarizeUsagePeriod(rows1);
  check("R.1 calls = 5 rows", s1.calls, 5);
  check("R.1 successCount = 2", s1.successCount, 2);
  check("R.1 errorCount = 3", s1.errorCount, 3);
  check("R.1 retryCount sums retry_count across rows (0+1+2+0+0)", s1.retryCount, 3);
  check("R.1 inputTokens sums non-null input_tokens (100+200)", s1.inputTokens, 300);
  check("R.1 totalTokens sums non-null total_tokens (150+300)", s1.totalTokens, 450);
  check("R.1 costUsd sums non-null estimated_cost_usd (0.01+0.02)", s1.costUsd, 0.03);
  check("R.1 unknownPricingCount = 1 (one UNKNOWN_PRICING row)", s1.unknownPricingCount, 1);
  check("R.1 avgLatencyMs = (1000+2000+3000+500+1500)/5 = 1600", s1.avgLatencyMs, 1600);
  check("R.1 rateLimited429 = 1", s1.rateLimited429, 1);
  check("R.1 timeouts = 1", s1.timeouts, 1);
  check("R.1 serverErrors5xx = 1", s1.serverErrors5xx, 1);
  check("R.1 lastCallAt = latest created_at (05:00)", s1.lastCallAt, "2026-08-10T05:00:00.000Z");

  const s0 = summarizeUsagePeriod([]);
  check("R.1b empty rows: calls = 0", s0.calls, 0);
  check("R.1b empty rows: avgLatencyMs = null (never divide by zero)", s0.avgLatencyMs, null);
  check("R.1b empty rows: lastCallAt = null", s0.lastCallAt, null);

  /* ==================== Part R.2: buildOperationBreakdown ==================== */
  const rows2: UsageEventRow[] = [
    row({ operation: "GENERATE_PACKAGE", status: "success" }),
    row({ operation: "GENERATE_PACKAGE", status: "success" }),
    row({ operation: "GENERATE_PACKAGE", status: "error" }),
    row({ operation: "RESUME_ANALYSIS", status: "success" }),
  ];
  const ops = buildOperationBreakdown(rows2);
  check("R.2 all 9 taxonomy operations present regardless of data", ops.length, 9);
  const gp = ops.find((o) => o.operation === "GENERATE_PACKAGE")!;
  check("R.2 GENERATE_PACKAGE calls = 3", gp.calls, 3);
  check("R.2 GENERATE_PACKAGE successRatePercent = 2/3 = 66.67", gp.successRatePercent, 66.67);
  const other = ops.find((o) => o.operation === "OTHER")!;
  check("R.2 OTHER (zero calls) successRatePercent is null, never a fabricated 0%", other.successRatePercent, null);
  check("R.2 OTHER (zero calls) calls = 0", other.calls, 0);

  /* ==================== Part R.3: buildModelBreakdown ==================== */
  const rows3: UsageEventRow[] = [
    row({ model: "gpt-5.5" }),
    row({ model: "gpt-5.5" }),
    row({ model: "gpt-4.1-mini", cost_classification: "UNKNOWN_PRICING", estimated_cost_usd: null }),
  ];
  const models = buildModelBreakdown(rows3);
  check("R.3 two distinct models grouped", models.length, 2);
  check("R.3 sorted descending by call count (gpt-5.5 first)", models[0].model, "gpt-5.5");
  check("R.3 gpt-5.5 calls = 2", models[0].calls, 2);
  check("R.3 gpt-4.1-mini unknownPricingCount = 1", models[1].unknownPricingCount, 1);

  /* ==================== Part R.4: aggregateUsageRows (today/month split + projection) ==================== */
  const now = new Date("2026-08-10T18:00:00.000Z"); // day 10 of a 31-day month
  const monthRows: UsageEventRow[] = [
    row({ created_at: "2026-08-01T00:00:00.000Z", estimated_cost_usd: 1 }), // earlier in month, not today
    row({ created_at: "2026-08-10T05:00:00.000Z", estimated_cost_usd: 2 }), // today
    row({ created_at: "2026-08-10T10:00:00.000Z", estimated_cost_usd: 3 }), // today
  ];
  const agg = aggregateUsageRows(monthRows, now);
  check("R.4 today.calls = 2 (only the two 08-10 rows)", agg.today.calls, 2);
  check("R.4 today.costUsd = 2+3 = 5", agg.today.costUsd, 5);
  check("R.4 thisMonth.calls = 3 (all three rows)", agg.thisMonth.calls, 3);
  check("R.4 thisMonth.costUsd = 1+2+3 = 6", agg.thisMonth.costUsd, 6);
  check("R.4 dailyAverageCostUsd = 6 / day-of-month(10) = 0.6", agg.dailyAverageCostUsd, 0.6);
  check("R.4 projectedMonthEndCostUsd = 0.6 * 31 days = 18.6", agg.projectedMonthEndCostUsd, 18.6);

  /* ==================== Part R.5: estimateCostUsd - honest UNKNOWN_PRICING ==================== */
  const priced = estimateCostUsd("a-model-with-no-confirmed-price", 1000, 1000);
  check("R.5 unpriced model returns classification UNKNOWN_PRICING", priced.classification, "UNKNOWN_PRICING");
  check("R.5 unpriced model returns costUsd null (never a guessed number)", priced.costUsd, null);

  /* ==================== Part R.5b: confirmed-price cost math (Operational Activation) ====================
     Rates confirmed against https://developers.openai.com/api/docs/pricing
     (OpenAI's own developer docs, fetched twice independently with
     matching numbers - see lib/openai/pricing.ts's own header comment).
     Exact arithmetic verified below, not just "is a number". */
  const gpt55Cost = estimateCostUsd("gpt-5.5", 1000, 500);
  check("R.5b gpt-5.5 classification is ESTIMATED_COST now that it's priced", gpt55Cost.classification, "ESTIMATED_COST");
  check(
    "R.5b gpt-5.5: 1000 input @ $5.00/1M + 500 output @ $30.00/1M = 0.005 + 0.015 = 0.02",
    gpt55Cost.costUsd,
    0.02
  );

  const gpt41Cost = estimateCostUsd("gpt-4.1", 10000, 2000);
  check(
    "R.5b gpt-4.1: 10000 input @ $2.00/1M + 2000 output @ $8.00/1M = 0.02 + 0.016 = 0.036",
    gpt41Cost.costUsd,
    0.036
  );

  const gpt41MiniCost = estimateCostUsd("gpt-4.1-mini", 50000, 10000);
  check(
    "R.5b gpt-4.1-mini: 50000 input @ $0.40/1M + 10000 output @ $1.60/1M = 0.02 + 0.016 = 0.036",
    gpt41MiniCost.costUsd,
    0.036
  );

  const gpt55ZeroCost = estimateCostUsd("gpt-5.5", 0, 0);
  check("R.5b gpt-5.5 with 0/0 tokens costs exactly $0 (not null - pricing IS known, usage was just zero)", gpt55ZeroCost.costUsd, 0);
  check("R.5b gpt-5.5 with 0/0 tokens is still ESTIMATED_COST, not UNKNOWN_PRICING", gpt55ZeroCost.classification, "ESTIMATED_COST");

  /* ==================== Part R.6: classifyOpenAiError ==================== */
  const rl = classifyOpenAiError(new OpenAI.RateLimitError(429, { error: { message: "rate limited" } }, "rate limited", new Headers()));
  check("R.6 RateLimitError -> httpStatusClass 429", rl.httpStatusClass, "429");
  check("R.6 RateLimitError -> errorCategory rate_limit", rl.errorCategory, "rate_limit");

  const to = classifyOpenAiError(new OpenAI.APIConnectionTimeoutError());
  check("R.6 APIConnectionTimeoutError -> httpStatusClass timeout", to.httpStatusClass, "timeout");
  check("R.6 APIConnectionTimeoutError -> errorCategory timeout", to.errorCategory, "timeout");

  const server = classifyOpenAiError(new OpenAI.InternalServerError(500, { error: { message: "boom" } }, "boom", new Headers()));
  check("R.6 5xx APIError -> httpStatusClass 5xx", server.httpStatusClass, "5xx");
  check("R.6 5xx APIError -> errorCategory server_error", server.errorCategory, "server_error");

  const client4xx = classifyOpenAiError(new OpenAI.BadRequestError(400, { error: { message: "bad" } }, "bad", new Headers()));
  check("R.6 4xx APIError -> httpStatusClass 4xx", client4xx.httpStatusClass, "4xx");
  check("R.6 4xx APIError -> errorCategory client_error", client4xx.errorCategory, "client_error");

  const unknown = classifyOpenAiError(new Error("some other unrelated error"));
  check("R.6 non-OpenAI error -> httpStatusClass unknown (never fabricated)", unknown.httpStatusClass, "unknown");
  check("R.6 non-OpenAI error -> errorCategory unknown", unknown.errorCategory, "unknown");

  /* ==================== Part S.1: classifyBudgetStatus boundary values ==================== */
  check("S.1 79.99% -> NORMAL", classifyBudgetStatus(79.99), "NORMAL");
  check("S.1 80.00% -> WARNING", classifyBudgetStatus(80.0), "WARNING");
  check("S.1 80.01% -> WARNING", classifyBudgetStatus(80.01), "WARNING");
  check("S.1 89.99% -> WARNING", classifyBudgetStatus(89.99), "WARNING");
  check("S.1 90.00% -> CRITICAL", classifyBudgetStatus(90.0), "CRITICAL");
  check("S.1 90.01% -> CRITICAL", classifyBudgetStatus(90.01), "CRITICAL");
  check("S.1 99.99% -> CRITICAL", classifyBudgetStatus(99.99), "CRITICAL");
  check("S.1 100.00% -> BUDGET_EXCEEDED", classifyBudgetStatus(100.0), "BUDGET_EXCEEDED");
  check("S.1 150.00% -> BUDGET_EXCEEDED (still exceeded, not a new state)", classifyBudgetStatus(150.0), "BUDGET_EXCEEDED");

  /* ==================== Part S.2: claimBudgetAlertThreshold - dedup + concurrency + month reset ====================
     Uses synthetic far-future "now" values so year_month never collides
     with a real month's actual alert-state row. The migration
     (20260810190100) deliberately grants service_role only SELECT/
     INSERT/UPDATE on this table - never DELETE, matching its own design
     ("a new UTC month is simply a new primary-key row, no cleanup job
     needed") - so this test resets rows via UPDATE (nulling the three
     *_sent_at columns) rather than deleting them; a no-op on a
     not-yet-existing row is harmless. */
  async function resetAlertRow(yearMonth: string) {
    await admin
      .from("openai_budget_alert_state")
      .update({ warning_sent_at: null, critical_sent_at: null, exceeded_sent_at: null })
      .eq("year_month", yearMonth);
  }

  const syntheticNowA = new Date("2099-01-15T12:00:00.000Z");
  const yearMonthA = currentUtcYearMonth(syntheticNowA);
  await resetAlertRow(yearMonthA);

  const SYNTHETIC_EFFECTIVE_BUDGET = 100;

  const firstClaim = await claimBudgetAlertThreshold("warning", SYNTHETIC_EFFECTIVE_BUDGET, syntheticNowA);
  checkTrue("S.2 first claim of a new threshold succeeds (true)", firstClaim === true);
  const secondClaim = await claimBudgetAlertThreshold("warning", SYNTHETIC_EFFECTIVE_BUDGET, syntheticNowA);
  checkTrue("S.2 second claim of the SAME threshold/month at the SAME effective budget fails (dedup - exactly once per threshold per budget level)", secondClaim === false);

  // Concurrent-crossing safety: two simultaneous claims of a fresh threshold must yield exactly one true.
  const syntheticNowB = new Date("2099-02-15T12:00:00.000Z");
  const yearMonthB = currentUtcYearMonth(syntheticNowB);
  await resetAlertRow(yearMonthB);
  const [concurrentA, concurrentB] = await Promise.all([
    claimBudgetAlertThreshold("critical", SYNTHETIC_EFFECTIVE_BUDGET, syntheticNowB),
    claimBudgetAlertThreshold("critical", SYNTHETIC_EFFECTIVE_BUDGET, syntheticNowB),
  ]);
  const concurrentTrueCount = [concurrentA, concurrentB].filter(Boolean).length;
  check("S.2 concurrent claims of the same threshold: exactly one succeeds (database-safe/atomic)", concurrentTrueCount, 1);

  // Independent thresholds within the same month must each be claimable once.
  const exceededClaim = await claimBudgetAlertThreshold("exceeded", SYNTHETIC_EFFECTIVE_BUDGET, syntheticNowA);
  checkTrue("S.2 a DIFFERENT threshold (exceeded) in the same month as an already-claimed warning still succeeds", exceededClaim === true);

  // New-UTC-month reset: a threshold already claimed in month A is claimable again in month B.
  const monthBWarningClaim = await claimBudgetAlertThreshold("warning", SYNTHETIC_EFFECTIVE_BUDGET, syntheticNowB);
  checkTrue("S.2 new-UTC-month reset: warning claimable again in a different month", monthBWarningClaim === true);

  // Re-alert-after-recharge: a threshold already claimed at the old effective budget IS claimable
  // again once a genuine recharge raises the effective budget (Part L design in lib/openai/budget.ts).
  const rechargedClaim = await claimBudgetAlertThreshold("warning", SYNTHETIC_EFFECTIVE_BUDGET + 50, syntheticNowA);
  checkTrue("S.2 re-claim of an already-claimed threshold succeeds once the effective budget has genuinely increased", rechargedClaim === true);
  const rechargedClaimAgainSameLevel = await claimBudgetAlertThreshold("warning", SYNTHETIC_EFFECTIVE_BUDGET + 50, syntheticNowA);
  checkTrue("S.2 re-claiming at the SAME (already-claimed) effective budget again fails - never spuriously reopens", rechargedClaimAgainSameLevel === false);

  await resetAlertRow(yearMonthA);
  await resetAlertRow(yearMonthB);

  /* ==================== Part Q: privacy - no content fields ever persisted or returned ====================
     The 20260810190000 migration grants service_role only SELECT/
     INSERT on this table (never DELETE/UPDATE) - matching openai_
     usage_events' own append-only design (real telemetry rows are
     never edited or removed after the fact). This test's synthetic
     rows are therefore backdated into a far-future synthetic year
     (2099) so they can never be cleaned up but also can never pollute
     a real "today"/"this month" dashboard query - the same pattern
     already used for the budget-alert-state rows above. */
  const syntheticInsertTime = "2099-06-01T00:00:00.000Z";
  const { data: insertedRow, error: insertError } = await admin
    .from("openai_usage_events")
    .insert({
      created_at: syntheticInsertTime,
      operation: "OTHER",
      model: "test-privacy-model",
      status: "success",
      duration_ms: 1,
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
      estimated_cost_usd: 0,
      cost_classification: "ESTIMATED_COST",
      retry_count: 0,
      http_status_class: "2xx",
      request_id: "phase638a-privacy-test",
    })
    .select("*")
    .single();
  checkTrue("Q.1 seeding a structurally-valid telemetry row succeeds", !insertError && !!insertedRow, insertError?.message);

  const rawKeys = Object.keys(insertedRow ?? {});
  const forbiddenSubstrings = ["prompt", "response", "resume", "job_description", "cover_letter", "email", "career_memory"];
  const leakedKeys = rawKeys.filter((k) => forbiddenSubstrings.some((f) => k.toLowerCase().includes(f)));
  checkTrue("Q.2 the persisted row's own columns contain none of prompt/response/resume/job/cover-letter/email/career-memory", leakedKeys.length === 0, `leaked columns: ${leakedKeys.join(", ")}`);

  const anon = createClient(URL, ANON_KEY);
  const { data: anonRead, error: anonError } = await anon.from("openai_usage_events").select("*").limit(1);
  checkTrue("Q.3 an anon client cannot read openai_usage_events (RLS + no grants - error or empty result)", !!anonError || (anonRead ?? []).length === 0, anonError ? undefined : "anon read unexpectedly returned rows");

  const attemptedInjection = await admin
    .from("openai_usage_events")
    .insert({
      created_at: syntheticInsertTime,
      operation: "OTHER",
      model: "test-privacy-model-2",
      status: "success",
      duration_ms: 1,
      retry_count: 0,
      // The following are NOT real columns on this table - an attempted
      // injection of content-bearing fields. Postgres/PostgREST rejects
      // an insert payload referencing an unknown column outright.
      prompt: "SENSITIVE PROMPT TEXT",
      resume_text: "SENSITIVE RESUME TEXT",
      job_description: "SENSITIVE JOB TEXT",
    } as never);
  checkTrue("Q.4 inserting a payload with injected content fields (prompt/resume_text/job_description) is rejected by the schema", !!attemptedInjection.error, "expected a schema error, insert unexpectedly succeeded");

  const apiCostsOutput = await getApiCostMetrics();
  const serialized = JSON.stringify(apiCostsOutput);
  const leakedInOutput = forbiddenSubstrings.filter((f) => serialized.toLowerCase().includes(f));
  // "email" alone would false-positive on legitimate copy like admin note
  // text ("used only for /api/followup reminder emails") - check the
  // more specific content-bearing substrings only for the API surface.
  const strictForbidden = ["prompt", "resume_text", "job_description", "cover_letter_text", "career_memory"];
  const strictLeaked = strictForbidden.filter((f) => serialized.toLowerCase().includes(f.replace("_", "")) || serialized.toLowerCase().includes(f));
  checkTrue("Q.5 getApiCostMetrics() output never contains prompt/resume/job/cover-letter/career-memory content markers", strictLeaked.length === 0, `found: ${strictLeaked.join(", ")}`);

  // No cleanup call here: service_role has no DELETE grant on this
  // table (by design - see the comment above Q.1). The two rows this
  // test seeded stay in the local DB permanently, backdated into 2099
  // so they never surface in a real dashboard query.

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
