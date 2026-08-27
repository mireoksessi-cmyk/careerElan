import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireAdminPermission, AdminAuthError } from "@/lib/admin/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logAdminAction } from "@/lib/admin/auditLog";

const resend = new Resend(process.env.RESEND_API_KEY);

/*
  Admin Marketing Email Sender - manual only, exactly two categories.
  Both GET and POST independently call requireAdminPermission(
  "admin.marketing.send") - never trusts a client-supplied role/isAdmin
  flag. Recipients are resolved here, server-side, from
  profiles.marketing_notifications = true AND a non-empty profiles.email
  AND a null profiles.suspended_at AND a confirmed auth address (see
  resolveEligibleRecipients below) - never from
  profiles.email_notifications, and email addresses are never returned to
  the browser (GET returns only a count; POST returns only
  eligible/attempted/successful/failed counts).

  Sends one resend.emails.send() call per recipient (not a single
  multi-address "to" array) - the same pattern already used by
  app/api/followup/route.ts. This is deliberate, not just consistency:
  a shared "to" array would let every recipient see every other
  recipient's email address, and there is no guarantee here about how
  many eligible recipients might exist - per-recipient sends are safe
  regardless of list size.
*/

const MARKETING_TYPES = ["new_feature", "promotion"] as const;
type MarketingType = (typeof MARKETING_TYPES)[number];

const TYPE_LABEL: Record<MarketingType, string> = {
  new_feature: "New Feature",
  promotion: "Promotion",
};

const SUBJECT_MAX_LENGTH = 200;
const MESSAGE_MAX_LENGTH = 5000;

/*
  M2A - how many past campaigns the admin history returns. Bounded because
  an admin console read has no business fetching a table without a ceiling,
  and nobody scrolls further back than this to answer "what did we send
  recently".
*/
const HISTORY_LIMIT = 20;

/*
  M2A - the shape an idempotency key must have to be accepted. Opaque by
  contract: the browser sends a random value (crypto.randomUUID), and
  nothing here reads meaning into it, so it must never carry an address, an
  id, or any part of the campaign. The bounds match the CHECK constraint on
  the column itself, so a malformed key is refused in both places rather
  than only one.
*/
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

type CampaignStatus = "SENDING" | "COMPLETED" | "PARTIAL" | "FAILED";

type CampaignHistoryRow = {
  id: number;
  campaignType: string;
  subject: string;
  body: string;
  status: CampaignStatus;
  eligible: number | null;
  attempted: number | null;
  accepted: number | null;
  failed: number | null;
  actorAdminUserId: string | null;
  createdAt: string;
  completedAt: string | null;
};

/*
  M2A - counts only, exactly as the table stores them. No recipient address
  is selected here because none is stored; see the migration's header for
  why, and for what this history can and cannot prove.
*/
async function listRecentCampaigns(): Promise<CampaignHistoryRow[]> {
  const { data, error } = await supabaseAdmin
    .from("marketing_email_campaigns")
    .select(
      "id, campaign_type, subject, body, status, eligible_count, attempted_count, accepted_count, failed_count, actor_admin_user_id, created_at, completed_at"
    )
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as number,
    campaignType: row.campaign_type as string,
    subject: row.subject as string,
    body: row.body as string,
    status: row.status as CampaignStatus,
    eligible: row.eligible_count as number | null,
    attempted: row.attempted_count as number | null,
    accepted: row.accepted_count as number | null,
    failed: row.failed_count as number | null,
    actorAdminUserId: row.actor_admin_user_id as string | null,
    createdAt: row.created_at as string,
    completedAt: row.completed_at as string | null,
  }));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/*
  Plain-text message in, safely-escaped HTML out - never accepts raw
  HTML from the admin. Newlines become <br/> so basic paragraph
  formatting survives; nothing else is interpreted as markup.
*/
function messageToSafeHtml(message: string): string {
  return escapeHtml(message)
    .split(/\r\n|\r|\n/)
    .join("<br />");
}

function buildSettingsUrl(request: NextRequest): string {
  const base = process.env.URL || new URL(request.url).origin;
  return `${base}/settings`;
}

function marketingEmailHtml(params: {
  type: MarketingType;
  subject: string;
  message: string;
  settingsUrl: string;
}): string {
  const { type, subject, message, settingsUrl } = params;

  return `
    <h2>${escapeHtml(TYPE_LABEL[type])} - Career Élan</h2>

    <h3>${escapeHtml(subject)}</h3>

    <p>${messageToSafeHtml(message)}</p>

    <p style="margin-top: 24px; font-size: 12px; color: #64748b;">
      You are receiving this because you opted in to Marketing Emails.<br />
      You can turn off Marketing Emails anytime in
      <a href="${settingsUrl}">Career Élan Settings</a>.
    </p>
  `;
}

