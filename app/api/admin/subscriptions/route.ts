import { withAdminPermission } from "@/lib/admin/routeHelpers";
import { getSubscriptionsMetrics } from "@/lib/admin/queries/subscriptions";

export async function GET() {
  return withAdminPermission("admin.subscriptions.read", () => getSubscriptionsMetrics());
}
