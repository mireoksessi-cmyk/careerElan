/*
  Phase 6I.6.37 - Users tab. Cross-references auth.users (via the Admin
  API - there is no PostgREST-exposed auth.users table) with
  career_memory/resumes/applications/subscriptions. Never returns
  resume/cover-letter/job/Career-Memory free-text content - only
  counts, flags, and dates (Part H/I's own "safe metadata only" rule).

  KNOWN LIMITATION (disclosed, not hidden): filtering/pagination is
  applied in-memory after fetching the full (capped at 50,000, see
  listAllAuthUsers) user list, because Supabase Admin API's listUsers()
  has no server-side filter for app_metadata/joined-table conditions
  and this codebase has no user-directory view/RPC to filter through
  instead. Fine for an early-stage product (Part AB); revisit with a
  real filtered view/RPC if the user base grows large enough for this
  to matter.
*/
import { supabaseAdmin } from "../../supabaseAdmin";
import { listAllAuthUsers, startOfUtcMonth, type AuthUserSummary } from "./shared";
import { entitlementEmailHmac } from "../../security/generatePackageEntitlementIdentity";

export type AdminUsersFilter = {
  provider?: string;
  plan?: "free" | "pro";
  careerMemoryComplete?: boolean;
  hasResume?: boolean;
  generatePackageUsed?: boolean;
  joinedAfter?: string;
  joinedBefore?: string;
  search?: string;
};

export type AdminUserRow = {
  userId: string;
  email: string | null;
  joinedAt: string;
  provider: string;
  plan: "free" | "pro";
  careerMemoryComplete: boolean;
  resumeCount: number;
  generatePackageThisMonth: number;
  applicationCount: number;
  lastActivity: string | null;
  emailConfirmedAt: string | null;
};

async function buildLookups() {
  const monthStart = startOfUtcMonth().toISOString();

  const [{ data: cmRows }, { data: resumeRows }, { data: proSubRows }, { data: appRows }, { data: appThisMonthRows }] = await Promise.all([
    supabaseAdmin.from("career_memory").select("user_id, required_completed"),
    supabaseAdmin.from("resumes").select("user_id"),
    supabaseAdmin.from("subscriptions").select("user_id").in("status", ["active", "trialing"]),
    supabaseAdmin.from("applications").select("user_id, created_at"),
    supabaseAdmin.from("applications").select("user_id").not("generation_status", "is", null).gte("created_at", monthStart),
  ]);

  const careerMemoryComplete = new Map<string, boolean>();
  for (const row of cmRows ?? []) careerMemoryComplete.set(row.user_id, Boolean(row.required_completed));

  const resumeCount = new Map<string, number>();
  for (const row of resumeRows ?? []) resumeCount.set(row.user_id, (resumeCount.get(row.user_id) ?? 0) + 1);

  const proUserIds = new Set((proSubRows ?? []).map((r) => r.user_id));

  const applicationCount = new Map<string, number>();
  const lastActivity = new Map<string, string>();
  for (const row of appRows ?? []) {
    applicationCount.set(row.user_id, (applicationCount.get(row.user_id) ?? 0) + 1);
    const existing = lastActivity.get(row.user_id);
    if (!existing || row.created_at > existing) lastActivity.set(row.user_id, row.created_at);
  }

  const generatePackageThisMonth = new Map<string, number>();
  for (const row of appThisMonthRows ?? []) {
    generatePackageThisMonth.set(row.user_id, (generatePackageThisMonth.get(row.user_id) ?? 0) + 1);
  }

  return { careerMemoryComplete, resumeCount, proUserIds, applicationCount, lastActivity, generatePackageThisMonth };
}

function toRow(user: AuthUserSummary, lookups: Awaited<ReturnType<typeof buildLookups>>): AdminUserRow {
  return {
    userId: user.id,
    email: user.email,
    joinedAt: user.createdAt,
    provider: user.provider,
    plan: lookups.proUserIds.has(user.id) ? "pro" : "free",
    careerMemoryComplete: lookups.careerMemoryComplete.get(user.id) ?? false,
    resumeCount: lookups.resumeCount.get(user.id) ?? 0,
    generatePackageThisMonth: lookups.generatePackageThisMonth.get(user.id) ?? 0,
    applicationCount: lookups.applicationCount.get(user.id) ?? 0,
    lastActivity: lookups.lastActivity.get(user.id) ?? null,
    emailConfirmedAt: user.emailConfirmedAt,
  };
}

