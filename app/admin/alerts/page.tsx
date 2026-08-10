import { guardAdminPage } from "@/lib/admin/pageAuth";
import AdminDenied from "@/components/admin/AdminDenied";
import { getAlerts } from "@/lib/admin/queries/alerts";
import { PageTitle, Badge, EmptyState } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

const TONE = { CRITICAL: "danger", HIGH: "warning", MEDIUM: "default", INFO: "default" } as const;

export default async function AlertsPage() {
  const guard = await guardAdminPage("admin.alerts.read");
  if (guard.denied) return <AdminDenied message={guard.message} />;

  const alerts = await getAlerts();

  return (
    <div>
      <PageTitle
        title="Alerts"
        subtitle="Computed fresh on every load from real health data - not persisted (no acknowledge/resolve state this phase)."
      />

      {alerts.length === 0 ? (
        <EmptyState message="No active alerts." />
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.key} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">{a.title}</span>
                <Badge tone={TONE[a.severity]}>{a.severity}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">{a.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
