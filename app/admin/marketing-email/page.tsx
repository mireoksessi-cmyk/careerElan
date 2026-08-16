import { guardAdminPage } from "@/lib/admin/pageAuth";
import AdminDenied from "@/components/admin/AdminDenied";
import { PageTitle, Section } from "@/components/admin/ui";
import { MarketingEmailForm } from "@/components/admin/MarketingEmailForm";

/*
  Admin Marketing Email Sender - manual New Feature / Promotion sends
  only, gated on the dedicated admin.marketing.send permission (see
  lib/admin/permissions.ts). Deliberately its own route rather than a
  section on app/admin/users/page.tsx: that page requires
  admin.users.read at the page level, which a MARKETING-only staffer
  (holding admin.marketing.send and nothing else) does not have - hosting
  this here is what actually makes the isolated permission reachable.
*/
export const dynamic = "force-dynamic";

export default async function MarketingEmailPage() {
  const guard = await guardAdminPage("admin.marketing.send");
  if (guard.denied) return <AdminDenied message={guard.message} />;

  return (
    <div>
      <PageTitle
        title="Marketing Email"
        subtitle="Manually compose and send a one-off New Feature or Promotion email to users who have opted into Marketing Emails. No automation, no scheduling - every send is a single explicit action."
      />

      <Section title="Compose">
        <MarketingEmailForm />
      </Section>
    </div>
  );
}
