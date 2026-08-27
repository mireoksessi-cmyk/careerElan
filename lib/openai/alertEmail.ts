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
import { supabaseAdmin } from "../supabaseAdmin";
import { recordExternalApiUsage } from "../externalApi/usageTelemetry";

const resend = new Resend(process.env.RESEND_API_KEY);

/*
  API-D2 - at most three delivery attempts per alert, an hour apart. A
  transient Resend outage should not silently lose an alert; a persistent one
  should not turn into a loop. Retries only ever happen on the back of a
  later genuine production usage event - nothing here schedules or polls.
*/
const MAX_ALERT_ATTEMPTS = 3;
const RETRY_COOLDOWN_MS = 60 * 60 * 1000;

export type AlertSettlement = "SENT" | "SUPERSEDED" | "FAILED";

/*
  API-D2 - takes exclusive ownership of one alert, or reports that someone
  else already has it.

  This is the recursion guard, and it works because of the order it enforces:
  the claim is written before any email is sent. The alert email goes out
  through Resend, C2 records that as a production resend/EMAIL_SEND event,
  and that event runs threshold evaluation again - which arrives here and
  finds the row already present. The duplicate cannot be sent because it can
  never be claimed. The same holds for two concurrent requests crossing a
  threshold together: the primary key on alert_key means exactly one insert
  succeeds.

  A FAILED alert may be re-claimed, but only within the attempt and cooldown
  bounds above. The UPDATE carries those bounds in its own WHERE clause, so
  the check and the claim are one atomic statement rather than a read
  followed by a hopeful write.

  Returns false on any error. A monitoring table that cannot be read is a
  reason to stay quiet, not a reason to send something that may be a
  duplicate.
*/
export async function claimUsageAlert(
  alertKey: string,
  thresholdPercent: number,
  now = new Date()
): Promise<boolean> {
  const nowIso = now.toISOString();

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("api_usage_alert_state")
    .insert({
      alert_key: alertKey,
      threshold_percent: thresholdPercent,
      state: "CLAIMED",
      attempts: 1,
      last_attempt_at: nowIso,
    })
    .select("alert_key")
    .maybeSingle();

  if (!insertError && inserted) return true;

  const retryFloorIso = new Date(now.getTime() - RETRY_COOLDOWN_MS).toISOString();

  const { data: reclaimed, error: updateError } = await supabaseAdmin
    .from("api_usage_alert_state")
    .update({ state: "CLAIMED", last_attempt_at: nowIso, updated_at: nowIso })
    .eq("alert_key", alertKey)
    .eq("state", "FAILED")
    .lt("attempts", MAX_ALERT_ATTEMPTS)
    .lt("last_attempt_at", retryFloorIso)
    .select("alert_key")
    .maybeSingle();

  if (updateError || !reclaimed) return false;

  /*
    The attempt counter is bumped after the claim rather than inside it,
    because PostgREST cannot express attempts = attempts + 1 in the same
    statement as the guarded transition. The guard above is what makes this
    safe: only the caller that won the transition out of FAILED reaches
    here, so the increment cannot race another sender.
  */
  const { data: current } = await supabaseAdmin
    .from("api_usage_alert_state")
    .select("attempts")
    .eq("alert_key", alertKey)
    .maybeSingle();

  if (current) {
    await supabaseAdmin
      .from("api_usage_alert_state")
      .update({ attempts: (current.attempts ?? 1) + 1 })
      .eq("alert_key", alertKey);
  }

  return true;
}

/*
  API-D2 - records how a claimed alert ended. SUPERSEDED is used when a
  threshold was genuinely crossed but a higher one in the same evaluation
  carried the message; the lower threshold is satisfied and must never
  produce its own email later.
*/
export async function settleUsageAlert(
  alertKey: string,
  settlement: AlertSettlement,
  now = new Date()
): Promise<void> {
  const nowIso = now.toISOString();

  await supabaseAdmin
    .from("api_usage_alert_state")
    .update({
      state: settlement,
      sent_at: settlement === "SENT" ? nowIso : null,
      updated_at: nowIso,
    })
    .eq("alert_key", alertKey);
}

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

  /*
    API-C2 - one row per actual Resend request. This path sends a single
    request carrying every configured recipient in one `to` array, so it is
    one provider request however many operators are listed - provider usage
    follows API calls, not addresses. Nothing about the recipients, the
    subject or the budget figures reaches telemetry.

    A system alert has no user behind it, so no user is attributed.
  */
  const startedAt = Date.now();

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
    await recordExternalApiUsage({
      provider: "resend",
      operation: "EMAIL_SEND",
      status: "success",
      httpStatusClass: "2xx",
      durationMs: Date.now() - startedAt,
    });

    return { sent: true };
  } catch {
    /*
      This path awaits the send without destructuring an error object, so a
      rejection is all it can observe - recorded without a status class it
      cannot honestly determine.
    */
    await recordExternalApiUsage({
      provider: "resend",
      operation: "EMAIL_SEND",
      status: "error",
      httpStatusClass: "unknown",
      durationMs: Date.now() - startedAt,
    });

    return { sent: false, reason: "Resend send failed" };
  }
}

