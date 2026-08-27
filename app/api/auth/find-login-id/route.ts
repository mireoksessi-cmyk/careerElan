import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { checkRateLimit } from "@/lib/security/rateLimiter";
import {
  recordExternalApiUsage,
  classifyExternalHttpStatus,
} from "@/lib/externalApi/usageTelemetry";

/*
  Recovers a forgotten Login ID for accounts that sign in with one.

  The login form asks for a login_id, and someone who has forgotten theirs
  has no way back: the address they remember is not what the form wants, and
  password reset asks for the same forgotten value. This route closes that
  gap and only that gap. It reads the existing login_id and hands it to a
  browser that has proven control of the account's mailbox. It never creates,
  changes, regenerates or renames one, and it never signs anybody in.

  Who is eligible is the question Create Account and the password-reset guard
  already answer, decided the same way: an account whose identities contain
  no "email" provider has no login_id worth recovering. The trigger gives
  every row one - login_id is NOT NULL, so an OAuth signup gets
  lower(split_part(email, '@', 1)) whether or not it will ever be typed into
  a login form - but that string is not a credential. Handing it to a
  social-only account would be worse than silence: it cannot be used, and it
  implies a password sign-in that does not exist.

  Three things reach the caller and nothing else. An eligible account and an
  address nobody has both answer CHECK_EMAIL, so the response cannot be read
  as "a password account exists here" - the rule login and password reset
  both keep. SOCIAL_ONLY is the one deliberate exception, and not a new one:
  /api/auth/email-status already tells the signup form that an address
  belongs to a social account, so this discloses nothing an attacker cannot
  obtain today from Create Account with the same input. Everything else -
  lookup failure, missing user, unreadable identities, mail that will not
  send - collapses to UNKNOWN and sends nothing.

  No session is minted anywhere here. Recovery, magic-link and confirmation
  tokens are deliberately unused: those authenticate, and knowing your own
  Login ID is not an authentication event. The person still types their
  password afterwards, exactly as before.
*/

type FindLoginIdStatus = "CHECK_EMAIL" | "SOCIAL_ONLY" | "UNKNOWN";

const MAX_EMAIL_LENGTH = 254;

/*
  The emailed link outlives the request that made it and nothing revokes it,
  so its whole safety margin is how briefly it is worth stealing. Ten minutes
  is long enough to walk to another device and short enough that a link
  sitting in a forwarded mailbox is already dead. The handoff is shorter: it
  only has to survive one redirect and the fetch on the page that lands.
*/
const LINK_TTL_SECONDS = 600;
const HANDOFF_TTL_SECONDS = 300;

const HANDOFF_COOKIE = "ce_find_login_id";

/*
  Same allowlist the confirmation and recovery routes run on, for the same
  reason: request.url describes the deploy rather than the address the person
  visited, so a link built from it can point somewhere the browser will not
  send the handoff cookie back to. The Host header carries the real address
  but is caller-supplied, so it is only ever matched against this fixed list,
  never interpolated as given - which is also what keeps this from becoming
  an open redirect.
*/
const TRUSTED_PUBLIC_HOSTS = new Set([
  "careerelan.com",
  "fabulous-frangipane-b5d970.netlify.app",
]);

const TRUSTED_DEPLOY_PREVIEW_HOST =
  /^deploy-preview-\d+--fabulous-frangipane-b5d970\.netlify\.app$/;

function trustedPublicOrigin(request: NextRequest): string {
  const hostHeader = request.headers.get("host");

  if (hostHeader) {
    const hostname = hostHeader.split(":")[0].toLowerCase();

    if (
      TRUSTED_PUBLIC_HOSTS.has(hostname) ||
      TRUSTED_DEPLOY_PREVIEW_HOST.test(hostname)
    ) {
      return `https://${hostname}`;
    }
  }

  return new URL(request.url).origin;
}

function statusResponse(status: FindLoginIdStatus, init?: number) {
  return NextResponse.json(
    { status },
    {
      status: init ?? 200,
      /*
        One caller's account state must never be served to the next one from
        a shared cache.
      */
      headers: { "Cache-Control": "no-store" },
    }
  );
}

/* ---------- token ---------- */

type TokenPurpose = "link" | "handoff";

