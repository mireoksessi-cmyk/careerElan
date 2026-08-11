import { guardAdminPage } from "@/lib/admin/pageAuth";
import AdminDenied from "@/components/admin/AdminDenied";
import { getApiCostMetrics, type PeriodMetrics } from "@/lib/admin/queries/apiCosts";
import { PageTitle, CardGrid, MetricCard, Section, Badge } from "@/components/admin/ui";
import type { BudgetStatus } from "@/lib/openai/budget";

export const dynamic = "force-dynamic";

const BUDGET_BADGE_TONE: Record<BudgetStatus, "success" | "warning" | "danger"> = {
  NORMAL: "success",
  WARNING: "warning",
  CRITICAL: "danger",
  BUDGET_EXCEEDED: "danger",
};

function usd(v: number) {
  return `$${v.toFixed(2)}`;
}

function PeriodCards({ p }: { p: PeriodMetrics }) {
  return (
    <CardGrid>
      <MetricCard label="Calls" metric={p.calls} />
      <MetricCard label="Success / Failed" metric={{ ...p.successCount, value: `${p.successCount.value} / ${p.errorCount.value}` }} />
      <MetricCard label="Retries" metric={p.retryCount} />
      <MetricCard label="Total Tokens" metric={p.totalTokens} />
      <MetricCard label="Cost" metric={p.cost} format={(v) => usd(Number(v))} />
      <MetricCard label="Avg Latency" metric={{ ...p.avgLatencyMs, value: p.avgLatencyMs.value === null ? null : `${p.avgLatencyMs.value}ms` }} />
      <MetricCard label="429 (Rate Limited)" metric={p.rateLimited429} />
      <MetricCard label="Timeouts" metric={p.timeouts} />
      <MetricCard label="5xx (Server Errors)" metric={p.serverErrors5xx} />
    </CardGrid>
  );
}

export default async function ApiCostsPage() {
  const guard = await guardAdminPage("admin.api_costs.read");
  if (guard.denied) return <AdminDenied message={guard.message} />;

  const m = await getApiCostMetrics();
  const budget = m.openAi.budget;

  return (
    <div>
      <PageTitle
        title="AI & API Costs"
        subtitle="OpenAI call/token/cost metrics below read real telemetry (openai_usage_events). Cost is a local token x price estimate, never provider billing - see each card's classification label."
      />

      <Section title="OpenAI — Today">
        <PeriodCards p={m.openAi.today} />
      </Section>

      <Section title="OpenAI — This Month">
        <PeriodCards p={m.openAi.thisMonth} />
        <div className="mt-4">
          <CardGrid>
            <MetricCard label="Daily Average Cost" metric={m.openAi.thisMonth.dailyAverageCost} format={(v) => usd(Number(v))} />
            <MetricCard label="Projected Month-End Cost" metric={m.openAi.thisMonth.projectedMonthEndCost} format={(v) => usd(Number(v))} />
            <MetricCard label="Last Call" metric={{ ...m.openAi.thisMonth.lastCallAt, value: m.openAi.thisMonth.lastCallAt.value }} />
          </CardGrid>
        </div>
      </Section>

      <Section title="Monthly Budget">
        {budget.configured ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <Badge tone={BUDGET_BADGE_TONE[budget.status]}>{budget.status}</Badge>
              <span className="text-sm text-slate-600">
                {usd(budget.monthSpendUsd)} of {usd(budget.monthlyBudgetUsd)} ({budget.budgetUsedPercent}%)
              </span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full ${budget.status === "NORMAL" ? "bg-emerald-500" : budget.status === "WARNING" ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${Math.min(100, budget.budgetUsedPercent)}%` }}
              />
            </div>
            <div className="mt-2 text-xs text-slate-400">
              Remaining: {usd(budget.remainingBudgetUsd)}. Alerts fire once per threshold (80% / 90% / 100%) per calendar month via email - see docs for ADMIN_ALERT_EMAILS configuration.
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-400">
            MONTHLY_BUDGET_NOT_CONFIGURED - set OPENAI_MONTHLY_BUDGET_USD (server-only env var) to enable budget tracking and 80/90/100% email alerts.
          </div>
        )}
      </Section>

      <Section title="OpenAI Remaining Capacity">
        <MetricCard label="Balance / Remaining Capacity" metric={m.openAi.remainingCapacity} />
      </Section>

      {m.openAi.unknownPricingModels.value.length > 0 && (
        <Section title="Unpriced Models (cost understated)">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            No confirmed pricing for: {m.openAi.unknownPricingModels.value.join(", ")}. Calls to these models are counted but excluded from the cost totals above.
          </div>
        </Section>
      )}

      <Section title="Per Operation (this month)">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Operation</th>
                <th className="px-3 py-2">Calls</th>
                <th className="px-3 py-2">Success Rate</th>
                <th className="px-3 py-2">Tokens</th>
                <th className="px-3 py-2">Cost</th>
              </tr>
            </thead>
            <tbody>
              {m.openAi.perOperation.map((op) => (
                <tr key={op.operation} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{op.operation}</td>
                  <td className="px-3 py-2">{op.calls}</td>
                  <td className="px-3 py-2">{op.successRatePercent === null ? "—" : `${op.successRatePercent}%`}</td>
                  <td className="px-3 py-2">{op.totalTokens}</td>
                  <td className="px-3 py-2">{usd(op.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Per Model (this month)">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Calls</th>
                <th className="px-3 py-2">Tokens</th>
                <th className="px-3 py-2">Cost</th>
              </tr>
            </thead>
            <tbody>
              {m.openAi.perModel.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-slate-400" colSpan={4}>
                    No calls recorded this month.
                  </td>
                </tr>
              ) : (
                m.openAi.perModel.map((mo) => (
                  <tr key={mo.model} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">
                      {mo.model}
                      {mo.unknownPricingCount > 0 && <span className="ml-2 text-amber-600">(unpriced)</span>}
                    </td>
                    <td className="px-3 py-2">{mo.calls}</td>
                    <td className="px-3 py-2">{mo.totalTokens}</td>
                    <td className="px-3 py-2">{usd(mo.costUsd)}</td>
                  </tr>
                ))
              )}
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
