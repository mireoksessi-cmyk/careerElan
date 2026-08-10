import { NextResponse } from "next/server";
import { withAdminPermission } from "@/lib/admin/routeHelpers";
import { getAdminUserDetail } from "@/lib/admin/queries/users";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAdminPermission("admin.users.read", async () => {
    const detail = await getAdminUserDetail(id);
    if (!detail) {
      // withAdminPermission always returns 200 with the handler's
      // resolved value - a genuine "not found" is signaled via the
      // payload shape, matching this route's own narrow contract.
      return { notFound: true };
    }
    return detail;
  });
}
