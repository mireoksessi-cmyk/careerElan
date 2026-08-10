import { NextRequest } from "next/server";
import { withAdminPermission } from "@/lib/admin/routeHelpers";
import { getAdminAuditLog } from "@/lib/admin/queries/auditLogList";

export async function GET(req: NextRequest) {
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10) || 1);
  return withAdminPermission("admin.audit.read", () => getAdminAuditLog(page, 25));
}