export async function getAdminUsers(
  filter: AdminUsersFilter,
  page: number,
  pageSize: number
): Promise<{ rows: AdminUserRow[]; total: number }> {
  const [authUsers, lookups] = await Promise.all([listAllAuthUsers(), buildLookups()]);

  let rows = authUsers.map((u) => toRow(u, lookups));

  if (filter.search) {
    const needle = filter.search.toLowerCase();
    rows = rows.filter((r) => r.email?.toLowerCase().includes(needle));
  }
  if (filter.provider) rows = rows.filter((r) => r.provider === filter.provider);
  if (filter.plan) rows = rows.filter((r) => r.plan === filter.plan);
  if (filter.careerMemoryComplete !== undefined) rows = rows.filter((r) => r.careerMemoryComplete === filter.careerMemoryComplete);
  if (filter.hasResume !== undefined) rows = rows.filter((r) => (r.resumeCount > 0) === filter.hasResume);
  if (filter.generatePackageUsed !== undefined) rows = rows.filter((r) => (r.generatePackageThisMonth > 0) === filter.generatePackageUsed);
  if (filter.joinedAfter) rows = rows.filter((r) => r.joinedAt >= filter.joinedAfter!);
  if (filter.joinedBefore) rows = rows.filter((r) => r.joinedAt <= filter.joinedBefore!);

  rows.sort((a, b) => (a.joinedAt < b.joinedAt ? 1 : -1));

  const total = rows.length;
  const start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total };
}

export type AdminUserDetail = AdminUserRow & {
  selectedResumeExists: boolean;
  selectedTemplate: string | null;
  successfulGenerationCount: number;
  failedGenerationCount: number;
  lastGenerationDate: string | null;
  monthlyGenerationLimit: number | null;
  remainingGenerateAllowance: number | null;
  recentSafeErrors: { code: string; date: string }[];
  /* Admin User Controls Phase 2 */
  suspended: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  planKey: string;
  quotaOverride: number | null;
};

