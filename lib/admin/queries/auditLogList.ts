/*
  Phase 6I.6.37 - reads public.admin_audit_log for the Audit tab.
  Read-only counterpart to lib/admin/auditLog.ts's writer.
*/
import { supabaseAdmin } from "../../supabaseAdmin";

export type AdminAuditLogRow = {
  id: number;
  // Nullable: the actor's auth.users row can be deleted later (staff removal,
  // account deletion) - ON DELETE SET NULL on the FK preserves this row.
  actorAdminUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  result: "success" | "denied" | "error";
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export async function getAdminAuditLog(page: number, pageSize: number): Promise<{ rows: AdminAuditLogRow[]; total: number }> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabaseAdmin
    .from("admin_audit_log")
    .select("id, actor_admin_user_id, action, target_type, target_id, result, metadata, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error || !data) return { rows: [], total: 0 };

  const emailCache = new Map<string, string | null>();
  const rows: AdminAuditLogRow[] = [];
  for (const row of data) {
    const actorId = row.actor_admin_user_id as string | null;
    if (actorId && !emailCache.has(actorId)) {
      const { data: userResult } = await supabaseAdmin.auth.admin.getUserById(actorId);
      emailCache.set(actorId, userResult?.user?.email ?? null);
    }
    rows.push({
      id: row.id,
      actorAdminUserId: actorId,
      actorEmail: actorId ? (emailCache.get(actorId) ?? null) : null,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      result: row.result as "success" | "denied" | "error",
      metadata: row.metadata as Record<string, unknown> | null,
      createdAt: row.created_at,
    });
  }

  return { rows, total: count ?? 0 };
}
