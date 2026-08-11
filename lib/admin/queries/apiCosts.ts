/*
  Phase 6I.6.38A - AI & API Costs tab, rewritten on top of the new
  openai_usage_events telemetry table (see lib/openai/telemetry.ts and
  the two 20260810190000/190100 migrations). Phase 6I.6.37 built this
  tab honestly around the fact that no such table existed yet - it does
  now, so every OpenAI metric below reads real rows instead of the
  DERIVED_ESTIMATE/NOT_AVAILABLE placeholders that phase shipped.

  Still honest about what remains genuinely unavailable: OpenAI's own
  remaining prepaid balance/org usage requires an Admin API key
  (OPENAI_ADMIN_KEY) this deployment does not have configured - Part N/
  V's MANUAL_PROVIDER_DASHBOARD_ONLY classification for that one field
  is unchanged. Everything else below is EXACT_INTERNAL_DATA, computed
  from this codebase's own telemetry rows, not the provider's billing
  system - estimated_cost_usd itself is ESTIMATED_COST (Part E), never
  presented as exact billing.
*/
import { supabaseAdmin } from "../../supabaseAdmin";
import { metric, startOfUtcMonth, listAllAuthUsers, type ClassifiedMetric } from "./shared";
import { getBudgetSummary, type BudgetSummary } from "../../openai/budget";
import { aggregateUsageRows, type UsageEventRow, type OperationBreakdownRow, type ModelBreakdownRow } from "../../openai/usageAggregation";

export type PeriodMetrics = {
  calls: ClassifiedMetric<number>;
  successCount: ClassifiedMetric<number>;
  errorCount: ClassifiedMetric<number>;
  retryCount: ClassifiedMetric<number>;
  totalTokens: ClassifiedMetric<number>;
  cost: ClassifiedMetric<number>;
  avgLatencyMs: ClassifiedMetric<number | null>;
  rateLimited429: ClassifiedMetric<number>;
  timeouts: ClassifiedMetric<number>;
  serverErrors5xx: ClassifiedMetric<number>;
};

export type ApiCostMetrics = {
  openAi: {
    today: PeriodMetrics;
    thisMonth: PeriodMetrics & {
      dailyAverageCost: ClassifiedMetric<number>;
      projectedMonthEndCost: ClassifiedMetric<number>;
      lastCallAt: ClassifiedMetric<string | null>;
    };
    budget: BudgetSummary;
    remainingCapacity: ClassifiedMetric<string>;
    unknownPricingModels: ClassifiedMetric<string[]>;
    perOperation: OperationBreakdownRow[];
    perModel: ModelBreakdownRow[];
  };
  supabase: { authUsers: ClassifiedMetric<number>; note: string };
  netlify: { note: string };
  sentry: { configured: boolean; note: string };
  resend: { note: string };
};

function periodMetrics(summary: ReturnType<typeof aggregateUsageRows>["today"]): PeriodMetrics {
  return {
    calls: metric(summary.calls, "EXACT_INTERNAL_DATA"),
    successCount: metric(summary.successCount, "EXACT_INTERNAL_DATA"),
    errorCount: metric(summary.errorCount, "EXACT_INTERNAL_DATA"),
    retryCount: metric(summary.retryCount, "EXACT_INTERNAL_DATA"),
    totalTokens: metric(summary.totalTokens, "EXACT_INTERNAL_DATA", "NULL token rows (endpoint returned no usage) contribute 0"),
    cost: metric(summary.costUsd, "DERIVED_ESTIMATE", "sum of estimated_cost_usd - local token x price calculation, never provider billing"),
    avgLatencyMs: metric(summary.avgLatencyMs, "EXACT_INTERNAL_DATA"),
    rateLimited429: metric(summary.rateLimited429, "EXACT_INTERNAL_DATA"),
    timeouts: metric(summary.timeouts, "EXACT_INTERNAL_DATA"),
    serverErrors5xx: metric(summary.serverErrors5xx, "EXACT_INTERNAL_DATA"),
  };
}

export async function getApiCostMetrics(): Promise<ApiCostMetrics> {
  const now = new Date();
  const monthStart = startOfUtcMonth(now).toISOString();

  const [{ data: monthRows, error: rowsError }, authUsers, budget] = await Promise.all([
    supabaseAdmin
      .from("openai_usage_events")
      .select(
        "created_at, operation, model, status, duration_ms, input_tokens, output_tokens, total_tokens, estimated_cost_usd, cost_classification, retry_count, http_status_class"
      )
      .gte("created_at", monthStart),
    listAllAuthUsers(),
    getBudgetSummary(now),
  ]);

  const rows: UsageEventRow[] = rowsError || !monthRows ? [] : (monthRows as UsageEventRow[]);
  const aggregation = aggregateUsageRows(rows, now);
  const authUserCount = authUsers.length;

  const unknownPricingModels = Array.from(
    new Set(aggregation.perModel.filter((m) => m.unknownPricingCount > 0).map((m) => m.model))
  );

  return {
    openAi: {
      today: periodMetrics(aggregation.today),
      thisMonth: {
        ...periodMetrics(aggregation.thisMonth),
        dailyAverageCost: metric(aggregation.dailyAverageCostUsd, "DERIVED_ESTIMATE", "month-to-date cost / day of month"),
        projectedMonthEndCost: metric(aggregation.projectedMonthEndCostUsd, "DERIVED_ESTIMATE", "linear projection from month-to-date daily average"),
        lastCallAt: metric(aggregation.thisMonth.lastCallAt, "EXACT_INTERNAL_DATA"),
      },
      budget,
      remainingCapacity: metric(
        "Check OpenAI Dashboard",
        "MANUAL_PROVIDER_DASHBOARD_ONLY",
        "no OPENAI_ADMIN_KEY configured - the standard API key cannot read org usage/cost/remaining balance"
      ),
      unknownPricingModels: metric(
        unknownPricingModels,
        unknownPricingModels.length > 0 ? "NOT_AVAILABLE" : "EXACT_INTERNAL_DATA",
        unknownPricingModels.length > 0
          ? "cost for these models could not be estimated - not in the confirmed pricing table (lib/openai/pricing.ts) - real spend on these models is understated above"
          : undefined
      ),
      perOperation: aggregation.perOperation,
      perModel: aggregation.perModel,
    },
    supabase: {
      authUsers: metric(authUserCount ?? 0, "EXACT_INTERNAL_DATA", "see Users tab for the authoritative count"),
      note: "DB/Storage health: MANUAL_PROVIDER_DASHBOARD_ONLY (Supabase project dashboard) - no SUPABASE_ACCESS_TOKEN configured for the Management API.",
    },
    netlify: {
      note: "MANUAL_PROVIDER_DASHBOARD_ONLY - no NETLIFY_API_TOKEN configured for the Netlify usage/limits API.",
    },
    sentry: {
      configured: false,
      note: "Not Configured (Phase 6I.6.36 decision: no DSN exists, none was fabricated - see docs/PRODUCTION_MONITORING_RUNBOOK.md).",
    },
    resend: {
      note: "Used only for /api/followup reminder emails and Phase 6I.6.38A budget alert emails. Send/failure counts: NOT_AVAILABLE (no persisted send-log; Resend's own dashboard has this).",
    },
  };
}
