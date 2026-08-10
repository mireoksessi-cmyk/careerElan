import Link from "next/link";
import { guardAdminPage } from "@/lib/admin/pageAuth";
import AdminDenied from "@/components/admin/AdminDenied";
import { getAdminAuditLog } from "@/lib/admin/queries/auditLogList";
import { PageTitle, Badge, EmptyState } from "@/components/admin/ui";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const guard = await guardAdminPage("admin.audit.read");
  if (guard.denied) return <AdminDenied message={guard.message} />;

  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const { rows, total } = await getAdminAuditLog(page, PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageTitle title="Audit Log" subtitle={`${total} recorded admin actions`} />

      {rows.length === 0 ? (
        <EmptyState message="No admin actions recorded yet." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 text-slate-500">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">{row.actorEmail ?? (row.actorAdminUserId ? row.actorAdminUserId.slice(0, 8) : "(deleted account)")}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.action}</td>
                  <td className="px-3 py-2 text-slate-500">{row.targetType ? `${row.targetType}:${row.targetId?.slice(0, 8)}` : "—"}</td>
                  <td className="px-3 py-2">
                    <Badge tone={row.result === "success" ? "success" : row.result === "denied" ? "warning" : "danger"}>{row.result}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 text-sm">
        {page > 1 && (
          <Link className="text-slate-600 underline" href={{ query: { page: String(page - 1) } }}>
            Previous
          </Link>
        )}
        <span className="text-slate-400">
          Page {page} of {totalPages}
        </span>
        {page < totalPages && (
          <Link className="text-slate-600 underline" href={{ query: { page: String(page + 1) } }}>
            Next
          </Link>
        )}
      </div>
    </div>
  );
}
