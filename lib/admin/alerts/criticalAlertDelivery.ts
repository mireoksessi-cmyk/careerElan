/*
  Gets critical operational incidents to the operator without them opening the
  Admin console.

  Everything the console shows was computed only when somebody looked at it.
  That is fine for a spike, which leaves evidence in the tables and is still
  there an hour later. It is not fine for a stuck generation, which becomes
  critical purely because time passed: the condition can arise, persist and
  matter with no request being made by anyone, so a system that only evaluates
  on page view can never report it. This runs on a schedule instead.

  The alert definitions are not repeated here. getAlerts() is called directly,
  so there is exactly one set of thresholds, windows and severities in the
  codebase and the email can never disagree with the screen about whether
  something is wrong.
*/
import { getAlerts } from "../queries/alerts";
import { supabaseAdmin } from "../../supabaseAdmin";
import {
  getConfiguredAlertRecipients,
  sendCriticalSystemAlertEmail,
} from "../../openai/alertEmail";

/*
  The six alerts the operator asked to be told about. Membership here does not
  send anything on its own - delivery still requires the canonical evaluation
  to return the key at CRITICAL severity. Keys currently classified HIGH are
  listed because promoting one later should start mailing without touching
  this module.
*/
const TARGET_ALERTS: Record<string, string> = {
  repeated_worker_enqueue_failures: "Worker repeated failure",
  generate_package_failure_spike: "Generate Package failure spike",
  stuck_generation_severe: "Stuck generation",
  openai_rate_limit_spike: "OpenAI 429 spike",
  openai_timeout_spike: "OpenAI timeout spike",
  openai_failure_rate: "OpenAI failure-rate spike",
};

const MAX_ATTEMPTS = 3;
const RETRY_COOLDOWN_MS = 60 * 60 * 1000;

export type CriticalAlertRunSummary = {
  evaluated: number;
  criticalNow: string[];
  claimed: string[];
  sent: string[];
  failed: string[];
  recovered: string[];
  skipped: "NOT_PRODUCTION" | "NO_RECIPIENT" | null;
};

/*
  Deliberately the same CONTEXT mapping used by lib/openai/telemetry.ts and
  lib/externalApi/usageTelemetry.ts, copied rather than imported for the same
  reason they copy it from each other: those modules are not this task's to
  change, and eight bounded lines are a smaller risk than reaching into them.

  It matters more here than anywhere else it appears. A Deploy Preview reads
  the same production database, so without this a preview build could mail the
  operator about a real incident it has no business reporting - and worse,
  claim the incident first, so the production evaluation would find it already
  taken and stay silent. Production requires positive evidence; anything
  unrecognised is not production.
*/
function isProduction(): boolean {
  return process.env.CONTEXT === "production";
}

/*
  Takes ownership of one alert's delivery, or reports that nothing needs
  sending.

  Claims before any email leaves, so a retry, a concurrent evaluation or an
  overlapping schedule run cannot produce a second message. The insert is the
  first-ever case; the guarded update covers the two cases where a new send is
  legitimate:

    RECOVERED - the alert cleared and has now returned. A new episode, so the
                attempt counter resets with it.
    FAILED    - delivery failed, and it is worth another go: bounded to three
                attempts, never inside an hour of the last one, so a Resend
                outage does not lose a critical alert and a persistent failure
                cannot become a loop.

  CLAIMED and SENT both return false. SENT is the ongoing-incident case the
  operator has already been told about; CLAIMED means another run holds it.

  Any error returns false. A delivery table that cannot be read is a reason to
  stay quiet rather than risk repeating a message.
*/
async function claimAlert(alertKey: string, now: Date): Promise<boolean> {
  const nowIso = now.toISOString();

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("system_alert_delivery_state")
    .insert({
      alert_key: alertKey,
      state: "CLAIMED",
      incident_started_at: nowIso,
      attempts: 1,
      last_attempt_at: nowIso,
      last_critical_at: nowIso,
    })
    .select("alert_key")
    .maybeSingle();

  if (!insertError && inserted) return true;

  /* A new episode after recovery. */
  const { data: reArmed } = await supabaseAdmin
    .from("system_alert_delivery_state")
    .update({
      state: "CLAIMED",
      incident_started_at: nowIso,
      attempts: 1,
      last_attempt_at: nowIso,
      last_critical_at: nowIso,
      sent_at: null,
      recovered_at: null,
      updated_at: nowIso,
    })
    .eq("alert_key", alertKey)
    .eq("state", "RECOVERED")
    .select("alert_key")
    .maybeSingle();

  if (reArmed) return true;

  /* A bounded retry of a delivery that failed. */
  const retryFloorIso = new Date(now.getTime() - RETRY_COOLDOWN_MS).toISOString();

  const { data: retried } = await supabaseAdmin
    .from("system_alert_delivery_state")
    .update({
      state: "CLAIMED",
      last_attempt_at: nowIso,
      last_critical_at: nowIso,
      updated_at: nowIso,
    })
    .eq("alert_key", alertKey)
    .eq("state", "FAILED")
    .lt("attempts", MAX_ATTEMPTS)
    .lt("last_attempt_at", retryFloorIso)
    .select("attempts")
    .maybeSingle();

  if (!retried) {
    /*
      Not claimed, but the alert is still critical - recorded so an operator
      reading the table can see the incident is ongoing rather than assuming
      the row went stale.
    */
    await supabaseAdmin
      .from("system_alert_delivery_state")
      .update({ last_critical_at: nowIso, updated_at: nowIso })
      .eq("alert_key", alertKey);

    return false;
  }

  /*
    Bumped after the guarded transition rather than inside it, because
    PostgREST cannot express attempts = attempts + 1 in the same statement as
    the condition. Only the caller that won the transition out of FAILED gets
    here, so the increment cannot race another sender.
  */
  await supabaseAdmin
    .from("system_alert_delivery_state")
    .update({ attempts: (retried.attempts ?? 1) + 1 })
    .eq("alert_key", alertKey);

  return true;
}

