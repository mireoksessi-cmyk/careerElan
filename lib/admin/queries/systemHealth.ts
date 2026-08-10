/*
  Phase 6I.6.37 - System Health tab. Reuses Phase 6I.6.36's health
  helpers directly (never re-implements the stuck-pending/error-rate
  logic) and adds a few more persisted-column-backed breakdowns that
  weren't needed for the operator runbook but are useful in a full
  dashboard: per-error-code failure counts, document/upload/auth
  failure counts. Every number here comes from an actual column on an
  existing table - no stdout-only event is aggregated (that data isn't
  queryable - see lib/admin/queries/apiCosts.ts's own note on this).
*/
import { supabaseAdmin } from "../../supabaseAdmin";
import { getStuckPendingGenerationsHealth, getRecentGenerationOutcomeHealth } from "../../observability/health";
import { metric, daysAgo, type ClassifiedMetric } from "./shared";

export type SystemHealth = {
  generatePackage: {
    succeeded: ClassifiedMetric<number>;
    failed: ClassifiedMetric<number>;
    successRatePercent: ClassifiedMetric<number | null>;
    stuckPending: ClassifiedMetric<number>;
    oldestStuckAgeMinutes: ClassifiedMetric<number | null>;
    backgroundEnqueueFailed: ClassifiedMetric<number>;
    errorCodeBreakdown: ClassifiedMetric<{ code: string; count: number }[]>;
  };
  documents: {
    pdfFailures: ClassifiedMetric<number>;
    docxFailures: ClassifiedMetric<number>;
  };
  upload: {
    resumeParseFailures: ClassifiedMetric<number>;
    coverLetterParseFailures: ClassifiedMetric<number>;
  };
  windowLabel: string;
};

const WINDOW_DAYS = 7;

export async function getSystemHealth(): Promise<SystemHealth> {
  const since = daysAgo(WINDOW_DAYS).toISOString();

  const outcome = await getRecentGenerationOutcomeHealth(WINDOW_DAYS * 24 * 60);
  const stuck = await getStuckPendingGenerationsHealth();

  const [{ count: enqueueFailed }, { data: errorRows }, { count: pdfFailures }, { count: docxFailures }, { count: resumeFailures }, { count: coverLetterFailures }] = await Promise.all([
    supabaseAdmin.from("applications").select("id", { count: "exact", head: true }).eq("generation_error_code", "BACKGROUND_ENQUEUE_FAILED").gte("updated_at", since),
    supabaseAdmin.from("applications").select("generation_error_code").eq("generation_status", "failed").not("generation_error_code", "is", null).gte("updated_at", since),
    supabaseAdmin.from("applications").select("id", { count: "exact", head: true }).eq("generation_error_code", "template_rendering_failed").gte("updated_at", since),
    supabaseAdmin.from("applications").select("id", { count: "exact", head: true }).eq("generation_error_code", "generated_document_failed").gte("updated_at", since),
    supabaseAdmin.from("resumes").select("id", { count: "exact", head: true }).eq("analysis_status", "failed").gte("updated_at", since),
    supabaseAdmin.from("cover_letters").select("id", { count: "exact", head: true }).eq("analysis_status", "failed").gte("updated_at", since),
  ]);

  const codeCounts = new Map<string, number>();
  for (const row of errorRows ?? []) {
    const code = row.generation_error_code as string;
    codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
  }
  const errorCodeBreakdown = Array.from(codeCounts.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  return {
    generatePackage: {
      succeeded: metric(outcome.succeeded, "EXACT_INTERNAL_DATA"),
      failed: metric(outcome.failed, "EXACT_INTERNAL_DATA"),
      successRatePercent: metric(outcome.errorRate === null ? null : Math.round((1 - outcome.errorRate) * 1000) / 10, "EXACT_INTERNAL_DATA"),
      stuckPending: metric(stuck.count, "EXACT_INTERNAL_DATA"),
      oldestStuckAgeMinutes: metric(stuck.oldestPendingAgeMs === null ? null : Math.round(stuck.oldestPendingAgeMs / 60000), "EXACT_INTERNAL_DATA"),
      backgroundEnqueueFailed: metric(enqueueFailed ?? 0, "EXACT_INTERNAL_DATA"),
      errorCodeBreakdown: metric(errorCodeBreakdown, "EXACT_INTERNAL_DATA"),
    },
    documents: {
      pdfFailures: metric(pdfFailures ?? 0, "EXACT_INTERNAL_DATA"),
      docxFailures: metric(docxFailures ?? 0, "EXACT_INTERNAL_DATA"),
    },
    upload: {
      resumeParseFailures: metric(resumeFailures ?? 0, "EXACT_INTERNAL_DATA"),
      coverLetterParseFailures: metric(coverLetterFailures ?? 0, "EXACT_INTERNAL_DATA"),
    },
    windowLabel: `last ${WINDOW_DAYS} days`,
  };
}
