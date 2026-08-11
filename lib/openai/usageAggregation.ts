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
};

export type OperationBreakdownRow = {
  operation: OpenAiOperation;
  calls: number;
  successCount: number;
  errorCount: number;
  successRatePercent: number | null;
  totalTokens: number;
  costUsd: number;
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

  for (const row of rows) {
    if (row.status === "success") successCount++;
    else errorCount++;

    if (row.retry_count > 0) retryCount += row.retry_count;

    inputTokens += row.input_tokens ?? 0;
    outputTokens += row.output_tokens ?? 0;
    totalTokens += row.total_tokens ?? 0;

    if (typeof row.estimated_cost_usd === "number") costUsd += row.estimated_cost_usd;
    if (row.cost_classification === "UNKNOWN_PRICING") unknownPricingCount++;

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

export type UsageAggregation = {
  today: UsagePeriodSummary;
  thisMonth: UsagePeriodSummary;
  dailyAverageCostUsd: number;
  projectedMonthEndCostUsd: number;
  perOperation: OperationBreakdownRow[];
  perModel: ModelBreakdownRow[];
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
  };
}
