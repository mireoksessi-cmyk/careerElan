import { guardAdminPage } from "@/lib/admin/pageAuth";
import AdminDenied from "@/components/admin/AdminDenied";
import { getAdminUserDetail } from "@/lib/admin/queries/users";
import { PageTitle, Badge, EmptyState } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminPage("admin.users.read");
  if (guard.denied) return <AdminDenied message={guard.message} />;

  const { id } = await params;
  const detail = await getAdminUserDetail(id);

  if (!detail) return <EmptyState message="User not found." />;

  return (
    <div className="max-w-2xl">
      <PageTitle title={detail.email ?? detail.userId} subtitle="Safe operational metadata only - never resume/job/cover-letter content." />

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <Row label="User ID" value={<span className="font-mono text-xs">{detail.userId}</span>} />
        <Row label="Joined" value={new Date(detail.joinedAt).toLocaleString()} />
        <Row label="Signup Provider" value={detail.provider} />
        <Row label="Plan" value={<Badge tone={detail.plan === "pro" ? "success" : "default"}>{detail.plan}</Badge>} />
        <Row label="Career Memory" value={detail.careerMemoryComplete ? <Badge tone="success">Complete</Badge> : <Badge>Incomplete</Badge>} />
        <Row label="Resume Count" value={detail.resumeCount} />
        <Row label="Selected Resume" value={detail.selectedResumeExists ? "Yes" : "No"} />
        <Row label="Selected Template" value={detail.selectedTemplate ?? "—"} />
        <Row label="Generate Package This Month" value={detail.generatePackageThisMonth} />
        <Row label="Monthly Limit" value={detail.monthlyGenerationLimit} />
        <Row label="Remaining Allowance" value={detail.remainingGenerateAllowance ?? "—"} />
        <Row label="Successful Generations (all time)" value={detail.successfulGenerationCount} />
        <Row label="Failed Generations (all time)" value={detail.failedGenerationCount} />
        <Row label="Last Generation" value={detail.lastGenerationDate ? new Date(detail.lastGenerationDate).toLocaleString() : "—"} />
        <Row label="Application Count" value={detail.applicationCount} />
        <Row label="Last Activity" value={detail.lastActivity ? new Date(detail.lastActivity).toLocaleString() : "—"} />
      </div>

      {detail.recentSafeErrors.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent Safe Errors</h2>
          <ul className="rounded-lg border border-slate-200 bg-white text-sm">
            {detail.recentSafeErrors.map((e, i) => (
              <li key={i} className="flex justify-between border-b border-slate-100 px-3 py-2 last:border-0">
                <span className="font-mono text-xs text-slate-500">{e.code}</span>
                <span className="text-slate-400">{new Date(e.date).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
