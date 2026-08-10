import { NextRequest } from "next/server";
import { withAdminPermission } from "@/lib/admin/routeHelpers";
import { getAdminUsers, type AdminUsersFilter } from "@/lib/admin/queries/users";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(params.get("pageSize") ?? "25", 10) || 25));

  const filter: AdminUsersFilter = {
    provider: params.get("provider") ?? undefined,
    plan: (params.get("plan") as "free" | "pro" | null) ?? undefined,
    careerMemoryComplete: params.get("careerMemoryComplete") === "true" ? true : params.get("careerMemoryComplete") === "false" ? false : undefined,
    hasResume: params.get("hasResume") === "true" ? true : params.get("hasResume") === "false" ? false : undefined,
    generatePackageUsed: params.get("generatePackageUsed") === "true" ? true : params.get("generatePackageUsed") === "false" ? false : undefined,
    joinedAfter: params.get("joinedAfter") ?? undefined,
    joinedBefore: params.get("joinedBefore") ?? undefined,
    search: params.get("search") ?? undefined,
  };

  return withAdminPermission("admin.users.read", () => getAdminUsers(filter, page, pageSize));
}
