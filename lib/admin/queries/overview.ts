/*
  Phase 6I.6.37 - Admin Overview cockpit. Read-only, aggregate-only.
  Every field is a ClassifiedMetric (lib/admin/queries/shared.ts) so
  the page can render "Unavailable"/estimate badges instead of ever
  fabricating a number (Part G's own "do not fabricate" instruction).
*/
import { supabaseAdmin } from "../../supabaseAdmin";
import { getStuckPendingGenerationsHealth, getRecentGenerationOutcomeHealth } from "../../observability/health";
import { metric, startOfUtcDay, startOfUtcMonth, daysAgo, listAllAuthUsers, type ClassifiedMetric } from "./shared";
import { getAlerts, countBySeverity } from "./alerts";

export type AdminOverview = {
  users: {
    total: ClassifiedMetric<number>;
    /*
      An auth.users row appears the moment Create Account is pressed, so
      `total` counts signup attempts, not members. Membership is the
      verified half of that, split out here so the console can stop
      reporting one as the other.
    */
    verifiedMembers: ClassifiedMetric<number>;
    unverifiedSignups: ClassifiedMetric<number>;
    newToday: ClassifiedMetric<number>;
    new7Days: ClassifiedMetric<number>;
    newThisMonth: ClassifiedMetric<number>;
  };
  product: {
    careerMemoryCompleted: ClassifiedMetric<number>;
    resumeOwners: ClassifiedMetric<number>;
    generatePackageUsersThisMonth: ClassifiedMetric<number>;
    generatePackagesThisMonth: ClassifiedMetric<number>;
    applicationsThisMonth: ClassifiedMetric<number>;
  };
  health: {
    generateSuccessRate: ClassifiedMetric<number | null>;
    failedGenerations: ClassifiedMetric<number>;
    stuckPending: ClassifiedMetric<number>;
    recentArtifactFailures: ClassifiedMetric<number>;
    recentUploadFailures: ClassifiedMetric<number>;
  };
  apiCost: {
    generatePackageAttemptsToday: ClassifiedMetric<number>;
    generatePackageAttemptsThisMonth: ClassifiedMetric<number>;
    tokensThisMonth: ClassifiedMetric<null>;
    costThisMonth: ClassifiedMetric<null>;
  };
  alerts: {
    critical: number;
    high: number;
    medium: number;
  };
};