/*
  One secret, two keys. The emailed token and the handoff cookie are
  different grants with different lifetimes, so deriving a separate key per
  purpose means a stolen cookie cannot be replayed as a mail link or the
  reverse - the wrong key fails the GCM tag before anything is parsed. The
  secret is dedicated to this feature: reusing the service-role key, the
  Resend key or another feature's signing secret would let a leak in one
  place become a leak in the other.
*/
function tokenKey(purpose: TokenPurpose): Buffer | null {
  const secret = process.env.FIND_LOGIN_ID_LINK_SECRET;

  if (!secret) {
    return null;
  }

  return crypto
    .createHmac("sha256", secret)
    .update(`find-login-id:v1:${purpose}`)
    .digest();
}

/*
  AES-256-GCM over the smallest payload that does the job: which account, and
  when it stops counting. The user id is the one thing the far side cannot
  look up without being told, and it never leaves this function in the clear
  - not in the URL, not in the cookie, not in the mail. The login_id and the
  address are deliberately absent; both are read from the database at
  redemption, so the token cannot go stale against them and cannot leak them
  if the ciphertext is ever opened.
*/
function seal(
  purpose: TokenPurpose,
  userId: string,
  ttlSeconds: number
): string | null {
  const key = tokenKey(purpose);

  if (!key) {
    return null;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(purpose, "utf8"));

  const payload = JSON.stringify({
    u: userId,
    x: Math.floor(Date.now() / 1000) + ttlSeconds,
  });

  const ciphertext = Buffer.concat([
    cipher.update(payload, "utf8"),
    cipher.final(),
  ]);

  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64url"
  );
}

/*
  Returns the user id only for a token this server sealed, for this purpose,
  that has not expired. Every other outcome - tampered, truncated, wrong
  purpose, unparseable, past its expiry, or no secret configured at all - is
  the same null. The caller turns all of them into one response, so nothing
  about which one happened is observable.
*/
function unseal(purpose: TokenPurpose, token: string): string | null {
  const key = tokenKey(purpose);

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

    decipher.setAAD(Buffer.from(purpose, "utf8"));
    decipher.setAuthTag(raw.subarray(12, 28));

    const plaintext = Buffer.concat([
      decipher.update(raw.subarray(28)),
      decipher.final(),
    ]).toString("utf8");

    const parsed = JSON.parse(plaintext) as { u?: unknown; x?: unknown };

    if (typeof parsed.u !== "string" || typeof parsed.x !== "number") {
      return null;
    }

    if (parsed.x <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return parsed.u;
  } catch {
    return null;
  }
}

/* ---------- eligibility ---------- */

type Eligibility = "ELIGIBLE" | "SOCIAL_ONLY" | "UNKNOWN";

/*
  identities decides this, not app_metadata.provider - that field names a
  single provider while identities carries the whole set, so an account
  holding an email identity stays eligible no matter how many social logins
  sit beside it. The only disqualifier is the absence of an email identity.

  Asked again at redemption rather than trusted from the moment the mail went
  out: identities can change in between, and a link should not outlive the
  eligibility that justified sending it.
*/
async function classifyUser(userId: string): Promise<{
  verdict: Eligibility;
  canonicalEmail: string | null;
}> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);

  if (error || !data?.user) {
    return { verdict: "UNKNOWN", canonicalEmail: null };
  }

  const identities = data.user.identities;

  if (!Array.isArray(identities) || identities.length === 0) {
    return { verdict: "UNKNOWN", canonicalEmail: null };
  }

  if (!identities.some((identity) => identity.provider === "email")) {
    return { verdict: "SOCIAL_ONLY", canonicalEmail: null };
  }

  return { verdict: "ELIGIBLE", canonicalEmail: data.user.email ?? null };
}

/* ---------- mail ---------- */

