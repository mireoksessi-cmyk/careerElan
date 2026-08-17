/*
  Phase 6I.6.38A - pure, deterministic aggregation over
  openai_usage_events rows. Kept separate from lib/admin/queries/
  apiCosts.ts (which only fetches rows and calls this) so the actual
  arithmetic (token sums, cost sums, success/failure/retry counts,
  429/timeout/5xx classification, daily-average/projected-month-end
  cost) can be unit-tested against synthetic rows with no database and
  no real OpenAI call (Part R).
*/
import { OPENAI_OPERATIONS, type OpenAiOperation } from "./operations";
import { startOfUtcDay } from "../admin/queries/shared";

export type UsageEventRow = {
  created_at: string;
  operation: OpenAiOperation;
  model: string;
  status: "success" | "error";
  duration_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  cost_classification: "ESTIMATED_COST" | "EXACT_PROVIDER_DATA" | "UNKNOWN_PRICING";
  retry_count: number;
  http_status_class: string | null;
  /* Admin API Usage Phase 1 - nullable FK, present on every wrapped call site. */
  user_id: string | null;
  /*
    Admin API Usage Phase 2 - frozen at insert time by
    lib/openai/telemetry.ts using whatever OPENAI_ACCOUNTING_USD_CAD_RATE
    was configured then. NULL whenever no rate was configured at insert
    time (or estimated_cost_usd itself is null) - never recomputed here.
  */
  estimated_cost_cad: number | null;
};

export type UsagePeriodSummary = {
  calls: number;
  successCount: number;
  errorCount: number;
  retryCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  unknownPricingCount: number;
  avgLatencyMs: number | null;
  rateLimited429: number;
  timeouts: number;
  serverErrors5xx: number;
  lastCallAt: string | null;
  /*
    Admin API Usage Phase 2 - sum of already-persisted estimated_cost_cad
    values only (never recomputed from costUsd here - see
    UsageEventRow.estimated_cost_cad's own comment on why).
  */
  costCadKnown: number;
  /*
    Count of rows with a known USD cost but no recorded CAD conversion
    (no accounting rate was configured when they were written) - the
    honest disclosure that costCadKnown understates true total cost
    whenever this is > 0, rather than silently presenting costCadKnown
    as complete.
  */
  costCadMissingCount: number;
};

export type OperationBreakdownRow = {
  operation: OpenAiOperation;
  calls: number;
  successCount: number;
  errorCount: number;
  successRatePercent: number | null;
  totalTokens: number;
  costUsd: number;
  /* Physical provider request attempts with retry_count > 0 - see this module's own retry-semantics note on buildUserBreakdown. */
  retryCount: number;
  costCadKnown: number;
  costCadMissingCount: number;
};

export type ModelBreakdownRow = {
  model: string;
  calls: number;
  totalTokens: number;
  costUsd: number;
  unknownPricingCount: number;
};

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function summarizeUsagePeriod(rows: UsageEventRow[]): UsagePeriodSummary {
  let successCount = 0;
  let errorCount = 0;
  let retryCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let costUsd = 0;
  let unknownPricingCount = 0;
  let durationSum = 0;
  let rateLimited429 = 0;
  let timeouts = 0;
  let serverErrors5xx = 0;
  let lastCallAt: string | null = null;
  let costCadKnown = 0;
  let costCadMissingCount = 0;

  for (const row of rows) {
    if (row.status === "success") successCount++;
    else errorCount++;

    if (row.retry_count > 0) retryCount += row.retry_count;

    inputTokens += row.input_tokens ?? 0;
    outputTokens += row.output_tokens ?? 0;
    totalTokens += row.total_tokens ?? 0;

    if (typeof row.estimated_cost_usd === "number") costUsd += row.estimated_cost_usd;
    if (row.cost_classification === "UNKNOWN_PRICING") unknownPricingCount++;

    if (typeof row.estimated_cost_cad === "number") {
      costCadKnown += row.estimated_cost_cad;
    } else if (typeof row.estimated_cost_usd === "number") {
      costCadMissingCount++;
    }

    durationSum += row.duration_ms;

    if (row.http_status_class === "429") rateLimited429++;
    if (row.http_status_class === "timeout") timeouts++;
    if (row.http_status_class === "5xx") serverErrors5xx++;

    if (!lastCallAt || row.created_at > lastCallAt) lastCallAt = row.created_at;
  }

  return {
    calls: rows.length,
    successCount,
    errorCount,
    retryCount,
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd: round6(costUsd),
    unknownPricingCount,
    avgLatencyMs: rows.length > 0 ? Math.round(durationSum / rows.length) : null,
    rateLimited429,
    timeouts,
    serverErrors5xx,
    lastCallAt,
    costCadKnown: round6(costCadKnown),
    costCadMissingCount,
  };
}

export function buildOperationBreakdown(rows: UsageEventRow[]): OperationBreakdownRow[] {
  return OPENAI_OPERATIONS.map((operation) => {
    const opRows = rows.filter((r) => r.operation === operation);
    const summary = summarizeUsagePeriod(opRows);

    return {
      operation,
      calls: summary.calls,
      successCount: summary.successCount,
      errorCount: summary.errorCount,
      successRatePercent: summary.calls > 0 ? Math.round((summary.successCount / summary.calls) * 10000) / 100 : null,
      totalTokens: summary.totalTokens,
      costUsd: summary.costUsd,
      retryCount: summary.retryCount,
      costCadKnown: summary.costCadKnown,
      costCadMissingCount: summary.costCadMissingCount,
    };
  });
}

