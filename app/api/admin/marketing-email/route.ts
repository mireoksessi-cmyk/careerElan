import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { Resend } from "resend";
import { requireAdminPermission, AdminAuthError } from "@/lib/admin/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logAdminAction } from "@/lib/admin/auditLog";
import {
  recordExternalApiUsage,
  classifyExternalHttpStatus,
  type ExternalApiHttpStatusClass,
} from "@/lib/externalApi/usageTelemetry";

/*
  API-C2 - Resend reports a real numeric statusCode on its error object, so
  the class comes from that rather than from reading the message text, which
  is not a stable contract. A send that returned no error is a 2xx; an error
  without a status is one that never got far enough to have one.
*/
function resendStatusClass(
  error: { statusCode?: number | null } | null | undefined
): ExternalApiHttpStatusClass {
  if (!error) return "2xx";
  if (typeof error.statusCode === "number") {
    return classifyExternalHttpStatus(error.statusCode);
  }
  return "unknown";
}

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

function buildBaseUrl(request: NextRequest): string {
  return process.env.URL || new URL(request.url).origin;
}

function buildSettingsUrl(request: NextRequest): string {
  return `${buildBaseUrl(request)}/settings`;
}

/*
  M2B - the policy version this deployment is built to write. The database
  writes its own literal for the /settings path (see the M2B migration); this
  is the server half of that pair, and the two must agree before anything
  mints a token that will outlive the campaign. If the environment says
  anything else, the version in force is not one this code understands, and
  guessing would attach the wrong policy to a real consent record.
*/
const SUPPORTED_CONSENT_VERSION = "marketing-v1";

const UNSUBSCRIBE_TOKEN_PURPOSE = "marketing-unsubscribe-v1";

function unsubscribeTokenKey(): Buffer | null {
  const secret = process.env.MARKETING_UNSUBSCRIBE_SECRET;

  if (!secret) {
    return null;
  }

  return crypto
    .createHmac("sha256", secret)
    .update(UNSUBSCRIBE_TOKEN_PURPOSE)
    .digest();
}

/*
  M2B - seals which account, and which consent instance, into an opaque
  token. The consent epoch is the recipient's marketing_consented_at at send
  time; null is a real value meaning a legacy opt-in with no recorded
  instance. Nothing else goes in - no address, no login id, no provider, and
  no version, because the version is not what the token is for.

  Everything is inside AES-256-GCM, so none of it is readable from the URL,
  and the dedicated unsubscribe secret means a token from here cannot be
  opened by, or confused with, any other feature's tokens.
*/
function sealUnsubscribeToken(
  userId: string,
  consentEpoch: string | null
): string | null {
  const key = unsubscribeTokenKey();

  if (!key) {
    return null;
  }

  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(UNSUBSCRIBE_TOKEN_PURPOSE, "utf8"));

    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify({ u: userId, e: consentEpoch }), "utf8"),
      cipher.final(),
    ]);

    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
      "base64url"
    );
  } catch {
    return null;
  }
}

function unsubscribeUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/api/marketing/unsubscribe?token=${encodeURIComponent(token)}`;
}

function marketingEmailHtml(params: {
  type: MarketingType;
  subject: string;
  message: string;
  settingsUrl: string;
  unsubscribeUrl: string | null;
}): string {
  const { type, subject, message, settingsUrl } = params;

  /*
    M2B - a visible way out, next to the existing preferences link rather
    than replacing it. The href is built by this server from an opaque
    token; nothing an admin types reaches it, and the admin's own copy stays
    escaped exactly as before.
  */
  const unsubscribeLine = params.unsubscribeUrl
    ? `<br />Or <a href="${params.unsubscribeUrl}">unsubscribe from marketing emails</a>.`
    : "";

  return `
    <h2>${escapeHtml(TYPE_LABEL[type])} - Career Élan</h2>

    <h3>${escapeHtml(subject)}</h3>

    <p>${messageToSafeHtml(message)}</p>

    <p style="margin-top: 24px; font-size: 12px; color: #64748b;">
      You are receiving this because you opted in to Marketing Emails.<br />
      You can turn off Marketing Emails anytime in
      <a href="${settingsUrl}">Career Élan Settings</a>.${unsubscribeLine}
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
/*
  M2B - consentEpoch is the recipient's marketing_consented_at, carried
  alongside the address so each message can be sealed to the consent
  instance it was actually sent under. Null is legitimate and means a legacy
  opt-in from before consent evidence existed; it is passed through as null
  rather than substituted, because inventing a timestamp here would defeat
  the staleness check it feeds.
*/
type MarketingRecipient = {
  id: string;
  email: string;
  consentEpoch: string | null;
};