/*
  The address that receives this is the account's own, resolved from the
  lookup - never the string in the request body. Those are usually the same,
  and the difference is the entire point: a caller must not be able to name
  where the recovery goes.

  The mail carries no login_id. It carries a link, and clicking it is what
  proves the mailbox belongs to whoever asked. A login_id sitting in an inbox
  is readable by anything that can read that mail, forever; a link stops
  mattering in ten minutes.
*/
async function sendFindLoginIdEmail(
  request: NextRequest,
  userId: string,
  recipient: string
): Promise<boolean> {
  const from = process.env.FIND_LOGIN_ID_FROM_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;

  /*
    No fallback sender. The shared onboarding address does not deliver to
    arbitrary recipients, so falling back to it would turn a configuration
    mistake into mail that silently never arrives.
  */
  if (!from || !apiKey) {
    return false;
  }

  const token = seal("link", userId, LINK_TTL_SECONDS);

  if (!token) {
    return false;
  }

  const link = `${trustedPublicOrigin(
    request
  )}/api/auth/find-login-id?token=${encodeURIComponent(token)}`;

  const expiryNote =
    "This link expires in 10 minutes. If you did not ask to recover your Login ID, you can ignore this email.";

  const startedAt = Date.now();

  try {
    const { error } = await new Resend(apiKey).emails.send({
      from,
      to: recipient,
      subject: "Recover your Career Élan Login ID",
      text: [
        "Use the secure link below to recover your Career Élan Login ID.",
        "",
        link,
        "",
        expiryNote,
      ].join("\n"),
      html: [
        '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#0f172a">',
        "<p>Use the secure link below to recover your Career Élan Login ID.</p>",
        `<p><a href="${link}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:#2563eb;color:#ffffff;font-weight:700;text-decoration:none">Recover Login ID</a></p>`,
        `<p style="font-size:13px;color:#64748b">${expiryNote}</p>`,
        "</div>",
      ].join(""),
    });

    /*
      API-C2 - one row per actual Resend request. Only the fact of the
      request is recorded: the recipient address, the recovery token and the
      Login ID it protects never reach telemetry, which takes no parameter
      that could carry them.
    */
    await recordExternalApiUsage({
      provider: "resend",
      operation: "EMAIL_SEND",
      status: error ? "error" : "success",
      httpStatusClass: error
        ? typeof error.statusCode === "number"
          ? classifyExternalHttpStatus(error.statusCode)
          : "unknown"
        : "2xx",
      durationMs: Date.now() - startedAt,
      userId,
    });

    if (error) {
      /*
        A marker, not the error. The failure has to be visible to whoever
        operates this, or a broken sender looks exactly like nobody asking -
        but the recipient, the id and the token stay out of the log.
      */
      console.error("FIND LOGIN ID DISPATCH FAILED");

      return false;
    }

    return true;
  } catch {
    await recordExternalApiUsage({
      provider: "resend",
      operation: "EMAIL_SEND",
      status: "error",
      httpStatusClass: "network",
      durationMs: Date.now() - startedAt,
      userId,
    });

    console.error("FIND LOGIN ID DISPATCH FAILED");

    return false;
  }
}

/* ---------- request a Find ID link ---------- */

export async function POST(request: NextRequest) {
  try {
    /*
      Before the lookup, not after: this is an unauthenticated address probe,
      and the privileged work behind it should never be reachable more often
      than the bucket allows. Its own bucket, deliberately not shared with
      login-by-id or auth-email-status - folding them together would let
      traffic here eat the budget that bounds how many login ids or addresses
      a caller can test there.
    */
    const rateLimitResult = await checkRateLimit("find-login-id", {
      userId: null,
      requestHeaders: request.headers,
    });

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again shortly." },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(rateLimitResult.retryAfterSeconds),
          },
        }
      );
    }

    const body = await request.json().catch(() => null);

    const rawEmail = body && typeof body.email === "string" ? body.email : "";

    const email = rawEmail.trim().toLowerCase();

    if (!email || email.length > MAX_EMAIL_LENGTH || !email.includes("@")) {
      return statusResponse("UNKNOWN", 400);
    }

    /*
      profiles.email is written by the on_auth_user_created trigger as
      lower(auth.users.email), so an exact match resolves the one account
      without walking the user list. One address per request, no partial
      matching, no enumeration.
    */
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (profileError) {
      return statusResponse("UNKNOWN");
    }

    /*
      Nobody here. Answered exactly as an eligible account is, and no mail is
      sent - the caller cannot tell the two apart, which is the point.
    */
    if (!profile) {
      return statusResponse("CHECK_EMAIL");
    }

    const { verdict, canonicalEmail } = await classifyUser(profile.id);

    if (verdict === "SOCIAL_ONLY") {
      return statusResponse("SOCIAL_ONLY");
    }

    if (verdict !== "ELIGIBLE" || !canonicalEmail) {
      return statusResponse("UNKNOWN");
    }

    /*
      A send failure answers UNKNOWN rather than CHECK_EMAIL. Saying "check
      your inbox" about mail that never left sends someone to wait on
      nothing, and a distinct "the account exists but delivery failed" would
      hand back the existence answer the generic response exists to withhold.
    */
    const delivered = await sendFindLoginIdEmail(
      request,
      profile.id,
      canonicalEmail
    );

    return statusResponse(delivered ? "CHECK_EMAIL" : "UNKNOWN");
  } catch {
    return statusResponse("UNKNOWN");
  }
}