export function buildModelBreakdown(rows: UsageEventRow[]): ModelBreakdownRow[] {
  const byModel = new Map<string, UsageEventRow[]>();

  for (const row of rows) {
    const existing = byModel.get(row.model);
    if (existing) existing.push(row);
    else byModel.set(row.model, [row]);
  }

  return Array.from(byModel.entries())
    .map(([model, modelRows]) => {
      const summary = summarizeUsagePeriod(modelRows);
      return {
        model,
        calls: summary.calls,
        totalTokens: summary.totalTokens,
        costUsd: summary.costUsd,
        unknownPricingCount: summary.unknownPricingCount,
      };
    })
    .sort((a, b) => b.calls - a.calls);
}

export type UserBreakdownRow = {
  userId: string | null;
  calls: number;
  retryCount: number;
  totalTokens: number;
  costUsd: number;
  costCadKnown: number;
  costCadMissingCount: number;
};

/*
  Admin API Usage Phase 1 - groups already-fetched rows by user_id (a
  plain in-memory grouping over rows the caller already queried, not a
  new DB query - see lib/admin/queries/apiCosts.ts). userId is null for
  any row written before this Phase (or from a call site that could not
  legitimately determine a userId) - grouped together rather than
  dropped, so no real usage silently disappears from a total.

  "calls" here is physical provider request attempts (row count), NOT
  Career Élan user actions or packages generated - see this module's own
  Part R header comment and Admin API Usage Phase 1's "call count
  semantics" requirement. A caller wanting "how many Generate Package
  actions" must derive that separately (e.g. from applications.
  generation_request_id), not from this count.
*/
export function buildUserBreakdown(rows: UsageEventRow[]): UserBreakdownRow[] {
  const byUser = new Map<string | null, UsageEventRow[]>();

  for (const row of rows) {
    const existing = byUser.get(row.user_id);
    if (existing) existing.push(row);
    else byUser.set(row.user_id, [row]);
  }

  return Array.from(byUser.entries())
    .map(([userId, userRows]) => {
      const summary = summarizeUsagePeriod(userRows);
      return {
        userId,
        calls: summary.calls,
        retryCount: summary.retryCount,
        totalTokens: summary.totalTokens,
        costUsd: summary.costUsd,
        costCadKnown: summary.costCadKnown,
        costCadMissingCount: summary.costCadMissingCount,
      };
    })
    .sort((a, b) => b.calls - a.calls);
}

function utcYearMonthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/*
  Admin API Usage Phase 2 - MONTHLY HISTORY. Pure grouping by UTC
  calendar-month boundary (matches lib/admin/queries/shared.ts's
  startOfUtcMonth/startOfNextUtcMonth convention) over rows the caller
  already fetched - current month "resets" purely because a query for
  "this month" naturally returns nothing from a month that hasn't
  started yet, never because any row was deleted, rewritten, or a
  counter reset. See supabase/migrations/20260816000000_
  openai_usage_events_cad_columns.sql's sibling design note.
*/
export function groupRowsByUtcMonth(rows: UsageEventRow[]): Map<string, UsageEventRow[]> {
  const byMonth = new Map<string, UsageEventRow[]>();

  for (const row of rows) {
    const key = utcYearMonthKey(row.created_at);
    const existing = byMonth.get(key);
    if (existing) existing.push(row);
    else byMonth.set(key, [row]);
  }

  return byMonth;
}

export type MonthlySummaryRow = UsagePeriodSummary & {
  yearMonth: string;
  userCount: number;
};

/*
  Newest month first (lexicographic descending sorts "YYYY-MM" keys
  correctly without a date parse) - matches the History page's required
  ordering directly.
*/
export function buildMonthlySummaries(rows: UsageEventRow[]): MonthlySummaryRow[] {
  const byMonth = groupRowsByUtcMonth(rows);

  return Array.from(byMonth.entries())
    .map(([yearMonth, monthRows]) => {
      const summary = summarizeUsagePeriod(monthRows);
      const distinctUsers = new Set(
        monthRows.map((r) => r.user_id).filter((id): id is string => id !== null)
      );
      return { ...summary, yearMonth, userCount: distinctUsers.size };
    })
    .sort((a, b) => (a.yearMonth < b.yearMonth ? 1 : a.yearMonth > b.yearMonth ? -1 : 0));
}

export type UsageAggregation = {
  today: UsagePeriodSummary;
  thisMonth: UsagePeriodSummary;
  dailyAverageCostUsd: number;
  projectedMonthEndCostUsd: number;
  perOperation: OperationBreakdownRow[];
  perModel: ModelBreakdownRow[];
  perUser: UserBreakdownRow[];
};

/*
  `monthRows` must already be pre-filtered to the current UTC month (the
  caller queries created_at >= start-of-month) - today's rows are a
  subset of that, filtered again here by created_at >= start-of-day.
*/
export function aggregateUsageRows(monthRows: UsageEventRow[], now = new Date()): UsageAggregation {
  const todayStartIso = startOfUtcDay(now).toISOString();
  const todayRows = monthRows.filter((r) => r.created_at >= todayStartIso);

  const thisMonth = summarizeUsagePeriod(monthRows);

  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const dailyAverageCostUsd = dayOfMonth > 0 ? round6(thisMonth.costUsd / dayOfMonth) : 0;
  const projectedMonthEndCostUsd = round6(dailyAverageCostUsd * daysInMonth);

  return {
    today: summarizeUsagePeriod(todayRows),
    thisMonth,
    dailyAverageCostUsd,
    projectedMonthEndCostUsd,
    perOperation: buildOperationBreakdown(monthRows),
    perModel: buildModelBreakdown(monthRows),
    perUser: buildUserBreakdown(monthRows),
  };
}
