import { redirect } from "next/navigation";
import { getAdminContext } from "@/lib/admin/auth";
import { permissionsForRole } from "@/lib/admin/permissions";
import AdminNav from "@/components/admin/AdminNav";

/*
  Phase 6I.6.37 - baseline gate: must be active staff to see ANY /admin
  page at all. Per-tab permission is enforced again by each individual
  page (see lib/admin/pageAuth.ts) - this layout only proves "is
  logged-in staff", never "is allowed on this specific tab".
*/
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAdminContext();
  if (!ctx) redirect("/");

  const permissions = permissionsForRole(ctx.role);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <AdminNav permissions={permissions} />
      <div className="flex-1 overflow-x-auto p-6">
        <div className="mb-4 text-xs text-slate-400">
          Signed in as {ctx.email} &middot; Role: <span className="font-medium text-slate-600">{ctx.role}</span>
        </div>
        {children}
      </div>
    </div>
  );
}
