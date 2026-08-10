import { withAdminPermission } from "@/lib/admin/routeHelpers";
import { getApiCostMetrics } from "@/lib/admin/queries/apiCosts";

export async function GET() {
  return withAdminPermission("admin.api_costs.read", () => getApiCostMetrics());
}
