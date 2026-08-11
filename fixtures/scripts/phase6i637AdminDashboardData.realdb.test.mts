/*
  Phase 6I.6.37 - Dashboard data-correctness test matrix (Part AJ):
  Overview metrics, Users pagination/filters, Product Usage funnel,
  template distribution, AI/API Costs classification, System Health,
  Alerts, Subscriptions, Staff, Audit Log, and per-user empty states.

  Imports the query modules directly (same functions the pages/routes
  call) against real local Supabase - no HTTP round trip needed since
  these are plain server-side async functions, not request handlers.
  No real OpenAI calls, no real-user quota consumption (all data is
  synthetic, created/deleted by this script).

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i637AdminDashboardData.realdb.test.mts
*/
import { createClient } from "@supabase/supabase-js";
import { getAdminOverview } from "../../lib/admin/queries/overview";
import { getAdminUsers, getAdminUserDetail } from "../../lib/admin/queries/users";
import { getProductUsageMetrics } from "../../lib/admin/queries/productUsage";
import { getApiCostMetrics } from "../../lib/admin/queries/apiCosts";
import { getSystemHealth } from "../../lib/admin/queries/systemHealth";
import { getAlerts, countBySeverity } from "../../lib/admin/queries/alerts";
import { getSubscriptionsMetrics } from "../../lib/admin/queries/subscriptions";
import { getStaffList, grantOrUpdateStaffRole } from "../../lib/admin/queries/staff";
import { getAdminAuditLog } from "../../lib/admin/queries/auditLogList";
import type { AdminContext } from "../../lib/admin/auth";

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
  console.log(actual ? "PASS" : "FAIL", label, actual ? "" : note ? `(${note})` : "");
  if (actual) pass++;
  else fail++;
}

