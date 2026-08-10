import { withAdminPermission } from "@/lib/admin/routeHelpers";
import { getAlerts } from "@/lib/admin/queries/alerts";

export async function GET() {
  return withAdminPermission("admin.alerts.read", () => getAlerts());
}
