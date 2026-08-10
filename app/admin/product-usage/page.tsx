import { guardAdminPage } from "@/lib/admin/pageAuth";
import AdminDenied from "@/components/admin/AdminDenied";
import { getProductUsageMetrics } from "@/lib/admin/queries/productUsage";
import { PageTitle, Section, EmptyState } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function ProductUsagePage() {
  const guard = await guardAdminPage("admin.product_usage.read");
  if (guard.denied) return <AdminDenied message={guard.message} />;

  const metrics = await getProductUsageMetrics();

  return (
    <div>
      <PageTitle title="Product Usage" subtitle="Aggregate-only funnel and adoption metrics." />

      <Section title="Funnel">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Step</th>
                <th className="px-3 py-2">Count</th>
                <th className="px-3 py-2">% of Previous</th>
                <th className="px-3 py-2">% of Registered</th>
              </tr>
            </thead>
            <tbody>
              {metrics.funnel.map((step) => (
                <tr key={step.label} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2">{step.label}</td>
                  <td className="px-3 py-2 font-medium">{step.count}</td>
                  <td className="px-3 py-2 text-slate-500">{step.pctOfPrevious === null ? "—" : `${step.pctOfPrevious}%`}</td>
                  <td className="px-3 py-2 text-slate-500">{step.pctOfRegistered}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Template Distribution (this month)">
        {metrics.templateDistribution.length === 0 ? (
          <EmptyState message="No Generate Package activity with a stored template this month." />
        ) : (
          <ul className="rounded-lg border border-slate-200 bg-white text-sm">
            {metrics.templateDistribution.map((t) => (
              <li key={t.templateId} className="flex justify-between border-b border-slate-100 px-3 py-2 last:border-0">
                <span>{t.templateId}</span>
                <span className="font-medium">{t.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Generate Package Usage This Month">
        <div className="grid grid-cols-4 gap-3 text-center text-sm">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-lg font-semibold">{metrics.generateUsageBuckets[0].count}</div>
            <div className="text-slate-500">0 uses</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-lg font-semibold">{metrics.generateUsageBuckets[1].count}</div>
            <div className="text-slate-500">1 use</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-lg font-semibold">{metrics.generateUsageBuckets[2].count}</div>
            <div className="text-slate-500">2 uses</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-lg font-semibold">{metrics.generateUsageBuckets[3].count}</div>
            <div className="text-slate-500">3+ uses</div>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">Average per active generator: {metrics.averagePerActiveGenerator}</p>
      </Section>

      <Section title="Applications by Status">
        {metrics.applicationsByStatus.length === 0 ? (
          <EmptyState message="No applications with a status value yet." />
        ) : (
          <ul className="rounded-lg border border-slate-200 bg-white text-sm">
            {metrics.applicationsByStatus.map((s) => (
              <li key={s.status} className="flex justify-between border-b border-slate-100 px-3 py-2 last:border-0">
                <span>{s.status}</span>
                <span className="font-medium">{s.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