async function makeUser(prefix: string) {
  const email = `phase6i637d-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "Phase6i637dTest!23", email_confirm: true });
  if (error) throw error;
  return { userId: data.user.id, email };
}

async function main() {
  console.log("=== Phase 6I.6.37 Admin Dashboard Data Matrix ===");

  /* ==================== 1: Overview - counts increment by exactly what was added ==================== */
  const baseline = await getAdminOverview();
  const freshUser = await makeUser("overview");
  const { data: cmRow } = await admin.from("career_memory").insert({ user_id: freshUser.userId, required_completed: true }).select("id").single();
  const { data: appRow } = await admin
    .from("applications")
    .insert({ user_id: freshUser.userId, generation_status: "succeeded", created_at: new Date().toISOString() })
    .select("id")
    .single();

  const after1 = await getAdminOverview();
  check("1. Overview users.total increments by exactly 1 after one new auth user", after1.users.total.value, baseline.users.total.value + 1);
  check("1. Overview users.newToday increments by exactly 1", after1.users.newToday.value, baseline.users.newToday.value + 1);
  check("1. Overview product.careerMemoryCompleted increments by exactly 1", after1.product.careerMemoryCompleted.value, baseline.product.careerMemoryCompleted.value + 1);
  check("1. Overview product.applicationsThisMonth increments by exactly 1", after1.product.applicationsThisMonth.value, baseline.product.applicationsThisMonth.value + 1);
  check("1. Overview users.total is classified EXACT_INTERNAL_DATA", after1.users.total.classification, "EXACT_INTERNAL_DATA");
  check("1. Overview apiCost.tokensThisMonth is classified NOT_AVAILABLE (no persisted call-log table)", after1.apiCost.tokensThisMonth.classification, "NOT_AVAILABLE");
  checkTrue("1. Overview apiCost.tokensThisMonth.value is null, never fabricated", after1.apiCost.tokensThisMonth.value === null);

  /* ==================== 2: Users tab - filters + pagination against the known fresh user ==================== */
  const usersAll = await getAdminUsers({}, 1, 5);
  checkTrue("2. getAdminUsers() page 1 returns at most pageSize rows", usersAll.rows.length <= 5);
  check("2. getAdminUsers() total matches real auth user count (same source as Overview)", usersAll.total, after1.users.total.value);

  const searchResult = await getAdminUsers({ search: freshUser.email.split("@")[0] }, 1, 10);
  checkTrue("2. getAdminUsers() search filter finds the exact seeded user by email substring", searchResult.rows.some((r) => r.userId === freshUser.userId));

  const cmFilterResult = await getAdminUsers({ careerMemoryComplete: true }, 1, 1000);
  checkTrue("2. getAdminUsers() careerMemoryComplete=true filter includes the seeded user", cmFilterResult.rows.some((r) => r.userId === freshUser.userId));
  checkTrue("2. getAdminUsers() careerMemoryComplete=true filter excludes users without it", cmFilterResult.rows.every((r) => r.careerMemoryComplete === true));

  const noMatchResult = await getAdminUsers({ search: "zzz_no_such_user_zzz" }, 1, 10);
  check("2. getAdminUsers() a search matching nobody returns an empty rows array (not an error)", noMatchResult.rows, []);

  /* ==================== 3: User Detail - exact per-user numbers (empty-state proof for a brand new user) ==================== */
  const emptyUser = await makeUser("emptydetail");
  const emptyDetail = await getAdminUserDetail(emptyUser.userId);
  checkTrue("3. getAdminUserDetail() for a user with zero activity returns a real object, not null", emptyDetail !== null);
  check("3. brand-new user: resumeCount is 0 (real empty state, not fabricated)", emptyDetail?.resumeCount, 0);
  check("3. brand-new user: applicationCount is 0", emptyDetail?.applicationCount, 0);
  check("3. brand-new user: successfulGenerationCount is 0", emptyDetail?.successfulGenerationCount, 0);
  check("3. brand-new user: recentSafeErrors is an empty array", emptyDetail?.recentSafeErrors, []);
  check("3. brand-new user: lastActivity is null", emptyDetail?.lastActivity, null);
  check("3. getAdminUserDetail() for a non-existent userId returns null (not a crash)", await getAdminUserDetail("00000000-0000-0000-0000-000000000000"), null);

  const filledDetail = await getAdminUserDetail(freshUser.userId);
  check("3. seeded user: applicationCount reflects the one inserted application", filledDetail?.applicationCount, 1);
  check("3. seeded user: successfulGenerationCount reflects the one succeeded row", filledDetail?.successfulGenerationCount, 1);
  checkTrue("3. seeded user: selectedResumeExists reflects career_memory.selected_resume_id (null here, so false)", filledDetail?.selectedResumeExists === false);

  /* ==================== 4: Product Usage funnel - bounded by Registered, percentages consistent ====================
     NOTE: steps 2-6 (Career Memory / Resume / Job Analyzed / Generate Package / Tracker) are each an
     INDEPENDENT milestone query, not a strict nested subset of the previous step - a real user can reach
     "Resume Uploaded" (e.g. via Paste Job's own upload) without ever completing Career Memory. Only
     "Registered" (step 0, literally auth.users.length) is a guaranteed upper bound for every other step,
     since resumes/applications/career_memory all carry a real FK to auth.users. */
  const funnel = await getProductUsageMetrics();
  checkTrue(
    "4. every funnel step's count is <= Registered (each step is a real FK-bound subset of all users)",
    funnel.funnel.every((step) => step.count <= funnel.funnel[0].count)
  );
  check("4. funnel first step (Registered) has pctOfPrevious === null (no previous step)", funnel.funnel[0].pctOfPrevious, null);
  checkTrue("4. every non-first funnel step's pctOfRegistered is between 0 and 100", funnel.funnel.every((s) => s.pctOfRegistered >= 0 && s.pctOfRegistered <= 100));
  checkTrue("4. generateUsageBuckets sums to <= total registered users (0+1+2+3plus can't exceed population)", funnel.generateUsageBuckets.reduce((a, b) => a + b.count, 0) <= funnel.funnel[0].count);

  /* ==================== 5: AI/API Costs - honest classification, never fabricated ====================
     Phase 6I.6.38A replaced the "no persisted call-log table" placeholders
     with real openai_usage_events telemetry - re-asserted below against
     the new shape (lib/admin/queries/apiCosts.ts, lib/openai/*). */
  const apiCosts = await getApiCostMetrics();
  check("5. openAi.today.calls is EXACT_INTERNAL_DATA (real telemetry table now exists)", apiCosts.openAi.today.calls.classification, "EXACT_INTERNAL_DATA");
  check("5. openAi.today.cost is DERIVED_ESTIMATE (local token x price calc, never provider billing)", apiCosts.openAi.today.cost.classification, "DERIVED_ESTIMATE");
  check("5. openAi.remainingCapacity is MANUAL_PROVIDER_DASHBOARD_ONLY (no OPENAI_ADMIN_KEY configured)", apiCosts.openAi.remainingCapacity.classification, "MANUAL_PROVIDER_DASHBOARD_ONLY");
  checkTrue("5. every perOperation row exists for the 9-value closed taxonomy", apiCosts.openAi.perOperation.length === 9);
  checkTrue("5. perOperation with zero calls has successRatePercent null (never a fabricated 0%)", apiCosts.openAi.perOperation.every((op) => op.calls > 0 || op.successRatePercent === null));
  check("5. sentry.configured is false (Phase 6I.6.36's own confirmed finding - no DSN exists)", apiCosts.sentry.configured, false);
  // Phase 6I.6.38A Operational Activation set OPENAI_MONTHLY_BUDGET_USD=100 in .env.local (a deliberate,
  // permanent local config change) and renamed BudgetSummary's configured-branch fields from the old
  // single monthlyBudgetUsd to baseBudgetUsd/rechargesUsd/effectiveBudgetUsd (see lib/openai/budget.ts) -
  // this assertion is updated to match that now-real, intended state instead of the old "unset" baseline.
  checkTrue("5. budget.configured is true with a numeric baseBudgetUsd now that OPENAI_MONTHLY_BUDGET_USD=100 is set (Phase 6I.6.38A)", apiCosts.openAi.budget.configured === true && typeof (apiCosts.openAi.budget as any).baseBudgetUsd === "number");

  /* ==================== 6: System Health - real column-backed counts ==================== */
  const health = await getSystemHealth();
  checkTrue("6. generatePackage.successRatePercent is either null or a real 0-100 percentage", health.generatePackage.successRatePercent.value === null || (health.generatePackage.successRatePercent.value! >= 0 && health.generatePackage.successRatePercent.value! <= 100));
  checkTrue("6. errorCodeBreakdown is sorted descending by count", health.generatePackage.errorCodeBreakdown.value.every((row, i, arr) => i === 0 || arr[i - 1].count >= row.count));
  check("6. windowLabel documents the actual aggregation window (7 days)", health.windowLabel, "last 7 days");

  /* ==================== 7: Alerts - real computation from real thresholds, always OPEN, never persisted ==================== */
  const alerts = await getAlerts();
  checkTrue("7. every returned alert has status OPEN (no persisted acknowledge/resolve state this phase)", alerts.every((a) => a.status === "OPEN"));
  const counts = countBySeverity(alerts);
  check("7. countBySeverity's total matches the alerts array length", counts.critical + counts.high + counts.medium + counts.info, alerts.length);
  checkTrue("7. alerts array contains no duplicate keys (each condition fires at most once)", new Set(alerts.map((a) => a.key)).size === alerts.length);

  /* ==================== 8: Subscriptions - Free/Pro reality, no fabricated MRR ====================
     Compares freeUsers+proUsers and the quota-bucket sum against each other (both derived inside
     THIS SAME call), not against an earlier snapshot - this local Supabase instance is a shared dev
     DB other sessions can write to concurrently, so cross-call comparisons against a stale count are
     inherently racy and not a meaningful correctness signal. */
  const subs = await getSubscriptionsMetrics();
  const subsTotalUsers = subs.freeUsers + subs.proUsers;
  checkTrue("8. freeUsers and proUsers are both non-negative", subs.freeUsers >= 0 && subs.proUsers >= 0);
  checkTrue("8. proWiringNote honestly states Pro is Coming Soon / no Stripe checkout wired", subs.proWiringNote.includes("Coming Soon") && subs.proWiringNote.includes("Stripe"));
  const quotaSum = subs.quotaUsageDistribution.used0 + subs.quotaUsageDistribution.used1 + subs.quotaUsageDistribution.used2 + subs.quotaUsageDistribution.used3Plus;
  check("8. quotaUsageDistribution buckets sum to the same total user population as freeUsers+proUsers (same call, no cross-call race)", quotaSum, subsTotalUsers);

  /* ==================== 9: Staff + Audit Log - pagination is real, not fabricated ==================== */
  const ownerForGrant: AdminContext = { userId: freshUser.userId, email: freshUser.email, role: "OWNER" };
  // grantOrUpdateStaffRole requires an existing admin_staff actor context conceptually, but the function itself
  // only checks the passed role - use it here purely to generate a real, attributable audit-log row for
  // pagination testing (not a claim that freshUser is genuinely staff).
  await grantOrUpdateStaffRole(ownerForGrant, emptyUser.email, "VIEWER");
  const auditPage1 = await getAdminAuditLog(1, 1);
  checkTrue("9. getAdminAuditLog() page 1 with pageSize=1 returns exactly 1 row when rows exist", auditPage1.rows.length === 1);
  checkTrue("9. getAdminAuditLog() total count is >= 1 after a real write", auditPage1.total >= 1);
  const staffList = await getStaffList();
  checkTrue("9. getStaffList() includes the just-granted VIEWER row", staffList.some((s) => s.userId === emptyUser.userId && s.role === "VIEWER"));

  /* ==================== cleanup ==================== */
  if (appRow) await admin.from("applications").delete().eq("id", appRow.id);
  if (cmRow) await admin.from("career_memory").delete().eq("id", cmRow.id);
  await admin.auth.admin.deleteUser(freshUser.userId).catch(() => {});
  await admin.auth.admin.deleteUser(emptyUser.userId).catch(() => {});

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