async function resolveEligibleRecipients(): Promise<MarketingRecipient[]> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email, marketing_consented_at")
    .eq("marketing_notifications", true)
    .is("suspended_at", null)
    .not("email", "is", null)
    .neq("email", "");

  if (error) throw error;

  const consenting = (data ?? []).map((row) => ({
    id: row.id as string,
    email: row.email as string,
    consentEpoch: (row.marketing_consented_at as string | null) ?? null,
  }));

  const verified: MarketingRecipient[] = [];

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
    const baseUrl = buildBaseUrl(req);
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
    /*
      M2B - the two version locations must agree before this deployment
      mints anything that records a consent policy. Checked once here, ahead
      of both the test and the campaign, and it fails closed: no campaign, no
      test, no token. Nobody's existing consent is touched by a mismatch -
      the wrong response to "I do not recognise this policy version" is to
      start rewriting consent records under it.
    */
    if (process.env.MARKETING_CONSENT_VERSION !== SUPPORTED_CONSENT_VERSION) {
      return NextResponse.json(
        {
          error:
            "Marketing consent version is not configured for this release. No email was sent.",
        },
        { status: 500 }
      );
    }

    if (!unsubscribeTokenKey()) {
      return NextResponse.json(
        {
          error:
            "Marketing unsubscribe is not configured. No email was sent.",
        },
        { status: 500 }
      );
    }

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

      /*
        M2B - the test carries a working unsubscribe link only if this admin
        is genuinely opted in to marketing right now. If they are not, the
        test goes out without one rather than opting them in or minting a
        token against a consent instance that does not exist: a test must
        never change anybody's preferences, including the tester's.
      */
      const { data: adminProfile } = await supabaseAdmin
        .from("profiles")
        .select("marketing_notifications, marketing_consented_at")
        .eq("id", ctx.userId)
        .maybeSingle();

      const adminUnsubscribeToken = adminProfile?.marketing_notifications
        ? sealUnsubscribeToken(
            ctx.userId,
            (adminProfile.marketing_consented_at as string | null) ?? null
          )
        : null;

      const testUnsubscribeUrl = adminUnsubscribeToken
        ? unsubscribeUrl(baseUrl, adminUnsubscribeToken)
        : null;

      const testStartedAt = Date.now();

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
            unsubscribeUrl: testUnsubscribeUrl,
          }),
          ...(testUnsubscribeUrl
            ? {
                headers: {
                  "List-Unsubscribe": `<${testUnsubscribeUrl}>`,
                  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                },
              }
            : {}),
        });

        /*
          API-C2 - one row per actual Resend request. A test is a real
          request against the same account and quota as any other, so it is
          counted like one; the campaign ledger records what was sent, this
          records what the provider was asked to do.
        */
        await recordExternalApiUsage({
          provider: "resend",
          operation: "EMAIL_SEND",
          status: testError ? "error" : "success",
          httpStatusClass: resendStatusClass(testError),
          durationMs: Date.now() - testStartedAt,
          userId: ctx.userId,
        });

        if (testError) {
          return NextResponse.json(
            { error: "The email provider rejected the test message." },
            { status: 502 }
          );
        }
      } catch {
        /*
          Threw rather than returning a status - the request still left this
          process, so it is still counted. The response below is unchanged.
        */
        await recordExternalApiUsage({
          provider: "resend",
          operation: "EMAIL_SEND",
          status: "error",
          httpStatusClass: "network",
          durationMs: Date.now() - testStartedAt,
          userId: ctx.userId,
        });

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
    let recipients: MarketingRecipient[];

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

    let attempted = 0;
    let successful = 0;
    let failed = 0;

    for (const recipient of recipients) {
      attempted++;
      const sendStartedAt = Date.now();

      try {
        /*
          M2B - built per recipient, because the token is bound to that
          person's own consent instance. If it cannot be produced, this
          message is not sent: marketing that offers no way out is worse
          than marketing that does not arrive, so the recipient is counted
          as a failure and the campaign moves on rather than delivering
          without an unsubscribe path.
        */
        const token = sealUnsubscribeToken(recipient.id, recipient.consentEpoch);

        if (!token) {
          failed++;
          continue;
        }

        const recipientUnsubscribeUrl = unsubscribeUrl(baseUrl, token);

        const { error: sendError } = await resend.emails.send({
          from,
          replyTo: "careerelanhq@gmail.com",
          to: recipient.email,
          subject,
          html: marketingEmailHtml({
            type: marketingType,
            subject,
            message,
            settingsUrl,
            unsubscribeUrl: recipientUnsubscribeUrl,
          }),
          /*
            The URL carries nothing but the opaque token - no address, id or
            login id - which is what makes it safe to hand to a mail client
            that may fetch it without a person present. The POST variant is
            advertised because the endpoint's GET deliberately does not
            unsubscribe anyone.
          */
          headers: {
            "List-Unsubscribe": `<${recipientUnsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });

        /*
          API-C2 - one row per recipient, because this route already sends
          one Resend request per recipient. A campaign to 100 people is 100
          provider requests and is counted as 100, not as one campaign - the
          ledger already records the campaign, and this records what the
          provider was actually asked to do.
        */
        await recordExternalApiUsage({
          provider: "resend",
          operation: "EMAIL_SEND",
          status: sendError ? "error" : "success",
          httpStatusClass: resendStatusClass(sendError),
          durationMs: Date.now() - sendStartedAt,
          userId: ctx.userId,
        });

        if (sendError) {
          failed++;
        } else {
          successful++;
        }
      } catch {
        /*
          The request threw rather than returning a status - it still left
          this process, so it is still counted, with the campaign's own
          failure handling below unchanged.
        */
        await recordExternalApiUsage({
          provider: "resend",
          operation: "EMAIL_SEND",
          status: "error",
          httpStatusClass: "network",
          durationMs: Date.now() - sendStartedAt,
          userId: ctx.userId,
        });

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
