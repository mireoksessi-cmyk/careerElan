import Link from "next/link";
import { guardAdminPage } from "@/lib/admin/pageAuth";
import AdminDenied from "@/components/admin/AdminDenied";
import { getApiCostMetrics, type PeriodMetrics } from "@/lib/admin/queries/apiCosts";
import { PageTitle, CardGrid, MetricCard, Section, Badge } from "@/components/admin/ui";
import { RecordRechargeForm } from "@/components/admin/RecordRechargeForm";
import { hasPermission } from "@/lib/admin/permissions";
import type { BudgetStatus } from "@/lib/openai/budget";
import { OPENAI_OPERATION_LABELS } from "@/lib/openai/operations";

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

function cad(v: number) {
  return `CA$${v.toFixed(2)}`;
}

function PeriodCards({ p }: { p: PeriodMetrics }) {
  return (
    <CardGrid>
      <MetricCard label="Calls" metric={p.calls} />
      <MetricCard label="Success / Failed" metric={{ ...p.successCount, value: `${p.successCount.value} / ${p.errorCount.value}` }} />
      <MetricCard label="Retries" metric={p.retryCount} />
      <MetricCard label="Total Tokens" metric={p.totalTokens} />
      {/*
        API-A - an unavailable CAD figure renders as an em dash, not CA$0.00.
        Every historical row predates any configured FX rate and stored a null
        conversion, and printing that as a currency amount reads as "spent
        nothing in CAD" rather than "not converted".
      */}
      <MetricCard
        label="OpenAI API Cost (CAD)"
        metric={{
          ...p.costCad,
          value: p.costCad.classification === "NOT_AVAILABLE" ? null : p.costCad.value,
        }}
        format={(v) => (v === null ? "—" : cad(Number(v)))}
      />
      <MetricCard label="OpenAI API Cost (USD reference)" metric={p.cost} format={(v) => usd(Number(v))} />
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

  const canManageBudget = hasPermission(guard.ctx.role, "admin.api_costs.manage");
  const m = await getApiCostMetrics();
  const budget = m.openAi.budget;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <PageTitle
          title="AI & API Costs"
          subtitle="OpenAI call/token/cost metrics below read real telemetry (openai_usage_events). Cost figures - USD and CAD alike - are a local token x price estimate, never provider billing; 'Tracked AI Cost' below covers OpenAI only, not RapidAPI/Google Places/Resend (see Other Providers)."
        />
        <Link href="/admin/api-costs/history" className="whitespace-nowrap text-sm font-medium text-blue-600 hover:text-blue-800">
          API Cost History →
        </Link>
      </div>

      {!m.openAi.cadRateConfiguredNow && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          OPENAI_ACCOUNTING_USD_CAD_RATE is not currently configured (server-only env var) - CAD figures below show as unavailable. USD figures remain available regardless.
        </div>
      )}

      <Section title="Tracked AI Cost — Today">
        <PeriodCards p={m.openAi.today} />
      </Section>

      <Section title="Tracked AI Cost — This Month">
        <PeriodCards p={m.openAi.thisMonth} />
        <div className="mt-4">
          <CardGrid>
            <MetricCard label="Daily Average Cost" metric={m.openAi.thisMonth.dailyAverageCost} format={(v) => usd(Number(v))} />
            <MetricCard label="Projected Month-End Cost" metric={m.openAi.thisMonth.projectedMonthEndCost} format={(v) => usd(Number(v))} />
            <MetricCard label="Last Call" metric={{ ...m.openAi.thisMonth.lastCallAt, value: m.openAi.thisMonth.lastCallAt.value }} />
          </CardGrid>
        </div>
      </Section>

      <Section title="Tracked AI Cost — All Time">
        <PeriodCards p={m.openAi.allTime} />
        {m.openAi.allTimeRowCapReached && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            All-Time figures are capped at the most recent 50,000 telemetry rows - older rows beyond that are not included above (still permanently retained in openai_usage_events and visible via API Cost History).
          </div>
        )}
      </Section>

      <Section title="OpenAI Budget">
        {budget.configured ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-3">
                <Badge tone={BUDGET_BADGE_TONE[budget.status]}>{budget.status}</Badge>
                <span className="text-sm text-slate-600">
                  {usd(budget.monthSpendUsd)} of {usd(budget.effectiveBudgetUsd)} effective budget ({budget.budgetUsedPercent}%)
                </span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full ${budget.status === "NORMAL" ? "bg-emerald-500" : budget.status === "WARNING" ? "bg-amber-500" : "bg-red-500"}`}
                  style={{ width: `${Math.min(100, budget.budgetUsedPercent)}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-slate-400">
                Remaining capacity: {usd(budget.remainingBudgetUsd)}. Alerts fire once per threshold (80% / 90% / 100% of the effective budget) per calendar month via email - see docs for ADMIN_ALERT_EMAILS configuration.
              </div>
            </div>

            <CardGrid>
              <MetricCard label="Base Monthly Budget" metric={{ value: budget.baseBudgetUsd, classification: "EXACT_INTERNAL_DATA" }} format={(v) => usd(Number(v))} />
              <MetricCard label="Manual Recharges This Month" metric={{ value: budget.rechargesUsd, classification: "EXACT_INTERNAL_DATA" }} format={(v) => `+${usd(Number(v))}`} />
              <MetricCard label="Effective Monthly Budget" metric={{ value: budget.effectiveBudgetUsd, classification: "EXACT_INTERNAL_DATA" }} format={(v) => usd(Number(v))} />
              <MetricCard label="Estimated OpenAI Spend This Month" metric={{ value: budget.monthSpendUsd, classification: "DERIVED_ESTIMATE" }} format={(v) => usd(Number(v))} />
            </CardGrid>

            {canManageBudget ? (
              <RecordRechargeForm />
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400">
                Recording a manual recharge requires the admin.api_costs.manage permission (OWNER/ADMIN).
              </div>
            )}

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Recharge History</h3>
              {m.openAi.rechargeHistory.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-400">No manual recharges recorded yet.</div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Amount</th>
                        <th className="px-3 py-2">Admin</th>
                        <th className="px-3 py-2">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.openAi.rechargeHistory.map((r) => (
                        <tr key={r.id} className="border-b border-slate-100 last:border-0">
                          <td className="px-3 py-2">{new Date(r.createdAt).toLocaleString()}</td>
                          <td className="px-3 py-2">{usd(r.amountUsd)}</td>
                          <td className="px-3 py-2 text-slate-500">{r.actorEmail ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500">{r.note ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          /*
            API-A - a budget that exists but could not be measured is not the
            same as no budget, and must not be reported as one. In this state
            no threshold is evaluated or claimed, so the month's 80/90/100%
            alerts remain available once the data can be read again.
          */
          budget.reason === "SPEND_UNAVAILABLE" ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              BUDGET_USAGE_UNAVAILABLE - a monthly budget is configured, but this
              month&apos;s spend could not be read, so usage is unknown rather than
              zero. No threshold alert was evaluated or consumed for this attempt.
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-400">
              MONTHLY_BUDGET_NOT_CONFIGURED - set OPENAI_MONTHLY_BUDGET_USD (server-only env var) to enable budget tracking and 80/90/100% email alerts.
            </div>
          )
        )}
      </Section>

      <Section title="OpenAI Provider Balance">
        <MetricCard label="Provider Balance (actual OpenAI account balance)" metric={m.openAi.remainingCapacity} />
      </Section>

      {m.openAi.unknownPricingModels.value.length > 0 && (
        <Section title="Unpriced Models (cost understated)">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            No confirmed pricing for: {m.openAi.unknownPricingModels.value.join(", ")}. Calls to these models are counted but excluded from the cost totals above.
          </div>
        </Section>
      )}

      {/*
        API-A - reported apart from unpriced models, and without claiming a
        direction. These calls ran on a model that does have a price but
        returned no usage to apply it to, so their cost is unknown here -
        which is not the same as knowing they cost nothing.
      */}
      {m.openAi.noUsageDataCalls > 0 && (
        <Section title="Calls Without Usage Data">
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
            Usage data unavailable for {m.openAi.noUsageDataCalls} call
            {m.openAi.noUsageDataCalls === 1 ? "" : "s"} - the model is priced, but
            the request returned no token accounting to price. Their cost is not
            included in the totals above, and is not claimed to be zero.
          </div>
        </Section>
      )}

      <Section title="User Usage (this month)">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">API Calls</th>
                <th className="px-3 py-2">Retries</th>
                <th className="px-3 py-2">Tokens</th>
                <th className="px-3 py-2">Cost (CAD)</th>
                <th className="px-3 py-2">Cost (USD)</th>
              </tr>
            </thead>
            <tbody>
              {m.openAi.perUser.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-slate-400" colSpan={6}>
                    No calls recorded this month.
                  </td>
                </tr>
              ) : (
                m.openAi.perUser.map((u) => (
                  <tr key={u.userId ?? "unattributed"} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2">{u.email ?? (u.userId ? u.userId : "Unattributed (pre-telemetry call)")}</td>
                    <td className="px-3 py-2">{u.calls}</td>
                    <td className="px-3 py-2">{u.retryCount}</td>
                    <td className="px-3 py-2">{u.totalTokens}</td>
                    <td className="px-3 py-2">{u.costCad.classification === "NOT_AVAILABLE" ? "—" : cad(Number(u.costCad.value))}</td>
                    <td className="px-3 py-2 text-slate-400">{usd(u.costUsd)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-xs text-slate-400">
          "API Calls" counts physical OpenAI provider request attempts, not Career Élan user actions or packages generated - a single Generate Package click that retries once counts as 2 calls / 1 retry here.
        </div>
      </Section>

      <Section title="Per Operation (this month)">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Feature</th>
                <th className="px-3 py-2">Calls</th>
                <th className="px-3 py-2">Retries</th>
                <th className="px-3 py-2">Success Rate</th>
                <th className="px-3 py-2">Tokens</th>
                <th className="px-3 py-2">Cost (CAD)</th>
                <th className="px-3 py-2">Cost (USD)</th>
              </tr>
            </thead>
            <tbody>
              {m.openAi.perOperation.map((op) => (
                <tr key={op.operation} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2">
                    {OPENAI_OPERATION_LABELS[op.operation]}
                    <span className="ml-1 font-mono text-xs text-slate-400">({op.operation})</span>
                  </td>
                  <td className="px-3 py-2">{op.calls}</td>
                  <td className="px-3 py-2">{op.retryCount}</td>
                  <td className="px-3 py-2">{op.successRatePercent === null ? "—" : `${op.successRatePercent}%`}</td>
                  <td className="px-3 py-2">{op.totalTokens}</td>
                  <td className="px-3 py-2">
                    {op.costCadKnown === 0 && op.costCadMissingCount > 0 ? "—" : cad(op.costCadKnown)}
                    {op.costCadMissingCount > 0 && (
                      <span className="ml-1 text-xs text-amber-600">({op.costCadMissingCount} unconverted)</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{usd(op.costUsd)}</td>
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
