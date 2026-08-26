import { guardAdminPage } from "@/lib/admin/pageAuth";
import AdminDenied from "@/components/admin/AdminDenied";
import { getAdminOverview } from "@/lib/admin/queries/overview";
import { PageTitle, CardGrid, MetricCard, Section, Badge } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const guard = await guardAdminPage("admin.overview.read");
  if (guard.denied) return <AdminDenied message={guard.message} />;

  const overview = await getAdminOverview();

  return (
    <div>
      <PageTitle title="Overview" subtitle="Operator cockpit - real authoritative metrics only." />

      <Section title="Users">
        <CardGrid>
          {/*
            "Total Users" used to sit over a count of every auth.users row,
            which is a count of signup attempts - an account exists there
            before its email is ever confirmed. The label now says what the
            number is, and the two cards beside it say how it splits.
          */}
          <MetricCard label="Total Auth Accounts" metric={overview.users.total} />
          <MetricCard label="Verified Members" metric={overview.users.verifiedMembers} />
          <MetricCard label="Unverified Signups" metric={overview.users.unverifiedSignups} />
          <MetricCard label="New Today" metric={overview.users.newToday} />
          <MetricCard label="New 7 Days" metric={overview.users.new7Days} />
          <MetricCard label="New This Month" metric={overview.users.newThisMonth} />
        </CardGrid>
      </Section>

      <Section title="Product">
        <CardGrid>
          <MetricCard label="Career Memory Completed" metric={overview.product.careerMemoryCompleted} />
          <MetricCard label="Resume Owners" metric={overview.product.resumeOwners} />
          <MetricCard label="Generate Package Users (Month)" metric={overview.product.generatePackageUsersThisMonth} />
          <MetricCard label="Generate Packages (Month)" metric={overview.product.generatePackagesThisMonth} />
          <MetricCard label="Applications (Month)" metric={overview.product.applicationsThisMonth} />
        </CardGrid>
      </Section>

      <Section title="Health">
        <CardGrid>
          <MetricCard label="Generate Success Rate (60m)" metric={overview.health.generateSuccessRate} format={(v) => `${v}%`} />
          <MetricCard label="Failed Generations (30d)" metric={overview.health.failedGenerations} />
          <MetricCard label="Stuck Pending" metric={overview.health.stuckPending} />
          <MetricCard label="Recent Artifact Failures (24h)" metric={overview.health.recentArtifactFailures} />
          <MetricCard label="Recent Upload Failures (24h)" metric={overview.health.recentUploadFailures} />
        </CardGrid>
      </Section>

      <Section title="API / Cost">
        <CardGrid>
          <MetricCard label="OpenAI Calls Today (est.)" metric={overview.apiCost.generatePackageAttemptsToday} />
          <MetricCard label="OpenAI Calls This Month (est.)" metric={overview.apiCost.generatePackageAttemptsThisMonth} />
          <MetricCard label="Tokens This Month" metric={overview.apiCost.tokensThisMonth} />
          <MetricCard label="Cost This Month" metric={overview.apiCost.costThisMonth} />
        </CardGrid>
      </Section>

      <Section title="Alerts">
        <div className="flex gap-3">
          <Badge tone="danger">Critical: {overview.alerts.critical}</Badge>
          <Badge tone="warning">High: {overview.alerts.high}</Badge>
          <Badge tone="default">Medium: {overview.alerts.medium}</Badge>
        </div>
      </Section>
    </div>
  );
}
