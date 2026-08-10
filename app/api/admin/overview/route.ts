import { withAdminPermission } from "@/lib/admin/routeHelpers";
import { getAdminOverview } from "@/lib/admin/queries/overview";

export async function GET() {
  return withAdminPermission("admin.overview.read", () => getAdminOverview());
}