/* ---------- redeem the emailed link / consume the handoff ---------- */

function handoffCookieOptions(maxAge: number) {
  return {
    name: HANDOFF_COOKIE,
    httpOnly: true,
    /*
      Off in local development only, where there is no https to be strict
      about; production and every preview deploy set it.
    */
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);

  if (requestUrl.searchParams.get("consume") === "1") {
    return consumeHandoff(request);
  }

  const publicOrigin = trustedPublicOrigin(request);

  /*
    Built first so the cookie write below lands on the response that is
    actually returned. Every failure path returns this one untouched, so
    expired, tampered, unknown and ineligible are not told apart.
  */
  const invalid = NextResponse.redirect(
    new URL("/?findId=invalid", publicOrigin)
  );

  const token = requestUrl.searchParams.get("token");
  const userId = token ? unseal("link", token) : null;

  if (!userId) {
    return invalid;
  }

  const { verdict } = await classifyUser(userId);

  if (verdict !== "ELIGIBLE") {
    return invalid;
  }

  /*
    Read here as well as at consume time. Nothing from it is returned by this
    request, but promising ?findId=ready to a page that will then find
    nothing to fill in is worse than saying the link did not work.
  */
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("login_id")
    .eq("id", userId)
    .maybeSingle();

  if (profileError || !profile?.login_id) {
    return invalid;
  }

  const handoff = seal("handoff", userId, HANDOFF_TTL_SECONDS);

  if (!handoff) {
    return invalid;
  }

  /*
    The Login ID travels as an HttpOnly cookie's worth of ciphertext, never
    in this Location - a query parameter would put it in history, in
    referrers, and in every log that records a path. The page that lands asks
    for it over its own request, where the answer is not part of a URL.

    No session is created. This proves control of a mailbox, which is not the
    same thing as signing in; the password is still required afterwards.
  */
  const response = NextResponse.redirect(
    new URL("/?findId=ready", publicOrigin)
  );

  response.cookies.set({
    ...handoffCookieOptions(HANDOFF_TTL_SECONDS),
    value: handoff,
  });

  return response;
}

/*
  The one place a login_id is allowed to reach a browser. What earns it is
  the click that came before: the link went to the account's own mailbox, and
  the cookie proving it arrived there is what this reads.

  Cleared on every path, valid or not, so a spent handoff cannot be used
  twice from the same browser. The emailed token itself is not single-use -
  no token table exists to make it so - which is why its lifetime is short
  rather than its usage counted.
*/
async function consumeHandoff(request: NextRequest) {
  function clear<T extends NextResponse>(response: T): T {
    response.cookies.set({ ...handoffCookieOptions(0), value: "" });

    return response;
  }

  const invalid = () =>
    clear(
      NextResponse.json(
        { status: "INVALID" },
        { headers: { "Cache-Control": "no-store" } }
      )
    );

  const cookie = request.cookies.get(HANDOFF_COOKIE)?.value;
  const userId = cookie ? unseal("handoff", cookie) : null;

  if (!userId) {
    return invalid();
  }

  const { verdict } = await classifyUser(userId);

  if (verdict !== "ELIGIBLE") {
    return invalid();
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("login_id")
    .eq("id", userId)
    .maybeSingle();

  if (profileError || !profile?.login_id) {
    return invalid();
  }

  /*
    login_id and nothing else. No address, no id, no provider, no identity
    list, no timestamps.
  */
  return clear(
    NextResponse.json(
      { status: "FOUND", loginId: profile.login_id },
      { headers: { "Cache-Control": "no-store" } }
    )
  );
}
