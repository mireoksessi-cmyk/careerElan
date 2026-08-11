/*
  Phase 6I.6.38A - Operational Activation. Verifies the complete live
  chain end to end against real local Supabase, using only synthetic
  data:

    OpenAI request (simulated - no real API call)
      -> telemetry event (real insert into openai_usage_events)
      -> actual token usage (real numbers, fed through the real
         estimateCostUsd() using this phase's now-confirmed pricing)
      -> estimated cost (real arithmetic)
      -> monthly aggregation (real getBudgetSummary() query)
      -> budget percentage (real classifyBudgetStatus())
      -> 80% WARNING / 90% CRITICAL / 100% BUDGET_EXCEEDED
         (real checkAndTriggerBudgetAlerts() orchestration, the exact
         function lib/openai/telemetry.ts calls after every real insert)

  No real OpenAI call is made anywhere in this file - every "request"
  below is a direct openai_usage_events insert with the same shape
  persistUsageEvent() itself writes.

  No real email is sent: ADMIN_ALERT_EMAILS is explicitly deleted from
  process.env before any check runs, regardless of what .env.local
  contains, so sendBudgetAlertEmail() always takes its "not configured"
  early-return path - confirmed directly below. Sending a real alert
  email requires a separate, explicitly-approved step once the operator
  has provided a real ADMIN_ALERT_EMAILS value.

  OPENAI_MONTHLY_BUDGET_USD is set only inside this process (never
  written to .env.local), so this script never touches the operator's
  real budget configuration.

  Every threshold check below uses a synthetic far-future "now" (2099)
  so year_month can never collide with a real month's alert-state row,
  and every openai_usage_events row is backdated into the same
  synthetic month so it never appears in a real "today"/"this month"
  dashboard query - same pattern as
  phase6i638aOpenAiTelemetryBudget.realdb.test.mts's own Part S/Q.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i638aOperationalActivation.realdb.test.mts
*/
import { createClient } from "@supabase/supabase-js";

delete process.env.ADMIN_ALERT_EMAILS;
process.env.OPENAI_MONTHLY_BUDGET_USD = "10";

const { estimateCostUsd } = await import("../../lib/openai/pricing");
const { getBudgetSummary, currentUtcYearMonth } = await import("../../lib/openai/budget");
const { checkAndTriggerBudgetAlerts } = await import("../../lib/openai/budgetAlerts");
const { sendBudgetAlertEmail, getConfiguredAlertRecipients } = await import("../../lib/openai/alertEmail");

const URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const admin = createClient(URL, SERVICE_ROLE_KEY);

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

async function resetAlertRow(yearMonth: string) {
  await admin
    .from("openai_budget_alert_state")
    .update({ warning_sent_at: null, critical_sent_at: null, exceeded_sent_at: null })
    .eq("year_month", yearMonth);
}

/*
  Simulates one real OpenAI request's telemetry write - the exact row
  shape lib/openai/telemetry.ts#persistUsageEvent() itself inserts.
  costUsd is computed via the real estimateCostUsd() (this phase's
  confirmed gpt-5.5 pricing), never hand-picked.
*/
async function simulateRequestTelemetry(createdAtIso: string, inputTokens: number, outputTokens: number) {
  const cost = estimateCostUsd("gpt-5.5", inputTokens, outputTokens);
  const { error } = await admin.from("openai_usage_events").insert({
    created_at: createdAtIso,
    operation: "GENERATE_PACKAGE",
    model: "gpt-5.5",
    status: "success",
    duration_ms: 1200,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    estimated_cost_usd: cost.costUsd,
    cost_classification: cost.classification,
    retry_count: 0,
    http_status_class: "2xx",
    request_id: "phase638a-activation-chain",
  });
  return { error, costUsd: cost.costUsd };
}

