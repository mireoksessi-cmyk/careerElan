import Link from "next/link";
import { guardAdminPage } from "@/lib/admin/pageAuth";
import AdminDenied from "@/components/admin/AdminDenied";
import { getApiCostHistory, getApiCostMonthDetail } from "@/lib/admin/queries/apiCosts";
import { PageTitle, CardGrid, MetricCard, Section } from "@/components/admin/ui";
import { OPENAI_OPERATION_LABELS } from "@/lib/openai/operations";

export const dynamic = "force-dynamic";

function usd(v: number) {
  return `$${v.toFixed(2)}`;
}

function cad(v: number) {
  return `CA$${v.toFixed(2)}`;
}

/*
  Admin API Usage Phase 2 - dedicated API Cost History page (Section 9).
  Server component only, same admin-only pattern as
  app/admin/api-costs/page.tsx (guardAdminPage -> AdminDenied on
  failure) - no new auth architecture, no new API route: this page
  calls lib/admin/queries/apiCosts.ts's getApiCostHistory()/
  getApiCostMonthDetail() directly, exactly as the main AI & API Costs
  page already calls getApiCostMetrics() directly, so a separate
  GET /api/admin/api-costs/history endpoint was not needed for this
  page to work.

  "Newest month first" ordering, "current month resets naturally"
  behavior, and permanent raw-row retention are all properties of
  getApiCostHistory()/buildMonthlySummaries() (lib/openai/
  usageAggregation.ts) - this page only renders what that layer
  already computes, it performs no date-boundary logic of its own.
*/
export default async function ApiCostHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const guard = await guardAdminPage("admin.api_costs.read");
  if (guard.denied) return <AdminDenied message={guard.message} />;

  const { month: selectedMonth } = await searchParams;
  const history = await getApiCostHistory();
  const detail = selectedMonth ? await getApiCostMonthDetail(selectedMonth) : null;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <PageTitle
          title="API Cost History"
          subtitle="Monthly summaries of tracked OpenAI usage (openai_usage_events), grouped by UTC calendar month. Raw telemetry rows are never deleted or rewritten - a month's total simply stops growing once that month ends."
        />
        <Link href="/admin/api-costs" className="whitespace-nowrap text-sm font-medium text-blue-600 hover:text-blue-800">
          ← AI &amp; API Costs
        </Link>
      </div>

      {!history.cadRateConfiguredNow && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          OPENAI_ACCOUNTING_USD_CAD_RATE is not currently configured - months with no recorded per-event CAD rate show CAD as unavailable below. This does not affect USD figures, and does not change any CAD figure a month already recorded while a rate WAS configured then.
        </div>
      )}

      {history.rowCapReached && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          This history is built from the most recent {history.rowCap.toLocaleString()} telemetry rows - usage volume has reached that cap, so older months beyond it are not shown above (still permanently retained in openai_usage_events).
        </div>
      )}

      <Section title="Monthly Summaries">
        {history.months.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-400">No tracked OpenAI usage recorded yet.</div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Month</th>
                  <th className="px-3 py-2">API Calls</th>
                  <th className="px-3 py-2">Retries</th>
                  <th className="px-3 py-2">Input Tokens</th>
                  <th className="px-3 py-2">Output Tokens</th>
                  <th className="px-3 py-2">Total Tokens</th>
                  <th className="px-3 py-2">Cost (USD)</th>
                  <th className="px-3 py-2">Cost (CAD)</th>
                  <th className="px-3 py-2">Users</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {history.months.map((mo) => (
                  <tr key={mo.yearMonth} className={`border-b border-slate-100 last:border-0 ${mo.yearMonth === selectedMonth ? "bg-blue-50" : ""}`}>
                    <td className="px-3 py-2 font-medium">{mo.yearMonth}</td>
                    <td className="px-3 py-2">{mo.calls}</td>
                    <td className="px-3 py-2">{mo.retryCount}</td>
                    <td className="px-3 py-2">{mo.inputTokens}</td>
                    <td className="px-3 py-2">{mo.outputTokens}</td>
                    <td className="px-3 py-2">{mo.totalTokens}</td>
                    <td className="px-3 py-2">{usd(mo.costUsd)}</td>
                    <td className="px-3 py-2">
                      {mo.costCad.classification === "NOT_AVAILABLE" ? "—" : cad(Number(mo.costCad.value))}
                    </td>
                    <td className="px-3 py-2">{mo.userCount}</td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/api-costs/history?month=${mo.yearMonth}`} className="text-xs font-medium text-blue-600 hover:text-blue-800">
                        Detail →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-2 text-xs text-slate-400">
          "API Calls" counts physical OpenAI provider request attempts, not Career Élan user actions or packages generated. Coverage: OpenAI only - RapidAPI, Google Places, and Resend usage are not tracked here (see the main AI &amp; API Costs page's Other Providers section).
        </div>
      </Section>

      {selectedMonth && (
        <Section title={`Detail — ${selectedMonth}`}>
          {!detail ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-400">No tracked usage found for {selectedMonth}.</div>
          ) : (
            <div className="space-y-6">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Per User</h3>
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">User</th>
                        <th className="px-3 py-2">Calls</th>
                        <th className="px-3 py-2">Retries</th>
                        <th className="px-3 py-2">Tokens</th>
                        <th className="px-3 py-2">Cost (CAD)</th>
                        <th className="px-3 py-2">Cost (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.perUser.map((u) => (
                        <tr key={u.userId ?? "unattributed"} className="border-b border-slate-100 last:border-0">
                          <td className="px-3 py-2">{u.email ?? (u.userId ? u.userId : "Unattributed (pre-telemetry call)")}</td>
                          <td className="px-3 py-2">{u.calls}</td>
                          <td className="px-3 py-2">{u.retryCount}</td>
                          <td className="px-3 py-2">{u.totalTokens}</td>
                          <td className="px-3 py-2">{u.costCad.classification === "NOT_AVAILABLE" ? "—" : cad(Number(u.costCad.value))}</td>
                          <td className="px-3 py-2 text-slate-400">{usd(u.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Per Feature</h3>
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Feature</th>
                        <th className="px-3 py-2">Calls</th>
                        <th className="px-3 py-2">Retries</th>
                        <th className="px-3 py-2">Tokens</th>
                        <th className="px-3 py-2">Cost (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.perOperation.map((op) => (
                        <tr key={op.operation} className="border-b border-slate-100 last:border-0">
                          <td className="px-3 py-2">
                            {OPENAI_OPERATION_LABELS[op.operation]}
                            <span className="ml-1 font-mono text-xs text-slate-400">({op.operation})</span>
                          </td>
                          <td className="px-3 py-2">{op.calls}</td>
                          <td className="px-3 py-2">{op.retryCount}</td>
                          <td className="px-3 py-2">{op.totalTokens}</td>
                          <td className="px-3 py-2">{usd(op.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