export async function getAdminOverview(): Promise<AdminOverview> {
  const now = new Date();
  const todayStart = startOfUtcDay(now).toISOString();
  const sevenDaysAgo = daysAgo(7, now).toISOString();
  const monthStart = startOfUtcMonth(now).toISOString();

  const authUsers = await listAllAuthUsers();
  const total = authUsers.length;
  /*
    email_confirmed_at is Supabase Auth's own record of the address having
    been proven. Nothing else here stands in for it - a profile row, a last
    sign-in, a finished Career Memory and a subscription can all exist
    without the address ever having been confirmed.
  */
  const verifiedMembers = authUsers.filter((u) => u.emailConfirmedAt !== null).length;
  const newToday = authUsers.filter((u) => u.createdAt >= todayStart).length;
  const new7Days = authUsers.filter((u) => u.createdAt >= sevenDaysAgo).length;
  const newThisMonth = authUsers.filter((u) => u.createdAt >= monthStart).length;

  const [
    { count: careerMemoryCompleted },
    { data: resumeUserRows },
    { count: applicationsThisMonth },
    { count: generatePackageAttemptsToday },
    { count: generatePackageAttemptsThisMonth },
    { count: failedGenerationsCount },
    { count: recentArtifactFailures },
    { count: recentUploadFailures },
  ] = await Promise.all([
    supabaseAdmin.from("career_memory").select("id", { count: "exact", head: true }).eq("required_completed", true),
    supabaseAdmin.from("resumes").select("user_id"),
    supabaseAdmin.from("applications").select("id", { count: "exact", head: true }).gte("created_at", monthStart),
    supabaseAdmin.from("applications").select("id", { count: "exact", head: true }).not("generation_status", "is", null).gte("created_at", todayStart),
    supabaseAdmin.from("applications").select("id", { count: "exact", head: true }).not("generation_status", "is", null).gte("created_at", monthStart),
    supabaseAdmin.from("applications").select("id", { count: "exact", head: true }).eq("generation_status", "failed").gte("created_at", daysAgo(30, now).toISOString()),
    supabaseAdmin
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("generation_status", "failed")
      .in("generation_error_code", ["template_rendering_failed", "generated_document_failed", "persistence_failed"])
      .gte("updated_at", daysAgo(1, now).toISOString()),
    supabaseAdmin
      .from("resumes")
      .select("id", { count: "exact", head: true })
      .eq("analysis_status", "failed")
      .gte("updated_at", daysAgo(1, now).toISOString()),
  ]);

  const resumeOwners = new Set((resumeUserRows ?? []).map((r) => r.user_id)).size;

  // "Generate Package users this month" derived from distinct user_id on
  // applications rows with a non-null generation_status this month -
  // same population the "attempts" count above is drawn from, just
  // deduplicated per user.
  const { data: generatePackageUserRows } = await supabaseAdmin
    .from("applications")
    .select("user_id")
    .not("generation_status", "is", null)
    .gte("created_at", monthStart);
  const generatePackageUsersThisMonth = new Set((generatePackageUserRows ?? []).map((r) => r.user_id)).size;

  const outcome60 = await getRecentGenerationOutcomeHealth(60);
  const stuck = await getStuckPendingGenerationsHealth();
  const alertCounts = countBySeverity(await getAlerts());

  return {
    users: {
      total: metric(total, "EXACT_INTERNAL_DATA", authUsers.length >= 50000 ? "capped at 50,000 rows" : undefined),
      verifiedMembers: metric(verifiedMembers, "EXACT_INTERNAL_DATA"),
      unverifiedSignups: metric(total - verifiedMembers, "EXACT_INTERNAL_DATA"),
      newToday: metric(newToday, "EXACT_INTERNAL_DATA"),
      new7Days: metric(new7Days, "EXACT_INTERNAL_DATA"),
      newThisMonth: metric(newThisMonth, "EXACT_INTERNAL_DATA"),
    },
    product: {
      careerMemoryCompleted: metric(careerMemoryCompleted ?? 0, "EXACT_INTERNAL_DATA"),
      resumeOwners: metric(resumeOwners, "EXACT_INTERNAL_DATA"),
      generatePackageUsersThisMonth: metric(generatePackageUsersThisMonth, "EXACT_INTERNAL_DATA"),
      generatePackagesThisMonth: metric(generatePackageAttemptsThisMonth ?? 0, "EXACT_INTERNAL_DATA"),
      applicationsThisMonth: metric(applicationsThisMonth ?? 0, "EXACT_INTERNAL_DATA"),
    },
    health: {
      generateSuccessRate: metric(
        outcome60.errorRate === null ? null : Math.round((1 - outcome60.errorRate) * 1000) / 10,
        "EXACT_INTERNAL_DATA",
        "last 60 minutes"
      ),
      failedGenerations: metric(failedGenerationsCount ?? 0, "EXACT_INTERNAL_DATA", "last 30 days"),
      stuckPending: metric(stuck.count, "EXACT_INTERNAL_DATA"),
      recentArtifactFailures: metric(recentArtifactFailures ?? 0, "EXACT_INTERNAL_DATA", "last 24h, render/storage error codes"),
      recentUploadFailures: metric(recentUploadFailures ?? 0, "EXACT_INTERNAL_DATA", "last 24h, resumes only"),
    },
    apiCost: {
      generatePackageAttemptsToday: metric(generatePackageAttemptsToday ?? 0, "DERIVED_ESTIMATE", "proxy for OpenAI tailoring calls - not a raw call count"),
      generatePackageAttemptsThisMonth: metric(generatePackageAttemptsThisMonth ?? 0, "DERIVED_ESTIMATE", "proxy for OpenAI tailoring calls - not a raw call count"),
      tokensThisMonth: metric(null, "NOT_AVAILABLE", "no persisted call-log table - see AI/API Costs tab"),
      costThisMonth: metric(null, "NOT_AVAILABLE", "no persisted call-log table - see AI/API Costs tab"),
    },
    alerts: { critical: alertCounts.critical, high: alertCounts.high, medium: alertCounts.medium },
  };
}
