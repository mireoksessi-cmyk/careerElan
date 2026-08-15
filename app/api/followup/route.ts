import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const resend = new Resend(process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/*
  Email Notifications Phase 1 - Job Tracker follow-up reminders.

  Reminder #1 fires once status_applied_at is at least 5 days old and no
  reminder has been sent yet (followup_email_count = 0). Reminder #2 fires
  once the successful Reminder #1 send (last_followup_email_at) is at
  least 3 days old and followup_email_count = 1. followup_email_count is
  the authoritative successful-send counter (0/1/2) and is only ever
  incremented AFTER a confirmed non-error Resend response - a failed send
  never advances it, so a later retry (this run or a future scheduled
  run) will simply try the same reminder again.
*/
const REMINDER_1_DELAY_MS = 5 * 24 * 60 * 60 * 1000;
const REMINDER_2_DELAY_MS = 3 * 24 * 60 * 60 * 1000;

/*
  A claimed-but-never-finalized row (process crash, Netlify function
  timeout, etc.) must not lock an application forever - any claim older
  than this is treated as abandoned and may be atomically reclaimed by a
  later invocation. No separate cleanup job is used; the claim's own
  WHERE clause performs the reclaim inline the next time this route runs.
*/
const CLAIM_STALE_MS = 30 * 60 * 1000;

/*
  process.env.URL is Netlify's own runtime site URL (see
  lib/openai/alertEmail.ts's identical convention for the same reasoning)
  - falls back to the request's own origin (never a fabricated hostname)
  for local dev / manual invocation.
*/
function buildSettingsUrl(request: Request): string {
  const base = process.env.URL || new URL(request.url).origin;
  return `${base}/settings`;
}

function reminderEmailHtml(params: {
  reminderNumber: 1 | 2;
  jobTitle: string;
  company: string;
  settingsUrl: string;
}): string {
  const { reminderNumber, jobTitle, company, settingsUrl } = params;

  const body =
    reminderNumber === 1
      ? `<p>It's been <strong>5 days</strong> since you applied for the <strong>${jobTitle}</strong> position at <strong>${company}</strong>. If you haven't heard back yet, this may be a good time to follow up.</p>`
      : `<p>Just a reminder - if you still haven't followed up on your application for the <strong>${jobTitle}</strong> position at <strong>${company}</strong>, you may want to send a short follow-up.</p>`;

  return `
    <h2>Follow-up Reminder</h2>

    <p>Hello,</p>

    ${body}

    <p>Thanks,</p>

    <p><strong>Career Élan</strong></p>

    <p style="margin-top: 24px; font-size: 12px; color: #64748b;">
      You can turn off Email Notifications anytime in
      <a href="${settingsUrl}">Career Élan Settings</a>.
    </p>
  `;
}

type FollowupCandidate = {
  application: any;
  expectedCount: 0 | 1;
  reminderNumber: 1 | 2;
};

/*
  Atomically claims one application for one specific reminder attempt via
  a single conditional UPDATE. Postgres's own row-level locking under
  READ COMMITTED makes this a correct compare-and-swap: the WHERE clause
  (exact expected followup_email_count + no active/only-stale claim) is
  re-evaluated against the committed row state before a concurrent UPDATE
  targeting the same row is allowed to proceed, so at most one concurrent
  invocation's UPDATE can ever match and return a row for a given
  application - no RPC, advisory lock, or SELECT ... FOR UPDATE needed.
*/
async function claimApplication(
  applicationId: string,
  expectedCount: 0 | 1,
  claimToken: string,
  nowIso: string,
  staleClaimCutoffIso: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("applications")
    .update({
      followup_claimed_at: nowIso,
      followup_claim_token: claimToken,
    })
    .eq("id", applicationId)
    .eq("status", "Applied")
    .eq("followup_email_count", expectedCount)
    .or(
      `followup_claimed_at.is.null,followup_claimed_at.lt.${staleClaimCutoffIso}`
    )
    .select("id");

  if (error) {
    console.error("FOLLOWUP CLAIM ERROR =", error);
    return false;
  }

  return (data?.length ?? 0) === 1;
}

async function releaseClaim(applicationId: string, claimToken: string) {
  const { error } = await supabase
    .from("applications")
    .update({
      followup_claimed_at: null,
      followup_claim_token: null,
    })
    .eq("id", applicationId)
    .eq("followup_claim_token", claimToken);

  if (error) {
    console.error("FOLLOWUP CLAIM RELEASE ERROR =", error);
  }
}

/*
  This route is meant to be hit by an external scheduler, not a logged-in
  user - there's no Supabase session to check here. CRON_SECRET is a
  shared secret only the scheduler knows, so this stays an auth gate, not
  a new sending provider or cron job. See netlify/functions/
  followup-scheduled.ts for the one authorized caller.
*/
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json(
      { success: false, error: "Unauthorized." },
      { status: 401 }
    );
  }

  try {
    const now = new Date();
    const reminder1CutoffIso = new Date(
      now.getTime() - REMINDER_1_DELAY_MS
    ).toISOString();
    const reminder2CutoffIso = new Date(
      now.getTime() - REMINDER_2_DELAY_MS
    ).toISOString();
    const staleClaimCutoffIso = new Date(
      now.getTime() - CLAIM_STALE_MS
    ).toISOString();

    const [
      { data: reminder1Rows, error: reminder1Error },
      { data: reminder2Rows, error: reminder2Error },
    ] = await Promise.all([
      supabase
        .from("applications")
        .select("*")
        .eq("status", "Applied")
        .eq("followup_email_count", 0)
        .not("status_applied_at", "is", null)
        .lte("status_applied_at", reminder1CutoffIso)
        .or(
          `followup_claimed_at.is.null,followup_claimed_at.lt.${staleClaimCutoffIso}`
        ),
      supabase
        .from("applications")
        .select("*")
        .eq("status", "Applied")
        .eq("followup_email_count", 1)
        .not("last_followup_email_at", "is", null)
        .lte("last_followup_email_at", reminder2CutoffIso)
        .or(
          `followup_claimed_at.is.null,followup_claimed_at.lt.${staleClaimCutoffIso}`
        ),
    ]);

    if (reminder1Error) throw reminder1Error;
    if (reminder2Error) throw reminder2Error;

    const candidates: FollowupCandidate[] = [
      ...(reminder1Rows ?? []).map((application) => ({
        application,
        expectedCount: 0 as const,
        reminderNumber: 1 as const,
      })),
      ...(reminder2Rows ?? []).map((application) => ({
        application,
        expectedCount: 1 as const,
        reminderNumber: 2 as const,
      })),
    ];

    if (!candidates.length) {
      return Response.json({ success: true, emailsSent: 0 });
    }

    const settingsUrl = buildSettingsUrl(request);
    let emailsSent = 0;

    for (const candidate of candidates) {
      const { application, expectedCount, reminderNumber } = candidate;

      const {
        data: { user },
      } = await supabase.auth.admin.getUserById(
        application.user_id
      );

      if (!user?.email) continue;

      /*
        Respect the user's own Settings > Email Notifications toggle.
        Column defaults to true, so only an explicit false (opted out)
        skips sending; a missing profiles row is treated as not opted out.
        profiles.marketing_notifications is never read here - Marketing
        Emails remain completely out of scope for this feature.
      */
      const { data: recipientProfile } = await supabase
        .from("profiles")
        .select("email_notifications")
        .eq("id", application.user_id)
        .maybeSingle();

      if (recipientProfile?.email_notifications === false) continue;

      const claimToken = randomUUID();
      const claimNowIso = new Date().toISOString();

      const claimed = await claimApplication(
        application.id,
        expectedCount,
        claimToken,
        claimNowIso,
        staleClaimCutoffIso
      );

      if (!claimed) continue;

      let sendSucceeded = false;

      try {
        const { error: sendError } = await resend.emails.send(
          {
            from: "Career Élan <onboarding@resend.dev>",
            to: user.email,
            subject: "Career Élan - Follow-up Reminder",
            html: reminderEmailHtml({
              reminderNumber,
              jobTitle: application.job_title,
              company: application.company,
              settingsUrl,
            }),
          },
          {
            /*
              Second, independent layer of exactly-once protection beyond
              the DB claim above - if a finalize write below ever fails
              after a successful send (leaving followup_email_count
              unadvanced), a later retry reuses this exact same key, and
              Resend returns the original cached result instead of
              delivering a second email to the user.
            */
            idempotencyKey: `followup:${application.id}:${reminderNumber}`,
          }
        );

        sendSucceeded = !sendError;

        if (sendError) {
          console.error("FOLLOWUP SEND ERROR =", sendError);
        }
      } catch (sendThrow) {
        console.error("FOLLOWUP SEND ERROR =", sendThrow);
      }

      if (sendSucceeded) {
        const { error: finalizeError } = await supabase
          .from("applications")
          .update({
            followup_email_count: expectedCount + 1,
            last_followup_email_at: new Date().toISOString(),
            followup_claimed_at: null,
            followup_claim_token: null,
          })
          .eq("id", application.id)
          .eq("followup_claim_token", claimToken);

        if (finalizeError) {
          console.error("FOLLOWUP FINALIZE ERROR =", finalizeError);
        } else {
          emailsSent++;
        }
      } else {
        await releaseClaim(application.id, claimToken);
      }
    }

    return Response.json({
      success: true,
      emailsSent,
    });
  } catch (error) {
    console.error(error);

    return Response.json(
      {
        success: false,
        error: String(error),
      },
      {
        status: 500,
      }
    );
  }
}
