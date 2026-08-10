/*
  Phase 6I.6.37 - Subscriptions tab. Reflects the real current state:
  Free plan active, Pro is "Coming Soon" (no Stripe wiring exists - see
  Phase 6I.6.36's own External Provider audit). Reads public.
  subscriptions directly (service-role only, per its own migration's
  lockdown) rather than fabricating revenue/MRR figures.
*/
import { supabaseAdmin } from "../../supabaseAdmin";
import { listAllAuthUsers, startOfUtcMonth } from "./shared";

export type SubscriptionsMetrics = {
  freeUsers: number;
  proUsers: number;
  byStatus: { status: string; count: number }[];
  byProvider: { provider: string; count: number }[];
  quotaUsageDistribution: { used0: number; used1: number; used2: number; used3Plus: number };
  proWiringNote: string;
};

export async function getSubscriptionsMetrics(): Promise<SubscriptionsMetrics> {
  const [authUsers, { data: subRows }] = await Promise.all([
    listAllAuthUsers(),
    supabaseAdmin.from("subscriptions").select("status, provider, user_id"),
  ]);

  const proUserIds = new Set((subRows ?? []).filter((r) => ["active", "trialing"].includes(r.status)).map((r) => r.user_id));

  const statusCounts = new Map<string, number>();
  const providerCounts = new Map<string, number>();
  for (const row of subRows ?? []) {
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
    providerCounts.set(row.provider, (providerCounts.get(row.provider) ?? 0) + 1);
  }

  const monthStart = startOfUtcMonth().toISOString();
  const { data: genRows } = await supabaseAdmin.from("applications").select("user_id").not("generation_status", "is", null).gte("created_at", monthStart);
  const perUser = new Map<string, number>();
  for (const row of genRows ?? []) perUser.set(row.user_id, (perUser.get(row.user_id) ?? 0) + 1);

  let used0 = authUsers.length - perUser.size;
  let used1 = 0;
  let used2 = 0;
  let used3Plus = 0;
  for (const count of perUser.values()) {
    if (count === 1) used1++;
    else if (count === 2) used2++;
    else used3Plus++;
  }
  if (used0 < 0) used0 = 0;

  return {
    freeUsers: authUsers.length - proUserIds.size,
    proUsers: proUserIds.size,
    byStatus: Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count })),
    byProvider: Array.from(providerCounts.entries()).map(([provider, count]) => ({ provider, count })),
    quotaUsageDistribution: { used0, used1, used2, used3Plus },
    proWiringNote: "Pro is Coming Soon - no Stripe checkout/billing is wired up. subscriptions.provider='manual'/'promo' rows (if any) represent support-granted access, never real payment.",
  };
}
