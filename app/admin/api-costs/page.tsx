import Link from "next/link";
import { guardAdminPage } from "@/lib/admin/pageAuth";
import AdminDenied from "@/components/admin/AdminDenied";
import { getApiCostMetrics, type PeriodMetrics } from "@/lib/admin/queries/apiCosts";
import { PageTitle, CardGrid, MetricCard, Section } from "@/components/admin/ui";
import { hasPermission } from "@/lib/admin/permissions";
import { OPENAI_OPERATION_LABELS } from "@/lib/openai/operations";

export const dynamic = "force-dynamic";

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

/*
  API-D2 - the outcome of a checkpoint submission, carried back on the
  redirect. The form posts to a route handler rather than being a client
  component, so this query parameter is how the result gets reported.
*/
const CHECKPOINT_RESULT_MESSAGE: Record<string, string> = {
  recorded: "New OpenAI credit balance checkpoint recorded. The 80%, 90% and 100% alerts are re-armed.",
  invalid: "That balance was not accepted. Enter the current remaining credit as a positive dollar amount.",
  "not-acknowledged": "No checkpoint was created - the confirmation box was not ticked.",
  failed: "The checkpoint could not be saved. Nothing was changed.",
};

export default async function ApiCostsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const guard = await guardAdminPage("admin.api_costs.read");
  if (guard.denied) return <AdminDenied message={guard.message} />;

  const canManageBudget = hasPermission(guard.ctx.role, "admin.api_costs.manage");
  const m = await getApiCostMetrics();
  const credit = m.openAi.creditBalance;

  const checkpointParam = (await searchParams).checkpoint;
  const checkpointMessage =
    typeof checkpointParam === "string" ? CHECKPOINT_RESULT_MESSAGE[checkpointParam] : undefined;

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

      {/*
        API-D2 - the OpenAI funding model the console runs on.

        The operator reads their remaining credit off OpenAI's billing page
        and enters it. That figure is a fact with a timestamp; everything
        derived from it afterwards is this codebase's own estimate, and each
        card says which it is rather than leaving the reader to guess.
      */}
      <Section title="OpenAI Credit Balance">
        {checkpointMessage ? (
          <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {checkpointMessage}
          </div>
        ) : null}

        {credit.available ? (
          <div className="space-y-4">
            {/*
              How much of this checkpoint has been consumed, drawn rather than
              read off a card. The figures below say the same thing, but a
              number has to be compared against another number to mean
              anything, and "$168 of $210" only becomes "nearly out" after the
              reader does that arithmetic themselves.

              Fill is consumed credit, so a fresh checkpoint is empty and the
              bar grows toward exhaustion. The width is clamped at 100% while
              the percentage beside it is not: an overrun is real information,
              but a bar wider than its track is a rendering bug.
            */}
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm text-slate-600">
                  {usd(credit.trackedSpendUsd)} of{" "}
                  {usd(credit.checkpoint.confirmedBalanceUsd)} confirmed credit
                  estimated consumed
                </span>
                <span className="text-sm font-semibold text-slate-900">
                  {credit.consumedPercent.toFixed(1)}%
                </span>
              </div>

              <div className="relative mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full ${
                    credit.consumedPercent >= 100
                      ? "bg-red-500"
                      : credit.consumedPercent >= 90
                        ? "bg-red-400"
                        : credit.consumedPercent >= 80
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, credit.consumedPercent))}%` }}
                />
                {/*
                  The two thresholds that actually send an email, marked on the
                  track itself. Without them the colour change at 80% looks
                  like decoration rather than the operational line it is.
                */}
                {[80, 90].map((t) => (
                  <div
                    key={t}
                    className="absolute top-0 h-full w-px bg-slate-400"
                    style={{ left: `${t}%` }}
                  />
                ))}
              </div>

              <div className="relative mt-1 h-4 text-[10px] text-slate-400">
                <span className="absolute left-0">0%</span>
                <span className="absolute -translate-x-1/2" style={{ left: "80%" }}>
                  80% alert
                </span>
                <span className="absolute -translate-x-1/2" style={{ left: "90%" }}>
                  90% alert
                </span>
                <span className="absolute right-0">100%</span>
              </div>

              <div className="mt-3 text-xs text-slate-500">
                Estimated remaining: {usd(credit.estimatedRemainingUsd)}. Fill is
                the local Production estimate measured against the balance you
                confirmed on {new Date(credit.checkpoint.createdAt).toLocaleString()} —
                not OpenAI&apos;s live balance.
              </div>
            </div>

            <CardGrid>
              <MetricCard
                label="Confirmed OpenAI Balance"
                metric={{
                  value: credit.checkpoint.confirmedBalanceUsd,
                  classification: "EXACT_INTERNAL_DATA",
                  note: `Read from the OpenAI billing dashboard by an operator and confirmed at ${new Date(credit.checkpoint.createdAt).toLocaleString()}.`,
                }}
                format={(v) => usd(Number(v))}
              />
              <MetricCard
                label="Tracked Production Spend Since Confirmation"
                metric={{
                  value: credit.trackedSpendUsd,
                  classification: "DERIVED_ESTIMATE",
                  note: "local token x price estimate for production traffic only - preview, branch, development and unattributed legacy usage excluded",
                }}
                format={(v) => usd(Number(v))}
              />
              <MetricCard
                label="Estimated Remaining Credit"
                metric={{
                  value: credit.estimatedRemainingUsd,
                  classification: "DERIVED_ESTIMATE",
                  note: "confirmed balance minus the local estimate above - not OpenAI's live balance",
                }}
                format={(v) => usd(Number(v))}
              />
              <MetricCard
                label="Estimated Consumed"
                metric={{
                  value: credit.consumedPercent,
                  classification: "DERIVED_ESTIMATE",
                  note:
                    credit.estimatedOverrunUsd !== null
                      ? `Estimated overrun: ${usd(credit.estimatedOverrunUsd)} past the confirmed balance.`
                      : "share of the confirmed balance the local estimate has used",
                }}
                format={(v) => `${Number(v).toFixed(1)}%`}
              />
            </CardGrid>

            <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
              Alert status —{" "}
              {[80, 90, 100]
                .map((t) => `${t}%: ${credit.consumedPercent >= t ? "threshold crossed" : "waiting"}`)
                .join(" · ")}
              . Each fires at most once per checkpoint by email to
              ADMIN_ALERT_EMAILS. Confirming a new balance re-arms all three;
              nothing else does, and they do not reset with the calendar month.
            </div>

            {credit.estimatedOverrunUsd !== null ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                The local estimate has passed the confirmed balance by{" "}
                {usd(credit.estimatedOverrunUsd)}. Check the OpenAI dashboard
                for the real remaining credit and record a new checkpoint.
              </div>
            ) : null}
          </div>
        ) : credit.reason === "NO_CHECKPOINT" ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-400">
            OpenAI Credit Balance: Not configured. Tracked depletion: Not
            available. Alerts: Not active. Record the current remaining credit
            from your OpenAI billing dashboard below to start tracking.
          </div>
        ) : (
          /*
            Neither of these is "no balance". A read that failed must not
            render as an empty, healthy state - no threshold is evaluated or
            claimed while the figure is unknown, so the alerts stay available
            for a later evaluation that can read the data.
          */
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            {credit.reason === "CHECKPOINT_UNREADABLE"
              ? "CHECKPOINT_UNREADABLE - the credit balance checkpoint could not be read, so remaining credit is unknown rather than zero."
              : "SPEND_UNAVAILABLE - a credit checkpoint exists, but production spend since it could not be read, so depletion is unknown rather than zero."}{" "}
            No threshold alert was evaluated or consumed for this attempt.
          </div>
        )}

        {canManageBudget ? (
          <form
            method="post"
            action="/api/admin/api-costs/credit-balance"
            className="mt-4 rounded-lg border border-slate-200 bg-white p-4"
          >
            <h3 className="text-sm font-semibold text-slate-900">
              Update Current Credit Balance
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Enter the current remaining credit shown in your OpenAI billing
              dashboard, not the amount you just added. If your balance was $10
              and you topped up $200, enter 210.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="text-sm text-slate-600" htmlFor="confirmedBalanceUsd">
                Current balance (USD)
              </label>
              <input
                id="confirmedBalanceUsd"
                name="confirmedBalanceUsd"
                type="number"
                step="0.01"
                min="0.01"
                required
                className="w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                placeholder="210.00"
              />
            </div>

            {/*
              Required in the markup and re-checked on the server. Saving a
              balance re-arms the alert cycle, which is not something anyone
              should be able to do by pressing Enter in a number field.
            */}
            <label className="mt-3 flex items-start gap-2 text-xs text-slate-600">
              <input type="checkbox" name="acknowledge" value="yes" required className="mt-0.5" />
              <span>
                This starts a new OpenAI balance checkpoint and resets the 80%,
                90%, and 100% depletion alert cycle.
              </span>
            </label>

            <button
              type="submit"
              className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              Update Current Credit Balance
            </button>
          </form>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400">
            Confirming a credit balance requires the admin.api_costs.manage
            permission (OWNER/ADMIN).
          </div>
        )}
      </Section>

      {/*
        API-D - the production picture across every metered provider. Strictly
        production-attributed: development, preview, branch and rows that
        predate attribution contribute nothing to any figure here, and the
        note on the total says so rather than leaving a smaller number
        unexplained.
      */}
      {/*
        F1 - the vendor's own accounting beside this codebase's estimate. The
        local figure is unchanged and still drives the budget alerts; this
        section exists to say how close it has been.

        F1.1 - the top row is the month: two overview figures that are NOT a
        comparison, because they start on different dates. The comparison is
        the row below, where both sides are bounded by the same settled days.
      */}
      <Section title="OpenAI Vendor Reconciliation">
        <CardGrid>
          <MetricCard
            label="Local Production Estimate — This Month (USD)"
            metric={m.openAi.thisMonth.cost}
            format={(v) => usd(Number(v))}
          />
          <MetricCard
            label="OpenAI Recorded Cost — This Month (USD)"
            metric={{
              ...m.vendor.openAiCostUsd,
              value:
                m.vendor.openAiCostUsd.classification === "NOT_AVAILABLE"
                  ? null
                  : m.vendor.openAiCostUsd.value,
            }}
            format={(v) => (v === null ? "—" : usd(Number(v)))}
          />
        </CardGrid>

        <p className="mt-4 text-sm font-medium text-slate-700">
          Comparable period
          {m.vendor.comparablePeriod
            ? `: ${m.vendor.comparablePeriod.startIso} → ${m.vendor.comparablePeriod.endIso}`
            : ": none yet"}
        </p>

        <CardGrid>
          <MetricCard
            label="Production Calls — Comparable Period"
            metric={{
              ...m.vendor.localComparableCalls,
              value:
                m.vendor.localComparableCalls.classification === "NOT_AVAILABLE"
                  ? null
                  : m.vendor.localComparableCalls.value,
            }}
            format={(v) => (v === null ? "—" : Number(v).toLocaleString())}
          />
          <MetricCard
            label="Local Estimate — Comparable Period (USD)"
            metric={{
              ...m.vendor.localComparableCostUsd,
              value:
                m.vendor.localComparableCostUsd.classification === "NOT_AVAILABLE"
                  ? null
                  : m.vendor.localComparableCostUsd.value,
            }}
            format={(v) => (v === null ? "—" : usd(Number(v)))}
          />
          <MetricCard
            label="OpenAI Recorded Cost — Comparable Period (USD)"
            metric={{
              ...m.vendor.vendorComparableCostUsd,
              value:
                m.vendor.vendorComparableCostUsd.classification === "NOT_AVAILABLE"
                  ? null
                  : m.vendor.vendorComparableCostUsd.value,
            }}
            format={(v) => (v === null ? "—" : usd(Number(v)))}
          />
          <MetricCard
            label="Estimate Variance (USD)"
            metric={{
              ...m.vendor.varianceUsd,
              value:
                m.vendor.varianceUsd.classification === "NOT_AVAILABLE"
                  ? null
                  : m.vendor.varianceUsd.value,
            }}
            format={(v) => (v === null ? "—" : usd(Number(v)))}
          />
          <MetricCard
            label="Estimate Variance (%)"
            metric={{
              ...m.vendor.variancePercent,
              value:
                m.vendor.variancePercent.classification === "NOT_AVAILABLE"
                  ? null
                  : m.vendor.variancePercent.value,
            }}
            format={(v) => (v === null ? "—" : `${Number(v).toFixed(1)}%`)}
          />
        </CardGrid>

        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
          {m.vendor.comparableNote}
        </div>

        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
          {m.vendor.scopeNote}
          {m.vendor.fetchedAt
            ? ` Read from OpenAI at ${new Date(m.vendor.fetchedAt).toLocaleString()}.`
            : ""}
        </div>

        <div className="mt-2 rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500">
          {m.vendor.creditBalanceNote} Budget alerts continue to run on the local
          estimate, which is available the moment a call returns; vendor cost is
          settled accounting and is used here for comparison only.
        </div>
      </Section>

      <Section title="Production API Overview — This Month">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Production Usage</th>
                <th className="px-3 py-2">Unit</th>
                <th className="px-3 py-2">Success</th>
                <th className="px-3 py-2">Failed</th>
                <th className="px-3 py-2">Estimated Cost</th>
                <th className="px-3 py-2">Budget / Limit</th>
                <th className="px-3 py-2">Last Activity</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-900">OpenAI</td>
                <td className="px-3 py-2">
                  {m.openAi.thisMonth.calls.classification === "NOT_AVAILABLE"
                    ? "Not available"
                    : `${m.openAi.thisMonth.calls.value} calls · ${m.openAi.thisMonth.totalTokens.value} tokens`}
                </td>
                <td className="px-3 py-2 text-slate-500">calls / tokens</td>
                <td className="px-3 py-2">{m.openAi.thisMonth.successCount.value}</td>
                <td className="px-3 py-2">{m.openAi.thisMonth.errorCount.value}</td>
                <td className="px-3 py-2">
                  {m.openAi.thisMonth.cost.classification === "NOT_AVAILABLE"
                    ? "Not available"
                    : `${usd(m.openAi.thisMonth.cost.value)} (estimate)`}
                </td>
                {/*
                  API-D2 - the confirmed credit balance, not the retired
                  internal monthly budget. Only the ceiling shown in this
                  column changed; the usage, success, failure and cost cells
                  beside it are the same production-only figures as before.
                */}
                <td className="px-3 py-2">
                  {credit.available
                    ? `${usd(credit.estimatedRemainingUsd)} est. remaining of ${usd(credit.checkpoint.confirmedBalanceUsd)} confirmed`
                    : credit.reason === "NO_CHECKPOINT"
                      ? "Not configured"
                      : "Not available"}
                </td>
                <td className="px-3 py-2 text-slate-500">
                  {m.openAi.thisMonth.lastCallAt.value
                    ? new Date(m.openAi.thisMonth.lastCallAt.value).toLocaleString()
                    : "—"}
                </td>
              </tr>

              {m.production.externalProviders.map((p) => (
                <tr key={p.provider} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">{p.label}</td>
                  <td className="px-3 py-2">
                    {p.requests.classification === "NOT_AVAILABLE"
                      ? "Not available"
                      : p.requests.value}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{p.unit}</td>
                  <td className="px-3 py-2">{p.successCount}</td>
                  <td className="px-3 py-2">{p.failedCount}</td>
                  <td className="px-3 py-2 text-slate-500">Not available</td>
                  {/*
                    API-D2 - an absent limit stays absent. It does not become
                    zero and no percentage is invented for it; usage above is
                    still counted and shown either way.
                  */}
                  <td className="px-3 py-2 text-slate-500">
                    {p.configuredMonthlyLimit === null
                      ? "Not configured"
                      : `${p.configuredMonthlyLimit} ${p.unit} configured${
                          p.usagePercent === null ? "" : ` · ${p.usagePercent.toFixed(1)}%`
                        }`}
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {p.lastActivityAt
                      ? new Date(p.lastActivityAt).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4">
          <CardGrid>
            <MetricCard
              label="Known Estimated Production API Cost"
              metric={m.production.knownEstimatedCostUsd}
              format={(v) => usd(Number(v))}
            />
          </CardGrid>
        </div>

        {/*
          Named rather than summarised, so the total is never mistaken for the
          whole bill. These providers are counted exactly; only their price is
          unknown, and $0 would be a different and false claim.
        */}
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
          Cost unknown for: {m.production.costUnknownProviders.join(", ")}. Their
          requests are counted exactly above, but no plan or SKU pricing is
          available to this deployment, so they contribute nothing to the total
          rather than contributing zero.
        </div>

        <div className="mt-2 rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500">
          Production only. Development, deploy-preview, branch-deploy, unknown
          and pre-attribution legacy usage are excluded from every figure in
          this section.
        </div>
      </Section>

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
