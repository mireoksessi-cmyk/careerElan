/*
  Phase 6I.6.37 - Staff & Permissions. All mutation rules from Part S
  are enforced HERE, in the one place every staff mutation funnels
  through - never re-implemented per-route:
    - only an existing admin_staff row (role OWNER or ADMIN, checked by
      the caller via requireAdminPermission("admin.staff.manage") -
      which itself only OWNER/ADMIN hold, see lib/admin/permissions.ts)
      may call updateStaffRole/setStaffStatus at all.
    - only OWNER may grant or revoke the OWNER role itself (ADMIN
      cannot create or demote an OWNER).
    - the last active OWNER can never be demoted or disabled (self-
      lockout protection - Part S's own explicit requirement).
  Staff invitation (Part T) is deliberately NOT implemented - this
  phase only supports "existing authenticated user -> OWNER/ADMIN
  grants a role", per the round spec's own explicit allowance to defer
  a real invitation-email workflow (reported as
  STAFF_INVITATION_ARCHITECTURE_REQUIRED in the final report, not
  worked around with a weak token here).
*/
import { supabaseAdmin } from "../../supabaseAdmin";
import { logOperationalEvent } from "../../observability/logger";
import { logAdminAction } from "../auditLog";
import type { AdminContext } from "../auth";
import { ADMIN_ROLES, type AdminRole } from "../permissions";

export type StaffMember = {
  userId: string;
  email: string | null;
  role: AdminRole;
  status: "active" | "disabled";
  createdAt: string;
  lastSignInAt: string | null;
};

export async function getStaffList(): Promise<StaffMember[]> {
  const { data: staffRows, error } = await supabaseAdmin
    .from("admin_staff")
    .select("user_id, role, status, created_at")
    .order("created_at", { ascending: true });

  if (error || !staffRows) return [];

  const members: StaffMember[] = [];
  for (const row of staffRows) {
    const { data: userResult } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
    members.push({
      userId: row.user_id,
      email: userResult?.user?.email ?? null,
      role: row.role as AdminRole,
      status: row.status as "active" | "disabled",
      createdAt: row.created_at,
      lastSignInAt: userResult?.user?.last_sign_in_at ?? null,
    });
  }
  return members;
}

async function countActiveOwners(): Promise<number> {
  const { count } = await supabaseAdmin
    .from("admin_staff")
    .select("user_id", { count: "exact", head: true })
    .eq("role", "OWNER")
    .eq("status", "active");
  return count ?? 0;
}

export type StaffMutationResult = { ok: true } | { ok: false; error: string };

/*
  Grants a role to an existing auth user (looked up by email - the user
  must already have a real Career Élan account). Creates the
  admin_staff row if none exists yet, otherwise updates it.
*/
export async function grantOrUpdateStaffRole(
  actor: AdminContext,
  targetEmail: string,
  newRole: AdminRole
): Promise<StaffMutationResult> {
  if (!ADMIN_ROLES.includes(newRole)) {
    return { ok: false, error: "Unknown role." };
  }
  if (newRole === "OWNER" && actor.role !== "OWNER") {
    await logAdminAction({ actorAdminUserId: actor.userId, action: "STAFF_ROLE_GRANT_DENIED", targetType: "admin_staff", result: "denied", metadata: { reason: "non-owner attempted to grant OWNER", newRole } });
    return { ok: false, error: "Only OWNER can grant the OWNER role." };
  }

  const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const targetUser = authUsers?.users.find((u) => u.email?.toLowerCase() === targetEmail.trim().toLowerCase());
  if (!targetUser) {
    return { ok: false, error: "No existing account found for that email." };
  }

  const { data: existing } = await supabaseAdmin.from("admin_staff").select("role, status").eq("user_id", targetUser.id).maybeSingle();

  // Demoting the last active OWNER is blocked, whether the target is
  // self or someone else.
  if (existing?.role === "OWNER" && newRole !== "OWNER") {
    const activeOwners = await countActiveOwners();
    if (activeOwners <= 1) {
      return { ok: false, error: "Cannot demote the last active OWNER." };
    }
  }

  const { error } = await supabaseAdmin
    .from("admin_staff")
    .upsert(
      { user_id: targetUser.id, role: newRole, status: "active", updated_by: actor.userId, created_by: existing ? undefined : actor.userId },
      { onConflict: "user_id" }
    );

  if (error) {
    await logAdminAction({ actorAdminUserId: actor.userId, action: "STAFF_ROLE_UPDATE_FAILED", targetType: "admin_staff", targetId: targetUser.id, result: "error", metadata: { message: error.message.slice(0, 200) } });
    return { ok: false, error: "Failed to update staff role." };
  }

  logOperationalEvent({ domain: "admin", event: "role_updated", actorUserId: actor.userId, targetUserId: targetUser.id, newRole });
  await logAdminAction({ actorAdminUserId: actor.userId, action: "STAFF_ROLE_UPDATED", targetType: "admin_staff", targetId: targetUser.id, result: "success", metadata: { newRole, previousRole: existing?.role ?? null } });

  return { ok: true };
}

export async function setStaffStatus(
  actor: AdminContext,
  targetUserId: string,
  status: "active" | "disabled"
): Promise<StaffMutationResult> {
  const { data: existing } = await supabaseAdmin.from("admin_staff").select("role, status").eq("user_id", targetUserId).maybeSingle();
  if (!existing) return { ok: false, error: "Staff record not found." };

  if (existing.role === "OWNER" && status === "disabled") {
    const activeOwners = await countActiveOwners();
    if (activeOwners <= 1) {
      return { ok: false, error: "Cannot disable the last active OWNER." };
    }
  }

  const { error } = await supabaseAdmin.from("admin_staff").update({ status, updated_by: actor.userId }).eq("user_id", targetUserId);
  if (error) {
    return { ok: false, error: "Failed to update staff status." };
  }

  logOperationalEvent(
    status === "disabled"
      ? { domain: "admin", event: "staff_disabled", actorUserId: actor.userId, targetUserId }
      : { domain: "admin", event: "staff_enabled", actorUserId: actor.userId, targetUserId }
  );
  await logAdminAction({
    actorAdminUserId: actor.userId,
    action: status === "disabled" ? "STAFF_DISABLED" : "STAFF_ENABLED",
    targetType: "admin_staff",
    targetId: targetUserId,
    result: "success",
  });

  return { ok: true };
}