async function main() {
  console.log("=== Phase 6I.6.38A: Operational Activation - full live chain (synthetic data) ===\n");

  checkTrue("0. ADMIN_ALERT_EMAILS is confirmed unset for this entire run (zero real-send risk)", process.env.ADMIN_ALERT_EMAILS === undefined);
  check("0. getConfiguredAlertRecipients() returns [] when unset", getConfiguredAlertRecipients(), []);

  const commaParsed = (() => {
    process.env.ADMIN_ALERT_EMAILS = "a@example.com, b@example.com ,c@example.com";
    const result = getConfiguredAlertRecipients();
    delete process.env.ADMIN_ALERT_EMAILS;
    return result;
  })();
  check("0. getConfiguredAlertRecipients() parses/trims a comma-separated list correctly", commaParsed, ["a@example.com", "b@example.com", "c@example.com"]);

  const directSend = await sendBudgetAlertEmail({
    level: "WARNING_80",
    monthSpendUsd: 8,
    effectiveBudgetUsd: 10,
    budgetUsedPercent: 80,
    timestampIso: new Date(0).toISOString(),
  });
  checkTrue("0. sendBudgetAlertEmail() with no recipients returns sent:false and never calls Resend", directSend.sent === false);
  checkTrue("0. sendBudgetAlertEmail() reports why (ADMIN_ALERT_EMAILS not configured)", (directSend.reason ?? "").includes("ADMIN_ALERT_EMAILS"));

  /* ==================== Chain 1: 70% -> 80% -> 90% -> 100%, one threshold at a time ====================
     Uses a synthetic month never touched by a prior run of this script
     (openai_usage_events grants service_role only SELECT/INSERT - see
     this file's own header - so a re-run must pick fresh, previously-
     unused months rather than relying on cleanup; 2099-03 confirmed
     unused via a direct row query before this run). */
  const monthA = new Date("2099-03-15T12:00:00.000Z");
  const yearMonthA = currentUtcYearMonth(monthA);
  await resetAlertRow(yearMonthA);

  // 7 requests of 200,000 input tokens each @ $5.00/1M = $1.00 each -> $7 total = 70% of the $10 budget.
  for (let i = 0; i < 7; i++) {
    const { error } = await simulateRequestTelemetry(`2099-03-0${i + 1}T00:00:00.000Z`, 200_000, 0);
    checkTrue(`1.${i} request ${i + 1}/7 telemetry write succeeds (no error)`, !error, error?.message);
  }

  let summary = await getBudgetSummary(monthA);
  checkTrue("1. budget.configured is true (OPENAI_MONTHLY_BUDGET_USD set for this process)", summary.configured === true);
  if (summary.configured) {
    check("1. month spend after 7 requests = $7.00 (real aggregation of real cost rows)", summary.monthSpendUsd, 7);
    check("1. budgetUsedPercent = 70%", summary.budgetUsedPercent, 70);
    check("1. status = NORMAL (below 80%)", summary.status, "NORMAL");
  }

  await checkAndTriggerBudgetAlerts(monthA);
  let { data: stateAfter70 } = await admin.from("openai_budget_alert_state").select("*").eq("year_month", yearMonthA).maybeSingle();
  checkTrue("1. at 70%, no threshold claimed yet (warning_sent_at still null)", !stateAfter70?.warning_sent_at);

  // 8th request -> $8 total = 80% exactly.
  await simulateRequestTelemetry("2099-03-08T00:00:00.000Z", 200_000, 0);
  summary = await getBudgetSummary(monthA);
  if (summary.configured) {
    check("2. month spend after 8 requests = $8.00", summary.monthSpendUsd, 8);
    check("2. budgetUsedPercent = 80%", summary.budgetUsedPercent, 80);
    check("2. status = WARNING", summary.status, "WARNING");
  }
  await checkAndTriggerBudgetAlerts(monthA);
  let { data: stateAt80 } = await admin.from("openai_budget_alert_state").select("*").eq("year_month", yearMonthA).maybeSingle();
  checkTrue("2. crossing 80% claims the warning threshold (warning_sent_at now set)", !!stateAt80?.warning_sent_at);
  checkTrue("2. 90%/100% thresholds NOT claimed yet at exactly 80%", !stateAt80?.critical_sent_at && !stateAt80?.exceeded_sent_at);

  // Re-run at the same 80% - must NOT re-claim (dedup).
  const warningTimestampFirst = stateAt80?.warning_sent_at;
  await checkAndTriggerBudgetAlerts(monthA);
  let { data: stateAfterRepeat } = await admin.from("openai_budget_alert_state").select("*").eq("year_month", yearMonthA).maybeSingle();
  check("2b. calling checkAndTriggerBudgetAlerts() again at the same 80% does NOT re-claim (warning_sent_at unchanged)", stateAfterRepeat?.warning_sent_at, warningTimestampFirst);

  // 9th request -> $9 total = 90% exactly.
  await simulateRequestTelemetry("2099-03-09T00:00:00.000Z", 200_000, 0);
  summary = await getBudgetSummary(monthA);
  if (summary.configured) {
    check("3. budgetUsedPercent = 90%", summary.budgetUsedPercent, 90);
    check("3. status = CRITICAL", summary.status, "CRITICAL");
  }
  await checkAndTriggerBudgetAlerts(monthA);
  let { data: stateAt90 } = await admin.from("openai_budget_alert_state").select("*").eq("year_month", yearMonthA).maybeSingle();
  checkTrue("3. crossing 90% claims the critical threshold (critical_sent_at now set)", !!stateAt90?.critical_sent_at);
  checkTrue("3. warning stays claimed from before (unchanged), exceeded still not claimed", !!stateAt90?.warning_sent_at && !stateAt90?.exceeded_sent_at);

  // 10th request -> $10 total = 100% exactly.
  await simulateRequestTelemetry("2099-03-10T00:00:00.000Z", 200_000, 0);
  summary = await getBudgetSummary(monthA);
  if (summary.configured) {
    check("4. budgetUsedPercent = 100%", summary.budgetUsedPercent, 100);
    check("4. status = BUDGET_EXCEEDED", summary.status, "BUDGET_EXCEEDED");
  }
  await checkAndTriggerBudgetAlerts(monthA);
  let { data: stateAt100 } = await admin.from("openai_budget_alert_state").select("*").eq("year_month", yearMonthA).maybeSingle();
  checkTrue("4. crossing 100% claims the exceeded threshold (exceeded_sent_at now set)", !!stateAt100?.exceeded_sent_at);
  checkTrue("4. all three thresholds now claimed exactly once each for this month", !!stateAt100?.warning_sent_at && !!stateAt100?.critical_sent_at && !!stateAt100?.exceeded_sent_at);

  await resetAlertRow(yearMonthA);

  /* ==================== Chain 2: a single request jumping straight to 95% claims BOTH 80% and 90% at once ==================== */
  const monthB = new Date("2099-08-15T12:00:00.000Z");
  const yearMonthB = currentUtcYearMonth(monthB);
  await resetAlertRow(yearMonthB);

  // 380,000 input tokens @ $5.00/1M = $1.90... use 1,900,000 tokens for exactly $9.50 = 95% of $10.
  await simulateRequestTelemetry("2099-08-01T00:00:00.000Z", 1_900_000, 0);
  const summaryB = await getBudgetSummary(monthB);
  if (summaryB.configured) {
    check("5. single-jump: month spend = $9.50 (95%)", summaryB.monthSpendUsd, 9.5);
    check("5. single-jump: status = CRITICAL (>=90%, <100%)", summaryB.status, "CRITICAL");
  }
  await checkAndTriggerBudgetAlerts(monthB);
  const { data: stateJump } = await admin.from("openai_budget_alert_state").select("*").eq("year_month", yearMonthB).maybeSingle();
  checkTrue("5. a single cost jump crossing 80% AND 90% at once claims BOTH thresholds in one call", !!stateJump?.warning_sent_at && !!stateJump?.critical_sent_at);
  checkTrue("5. exceeded (100%) correctly NOT claimed at 95%", !stateJump?.exceeded_sent_at);

  await resetAlertRow(yearMonthB);

  /* ==================== Chain 3: new-UTC-month reset re-verified at the orchestration level (task 4) ==================== */
  const monthC = new Date("2099-10-15T12:00:00.000Z");
  const yearMonthC = currentUtcYearMonth(monthC);
  await resetAlertRow(yearMonthC);

  await simulateRequestTelemetry("2099-10-01T00:00:00.000Z", 200_000 * 8, 0); // $8 = 80%
  await checkAndTriggerBudgetAlerts(monthC);
  const { data: stateNewMonth } = await admin.from("openai_budget_alert_state").select("*").eq("year_month", yearMonthC).maybeSingle();
  checkTrue(
    "6. a brand-new synthetic month reaching 80% claims warning independently of any other month's already-claimed state",
    !!stateNewMonth?.warning_sent_at
  );
  await resetAlertRow(yearMonthC);

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
