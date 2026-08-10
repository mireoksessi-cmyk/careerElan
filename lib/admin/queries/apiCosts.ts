/*
  Phase 6I.6.37 - AI & API Costs tab. Built directly on Phase 6I.6.36's
  External Provider Usage & Limit Readiness audit findings (this
  phase's own re-confirmation, not re-derived): there is NO persisted
  OpenAI call-log table anywhere in this codebase - every OpenAI event
  (lib/observability/logger.ts's "openai" domain, and generateCore.ts's
  own stage logs) is a stdout JSON line only, captured by Netlify
  Function Logs, never written to a queryable table. Token counts ARE
  read from the OpenAI SDK response (.usage) at exactly one call site
  (lib/generatePackage/generateCore.ts) but, again, only logged, never
  persisted. This tab is therefore honest about what it can and cannot
  show, per Part K/L/AO's explicit "do not fabricate" / "classify every
  metric" instructions - it does NOT reverse-engineer a per-call log
  from `applications` rows beyond what that table's own generation_*
  columns already represent (attempt counts, not call counts - legacy
  makes 2 OpenAI calls per generation, canonical makes 1 + up to 1
  repair retry, so "attempts" != "OpenAI calls" 1:1).
*/
import { supabaseAdmin } from "../../supabaseAdmin";
import { metric, startOfUtcDay, startOfUtcMonth, listAllAuthUsers, type ClassifiedMetric } from "./shared";

export type OperationRow = {
  operation: string;
  calls: ClassifiedMetric<number | null>;
  successRate: ClassifiedMetric<number | null>;
};

export type ApiCostMetrics = {
  openAi: {
    today: {
      generatePackageAttempts: ClassifiedMetric<number>;
      tokens: ClassifiedMetric<null>;
      cost: ClassifiedMetric<null>;
    };
    thisMonth: {
      generatePackageAttempts: ClassifiedMetric<number>;
      tokens: ClassifiedMetric<null>;
      cost: ClassifiedMetric<null>;
      dailyAverageAttempts: ClassifiedMetric<number>;
      projectedMonthEndAttempts: ClassifiedMetric<number>;
    };
    remainingCapacity: ClassifiedMetric<string>;
    perOperation: OperationRow[];
  };
  supabase: { authUsers: ClassifiedMetric<number>; note: string };
  netlify: { note: string };
  sentry: { configured: boolean; note: string };
  resend: { note: string };
};

export async function getApiCostMetrics(): Promise<ApiCostMetrics> {
  const now = new Date();
  const todayStart = startOfUtcDay(now).toISOString();
  const monthStart = startOfUtcMonth(now).toISOString();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();

  const [{ count: attemptsToday }, { count: attemptsThisMonth }, authUsers] = await Promise.all([
    supabaseAdmin.from("applications").select("id", { count: "exact", head: true }).not("generation_status", "is", null).gte("created_at", todayStart),
    supabaseAdmin.from("applications").select("id", { count: "exact", head: true }).not("generation_status", "is", null).gte("created_at", monthStart),
    listAllAuthUsers(),
  ]);
  const authUserCount = authUsers.length;

  const dailyAverage = dayOfMonth > 0 ? Math.round(((attemptsThisMonth ?? 0) / dayOfMonth) * 100) / 100 : 0;
  const projected = Math.round(dailyAverage * daysInMonth);

  const operations = [
    "generate-package",
    "analyze-job",
    "analyze-job-url",
    "resume-analysis",
    "cover-letter-analysis",
    "recommend-jobs",
    "career-insight",
    "analytics-summary",
  ];

  return {
    openAi: {
      today: {
        generatePackageAttempts: metric(attemptsToday ?? 0, "DERIVED_ESTIMATE", "Generate Package tailoring attempts, not a raw OpenAI call count"),
        tokens: metric(null, "NOT_AVAILABLE", "no persisted call-log table"),
        cost: metric(null, "NOT_AVAILABLE", "no persisted call-log table"),
      },
      thisMonth: {
        generatePackageAttempts: metric(attemptsThisMonth ?? 0, "DERIVED_ESTIMATE"),
        tokens: metric(null, "NOT_AVAILABLE"),
        cost: metric(null, "NOT_AVAILABLE"),
        dailyAverageAttempts: metric(dailyAverage, "DERIVED_ESTIMATE"),
        projectedMonthEndAttempts: metric(projected, "DERIVED_ESTIMATE", "linear projection from month-to-date daily average"),
      },
      remainingCapacity: metric(
        "Check OpenAI Dashboard",
        "MANUAL_PROVIDER_DASHBOARD_ONLY",
        "no OPENAI_ADMIN_KEY configured - the standard API key cannot read org usage/cost"
      ),
      perOperation: operations.map((operation) => ({
        operation,
        calls: metric(null, "NOT_AVAILABLE", "no persisted per-operation call log"),
        successRate: metric(null, "NOT_AVAILABLE"),
      })),
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
      note: "Used only for /api/followup reminder emails. Send/failure counts: NOT_AVAILABLE (no persisted send-log; Resend's own dashboard has this).",
    },
  };
}
