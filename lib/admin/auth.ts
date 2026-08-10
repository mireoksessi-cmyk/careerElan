/*
  Phase 6I.6.37 - the ONE shared admin authorization helper. Every admin
  page (server component) and every admin API route calls
  requireAdminPermission() before touching any admin data - hiding a
  tab in the nav is never treated as security by itself (Part AI's own
  "hidden UI is not relied upon as security" test exists to prove this).

  OWNER bootstrap: this codebase had zero staff rows before this phase
  (confirmed audit - see supabase/migrations/20260810180000_admin_staff_
  rbac.sql's own header). ADMIN_OWNER_BOOTSTRAP_EMAILS is a server-only
  env var (never NEXT_PUBLIC_) - a comma-separated allowlist consulted
  ONLY when a user has no admin_staff row yet. The first matching login
  self-provisions a real 'active'/'OWNER' row; every login after that
  reads the DB row exclusively - the env var is never consulted again
  for a user who already has a row, so revoking/changing the env var
  later does not touch already-provisioned staff. This is the "server-
  side env allowlist only for initial bootstrap, DB authoritative after
  that" pattern the round spec itself names as acceptable.
*/
import { createClient } from "../supabase-server";
import { supabaseAdmin } from "../supabaseAdmin";
import { logSafeError } from "../errors/publicError";
import { logOperationalEvent } from "../observability/logger";
import { logAdminAction } from "./auditLog";
import {
  type AdminRole,
  type AdminPermission,
  hasPermission,
} from "./permissions";

export type AdminContext = {
  userId: string;
  email: string;
  role: AdminRole;
};

export class AdminAuthError extends Error {
  status: 401 | 403;
  code: "UNAUTHENTICATED" | "FORBIDDEN";

  constructor(status: 401 | 403, code: "UNAUTHENTICATED" | "FORBIDDEN", message: string) {
    super(message);
    this.name = "AdminAuthError";
    this.status = status;
    this.code = code;
  }
}

function parseBootstrapEmails(): string[] {
  const raw = process.env.ADMIN_OWNER_BOOTSTRAP_EMAILS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

async function resolveStaffRecord(
  userId: string,
  email: string | null
): Promise<{ role: AdminRole; status: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("admin_staff")
    .select("role, status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logSafeError(error, { requestId: userId, route: "lib/admin/auth#resolveStaffRecord", userId });
    return null;
  }
  if (data) return data as { role: AdminRole; status: string };

  const bootstrapEmails = parseBootstrapEmails();
  if (!email || !bootstrapEmails.includes(email.toLowerCase())) return null;

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("admin_staff")
    .insert({ user_id: userId, role: "OWNER", status: "active" })
    .select("role, status")
    .single();

  if (insertError) {
    // A concurrent bootstrap (two simultaneous first-logins) hits the
    // primary key conflict here - re-read rather than fail the request.
    logSafeError(insertError, { requestId: userId, route: "lib/admin/auth#bootstrapOwner", userId });
    const { data: retry } = await supabaseAdmin
      .from("admin_staff")
      .select("role, status")
      .eq("user_id", userId)
      .maybeSingle();
    return (retry as { role: AdminRole; status: string } | null) ?? null;
  }

  await logAdminAction({
    actorAdminUserId: userId,
    action: "ADMIN_OWNER_BOOTSTRAPPED",
    targetType: "admin_staff",
    targetId: userId,
    result: "success",
  });

  return inserted as { role: AdminRole; status: string };
}

/*
  Returns null for any non-staff/disabled-staff/unauthenticated case -
  callers that need a hard failure (routes/pages) should use
  requireAdminPermission() instead, which throws AdminAuthError with
  the right HTTP status.
*/
export async function getAdminContext(): Promise<AdminContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const staff = await resolveStaffRecord(user.id, user.email ?? null);
  if (!staff || staff.status !== "active") return null;

  return { userId: user.id, email: user.email ?? "", role: staff.role };
}

export async function requireAdminPermission(
  permission: AdminPermission
): Promise<AdminContext> {
  const ctx = await getAdminContext();

  if (!ctx) {
    throw new AdminAuthError(401, "UNAUTHENTICATED", "Not authenticated as active staff.");
  }

  if (!hasPermission(ctx.role, permission)) {
    logOperationalEvent({ domain: "admin", event: "access_denied", userId: ctx.userId, permission });
    await logAdminAction({
      actorAdminUserId: ctx.userId,
      action: `PERMISSION_DENIED:${permission}`,
      result: "denied",
    });
    throw new AdminAuthError(403, "FORBIDDEN", `Missing permission: ${permission}`);
  }

  return ctx;
}
