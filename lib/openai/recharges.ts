/*
  Phase 6I.6.38A Operational Activation - manual OpenAI recharge/top-up
  recording. Records ONLY the fact that an operator manually added
  OpenAI credit outside Career Élan - never calls any OpenAI billing/
  payment API, never purchases anything, never touches a card or
  invoice. See supabase/migrations/20260811000000_openai_manual_
  recharges.sql for the table's own lockdown (service-role INSERT/
  SELECT only, no UPDATE/DELETE - append-only by design, Part G).
*/
import { supabaseAdmin } from "../supabaseAdmin";
import { startOfUtcMonth, startOfNextUtcMonth } from "../admin/queries/shared";

export type RechargeValidationError =
  | "AMOUNT_NOT_A_NUMBER"
  | "AMOUNT_NOT_FINITE"
  | "AMOUNT_NOT_POSITIVE"
  | "AMOUNT_PRECISION_TOO_HIGH";

export type RecordRechargeResult =
  | { ok: true; id: string; amountUsd: number; createdAt: string }
  | { ok: false; error: RechargeValidationError | "INSERT_FAILED"; message: string };

/*
  Rejects 0/negative/NaN/Infinity/non-numeric input and anything with
  more than 6 decimal places (this table's numeric(12,6) precision) -
  never trusts client input, matches Part F's explicit validation list.
*/
export function validateRechargeAmount(rawAmount: unknown): RechargeValidationError | null {
  if (typeof rawAmount !== "number") return "AMOUNT_NOT_A_NUMBER";
  if (!Number.isFinite(rawAmount)) return "AMOUNT_NOT_FINITE";
  if (rawAmount <= 0) return "AMOUNT_NOT_POSITIVE";
  // Reject sub-millionth-of-a-dollar precision (numeric(12,6) would silently
  // round it in Postgres - reject here instead of accepting a value that
  // doesn't round-trip exactly).
  const scaled = rawAmount * 1_000_000;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) return "AMOUNT_PRECISION_TOO_HIGH";
  return null;
}

export async function recordManualRecharge(params: {
  amountUsd: number;
  actorAdminUserId: string;
  note?: string | null;
}): Promise<RecordRechargeResult> {
  const validationError = validateRechargeAmount(params.amountUsd);
  if (validationError) {
    return { ok: false, error: validationError, message: "Invalid recharge amount." };
  }

  const note = typeof params.note === "string" && params.note.trim() ? params.note.trim().slice(0, 500) : null;

  const { data, error } = await supabaseAdmin
    .from("openai_manual_recharges")
    .insert({
      amount_usd: params.amountUsd,
      actor_admin_user_id: params.actorAdminUserId,
      note,
    })
    .select("id, amount_usd, created_at")
    .single();

  if (error || !data) {
    return { ok: false, error: "INSERT_FAILED", message: "Failed to record recharge." };
  }

  return { ok: true, id: data.id, amountUsd: data.amount_usd, createdAt: data.created_at };
}

/*
  Sums openai_manual_recharges for the current UTC calendar month only
  (Part J - "base monthly budget resets conceptually each UTC calendar
  month... a prior month's recharge does NOT carry forward"). Bounded
  on both ends for the same reason lib/openai/budget.ts's
  getBudgetSummary() now is - a synthetic/test `now` must never pick up
  a real or differently-dated row outside its own month.
*/
export async function getMonthlyRechargesUsd(now = new Date()): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("openai_manual_recharges")
    .select("amount_usd")
    .gte("created_at", startOfUtcMonth(now).toISOString())
    .lt("created_at", startOfNextUtcMonth(now).toISOString());

  if (error || !data) return 0;
  return data.reduce((sum, row) => sum + (typeof row.amount_usd === "number" ? row.amount_usd : 0), 0);
}

export type RechargeHistoryRow = {
  id: string;
  amountUsd: number;
  actorAdminUserId: string | null;
  actorEmail: string | null;
  note: string | null;
  createdAt: string;
};

/*
  Newest-first history for the admin UI (Part E). actorEmail is
  resolved from auth.users via the caller-supplied lookup map (built
  from listAllAuthUsers(), already fetched by getApiCostMetrics() for
  an unrelated purpose - reused here rather than a second Admin API
  page-listing call).
*/
export async function listRecentRecharges(
  emailByUserId: Map<string, string | null>,
  limit = 50
): Promise<RechargeHistoryRow[]> {
  const { data, error } = await supabaseAdmin
    .from("openai_manual_recharges")
    .select("id, amount_usd, actor_admin_user_id, note, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    amountUsd: row.amount_usd,
    actorAdminUserId: row.actor_admin_user_id,
    actorEmail: row.actor_admin_user_id ? emailByUserId.get(row.actor_admin_user_id) ?? null : null,
    note: row.note,
    createdAt: row.created_at,
  }));
}
