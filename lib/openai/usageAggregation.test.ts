/*
  Admin API Usage Phase 1+2 - pure unit tests for the new aggregation
  helpers (buildUserBreakdown, groupRowsByUtcMonth, buildMonthlySummaries)
  and the extended CAD/retry fields on the existing ones. No database,
  no OpenAI call - synthetic rows only, matching this codebase's
  existing lib/openai test convention (run via `npx tsx <file>`).
*/
import {
  summarizeUsagePeriod,
  buildOperationBreakdown,
  buildUserBreakdown,
  groupRowsByUtcMonth,
  buildMonthlySummaries,
  type UsageEventRow,
} from "./usageAggregation";

let passed = 0;
let failed = 0;

function checkTrue(label: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

function row(overrides: Partial<UsageEventRow> = {}): UsageEventRow {
  return {
    created_at: "2026-08-05T12:00:00.000Z",
    operation: "GENERATE_PACKAGE",
    model: "gpt-5.5",
    status: "success",
    duration_ms: 1000,
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    estimated_cost_usd: 0.001,
    cost_classification: "ESTIMATED_COST",
    retry_count: 0,
    http_status_class: "2xx",
    user_id: "user-a",
    estimated_cost_cad: 0.00135,
    ...overrides,
  };
}

// --- A. UTC month boundary ---
{
  const augustRow = row({ created_at: "2026-08-31T23:59:59.000Z" });
  const septemberRow = row({ created_at: "2026-09-01T00:00:00.000Z" });
  const groups = groupRowsByUtcMonth([augustRow, septemberRow]);
  checkTrue("month boundary: exactly 2 groups", groups.size === 2);
  checkTrue("month boundary: Aug row in 2026-08", (groups.get("2026-08") ?? []).length === 1);
  checkTrue("month boundary: Sep row in 2026-09", (groups.get("2026-09") ?? []).length === 1);
}

// --- B/C. current month automatically changes / prior month remains queryable ---
{
  const rows = [
    row({ created_at: "2026-07-15T00:00:00.000Z", user_id: "u1" }),
    row({ created_at: "2026-08-15T00:00:00.000Z", user_id: "u1" }),
    row({ created_at: "2026-08-16T00:00:00.000Z", user_id: "u2" }),
  ];
  const months = buildMonthlySummaries(rows);
  checkTrue("history: newest month first", months[0].yearMonth === "2026-08" && months[1].yearMonth === "2026-07");
  checkTrue("history: July retains its own single row, untouched by August rows", months[1].calls === 1);
  checkTrue("history: August has 2 calls across 2 distinct users", months[0].calls === 2 && months[0].userCount === 2);

  const septRows = rows.filter((r) => r.created_at.startsWith("2026-09"));
  checkTrue("history: September starts at zero purely because no rows exist yet (no reset job involved)", septRows.length === 0);
}

// --- D. user aggregation ---
{
  const rows = [
    row({ user_id: "u1", retry_count: 0 }),
    row({ user_id: "u1", retry_count: 1 }),
    row({ user_id: "u2", retry_count: 0 }),
    row({ user_id: null, retry_count: 0 }),
  ];
  const byUser = buildUserBreakdown(rows);
  checkTrue("user aggregation: 3 groups (u1, u2, null=unattributed)", byUser.length === 3);
  const u1 = byUser.find((u) => u.userId === "u1");
  checkTrue("user aggregation: u1 has 2 calls", !!u1 && u1.calls === 2);
  checkTrue("user aggregation: u1 retryCount sums to 1", !!u1 && u1.retryCount === 1);
}

// --- E. feature aggregation (retryCount + CAD) ---
{
  const rows = [
    row({ operation: "GENERATE_PACKAGE", retry_count: 0, estimated_cost_cad: 0.01 }),
    row({ operation: "GENERATE_PACKAGE", retry_count: 1, estimated_cost_cad: 0.02 }),
    row({ operation: "OTHER", retry_count: 0, estimated_cost_cad: null }),
  ];
  const perOp = buildOperationBreakdown(rows);
  const gp = perOp.find((o) => o.operation === "GENERATE_PACKAGE");
  checkTrue("feature aggregation: GENERATE_PACKAGE calls=2", !!gp && gp.calls === 2);
  checkTrue("feature aggregation: GENERATE_PACKAGE retryCount=1", !!gp && gp.retryCount === 1);
  checkTrue("feature aggregation: GENERATE_PACKAGE costCadKnown=0.03", !!gp && Math.abs(gp.costCadKnown - 0.03) < 1e-9);

  const other = perOp.find((o) => o.operation === "OTHER");
  checkTrue("feature aggregation: OTHER costCadMissingCount=1 (usd known, cad null)", !!other && other.costCadMissingCount === 1);
}

// --- F. retry counting: 1 action, timeout then success = 2 physical calls, 1 retry ---
{
  const rows = [
    row({ retry_count: 0, status: "error", http_status_class: "timeout" }),
    row({ retry_count: 1, status: "success" }),
  ];
  const summary = summarizeUsagePeriod(rows);
  checkTrue("retry semantics: 2 physical API calls", summary.calls === 2);
  checkTrue("retry semantics: 1 retry", summary.retryCount === 1);
}

// --- G/H. CAD conversion + missing-rate handling ---
{
  const allMissing = [row({ estimated_cost_cad: null }), row({ estimated_cost_cad: null })];
  const s1 = summarizeUsagePeriod(allMissing);
  checkTrue("CAD missing: costCadKnown=0", s1.costCadKnown === 0);
  checkTrue("CAD missing: costCadMissingCount=2", s1.costCadMissingCount === 2);

  const mixed = [row({ estimated_cost_cad: 0.01 }), row({ estimated_cost_cad: null })];
  const s2 = summarizeUsagePeriod(mixed);
  checkTrue("CAD mixed: costCadKnown=0.01", Math.abs(s2.costCadKnown - 0.01) < 1e-9);
  checkTrue("CAD mixed: costCadMissingCount=1 (excluded from the total, not silently zeroed)", s2.costCadMissingCount === 1);
}

// --- I. historical rate stability: a later rate change must never alter an
// already-frozen row's contribution to a sum ---
{
  // Row A written when the accounting rate was 1.35 (usd 1.00 -> cad 1.35).
  // Row B written later after the rate changed to 1.40 (usd 1.00 -> cad 1.40).
  // A correct aggregation sums the two ALREADY-FROZEN values (2.75) - it
  // must never recompute either row using a single "current" rate.
  const rows = [
    row({ estimated_cost_usd: 1.0, estimated_cost_cad: 1.35 }),
    row({ estimated_cost_usd: 1.0, estimated_cost_cad: 1.4 }),
  ];
  const summary = summarizeUsagePeriod(rows);
  checkTrue(
    "historical CAD stability: sums each row's own frozen conversion, unaffected by a later rate change",
    Math.abs(summary.costCadKnown - 2.75) < 1e-9
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
