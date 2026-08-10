import Link from "next/link";
import { guardAdminPage } from "@/lib/admin/pageAuth";
import AdminDenied from "@/components/admin/AdminDenied";
import { getAdminUsers, type AdminUsersFilter } from "@/lib/admin/queries/users";
import { PageTitle, Badge, EmptyState } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const guard = await guardAdminPage("admin.users.read");
  if (guard.denied) return <AdminDenied message={guard.message} />;

  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const filter: AdminUsersFilter = {
    provider: params.provider || undefined,
    plan: (params.plan as "free" | "pro" | undefined) || undefined,
    careerMemoryComplete: params.cm === "1" ? true : params.cm === "0" ? false : undefined,
    hasResume: params.resume === "1" ? true : params.resume === "0" ? false : undefined,
    generatePackageUsed: params.gp === "1" ? true : params.gp === "0" ? false : undefined,
    search: params.q || undefined,
  };

  const { rows, total } = await getAdminUsers(filter, page, PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageTitle title="Users" subtitle={`${total} matching users`} />

      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <input name="q" defaultValue={params.q ?? ""} placeholder="Search email" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        <select name="provider" defaultValue={params.provider ?? ""} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
          <option value="">Any provider</option>
          <option value="email">Email</option>
          <option value="google">Google</option>
          <option value="linkedin_oidc">LinkedIn</option>
          <option value="facebook">Facebook</option>
        </select>
        <select name="plan" defaultValue={params.plan ?? ""} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
          <option value="">Any plan</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
        </select>
        <select name="cm" defaultValue={params.cm ?? ""} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
          <option value="">Career Memory: any</option>
          <option value="1">Complete</option>
          <option value="0">Incomplete</option>
        </select>
        <select name="resume" defaultValue={params.resume ?? ""} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
          <option value="">Resume: any</option>
          <option value="1">Has resume</option>
          <option value="0">No resume</option>
        </select>
        <select name="gp" defaultValue={params.gp ?? ""} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
          <option value="">Generate Package: any</option>
          <option value="1">Used this month</option>
          <option value="0">Not used this month</option>
        </select>
        <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState message="No users match these filters." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Joined</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2">Career Memory</th>
                <th className="px-3 py-2">Resumes</th>
                <th className="px-3 py-2">Generate (mo)</th>
                <th className="px-3 py-2">Applications</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link href={`/admin/users/${row.userId}`} className="text-slate-900 underline-offset-2 hover:underline">
                      {row.email ?? row.userId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{new Date(row.joinedAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2">{row.provider}</td>
                  <td className="px-3 py-2">
                    <Badge tone={row.plan === "pro" ? "success" : "default"}>{row.plan}</Badge>
                  </td>
                  <td className="px-3 py-2">{row.careerMemoryComplete ? <Badge tone="success">Complete</Badge> : <Badge>Incomplete</Badge>}</td>
                  <td className="px-3 py-2">{row.resumeCount}</td>
                  <td className="px-3 py-2">{row.generatePackageThisMonth}</td>
                  <td className="px-3 py-2">{row.applicationCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 text-sm">
        {page > 1 && (
          <Link className="text-slate-600 underline" href={{ query: { ...params, page: String(page - 1) } }}>
            Previous
          </Link>
        )}
        <span className="text-slate-400">
          Page {page} of {totalPages}
        </span>
        {page < totalPages && (
          <Link className="text-slate-600 underline" href={{ query: { ...params, page: String(page + 1) } }}>
            Next
          </Link>
        )}
      </div>
    </div>
  );
}
