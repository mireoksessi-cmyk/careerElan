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
    const recipients = await resolveEligibleRecipients();
    return NextResponse.json({ eligible: recipients.length });
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
    const recipients = await resolveEligibleRecipients();
    const eligible = recipients.length;
    const settingsUrl = buildSettingsUrl(req);
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

    return NextResponse.json({ eligible, attempted, successful, failed });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
