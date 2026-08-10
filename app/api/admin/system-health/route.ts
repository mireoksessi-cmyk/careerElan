import { withAdminPermission } from "@/lib/admin/routeHelpers";
import { getSystemHealth } from "@/lib/admin/queries/systemHealth";

export async function GET() {
  return withAdminPermission("admin.system_health.read", () => getSystemHealth());
}