async function settleAlert(
  alertKey: string,
  sent: boolean,
  now: Date
): Promise<void> {
  const nowIso = now.toISOString();

  await supabaseAdmin
    .from("system_alert_delivery_state")
    .update({
      state: sent ? "SENT" : "FAILED",
      sent_at: sent ? nowIso : null,
      updated_at: nowIso,
    })
    .eq("alert_key", alertKey);
}

/*
  Marks an alert recovered once the canonical evaluation stops returning it as
  critical. This is what re-arms the next episode, and it is why nobody has to
  clear anything by hand - which matters, because the person who would clear it
  is the person the email is trying to reach.

  Never touches a row already RECOVERED, so recovered_at keeps the moment the
  incident actually ended rather than the last time a schedule ran.
*/
async function markRecovered(alertKey: string, now: Date): Promise<boolean> {
  const nowIso = now.toISOString();

  const { data } = await supabaseAdmin
    .from("system_alert_delivery_state")
    .update({ state: "RECOVERED", recovered_at: nowIso, updated_at: nowIso })
    .eq("alert_key", alertKey)
    .neq("state", "RECOVERED")
    .select("alert_key")
    .maybeSingle();

  return Boolean(data);
}

/*
  One scheduled pass. Never throws: this is monitoring, and a failure here must
  not surface anywhere near a user's request.
*/
export async function runCriticalAlertDelivery(
  now = new Date()
): Promise<CriticalAlertRunSummary> {
  const summary: CriticalAlertRunSummary = {
    evaluated: 0,
    criticalNow: [],
    claimed: [],
    sent: [],
    failed: [],
    recovered: [],
    skipped: null,
  };

  try {
    if (!isProduction()) {
      summary.skipped = "NOT_PRODUCTION";
      return summary;
    }

    /*
      No configured recipient means nothing can be delivered. Returning before
      any claim keeps every incident eligible for the moment a recipient is
      configured - claiming now would burn the alert on a message nobody
      receives, which is the one outcome worse than not alerting.
    */
    if (getConfiguredAlertRecipients().length === 0) {
      summary.skipped = "NO_RECIPIENT";
      return summary;
    }

    const alerts = await getAlerts();
    summary.evaluated = alerts.length;

    /*
      CRITICAL only. Several of the target keys are classified HIGH by the
      canonical evaluation today and so will not mail; that classification is
      the Admin console's to make, and quietly raising it here to produce an
      email would mean the screen and the inbox disagreed about how serious
      the same condition is.
    */
    const criticalKeys = new Set(
      alerts
        .filter((a) => a.severity === "CRITICAL" && a.key in TARGET_ALERTS)
        .map((a) => a.key)
    );
    summary.criticalNow = [...criticalKeys];

    for (const alertKey of Object.keys(TARGET_ALERTS)) {
      if (!criticalKeys.has(alertKey)) {
        if (await markRecovered(alertKey, now)) summary.recovered.push(alertKey);
        continue;
      }

      if (!(await claimAlert(alertKey, now))) continue;
      summary.claimed.push(alertKey);

      const alert = alerts.find((a) => a.key === alertKey);
      if (!alert) continue;

      const { data: row } = await supabaseAdmin
        .from("system_alert_delivery_state")
        .select("incident_started_at")
        .eq("alert_key", alertKey)
        .maybeSingle();

      const result = await sendCriticalSystemAlertEmail({
        alertName: TARGET_ALERTS[alertKey],
        alertKey,
        title: alert.title,
        detail: alert.detail,
        incidentStartedAtIso: row?.incident_started_at ?? now.toISOString(),
        timestampIso: now.toISOString(),
      });

      await settleAlert(alertKey, result.sent, now);
      (result.sent ? summary.sent : summary.failed).push(alertKey);
    }
  } catch {
    /* Swallowed deliberately - see this function's own header comment. */
  }

  return summary;
}
