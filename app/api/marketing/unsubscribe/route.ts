import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/*
  Unsubscribe from marketing email. Public on purpose: someone who no longer
  wants these messages must not be made to sign in first, and the person
  holding the link may not be at the device they signed up on.

  The capability is the token and only the token. No user id, address or
  login id is accepted as a parameter, so the endpoint cannot be pointed at
  anyone - it can only act on whoever is sealed inside a token this server
  minted.

  GET never changes anything. Mail scanners, link previewers and corporate
  security proxies fetch URLs in messages without a human ever seeing them,
  and an unsubscribe that fired on GET would silently opt people out of mail
  they wanted. GET renders a page with a button; the button POSTs. The RFC
  one-click header points at the same POST, which is the only reason it is
  safe to advertise.

  Every failure - tampered token, wrong key, expired consent instance,
  unknown account - produces the same page. The endpoint is unauthenticated
  and reachable by anyone, so telling the caller which of those happened
  would answer questions about accounts they have no business asking.
*/

const TOKEN_PURPOSE = "marketing-unsubscribe-v1";

type UnsubscribeSource = "email_footer" | "email_one_click";

/*
  The consent instance a token was minted against. `epoch` is the account's
  marketing_consented_at at send time, and null is a real value here - it
  means a legacy opt-in that predates consent evidence. Either way it is
  compared against the account's current epoch in the database, so a token
  issued before a later re-consent matches nothing.
*/
type UnsubscribePayload = {
  userId: string;
  epoch: string | null;
};

function tokenKey(): Buffer | null {
  const secret = process.env.MARKETING_UNSUBSCRIBE_SECRET;

  if (!secret) {
    return null;
  }

  return crypto.createHmac("sha256", secret).update(TOKEN_PURPOSE).digest();
}

/*
  Returns the sealed payload only for a token this server produced for this
  purpose. Anything else - tampered, truncated, wrong key, unparseable, or
  no secret configured - is the same null, and the caller renders one page
  for all of them.

  Deliberately no expiry. An unsubscribe link has to keep working for as
  long as the message sits in someone's mailbox, which is not ten minutes.
  What bounds this token is not time but the consent instance it names: see
  withdraw_marketing_consent() in the M2B migration.
*/
function openToken(token: string): UnsubscribePayload | null {
  const key = tokenKey();

  if (!key) {
    return null;
  }

  try {
    const raw = Buffer.from(token, "base64url");

    if (raw.length <= 28) {
      return null;
    }

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      raw.subarray(0, 12)
    );

    decipher.setAAD(Buffer.from(TOKEN_PURPOSE, "utf8"));
    decipher.setAuthTag(raw.subarray(12, 28));

    const plaintext = Buffer.concat([
      decipher.update(raw.subarray(28)),
      decipher.final(),
    ]).toString("utf8");

    const parsed = JSON.parse(plaintext) as { u?: unknown; e?: unknown };

    if (typeof parsed.u !== "string") {
      return null;
    }

    if (parsed.e !== null && typeof parsed.e !== "string") {
      return null;
    }

    return { userId: parsed.u, epoch: (parsed.e as string | null) ?? null };
  } catch {
    return null;
  }
}

function page(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/>` +
      `<meta name="viewport" content="width=device-width,initial-scale=1"/>` +
      `<meta name="robots" content="noindex"/>` +
      `<title>${title} &middot; Career Élan</title>` +
      `<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f8fafc;color:#0f172a;` +
      `display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}` +
      `main{max-width:34rem;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;line-height:1.6}` +
      `h1{font-size:1.25rem;margin:0 0 12px}p{margin:0 0 12px;color:#334155}` +
      `button{background:#0f172a;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-weight:700;cursor:pointer}` +
      `a{color:#2563eb}</style></head><body><main><h1>${title}</h1>${body}</main></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
}

const INVALID_BODY =
  `<p>This unsubscribe link is not valid, or it has already been replaced by a newer ` +
  `email preference.</p><p>You can always manage marketing emails in ` +
  `<a href="/settings">Career Élan Settings</a>.</p>`;

/*
  Confirmation only. Reads nothing from the database and writes nothing -
  the token is opened just far enough to know whether to offer the button,
  so an automated fetch of this URL costs the visitor nothing.
*/
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const payload = token ? openToken(token) : null;

  if (!payload) {
    return page("Unsubscribe", INVALID_BODY, 400);
  }

  const action = `/api/marketing/unsubscribe?token=${encodeURIComponent(token)}`;

  return page(
    "Unsubscribe from marketing emails",
    `<p>You are about to stop receiving Career Élan marketing emails. ` +
      `Account and service emails are not affected.</p>` +
      `<form method="post" action="${action}">` +
      `<button type="submit">Unsubscribe</button></form>` +
      `<p style="margin-top:16px;font-size:.875rem;color:#64748b">Changed your mind? ` +
      `Close this page, or manage preferences in ` +
      `<a href="/settings">Career Élan Settings</a>.</p>`
  );
}

/*
  The only path that changes anything.

  Two callers reach it. A person pressing the button on the page above, and
  a mail client honouring List-Unsubscribe-Post, which sends the fixed body
  `List-Unsubscribe=One-Click`. They are recorded as different sources
  because they are different acts - one is a human decision, the other is a
  client acting on a header - but the effect is identical and neither needs
  a session.

  The source is decided here from the request shape; nothing in the body
  chooses it. The database refuses any value other than these two.
*/
export async function POST(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const payload = token ? openToken(token) : null;

  if (!payload) {
    return page("Unsubscribe", INVALID_BODY, 400);
  }

  let source: UnsubscribeSource = "email_footer";

  try {
    const raw = await request.text();

    if (/(^|&)List-Unsubscribe=One-Click(&|$)/i.test(raw.trim())) {
      source = "email_one_click";
    }
  } catch {
    /* Body is optional; the footer form posts an empty one. */
  }

  const { data, error } = await supabaseAdmin.rpc(
    "withdraw_marketing_consent",
    {
      p_user_id: payload.userId,
      p_source: source,
      p_consent_epoch: payload.epoch,
    }
  );

  /*
    STALE means the account consented again after this message was sent, so
    the link is answering for a decision that has since been replaced. It is
    shown as an ordinary invalid link rather than explained, because
    explaining it would confirm to an anonymous caller that the address
    belongs to an account that re-subscribed.
  */
  if (error || data === "INVALID" || data === "STALE") {
    return page("Unsubscribe", INVALID_BODY, 400);
  }

  /*
    WITHDRAWN and ALREADY read the same to the person holding the link. They
    asked not to receive marketing email; they are not receiving it. Saying
    "you were already unsubscribed" only invites a second look at whether
    the first one worked.
  */
  return page(
    "You have been unsubscribed",
    `<p>You will no longer receive Career Élan marketing emails.</p>` +
      `<p>Account and service emails, such as sign-in and password messages, ` +
      `are not affected.</p>` +
      `<p style="font-size:.875rem;color:#64748b">You can opt back in any time in ` +
      `<a href="/settings">Career Élan Settings</a>.</p>`
  );
}
