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
import { metric, startOfUtcMonth, startOfNextUtcMonth, listAllAuthUsers, type ClassifiedMetric } from "./shared";
import { getBudgetSummary, type BudgetSummary } from "../../openai/budget";
import {
  aggregateUsageRows,
  buildMonthlySummaries,
  summarizeUsagePeriod,
  type UsageEventRow,
  type OperationBreakdownRow,
  type ModelBreakdownRow,
  type UserBreakdownRow,
  type UsagePeriodSummary,
  type MonthlySummaryRow,
} from "../../openai/usageAggregation";
import { listRecentRecharges, type RechargeHistoryRow } from "../../openai/recharges";
import { getConfiguredUsdToCadRate } from "../../openai/currency";
import { isPricingKnown } from "../../openai/pricing";

/*
  Admin API Usage Phase 2 - shared select() column list for both the
  existing month-scoped query below and the new fetchAllUsageRows()
  (All-Time cards + API Cost History). Kept as one constant so the two
  queries can never silently drift out of sync on which columns they
  read.
*/
const USAGE_EVENT_COLUMNS =
  "created_at, operation, model, status, duration_ms, input_tokens, output_tokens, total_tokens, estimated_cost_usd, cost_classification, retry_count, http_status_class, user_id, estimated_cost_cad, environment";

/*
  API-B - the console reports production traffic. Deploy Previews run
  against this same database with the same keys, so preview experiments used
  to be counted as customer cost; they are now identifiable and excluded,
  along with branch and local runs.

  Rows written before attribution carry NULL. They are excluded too, because
  their origin is genuinely unknown and quietly folding unknown traffic into
  a figure labelled "production" is the same error the column exists to fix.
  They are not hidden either - the counts below are surfaced in the notes on
  the affected metrics, so the difference between "no production usage yet"
  and "usage that predates attribution" stays visible.
*/
type EnvUsageRow = UsageEventRow & { environment: string | null };

type EnvironmentSplit = {
  production: UsageEventRow[];
  legacyCalls: number;
  legacyCostUsd: number;
  nonProductionCalls: number;
};

function splitByEnvironment(rows: EnvUsageRow[]): EnvironmentSplit {
  const production: UsageEventRow[] = [];
  let legacyCalls = 0;
  let legacyCostUsd = 0;
  let nonProductionCalls = 0;

  for (const row of rows) {
    if (row.environment === "production") {
      production.push(row);
      continue;
    }

    if (row.environment === null || row.environment === undefined) {
      legacyCalls++;
      legacyCostUsd +=
        typeof row.estimated_cost_usd === "number" ? row.estimated_cost_usd : 0;
      continue;
    }

    nonProductionCalls++;
  }

  return { production, legacyCalls, legacyCostUsd, nonProductionCalls };
}

/*
  Reads as a plain sentence on the metric card rather than a separate panel,
  which keeps the disclosure next to the number it qualifies without any new
  UI. Empty when there is nothing excluded, so a fully attributed month says
  nothing extra.
*/
function exclusionNote(split: EnvironmentSplit): string | undefined {
  const parts: string[] = [];

  if (split.legacyCalls > 0) {
    parts.push(
      `${split.legacyCalls} call(s) costing about $${split.legacyCostUsd.toFixed(
        2
      )} predate environment attribution and are excluded - their origin is unknown, not production`
    );
  }

  if (split.nonProductionCalls > 0) {
    parts.push(
      `${split.nonProductionCalls} call(s) from preview/branch/development excluded`
    );
  }

  return parts.length > 0 ? parts.join("; ") : undefined;
}

/*
  Admin API Usage Phase 2 - safety cap on the "fetch every historical
  row" queries (All-Time totals, API Cost History), matching
  lib/admin/queries/shared.ts's own listAllAuthUsers() 50,000-row
  runaway guard for an admin-console read. Career Élan is early-stage;
  re-evaluated if usage volume ever approaches this.
*/
const MAX_USAGE_EVENT_ROWS = 50_000;