/*
  API-D2 - shared Resend delivery for both alert kinds.

  Everything about how a request reaches Resend, and how C2 accounts for it,
  is identical between them, so it lives here once. The two callers differ
  only in what they have to say.
*/
async function sendAlertEmail(params: {
  recipients: string[];
  subject: string;
  html: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const startedAt = Date.now();

  try {
    await resend.emails.send({
      from: "Career Élan <onboarding@resend.dev>",
      to: params.recipients,
      subject: params.subject,
      html: params.html,
    });
    await recordExternalApiUsage({
      provider: "resend",
      operation: "EMAIL_SEND",
      status: "success",
      httpStatusClass: "2xx",
      durationMs: Date.now() - startedAt,
    });

    return { sent: true };
  } catch {
    await recordExternalApiUsage({
      provider: "resend",
      operation: "EMAIL_SEND",
      status: "error",
      httpStatusClass: "unknown",
      durationMs: Date.now() - startedAt,
    });

    return { sent: false, reason: "Resend send failed" };
  }
}

function adminPageUrl(): string {
  return process.env.URL ? `${process.env.URL}/admin/api-costs` : "/admin/api-costs";
}

export type CreditAlertThreshold = 80 | 90 | 100;

/*
  API-D2 - the OpenAI credit depletion alert.

  The wording carries a distinction the numbers alone would hide. The
  confirmed balance is a fact: a human read it off OpenAI's billing page at a
  stated moment. Everything derived from it since - spend, remaining,
  percentage - is this codebase's own token-price estimate. Saying
  "estimated remaining" rather than "remaining" is the difference between
  reporting what we know and implying we can see OpenAI's live balance, which
  we cannot.
*/
export async function sendCreditDepletionAlertEmail(params: {
  threshold: CreditAlertThreshold;
  confirmedBalanceUsd: number;
  confirmedAtIso: string;
  trackedSpendUsd: number;
  estimatedRemainingUsd: number;
  consumedPercent: number;
  timestampIso: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const recipients = getConfiguredAlertRecipients();
  if (recipients.length === 0) {
    return { sent: false, reason: "ADMIN_ALERT_EMAILS not configured" };
  }

  const url = adminPageUrl();
  const headline =
    params.threshold === 100
      ? "Career Élan OpenAI Credit Alert - estimated credit exhausted (100%)"
      : `Career Élan OpenAI Credit Alert - ${params.threshold}% of confirmed credit estimated consumed`;

  return sendAlertEmail({
    recipients,
    subject: `[Career Élan] OpenAI credit ${params.threshold}% consumed (estimated)`,
    html: `
      <h2>${headline}</h2>
      <p>Confirmed OpenAI credit balance at checkpoint: <strong>$${params.confirmedBalanceUsd.toFixed(2)}</strong><br />
      Confirmed at (UTC): ${params.confirmedAtIso}</p>
      <p>Tracked Production estimated spend since that checkpoint: <strong>$${params.trackedSpendUsd.toFixed(2)}</strong></p>
      <p>Estimated remaining credit: <strong>$${params.estimatedRemainingUsd.toFixed(2)}</strong></p>
      <p>Estimated consumed: <strong>${params.consumedPercent.toFixed(1)}%</strong></p>
      <p>
        The confirmed balance is what you read from the OpenAI billing dashboard
        at the checkpoint. The spend, remaining and percentage above are Career
        Élan's own estimate from token counts and a local price table - they are
        not OpenAI's live balance. Check the OpenAI dashboard for the real
        figure, and record a new checkpoint after topping up.
      </p>
      <p>Timestamp (UTC): ${params.timestampIso}</p>
      <p>Details: <a href="${url}">${url}</a> (AI &amp; API Costs tab)</p>
    `,
  });
}

/*
  API-D2 - the external provider monthly usage alert.

  These providers report no cost this codebase can price, so the alert is
  about request counts against a limit the operator configured. The email
  says so plainly: an operational limit somebody set is not the same as a
  quota the provider enforces, and an operator acting on this should know
  which one they are looking at.
*/
export async function sendExternalUsageAlertEmail(params: {
  providerLabel: string;
  threshold: 80 | 90;
  productionUsage: number;
  configuredLimit: number;
  remainingUnits: number;
  unit: string;
  usagePercent: number;
  timestampIso: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const recipients = getConfiguredAlertRecipients();
  if (recipients.length === 0) {
    return { sent: false, reason: "ADMIN_ALERT_EMAILS not configured" };
  }

  const url = adminPageUrl();

  return sendAlertEmail({
    recipients,
    subject: `[Career Élan] ${params.providerLabel} usage reached ${params.threshold}% of configured monthly limit`,
    html: `
      <h2>Career Élan API Usage Alert - ${params.providerLabel}</h2>
      <p>Production usage this month: <strong>${params.productionUsage} ${params.unit}</strong></p>
      <p>Configured monthly limit: <strong>${params.configuredLimit} ${params.unit}</strong></p>
      <p>Usage: <strong>${params.usagePercent.toFixed(1)}%</strong> (threshold ${params.threshold}%)</p>
      <p>Remaining before the configured limit: <strong>${params.remainingUnits} ${params.unit}</strong></p>
      <p>
        Limit source: <strong>CAREER ÉLAN CONFIGURED LIMIT</strong>. This is an
        operational ceiling set in this deployment's configuration, not a quota
        proven to be enforced by the provider. The provider's own plan limit may
        be higher or lower.
      </p>
      <p>Counts Production traffic only - preview, branch and local usage is excluded.</p>
      <p>Timestamp (UTC): ${params.timestampIso}</p>
      <p>Details: <a href="${url}">${url}</a> (AI &amp; API Costs tab)</p>
    `,
  });
}
