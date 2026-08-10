/*
  Phase 6I.6.37 - append-only writer for public.admin_audit_log. Never
  pass resume/job/cover-letter/Career Memory text, passwords, tokens,
  or secrets in `metadata` - only small, explicit, already-safe fields
  (ids, role names, counts). Failure to write an audit row never blocks
  the admin action itself (logged via logSafeError and swallowed) -
  matching this codebase's existing "observability is additive, never
  blocking" convention (see lib/observability/logger.ts's own header).
*/
import { supabaseAdmin } from "../supabaseAdmin";
import { logSafeError } from "../errors/publicError";

export type AdminAuditResult = "success" | "denied" | "error";

export async function logAdminAction(params: {
  actorAdminUserId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  result: AdminAuditResult;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("admin_audit_log").insert({
    actor_admin_user_id: params.actorAdminUserId,
    action: params.action,
    target_type: params.targetType ?? null,
    target_id: params.targetId ?? null,
    result: params.result,
    metadata: params.metadata ?? null,
  });

  if (error) {
    logSafeError(error, {
      requestId: params.actorAdminUserId,
      route: "lib/admin/auditLog#insert",
      userId: params.actorAdminUserId,
    });
  }
}