/*
  Three conditions, all resolved server-side, all required.

  marketing_notifications is the consent record and is not negotiable -
  a row without it is never a recipient, whatever else is true of it.

  suspended_at is the same suspension signal middleware.ts already
  enforces on every page and API request. An account that cannot use the
  product should not be receiving campaigns about it, and reading the
  same column rather than any second notion of account state means
  suspending someone takes effect here without anyone remembering to
  update a list.

  email_confirmed_at is the address itself having been proven. It lives
  on the auth user rather than the profile, so it is read one account at
  a time by id - each id already resolved from a consent-bearing profile
  row. Same bounded getUserById() pattern the signup preflight and the
  password-reset guard use, and deliberately not listUsers(): nothing is
  enumerated, and the number of reads is the number of people who asked
  for these emails.

  Having a Google/Facebook/LinkedIn identity is not itself a reason to
  exclude anyone - a social account whose provider returned a verified
  address carries email_confirmed_at like any other and stays eligible.
  What this drops is an unproven address, whichever way the account was
  created.

  Anything unreadable - a failed auth lookup, a missing user - drops that
  recipient rather than including them. Marketing is the one place where
  sending on a guess is worse than not sending at all.
*/
async function resolveEligibleRecipients(): Promise<{ id: string; email: string }[]> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email")
    .eq("marketing_notifications", true)
    .is("suspended_at", null)
    .not("email", "is", null)
    .neq("email", "");

  if (error) throw error;

  const consenting = (data ?? []) as { id: string; email: string }[];
  const verified: { id: string; email: string }[] = [];

  for (const candidate of consenting) {
    const { data: authUser, error: authError } =
      await supabaseAdmin.auth.admin.getUserById(candidate.id);

    if (authError || !authUser?.user?.email_confirmed_at) {
      continue;
    }

    verified.push(candidate);
  }

  return verified;
}

