import { withAdminPermission } from "@/lib/admin/routeHelpers";
import { getProductUsageMetrics } from "@/lib/admin/queries/productUsage";

export async function GET() {
  return withAdminPermission("admin.product_usage.read", () => getProductUsageMetrics());
}
