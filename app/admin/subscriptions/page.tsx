import { guardAdminPage } from "@/lib/admin/pageAuth";
import AdminDenied from "@/components/admin/AdminDenied";
import { getSubscriptionsMetrics } from "@/lib/admin/queries/subscriptions";
import { PageTitle, CardGrid, Section, EmptyState } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const guard = await guardAdminPage("admin.subscriptions.read");
  if (guard.denied) return <AdminDenied message={guard.message} />;

  const s = await getSubscriptionsMetrics();

  return (
    <div>
      <PageTitle title="Subscriptions" subtitle={s.proWiringNote} />

      <Section title="Plan Distribution">
        <CardGrid>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Free</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{s.freeUsers}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Pro</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{s.proUsers}</div>
          </div>
        </CardGrid>
      </Section>

      <Section title="By Status">
        {s.byStatus.length === 0 ? (
          <EmptyState message="No subscriptions rows exist yet." />
        ) : (
          <ul className="rounded-lg border border-slate-200 bg-white text-sm">
            {s.byStatus.map((row) => (
              <li key={row.status} className="flex justify-between border-b border-slate-100 px-3 py-2 last:border-0">
                <span>{row.status}</span>
                <span className="font-medium">{row.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="This Month's Quota Usage Distribution">
        <div className="grid grid-cols-4 gap-3 text-center text-sm">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-lg font-semibold">{s.quotaUsageDistribution.used0}</div>
            <div className="text-slate-500">0 used</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-lg font-semibold">{s.quotaUsageDistribution.used1}</div>
            <div className="text-slate-500">1 used</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-lg font-semibold">{s.quotaUsageDistribution.used2}</div>
            <div className="text-slate-500">2 used</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-lg font-semibold">{s.quotaUsageDistribution.used3Plus}</div>
            <div className="text-slate-500">3+ used</div>
          </div>
        </div>
      </Section>
    </div>
  );
}