export async function getAdminUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const { data: userResult, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (userError || !userResult?.user) return null;
  const user = userResult.user;

  /*
    Stage 2C - transient entitlement digest for the usage read below. Derived
    from the auth User already fetched above, never stored, never logged and
    never returned in AdminUserDetail. No claim is created or touched: the
    read wrapper only SELECTs an existing claim.

    Null when the address is absent or the secret is unavailable - see the
    usage read for why that deliberately yields no usage figure rather than a
    per-uuid one.
  */
  let emailHmac: string | null = null;

  if (user.email) {
    try {
      emailHmac = entitlementEmailHmac(user.email);
    } catch {
      emailHmac = null;
    }
  }

  const [{ data: cm }, { data: resumes }, { data: apps }, { data: proSub }, { data: quota }, { data: quotaLimit, error: quotaLimitError }, { data: profileRow }, { data: quotaOverrideRow }] = await Promise.all([
    supabaseAdmin.from("career_memory").select("required_completed, selected_resume_id, resume_template").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("resumes").select("id").eq("user_id", userId),
    supabaseAdmin.from("applications").select("created_at, generation_status, generation_error_code, generation_completed_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
    supabaseAdmin.from("subscriptions").select("plan_key, status").eq("user_id", userId).in("status", ["active", "trialing"]).maybeSingle(),
    /*
      Stage 2C - usage is read through the entitlement owner, matching
      enforcement. p_user_id stays this account's own uuid so the plan limit
      still resolves from its subscription / admin override; only the usage
      side follows the digest to the founding owner. When the digest could
      not be derived the read is skipped entirely rather than falling back to
      a per-uuid figure that would be knowingly wrong for a recreated
      account - remainingGenerateAllowance then stays null, which this
      function's contract already means as "unavailable".
    */
    emailHmac
      ? supabaseAdmin.rpc("get_generate_package_usage_for_entitlement", { p_user_id: userId, p_email_hmac: emailHmac, p_limit: 3 })
      : Promise.resolve({ data: null }),
    /*
      Plan/usage identity split: this resolver takes the CURRENT
      admin-inspected account's uuid, so the limit follows that account's own
      subscription/override, while the usage read above follows the digest to
      the founding entitlement owner. Independent of emailHmac by design - a
      user whose digest cannot be derived still gets a correct limit.
    */
    supabaseAdmin.rpc("resolve_generate_package_quota_limit", { p_user_id: userId }),
    supabaseAdmin.from("profiles").select("suspended_at, suspended_reason").eq("id", userId).maybeSingle(),
    supabaseAdmin.from("admin_user_quota_overrides").select("monthly_generate_limit").eq("user_id", userId).maybeSingle(),
  ]);

  const monthStart = startOfUtcMonth().toISOString();
  const appsThisMonth = (apps ?? []).filter((a) => a.created_at >= monthStart && a.generation_status);
  const succeeded = (apps ?? []).filter((a) => a.generation_status === "succeeded");
  const failed = (apps ?? []).filter((a) => a.generation_status === "failed");
  const quotaRow = Array.isArray(quota) ? quota[0] : quota;

  /*
    The effective monthly limit comes from the authoritative database
    resolver, never from this file: resolve_generate_package_quota_limit()
    already applies the full precedence chain (admin override, then a
    plan-granting subscription, then the default plan), so a plan whose
    allowance changes later - or is defined for the first time - is reflected
    here automatically with no admin-display change.

    Deliberately NOT used + remaining: the usage RPC floors remaining at
    greatest(limit - used, 0), so an account that has consumed more than its
    current limit (an override lowered mid-month, or a downgrade) would report
    `used` instead of the real limit.

    Null on any failure or non-numeric result. Never a literal fallback - a
    hardcoded number would be wrong for every account whose limit is not that
    number, and an absent value is better than a confidently wrong one.
  */
  const resolvedMonthlyLimit: number | null =
    quotaLimitError || typeof quotaLimit !== "number" ? null : quotaLimit;

  return {
    userId,
    email: user.email ?? null,
    joinedAt: user.created_at,
    provider: typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : "email",
    plan: proSub ? "pro" : "free",
    careerMemoryComplete: Boolean(cm?.required_completed),
    resumeCount: (resumes ?? []).length,
    generatePackageThisMonth: appsThisMonth.length,
    applicationCount: (apps ?? []).length,
    lastActivity: apps?.[0]?.created_at ?? null,
    emailConfirmedAt: user.email_confirmed_at ?? null,
    selectedResumeExists: Boolean(cm?.selected_resume_id),
    selectedTemplate: cm?.resume_template ?? null,
    successfulGenerationCount: succeeded.length,
    failedGenerationCount: failed.length,
    lastGenerationDate: succeeded[0]?.generation_completed_at ?? null,
    monthlyGenerationLimit: resolvedMonthlyLimit,
    remainingGenerateAllowance: quotaRow?.remaining ?? null,
    recentSafeErrors: failed.slice(0, 5).map((a) => ({ code: a.generation_error_code ?? "UNKNOWN", date: a.created_at })),
    suspended: Boolean(profileRow?.suspended_at),
    suspendedAt: profileRow?.suspended_at ?? null,
    suspendedReason: profileRow?.suspended_reason ?? null,
    planKey: proSub?.plan_key ?? "free",
    quotaOverride: quotaOverrideRow?.monthly_generate_limit ?? null,
  };
}

/*
  Admin User Controls Phase 2 - the enabled plan_key list the Plan
  Override dropdown offers, read from the existing quota_plans config
  table rather than a hardcoded ["free", "pro"] array, so a future
  plan added purely via a quota_plans INSERT (per that table's own
  documented "add a plan by inserting a row, never a code change"
  design) shows up here automatically.
*/
export async function getEnabledPlanKeys(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("quota_plans")
    .select("plan_key")
    .eq("enabled", true)
    .order("plan_key");

  return (data ?? []).map((p) => p.plan_key);
}
