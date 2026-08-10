import { guardAdminPage } from "@/lib/admin/pageAuth";
import AdminDenied from "@/components/admin/AdminDenied";
import { getApiCostMetrics } from "@/lib/admin/queries/apiCosts";
import { PageTitle, CardGrid, MetricCard, Section } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function ApiCostsPage() {
  const guard = await guardAdminPage("admin.api_costs.read");
  if (guard.denied) return <AdminDenied message={guard.message} />;

  const m = await getApiCostMetrics();

  return (
    <div>
      <PageTitle
        title="AI & API Costs"
        subtitle="No persisted OpenAI call-log table exists in this codebase - counts below are honestly labeled as estimates or unavailable, never fabricated."
      />

      <Section title="OpenAI — Today">
        <CardGrid>
          <MetricCard label="Generate Package Attempts" metric={m.openAi.today.generatePackageAttempts} />
          <MetricCard label="Tokens" metric={m.openAi.today.tokens} />
          <MetricCard label="Cost" metric={m.openAi.today.cost} />
        </CardGrid>
      </Section>

      <Section title="OpenAI — This Month">
        <CardGrid>
          <MetricCard label="Generate Package Attempts" metric={m.openAi.thisMonth.generatePackageAttempts} />
          <MetricCard label="Tokens" metric={m.openAi.thisMonth.tokens} />
          <MetricCard label="Cost" metric={m.openAi.thisMonth.cost} />
          <MetricCard label="Daily Average" metric={m.openAi.thisMonth.dailyAverageAttempts} />
          <MetricCard label="Projected Month-End" metric={m.openAi.thisMonth.projectedMonthEndAttempts} />
        </CardGrid>
      </Section>

      <Section title="OpenAI Remaining Capacity">
        <MetricCard label="Balance / Remaining Capacity" metric={m.openAi.remainingCapacity} />
      </Section>

      <Section title="Per Operation">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Operation</th>
                <th className="px-3 py-2">Calls</th>
                <th className="px-3 py-2">Success Rate</th>
              </tr>
            </thead>
            <tbody>
              {m.openAi.perOperation.map((op) => (
                <tr key={op.operation} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{op.operation}</td>
                  <td className="px-3 py-2 text-slate-400">unavailable</td>
                  <td className="px-3 py-2 text-slate-400">unavailable</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Other Providers">
        <div className="space-y-2 text-sm">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="font-medium">Supabase</div>
            <div className="text-slate-500">Auth users (see Users tab): {m.supabase.authUsers.value}</div>
            <div className="text-xs text-slate-400">{m.supabase.note}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="font-medium">Netlify</div>
            <div className="text-xs text-slate-400">{m.netlify.note}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="font-medium">Sentry</div>
            <div className="text-xs text-slate-400">{m.sentry.note}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="font-medium">Resend</div>
            <div className="text-xs text-slate-400">{m.resend.note}</div>
          </div>
        </div>
      </Section>
    </div>
  );
}