/*
  API-A - `unavailable` separates "the query failed" from "the query
  succeeded and there was nothing". Both used to collapse into an empty
  array, so a database problem rendered as a confident 0 calls / $0 -
  indistinguishable from a quiet month, and wrong in the direction that
  gets noticed last.
*/
async function fetchAllUsageRows(): Promise<{
  rows: UsageEventRow[];
  capReached: boolean;
  unavailable: boolean;
  split: EnvironmentSplit;
}> {
  const { data, error } = await supabaseAdmin
    .from("openai_usage_events")
    .select(USAGE_EVENT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(MAX_USAGE_EVENT_ROWS);

  if (error || !data) {
    return {
      rows: [],
      capReached: false,
      unavailable: true,
      split: { production: [], legacyCalls: 0, legacyCostUsd: 0, nonProductionCalls: 0 },
    };
  }

  const fetched = data as EnvUsageRow[];
  const split = splitByEnvironment(fetched);

  return {
    rows: split.production,
    capReached: fetched.length >= MAX_USAGE_EVENT_ROWS,
    unavailable: false,
    split,
  };
}

/*
  API-D - the non-OpenAI providers, counted the same way and shown beside it.

  Production only, and strictly: the filter is environment = 'production',
  never "not development" and never a coalesce that lets a null through. A
  row that cannot say where it ran does not belong in a figure describing
  what customers cost, and the whole point of API-B/C1 was to make that
  distinguishable.

  Usage is exact - these are counted upstream requests. Cost is not shown at
  all, because nothing in this deployment proves the subscribed RapidAPI
  plan, which Places SKU a request bills against, or the Resend tier. A
  provider whose cost is unknown is reported as unknown rather than folded
  into a total as zero, which would read as "free".
*/
export type ExternalProviderKey =
  | "rapidapi_jsearch"
  | "google_places"
  | "resend";

export type ExternalProviderSummary = {
  provider: ExternalProviderKey;
  label: string;
  unit: string;
  requests: ClassifiedMetric<number>;
  successCount: number;
  failedCount: number;
  lastActivityAt: string | null;
  costNote: string;
};

const EXTERNAL_PROVIDER_LABELS: Record<
  ExternalProviderKey,
  { label: string; unit: string; costNote: string }
> = {
  rapidapi_jsearch: {
    label: "RapidAPI / JSearch",
    unit: "upstream requests",
    costNote: "subscribed plan pricing not available to this deployment",
  },
  google_places: {
    label: "Google Places",
    unit: "autocomplete requests",
    costNote: "per-SKU pricing not available to this deployment",
  },
  resend: {
    label: "Resend",
    unit: "send requests",
    costNote: "plan pricing not available to this deployment",
  },
};

type ExternalUsageRow = {
  provider: string;
  status: string;
  request_units: number | null;
  created_at: string;
};

/*
  One bounded read for all three providers, grouped in memory - not a query
  per provider, and not a query per row.
*/
async function fetchProductionExternalUsage(
  monthStart: string,
  monthEnd: string
): Promise<{ rows: ExternalUsageRow[]; unavailable: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("external_api_usage_events")
    .select("provider, status, request_units, created_at")
    .eq("environment", "production")
    .gte("created_at", monthStart)
    .lt("created_at", monthEnd)
    .limit(MAX_USAGE_EVENT_ROWS);

  if (error || !data) {
    return { rows: [], unavailable: true };
  }

  return { rows: data as ExternalUsageRow[], unavailable: false };
}

function summarizeExternalProviders(
  rows: ExternalUsageRow[],
  unavailable: boolean
): ExternalProviderSummary[] {
  const keys: ExternalProviderKey[] = [
    "rapidapi_jsearch",
    "google_places",
    "resend",
  ];

  return keys.map((provider) => {
    const meta = EXTERNAL_PROVIDER_LABELS[provider];
    const providerRows = rows.filter((row) => row.provider === provider);

    let requests = 0;
    let successCount = 0;
    let failedCount = 0;
    let lastActivityAt: string | null = null;

    for (const row of providerRows) {
      requests += typeof row.request_units === "number" ? row.request_units : 1;
      if (row.status === "success") successCount++;
      else failedCount++;
      if (lastActivityAt === null || row.created_at > lastActivityAt) {
        lastActivityAt = row.created_at;
      }
    }

    return {
      provider,
      label: meta.label,
      unit: meta.unit,
      /*
        A failed read is reported unavailable rather than as a real zero,
        the same distinction API-A drew for OpenAI. A successful read that
        found nothing is an ordinary zero.
      */
      requests: unavailable
        ? metric(0, "NOT_AVAILABLE", "provider usage could not be read - not a measurement of zero")
        : metric(requests, "EXACT_INTERNAL_DATA", "production-attributed upstream requests this month"),
      successCount,
      failedCount,
      lastActivityAt,
      costNote: meta.costNote,
    };
  });
}

/*
  Admin API Usage Phase 2 - CAD classification for a single already-
  computed summary (works for a PeriodMetrics-style summary or a single
  MonthlySummaryRow, both share UsagePeriodSummary's costCadKnown/
  costCadMissingCount fields). Never fabricates a CAD figure: explicit
  NOT_AVAILABLE when nothing could be converted, explicit disclosure via
  the note whenever some calls are excluded from a non-zero total.
*/
function cadMetricFromSummary(summary: UsagePeriodSummary): ClassifiedMetric<number> {
  if (summary.costCadKnown === 0 && summary.costCadMissingCount > 0) {
    return metric(
      0,
      "NOT_AVAILABLE",
      `OPENAI_ACCOUNTING_USD_CAD_RATE was not configured for any of these ${summary.costCadMissingCount} call(s) with a known USD cost - CAD unavailable, see the USD cost figure instead.`
    );
  }
  if (summary.costCadMissingCount > 0) {
    return metric(
      summary.costCadKnown,
      "DERIVED_ESTIMATE",
      `${summary.costCadMissingCount} call(s) with a known USD cost have no recorded CAD conversion (no rate was configured when they were written) and are excluded from this total - it understates true CAD spend.`
    );
  }
  return metric(
    summary.costCadKnown,
    "DERIVED_ESTIMATE",
    "sum of estimated_cost_cad - each row's own frozen USD->CAD conversion at insert time, never provider billing and never recalculated with today's rate."
  );
}

export type PeriodMetrics = {
  calls: ClassifiedMetric<number>;
  successCount: ClassifiedMetric<number>;
  errorCount: ClassifiedMetric<number>;
  retryCount: ClassifiedMetric<number>;
  totalTokens: ClassifiedMetric<number>;
  cost: ClassifiedMetric<number>;
  costCad: ClassifiedMetric<number>;
  avgLatencyMs: ClassifiedMetric<number | null>;
  rateLimited429: ClassifiedMetric<number>;
  timeouts: ClassifiedMetric<number>;
  serverErrors5xx: ClassifiedMetric<number>;
};

export type UserUsageRow = {
  userId: string | null;
  email: string | null;
  calls: number;
  retryCount: number;
  totalTokens: number;
  costUsd: number;
  costCad: ClassifiedMetric<number>;
};

export type ApiCostMetrics = {
  openAi: {
    today: PeriodMetrics;
    thisMonth: PeriodMetrics & {
      dailyAverageCost: ClassifiedMetric<number>;
      projectedMonthEndCost: ClassifiedMetric<number>;
      lastCallAt: ClassifiedMetric<string | null>;
    };
    /*
      Admin API Usage Phase 2 - reads from a separate bounded
      fetchAllUsageRows() query (see below), not derived from thisMonth -
      capped at MAX_USAGE_EVENT_ROWS most recent rows, disclosed via
      allTimeRowCapReached rather than silently presenting a partial sum
      as complete once usage volume ever exceeds the cap.
    */
    allTime: PeriodMetrics;
    allTimeRowCapReached: boolean;
    cadRateConfiguredNow: boolean;
    budget: BudgetSummary;
    rechargeHistory: RechargeHistoryRow[];
    remainingCapacity: ClassifiedMetric<string>;
    unknownPricingModels: ClassifiedMetric<string[]>;
    /*
      API-A - calls on a priced model that returned no usage to price.
      Counted separately from unknownPricingModels so neither is described
      as the other.
    */
    noUsageDataCalls: number;
    perOperation: OperationBreakdownRow[];
    perModel: ModelBreakdownRow[];
    /* This UTC calendar month only - see lib/openai/usageAggregation.ts's buildUserBreakdown() for "calls" semantics. */
    perUser: UserUsageRow[];
  };
  /*
    API-D - the production picture across every metered provider, plus what
    the money total deliberately leaves out.
  */
  production: {
    externalProviders: ExternalProviderSummary[];
    /*
      Sums only figures with a real accounting basis behind them. Today that
      is OpenAI's local estimate and nothing else - the other three have no
      known price, and adding them in as zero would understate the bill
      while looking complete.
    */
    knownEstimatedCostUsd: ClassifiedMetric<number>;
    costUnknownProviders: string[];
  };
  supabase: { authUsers: ClassifiedMetric<number>; note: string };
  netlify: { note: string };
  sentry: { configured: boolean; note: string };
  resend: { note: string };
};

/*
  API-A - when the underlying query could not be read, every figure in the
  period is reported NOT_AVAILABLE rather than as a real measurement. A
  genuine empty period still returns ordinary zeros, which is the whole
  point of keeping the two apart.
*/
function unavailablePeriodMetrics(note: string): PeriodMetrics {
  const n = (): ClassifiedMetric<number> => metric(0, "NOT_AVAILABLE", note);

  return {
    calls: n(),
    successCount: n(),
    errorCount: n(),
    retryCount: n(),
    totalTokens: n(),
    cost: n(),
    costCad: n(),
    avgLatencyMs: metric(null, "NOT_AVAILABLE", note),
    rateLimited429: n(),
    timeouts: n(),
    serverErrors5xx: n(),
  };
}

function periodMetrics(
  summary: UsagePeriodSummary,
  /*
    API-B - what production accounting left out, stated on the two cards a
    reader checks first. Undefined when nothing was excluded.
  */
  excluded?: string
): PeriodMetrics {
  return {
    calls: metric(summary.calls, "EXACT_INTERNAL_DATA", excluded),
    successCount: metric(summary.successCount, "EXACT_INTERNAL_DATA"),
    errorCount: metric(summary.errorCount, "EXACT_INTERNAL_DATA"),
    retryCount: metric(summary.retryCount, "EXACT_INTERNAL_DATA"),
    totalTokens: metric(summary.totalTokens, "EXACT_INTERNAL_DATA", "NULL token rows (endpoint returned no usage) contribute 0"),
    cost: metric(
      summary.costUsd,
      "DERIVED_ESTIMATE",
      excluded
        ? `sum of estimated_cost_usd for production traffic - local token x price calculation, never provider billing. ${excluded}`
        : "sum of estimated_cost_usd for production traffic - local token x price calculation, never provider billing"
    ),
    costCad: cadMetricFromSummary(summary),
    avgLatencyMs: metric(summary.avgLatencyMs, "EXACT_INTERNAL_DATA"),
    rateLimited429: metric(summary.rateLimited429, "EXACT_INTERNAL_DATA"),
    timeouts: metric(summary.timeouts, "EXACT_INTERNAL_DATA"),
    serverErrors5xx: metric(summary.serverErrors5xx, "EXACT_INTERNAL_DATA"),
  };
}

export async function getApiCostMetrics(): Promise<ApiCostMetrics> {
  const now = new Date();
  const monthStart = startOfUtcMonth(now).toISOString();
  const monthEnd = startOfNextUtcMonth(now).toISOString();

  const [
    { data: monthRows, error: rowsError },
    authUsers,
    budget,
    allTimeFetch,
    externalFetch,
  ] = await Promise.all([
    supabaseAdmin
      .from("openai_usage_events")
      .select(USAGE_EVENT_COLUMNS)
      .gte("created_at", monthStart)
      .lt("created_at", monthEnd),
    listAllAuthUsers(),
    getBudgetSummary(now),
    fetchAllUsageRows(),
    fetchProductionExternalUsage(monthStart, monthEnd),
  ]);

  /*
    API-A - same distinction as the all-time query above: a failed read
    must not be aggregated as a real, empty month.
  */
  const monthUnavailable = Boolean(rowsError) || !monthRows;

  /*
    API-B - the month is aggregated from production rows only; what was
    excluded is carried alongside so the console can say so rather than
    simply showing a smaller number.
  */
  const monthSplit = monthUnavailable
    ? { production: [], legacyCalls: 0, legacyCostUsd: 0, nonProductionCalls: 0 }
    : splitByEnvironment(monthRows as EnvUsageRow[]);

  const rows: UsageEventRow[] = monthSplit.production;
  const aggregation = aggregateUsageRows(rows, now);
  const monthExclusionNote = exclusionNote(monthSplit);
  const allTimeExclusionNote = exclusionNote(allTimeFetch.split);

  const MONTH_UNAVAILABLE_NOTE =
    "this month's usage could not be read - not a measurement of zero";
  const ALL_TIME_UNAVAILABLE_NOTE =
    "all-time usage could not be read - not a measurement of zero";
  const authUserCount = authUsers.length;

  const emailByUserId = new Map(authUsers.map((u) => [u.id, u.email]));
  const rechargeHistory = await listRecentRecharges(emailByUserId);

  const allTimeMetrics = allTimeFetch.unavailable
    ? unavailablePeriodMetrics(ALL_TIME_UNAVAILABLE_NOTE)
    : periodMetrics(summarizeAllTimeRows(allTimeFetch.rows), allTimeExclusionNote);

  const perUser: UserUsageRow[] = aggregation.perUser.map((u: UserBreakdownRow) => ({
    userId: u.userId,
    email: u.userId ? (emailByUserId.get(u.userId) ?? null) : null,
    calls: u.calls,
    retryCount: u.retryCount,
    totalTokens: u.totalTokens,
    costUsd: u.costUsd,
    costCad:
      u.costCadKnown === 0 && u.costCadMissingCount > 0
        ? metric(0, "NOT_AVAILABLE", "No CAD rate configured for this user's calls.")
        : metric(u.costCadKnown, "DERIVED_ESTIMATE", u.costCadMissingCount > 0 ? `${u.costCadMissingCount} call(s) excluded (no CAD rate recorded).` : undefined),
  }));

  /*
    API-A - a model belongs on the unpriced list only when the model itself
    has no confirmed price. It used to be listed whenever any of its rows
    carried UNKNOWN_PRICING, and the stored column uses that same value for
    calls that failed before reporting usage - so a fully priced model
    appeared under "Unpriced Models (cost understated)" because two of its
    requests had errored. isPricingKnown() answers the actual question, and
    a genuinely unpriced model is still listed exactly as before.
  */
  const unknownPricingModels = Array.from(
    new Set(
      aggregation.perModel
        .filter((m) => m.unknownPricingCount > 0 && !isPricingKnown(m.model))
        .map((m) => m.model)
    )
  );

  /*
    The remainder: priced models whose rows had no usage to price. Reported
    as a count of calls, with no claim about their cost in either direction
    - a request that never returned usage gives this codebase nothing to
    price, which is not the same as knowing it was free.
  */
  const noUsageDataCalls = aggregation.perModel
    .filter((m) => isPricingKnown(m.model))
    .reduce((sum, m) => sum + m.unknownPricingCount, 0);

  /*
    API-D - built from the production-filtered month only. The OpenAI figure
    reuses the same production aggregation the cards above show, so the total
    and its parts cannot disagree.
  */
  const externalProviders = summarizeExternalProviders(
    externalFetch.rows,
    externalFetch.unavailable
  );

  const costUnknownProviders = externalProviders.map((p) => p.label);

  const knownEstimatedCostUsd = monthUnavailable
    ? metric(0, "NOT_AVAILABLE", MONTH_UNAVAILABLE_NOTE)
    : metric(
        aggregation.thisMonth.costUsd,
        "DERIVED_ESTIMATE",
        `OpenAI production estimate only. Excluded because no price is known for them: ${costUnknownProviders.join(
          ", "
        )}. Also excluded because not production: development, preview, branch and unattributed legacy usage.`
      );

  return {
    openAi: {
      today: monthUnavailable
        ? unavailablePeriodMetrics(MONTH_UNAVAILABLE_NOTE)
        : periodMetrics(aggregation.today, monthExclusionNote),
      thisMonth: {
        ...(monthUnavailable
          ? unavailablePeriodMetrics(MONTH_UNAVAILABLE_NOTE)
          : periodMetrics(aggregation.thisMonth, monthExclusionNote)),
        dailyAverageCost: monthUnavailable
          ? metric(0, "NOT_AVAILABLE", MONTH_UNAVAILABLE_NOTE)
          : metric(aggregation.dailyAverageCostUsd, "DERIVED_ESTIMATE", "month-to-date cost / day of month"),
        projectedMonthEndCost: monthUnavailable
          ? metric(0, "NOT_AVAILABLE", MONTH_UNAVAILABLE_NOTE)
          : metric(aggregation.projectedMonthEndCostUsd, "DERIVED_ESTIMATE", "linear projection from month-to-date daily average"),
        lastCallAt: monthUnavailable
          ? metric(null, "NOT_AVAILABLE", MONTH_UNAVAILABLE_NOTE)
          : metric(aggregation.thisMonth.lastCallAt, "EXACT_INTERNAL_DATA"),
      },
      allTime: allTimeMetrics,
      allTimeRowCapReached: allTimeFetch.capReached,
      cadRateConfiguredNow: getConfiguredUsdToCadRate() !== null,
      budget,
      rechargeHistory,
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
      noUsageDataCalls,
      perOperation: aggregation.perOperation,
      perModel: aggregation.perModel,
      perUser,
    },
    production: {
      externalProviders,
      knownEstimatedCostUsd,
      costUnknownProviders,
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

/*
  Admin API Usage Phase 2 - thin wrapper so getApiCostMetrics()'s
  All-Time card uses the exact same summarizeUsagePeriod() arithmetic as
  every other period in this file (Today/This Month), just imported
  directly for a one-off summary rather than the full
  aggregateUsageRows() bundle (which also computes per-operation/
  per-model/per-user breakdowns this call site does not need for a
  single top-line card).
*/
function summarizeAllTimeRows(rows: UsageEventRow[]): UsagePeriodSummary {
  return summarizeUsagePeriod(rows);
}

export type ApiCostHistoryMonth = MonthlySummaryRow & {
  costCad: ClassifiedMetric<number>;
};

export type ApiCostHistory = {
  months: ApiCostHistoryMonth[];
  cadRateConfiguredNow: boolean;
  rowCap: number;
  rowCapReached: boolean;
};

/*
  Admin API Usage Phase 2 - MONTHLY HISTORY. No new DB table: reads the
  same openai_usage_events rows getApiCostMetrics() already reads (via
  the same bounded fetchAllUsageRows()), grouped by UTC calendar month
  purely in memory (lib/openai/usageAggregation.ts's
  buildMonthlySummaries()). Every past month's rows stay exactly as
  they were written - "Current Month" elsewhere in this file simply
  never includes a future month's rows, and a new month's total starts
  at zero purely because no rows exist for it yet, not because anything
  was reset.
*/
export async function getApiCostHistory(): Promise<ApiCostHistory> {
  const { rows, capReached } = await fetchAllUsageRows();
  const months = buildMonthlySummaries(rows).map((m) => ({
    ...m,
    costCad: cadMetricFromSummary(m),
  }));

  return {
    months,
    cadRateConfiguredNow: getConfiguredUsdToCadRate() !== null,
    rowCap: MAX_USAGE_EVENT_ROWS,
    rowCapReached: capReached,
  };
}

export type ApiCostMonthDetail = {
  yearMonth: string;
  perUser: UserUsageRow[];
  perOperation: OperationBreakdownRow[];
};

/*
  Admin API Usage Phase 2 - optional one-month drill-down for the
  History page (Section 9's "allow inspecting one month in more detail
  if this fits the existing query architecture without major
  expansion"). Reuses the same bounded fetchAllUsageRows() + the same
  buildUserBreakdown/buildOperationBreakdown helpers getApiCostMetrics()
  already uses for "this month" - just filtered to a caller-chosen past
  month instead of the current one. Returns null for a month with no
  rows in the fetched window, rather than a misleadingly empty-but-
  present detail object.
*/
export async function getApiCostMonthDetail(yearMonth: string): Promise<ApiCostMonthDetail | null> {
  const { rows } = await fetchAllUsageRows();
  const monthRows = rows.filter((r) => r.created_at.slice(0, 7) === yearMonth);
  if (monthRows.length === 0) return null;

  const authUsers = await listAllAuthUsers();
  const emailByUserId = new Map(authUsers.map((u) => [u.id, u.email]));

  const aggregation = aggregateUsageRows(monthRows, new Date(`${yearMonth}-01T00:00:00Z`));

  const perUser: UserUsageRow[] = aggregation.perUser.map((u: UserBreakdownRow) => ({
    userId: u.userId,
    email: u.userId ? (emailByUserId.get(u.userId) ?? null) : null,
    calls: u.calls,
    retryCount: u.retryCount,
    totalTokens: u.totalTokens,
    costUsd: u.costUsd,
    costCad:
      u.costCadKnown === 0 && u.costCadMissingCount > 0
        ? metric(0, "NOT_AVAILABLE", "No CAD rate configured for this user's calls.")
        : metric(u.costCadKnown, "DERIVED_ESTIMATE", u.costCadMissingCount > 0 ? `${u.costCadMissingCount} call(s) excluded (no CAD rate recorded).` : undefined),
  }));

  return {
    yearMonth,
    perUser,
    perOperation: aggregation.perOperation,
  };
}
