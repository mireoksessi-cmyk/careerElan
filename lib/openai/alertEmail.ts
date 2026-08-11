/*
  Phase 6I.6.38A - operator email delivery for the 80/90/100% OpenAI
  monthly budget alerts. Reuses this codebase's existing Resend
  integration exactly as app/api/followup/route.ts already does
  (same `Resend` client construction, same "onboarding@resend.dev"
  sender - no new provider/account was introduced).

  ADMIN_ALERT_EMAILS is a server-only env var (never NEXT_PUBLIC_), a
  comma-separated list of operator recipient addresses. If unset, no
  email is sent and the caller's threshold claim (see budget.ts) is
  simply "spent" with no delivery - the in-app Alerts tab (Part O) is
  the fallback signal in that case.

  Never includes user data, prompts, or resume/job/cover-letter text -
  only the safe budget figures themselves.
*/
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export type BudgetAlertLevel = "WARNING_80" | "CRITICAL_90" | "EXCEEDED_100";

const SUBJECT_BY_LEVEL: Record<BudgetAlertLevel, string> = {
  WARNING_80: "[Career Élan] OpenAI monthly budget reached 80%",
  CRITICAL_90: "[Career Élan] OpenAI monthly budget reached 90%",
  EXCEEDED_100: "[Career Élan] OpenAI monthly budget EXCEEDED (100%)",
};

export function getConfiguredAlertRecipients(): string[] {
  const raw = process.env.ADMIN_ALERT_EMAILS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function sendBudgetAlertEmail(params: {
  level: BudgetAlertLevel;
  monthSpendUsd: number;
  /** Base budget + this month's recorded manual recharges - never raw OpenAI billing. */
  effectiveBudgetUsd: number;
  budgetUsedPercent: number;
  timestampIso: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const recipients = getConfiguredAlertRecipients();
  if (recipients.length === 0) {
    return { sent: false, reason: "ADMIN_ALERT_EMAILS not configured" };
  }

  // process.env.URL is Netlify's own runtime site URL (confirmed
  // available to serverless functions - see lib/generatePackage/
  // backgroundTarget.ts's own header comment for the source). Falls
  // back to a relative path (no fabricated domain) when absent, e.g.
  // local dev - the admin page location is still stated in words.
  const adminPageUrl = process.env.URL ? `${process.env.URL}/admin/api-costs` : "/admin/api-costs";

  try {
    await resend.emails.send({
      from: "Career Élan <onboarding@resend.dev>",
      to: recipients,
      subject: SUBJECT_BY_LEVEL[params.level],
      html: `
        <h2>${SUBJECT_BY_LEVEL[params.level]}</h2>
        <p>Current estimated spend: <strong>$${params.monthSpendUsd.toFixed(2)}</strong></p>
        <p>Effective monthly budget (base + manual recharges): <strong>$${params.effectiveBudgetUsd.toFixed(2)}</strong></p>
        <p>Percentage used: <strong>${params.budgetUsedPercent.toFixed(1)}%</strong></p>
        <p>Timestamp (UTC): ${params.timestampIso}</p>
        <p>Details: <a href="${adminPageUrl}">${adminPageUrl}</a> (AI &amp; API Costs tab)</p>
      `,
    });
    return { sent: true };
  } catch {
    return { sent: false, reason: "Resend send failed" };
  }
}