export async function GET() {
  try {
    await requireAdminPermission("admin.marketing.send");
    const [recipients, campaigns] = await Promise.all([
      resolveEligibleRecipients(),
      listRecentCampaigns(),
    ]);
    return NextResponse.json({ eligible: recipients.length, campaigns });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAdminPermission("admin.marketing.send");

    const body = await req.json().catch(() => ({}));

    const type = typeof body.type === "string" ? body.type : "";
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!MARKETING_TYPES.includes(type as MarketingType)) {
      return NextResponse.json(
        { error: "type must be one of: new_feature, promotion." },
        { status: 400 }
      );
    }
    if (!subject) {
      return NextResponse.json({ error: "subject is required." }, { status: 400 });
    }
    if (subject.length > SUBJECT_MAX_LENGTH) {
      return NextResponse.json(
        { error: `subject must be at most ${SUBJECT_MAX_LENGTH} characters.` },
        { status: 400 }
      );
    }
    if (!message) {
      return NextResponse.json({ error: "message is required." }, { status: 400 });
    }
    if (message.length > MESSAGE_MAX_LENGTH) {
      return NextResponse.json(
        { error: `message must be at most ${MESSAGE_MAX_LENGTH} characters.` },
        { status: 400 }
      );
    }

    /*
      Checked before the recipient lookup so a misconfigured sender costs
      nothing and sends nothing. There is no fallback on purpose: the
      shared onboarding address this route used to carry does not deliver
      to arbitrary recipients, so quietly falling back to it would turn a
      missing variable into a campaign that reports success and reaches
      nobody. Refusing and saying so is the better failure.

      The message names the setting, never its value - this reaches an
      admin's browser.
    */
    const from = process.env.MARKETING_EMAIL_FROM;

    if (!from) {
      return NextResponse.json(
        {
          error:
            "Marketing email sender is not configured. No email was sent.",
        },
        { status: 500 }
      );
    }

    const marketingType = type as MarketingType;
    const settingsUrl = buildSettingsUrl(req);

    /*
      M2A - a test send goes to the admin who is asking and to nobody else.
      The address is taken from the authenticated context, never from the
      request: a body field naming the recipient would turn this into an
      open relay for anyone who reached the endpoint with marketing
      permission, and there is no version of "send this campaign to an
      address I typed" that this feature needs.

      It touches neither the campaign ledger nor the marketing recipient
      list. An admin can test as many times as they like without consuming
      the idempotency key that protects the real campaign, and no opted-in
      user receives anything.
    */
    if (body.action === "test") {
      const testRecipient = ctx.email?.trim();

      if (!testRecipient) {
        return NextResponse.json(
          {
            error:
              "No verified email is available for the current admin account. No test email was sent.",
          },
          { status: 400 }
        );
      }

      const testSubject = `[TEST] ${subject}`.slice(0, SUBJECT_MAX_LENGTH);

      try {
        const { error: testError } = await resend.emails.send({
          from,
          replyTo: "careerelanhq@gmail.com",
          to: testRecipient,
          subject: testSubject,
          html: marketingEmailHtml({
            type: marketingType,
            subject: testSubject,
            message,
            settingsUrl,
          }),
        });

        if (testError) {
          return NextResponse.json(
            { error: "The email provider rejected the test message." },
            { status: 502 }
          );
        }
      } catch {
        return NextResponse.json(
          { error: "The email provider rejected the test message." },
          { status: 502 }
        );
      }

      /* Never echoes the address back - the admin knows their own. */
      return NextResponse.json({ test: true, sent: 1 });
    }

    /*
      M2A - everything below is the real campaign, and the key is claimed
      before any of it happens.

      The browser generates one opaque key per intended submission and
      reuses it on retry. Uniqueness is enforced by the column, not by a
      read-then-write here: two requests arriving together both attempt the
      insert, Postgres accepts exactly one, and the other is rejected with a
      constraint violation before it has sent anything. A check-first
      approach would leave a window between the check and the send where
      both requests believed they were the only one.
    */
    const idempotencyKey =
      typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return NextResponse.json(
        { error: "A valid campaign key is required. No email was sent." },
        { status: 400 }
      );
    }

    const { data: reservation, error: reservationError } = await supabaseAdmin
      .from("marketing_email_campaigns")
      .insert({
        idempotency_key: idempotencyKey,
        actor_admin_user_id: ctx.userId,
        campaign_type: marketingType,
        subject,
        body: message,
        status: "SENDING" satisfies CampaignStatus,
      })
      .select("id")
      .single();

    if (reservationError || !reservation) {
      /*
        Either this key already ran, or the ledger could not be written. Both
        end the same way: nothing is sent. Re-running a key whose row is
        still SENDING would risk delivering a second copy to people who
        already received one, and sending without a durable record would
        leave a campaign nobody can account for. The recorded outcome is
        returned so the admin can see what already happened instead of
        guessing.
      */
      const { data: existing } = await supabaseAdmin
        .from("marketing_email_campaigns")
        .select(
          "status, eligible_count, attempted_count, accepted_count, failed_count"
        )
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existing) {
        return NextResponse.json(
          {
            duplicate: true,
            status: existing.status as CampaignStatus,
            eligible: (existing.eligible_count as number | null) ?? 0,
            attempted: (existing.attempted_count as number | null) ?? 0,
            successful: (existing.accepted_count as number | null) ?? 0,
            failed: (existing.failed_count as number | null) ?? 0,
          },
          { status: 200 }
        );
      }

      return NextResponse.json(
        {
          error:
            "This campaign could not be recorded, so nothing was sent. Please try again with a new campaign.",
        },
        { status: 500 }
      );
    }

    const campaignId = reservation.id as number;

    /*
      Resolved after the reservation, so a failure here still cannot produce
      an unrecorded send - nothing has gone out yet. The row is closed as
      FAILED with zero counts rather than left ambiguous, because at this
      point it is known that no message left.
    */
    let recipients: { id: string; email: string }[];

    try {
      recipients = await resolveEligibleRecipients();
    } catch {
      await supabaseAdmin
        .from("marketing_email_campaigns")
        .update({
          status: "FAILED" satisfies CampaignStatus,
          eligible_count: 0,
          attempted_count: 0,
          accepted_count: 0,
          failed_count: 0,
          completed_at: new Date().toISOString(),
        })
        .eq("id", campaignId);

      return NextResponse.json(
        {
          error:
            "Recipients could not be resolved, so nothing was sent. Please start a new campaign.",
        },
        { status: 500 }
      );
    }

    const eligible = recipients.length;
    const html = marketingEmailHtml({ type: marketingType, subject, message, settingsUrl });

    let attempted = 0;
    let successful = 0;
    let failed = 0;

    for (const recipient of recipients) {
      attempted++;
      try {
        const { error: sendError } = await resend.emails.send({
          from,
          replyTo: "careerelanhq@gmail.com",
          to: recipient.email,
          subject,
          html,
        });

        if (sendError) {
          failed++;
        } else {
          successful++;
        }
      } catch {
        failed++;
      }
    }

    /*
      M2A - close the ledger row with what actually happened. COMPLETED
      means nothing was rejected; PARTIAL means some were and some were
      not; FAILED means there was something to send and none of it was
      accepted. An empty eligible list is COMPLETED, not FAILED - there was
      no work and it was done.

      "accepted" throughout is the provider taking the message, which is
      the furthest this code can honestly see. Whether it reached a mailbox
      is not observable here and is never recorded as though it were.

      A failure to write this update does not re-run the campaign: the mail
      is already out, and the correct response to bad bookkeeping is not a
      second delivery.
    */
    const status: CampaignStatus =
      failed === 0
        ? "COMPLETED"
        : successful > 0
          ? "PARTIAL"
          : "FAILED";

    await supabaseAdmin
      .from("marketing_email_campaigns")
      .update({
        status,
        eligible_count: eligible,
        attempted_count: attempted,
        accepted_count: successful,
        failed_count: failed,
        completed_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    /*
      "error" only when there WAS something to send and every single
      attempt failed - a genuinely empty eligible list (nothing to do)
      or any partial success both count as "success" for audit
      classification purposes.
    */
    await logAdminAction({
      actorAdminUserId: ctx.userId,
      action: "MARKETING_EMAIL_SENT",
      targetType: "profiles",
      result: eligible === 0 || successful > 0 ? "success" : "error",
      metadata: { type: marketingType, eligible, attempted, successful, failed },
    });

    return NextResponse.json({ eligible, attempted, successful, failed, status });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
