import { supabaseAdmin } from "../../supabaseAdmin";
import { logAdminAction } from "../auditLog";
import { deleteUserAccountData } from "../../accountDeletion";
import type { AdminContext } from "../auth";

/*
  Admin User Controls Phase 2 - all mutation logic for Suspend/
  Reactivate/Plan Override/Quota Override/Admin Delete. Every exported
  function here takes the caller's already-verified AdminContext (from
  requireAdminPermission("admin.users.manage") - never re-checked here,
  callers are the API routes, each of which independently calls
  requireAdminPermission itself before reaching this module) plus a
  target userId. Never logs resume/job/cover-letter/Career-Memory text,
  passwords, tokens, or secrets to admin_audit_log - only ids, plan
  keys, limits, and short operator-entered notes, matching this
  codebase's existing lib/admin/auditLog.ts convention.
*/

export type UserControlResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function selfTargetGuard(actor: AdminContext, targetUserId: string): string | null {
  if (actor.userId === targetUserId) {
    return "You cannot perform this action on your own account.";
  }
  return null;
}

export async function suspendUser(
  actor: AdminContext,
  targetUserId: string,
  reason: string | null
): Promise<UserControlResult> {
  const selfError = selfTargetGuard(actor, targetUserId);
  if (selfError) return { ok: false, error: selfError };

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      suspended_at: new Date().toISOString(),
      suspended_by: actor.userId,
      suspended_reason: reason,
    })
    .eq("id", targetUserId);

  if (error) {
    await logAdminAction({
      actorAdminUserId: actor.userId,
      action: "USER_SUSPENDED",
      targetType: "user",
      targetId: targetUserId,
      result: "error",
    });
    return { ok: false, error: "Failed to suspend user." };
  }

  await logAdminAction({
    actorAdminUserId: actor.userId,
    action: "USER_SUSPENDED",
    targetType: "user",
    targetId: targetUserId,
    result: "success",
    metadata: { reason: reason ?? undefined },
  });

  return { ok: true, value: undefined };
}

export async function reactivateUser(
  actor: AdminContext,
  targetUserId: string
): Promise<UserControlResult> {
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      suspended_at: null,
      suspended_by: null,
      suspended_reason: null,
    })
    .eq("id", targetUserId);

  if (error) {
    await logAdminAction({
      actorAdminUserId: actor.userId,
      action: "USER_REACTIVATED",
      targetType: "user",
      targetId: targetUserId,
      result: "error",
    });
    return { ok: false, error: "Failed to reactivate user." };
  }

  await logAdminAction({
    actorAdminUserId: actor.userId,
    action: "USER_REACTIVATED",
    targetType: "user",
    targetId: targetUserId,
    result: "success",
  });

  return { ok: true, value: undefined };
}

/*
  Validates against public.quota_plans' own enabled rows - never
  accepts an arbitrary string. Reuses the existing plan model
  (free/pro today) rather than inventing a second one, per this
  phase's explicit "supported values must come from the existing
  application's plan model" requirement.
*/
export async function changeUserPlan(
  actor: AdminContext,
  targetUserId: string,
  planKey: string
): Promise<UserControlResult> {
  const { data: validPlans, error: plansError } = await supabaseAdmin
    .from("quota_plans")
    .select("plan_key")
    .eq("enabled", true);

  if (plansError) {
    return { ok: false, error: "Failed to load plan configuration." };
  }

  const allowedKeys = new Set((validPlans ?? []).map((p) => p.plan_key));
  if (!allowedKeys.has(planKey)) {
    return { ok: false, error: `Unsupported plan key. Allowed: ${Array.from(allowedKeys).join(", ")}` };
  }

  const { data: previousRow } = await supabaseAdmin
    .from("subscriptions")
    .select("plan_key")
    .eq("user_id", targetUserId)
    .maybeSingle();

  const { error } = await supabaseAdmin
    .from("subscriptions")
    .upsert(
      {
        user_id: targetUserId,
        plan_key: planKey,
        status: "active",
        provider: "manual",
      },
      { onConflict: "user_id" }
    );

  if (error) {
    await logAdminAction({
      actorAdminUserId: actor.userId,
      action: "USER_PLAN_CHANGED",
      targetType: "user",
      targetId: targetUserId,
      result: "error",
    });
    return { ok: false, error: "Failed to change plan." };
  }

  await logAdminAction({
    actorAdminUserId: actor.userId,
    action: "USER_PLAN_CHANGED",
    targetType: "user",
    targetId: targetUserId,
    result: "success",
    metadata: { fromPlan: previousRow?.plan_key ?? "free", toPlan: planKey },
  });

  return { ok: true, value: undefined };
}

/*
  limit === null clears any existing override (falls back to the
  user's plan-resolved default) - matches the resolver's own "no row =
  no override" contract in the migration.
*/
export async function changeUserQuotaOverride(
  actor: AdminContext,
  targetUserId: string,
  limit: number | null,
  note: string | null
): Promise<UserControlResult> {
  if (limit !== null && (!Number.isFinite(limit) || limit < 0 || !Number.isInteger(limit))) {
    return { ok: false, error: "Quota override must be a non-negative whole number, or null to clear it." };
  }

  if (limit === null) {
    const { error } = await supabaseAdmin
      .from("admin_user_quota_overrides")
      .delete()
      .eq("user_id", targetUserId);

    if (error) {
      return { ok: false, error: "Failed to clear quota override." };
    }
  } else {
    const { error } = await supabaseAdmin
      .from("admin_user_quota_overrides")
      .upsert(
        {
          user_id: targetUserId,
          monthly_generate_limit: limit,
          set_by: actor.userId,
          set_at: new Date().toISOString(),
          note,
        },
        { onConflict: "user_id" }
      );

    if (error) {
      return { ok: false, error: "Failed to set quota override." };
    }
  }

  await logAdminAction({
    actorAdminUserId: actor.userId,
    action: "USER_QUOTA_CHANGED",
    targetType: "user",
    targetId: targetUserId,
    result: "success",
    metadata: { newLimit: limit },
  });

  return { ok: true, value: undefined };
}

export type AdminDeleteResult = {
  stripeSubscriptionNotCancelled: boolean;
};

export async function deleteUserByAdmin(
  actor: AdminContext,
  targetUserId: string
): Promise<UserControlResult<AdminDeleteResult>> {
  const selfError = selfTargetGuard(actor, targetUserId);
  if (selfError) return { ok: false, error: selfError };

  const result = await deleteUserAccountData(targetUserId);

  if (!result.success) {
    await logAdminAction({
      actorAdminUserId: actor.userId,
      action: "USER_DELETED",
      targetType: "user",
      targetId: targetUserId,
      result: "error",
      metadata: { failedStep: result.failedStep },
    });
    return { ok: false, error: "Failed to delete user account." };
  }

  await logAdminAction({
    actorAdminUserId: actor.userId,
    action: "USER_DELETED",
    targetType: "user",
    targetId: targetUserId,
    result: "success",
    metadata: {
      stripeSubscriptionNotCancelled: result.stripeSubscriptionNotCancelled,
    },
  });

  return {
    ok: true,
    value: { stripeSubscriptionNotCancelled: result.stripeSubscriptionNotCancelled },
  };
}
