import { guardAdminPage } from "@/lib/admin/pageAuth";
import AdminDenied from "@/components/admin/AdminDenied";
import { getStaffList } from "@/lib/admin/queries/staff";
import { PageTitle, Badge, Section } from "@/components/admin/ui";
import { GrantRoleForm, StaffStatusButton } from "@/components/admin/StaffActions";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const guard = await guardAdminPage("admin.staff.read");
  if (guard.denied) return <AdminDenied message={guard.message} />;

  const staff = await getStaffList();
  const canManage = guard.ctx.role === "OWNER" || guard.ctx.role === "ADMIN";

  return (
    <div>
      <PageTitle title="Staff & Permissions" subtitle="OWNER-only can grant/revoke the OWNER role. The last active OWNER can never be demoted or disabled." />

      {canManage && (
        <Section title="Grant / Update Role">
          <GrantRoleForm canGrantOwner={guard.ctx.role === "OWNER"} />
        </Section>
      )}

      <Section title="Current Staff">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Last Sign-In</th>
                {canManage && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => (
                <tr key={member.userId} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2">{member.email ?? member.userId.slice(0, 8)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={member.role === "OWNER" ? "success" : "default"}>{member.role}</Badge>
                  </td>
                  <td className="px-3 py-2">{member.status === "active" ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Disabled</Badge>}</td>
                  <td className="px-3 py-2 text-slate-500">{new Date(member.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-slate-500">{member.lastSignInAt ? new Date(member.lastSignInAt).toLocaleDateString() : "—"}</td>
                  {canManage && (
                    <td className="px-3 py-2 text-right">
                      <StaffStatusButton userId={member.userId} status={member.status} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
