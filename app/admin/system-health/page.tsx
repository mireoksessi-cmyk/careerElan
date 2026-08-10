import { guardAdminPage } from "@/lib/admin/pageAuth";
import AdminDenied from "@/components/admin/AdminDenied";
import { getSystemHealth } from "@/lib/admin/queries/systemHealth";
import { PageTitle, CardGrid, MetricCard, Section, EmptyState } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function SystemHealthPage() {
  const guard = await guardAdminPage("admin.system_health.read");
  if (guard.denied) return <AdminDenied message={guard.message} />;

  const h = await getSystemHealth();

  return (
    <div>
      <PageTitle title="System Health" subtitle={`Window: ${h.windowLabel}`} />

      <Section title="Generate Package">
        <CardGrid>
          <MetricCard label="Succeeded" metric={h.generatePackage.succeeded} />
          <MetricCard label="Failed" metric={h.generatePackage.failed} />
          <MetricCard label="Success Rate" metric={h.generatePackage.successRatePercent} format={(v) => `${v}%`} />
          <MetricCard label="Stuck Pending" metric={h.generatePackage.stuckPending} />
          <MetricCard label="Oldest Stuck (min)" metric={h.generatePackage.oldestStuckAgeMinutes} />
          <MetricCard label="Background Enqueue Failed" metric={h.generatePackage.backgroundEnqueueFailed} />
        </CardGrid>

        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">Error Code Breakdown</h3>
          {h.generatePackage.errorCodeBreakdown.value.length === 0 ? (
            <EmptyState message="No failures in this window." />
          ) : (
            <ul className="rounded-lg border border-slate-200 bg-white text-sm">
              {h.generatePackage.errorCodeBreakdown.value.map((e) => (
                <li key={e.code} className="flex justify-between border-b border-slate-100 px-3 py-2 last:border-0">
                  <span className="font-mono text-xs">{e.code}</span>
                  <span className="font-medium">{e.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <Section title="Documents">
        <CardGrid>
          <MetricCard label="PDF Render Failures" metric={h.documents.pdfFailures} />
          <MetricCard label="DOCX Render Failures" metric={h.documents.docxFailures} />
        </CardGrid>
      </Section>

      <Section title="Upload">
        <CardGrid>
          <MetricCard label="Resume Parse Failures" metric={h.upload.resumeParseFailures} />
          <MetricCard label="Cover Letter Parse Failures" metric={h.upload.coverLetterParseFailures} />
        </CardGrid>
      </Section>
    </div>
  );
}
