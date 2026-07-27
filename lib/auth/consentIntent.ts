import { createHmac, timingSafeEqual } from "crypto";

/*
  Carries "an OAuth signup was just started from the Sign Up screen, for
  this provider" across the redirect to the OAuth provider and back to
  app/auth/callback/route.ts - the only place that can safely confirm the
  session was actually established. Deliberately NOT a plain
  sessionStorage value or an unsigned cookie: either could be set/edited
  by the browser itself to claim an arbitrary consent_source. An
  HMAC-signed, server-issued, short-lived HttpOnly cookie is the
  standard-server-side-state pattern for this kind of pre-auth intent.

  Low-stakes by construction, not a security boundary: forging this value
  only lets someone record a (possibly mislabeled) consent event for
  their OWN account - it can never grant access to another user's data,
  since the callback still requires a real Supabase-verified session for
  the resulting account. Its purpose is an accurate consent audit trail,
  not access control.
*/

export const CONSENT_INTENT_COOKIE_NAME = "legal_consent_intent";
const INTENT_TTL_MS = 15 * 60 * 1000;
export const CONSENT_INTENT_MAX_AGE_SECONDS = INTENT_TTL_MS / 1000;

/*
  Wording note for anything that describes this cookie's lifecycle: it is
  only ever cleared by code - in app/auth/callback/route.ts, on every
  branch that route can actually reach (missing code, failed exchange,
  or a successful exchange). If OAuth is abandoned before the browser
  ever returns to our site at all (e.g. the user closes the provider's
  consent screen and never comes back), no code runs to clear it - it
  simply stops being sent once its own Max-Age (CONSENT_INTENT_MAX_AGE_SECONDS,
  15 minutes) elapses, which is the browser's own behavior, not ours.
  "Cleared immediately on cancel" is only accurate for cancellations that
  actually redirect back to /auth/callback (e.g. with an ?error= param) -
  never claim it holds for a browser tab that's simply abandoned.
*/

export type ConsentSource =
  | "google_oauth"
  | "facebook_oauth"
  | "linkedin_oauth";

const ALL_CONSENT_SOURCES: ConsentSource[] = [
  "google_oauth",
  "facebook_oauth",
  "linkedin_oauth",
];

/*
  Local-dev/test fallback ONLY - structurally unreachable in production
  (see resolveSigningSecret() below, which throws before this constant is
  ever read when NODE_ENV === "production"). Unlike
  lib/generatePackage/backgroundTarget.ts's LOCAL_DEV_FALLBACK_SECRET
  (which the Netlify-vs-local branch already makes unreachable in
  Production by construction, since that route 404s there), this cookie
  is read on every real Production OAuth-signup attempt, so a silent
  fallback would mean Production silently running with a
  publicly-known key - refusing to start that flow at all is safer than
  that.
*/
const LOCAL_DEV_FALLBACK_SECRET = "local-dev-legal-consent-intent-secret";

/*
  Production requires LEGAL_CONSENT_SIGNING_SECRET to be explicitly set -
  no fallback there, for the reason above. Throws (never logs the actual
  secret value, only the fact that it's missing) rather than silently
  signing with a guessable key. This only affects the OAuth-signup
  consent-intent path specifically, not login or email signup:
  verifyConsentIntentCookieValue() below returns null before ever calling
  this for the (overwhelmingly common) case where no
  legal_consent_intent cookie is present at all, and
  app/auth/callback/route.ts already wraps its one caller of this module
  in its own try/catch that logs and continues rather than blocking the
  redirect - a misconfigured secret fails loud in logs without taking
  down login/signup.
*/
function resolveSigningSecret(): string {
  const secret = process.env.LEGAL_CONSENT_SIGNING_SECRET;

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "LEGAL_CONSENT_SIGNING_SECRET is not set. Refusing to sign or verify " +
        "legal consent-intent cookies in production without it."
    );
  }

  return LOCAL_DEV_FALLBACK_SECRET;
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", resolveSigningSecret())
    .update(encodedPayload)
    .digest("base64url");
}

/*
  Maps the Supabase provider id used throughout app/page.tsx
  (signInWithOAuth's own provider strings) to the consent_source
  vocabulary stored in the database - kept as a single source of truth
  here rather than duplicated in the API route and the callback route.
*/
export function providerToConsentSource(
  provider: string
): ConsentSource | null {
  switch (provider) {
    case "google":
      return "google_oauth";
    case "facebook":
      return "facebook_oauth";
    case "linkedin_oidc":
      return "linkedin_oauth";
    default:
      return null;
  }
}

export function createConsentIntentCookieValue(source: ConsentSource): string {
  const payload = JSON.stringify({
    source,
    exp: Date.now() + INTENT_TTL_MS,
  });
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const signature = sign(encoded);

  return `${encoded}.${signature}`;
}

/*
  Returns the verified source, or null for anything malformed, expired,
  unsigned, or tampered with - the caller (app/auth/callback/route.ts)
  treats null exactly like "no OAuth-signup intent was recorded", which
  is always the safe default (skip consent recording, never block login).
*/
export function verifyConsentIntentCookieValue(
  value: string | undefined | null
): ConsentSource | null {
  if (!value) return null;

  const separatorIndex = value.lastIndexOf(".");
  if (separatorIndex <= 0) return null;

  const encoded = value.slice(0, separatorIndex);
  const signature = value.slice(separatorIndex + 1);
  if (!encoded || !signature) return null;

  const expectedSignature = sign(encoded);

  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);

  if (
    actualBuf.length !== expectedBuf.length ||
    !timingSafeEqual(actualBuf, expectedBuf)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    );

    if (typeof payload?.exp !== "number" || Date.now() > payload.exp) {
      return null;
    }

    if (!ALL_CONSENT_SOURCES.includes(payload?.source)) {
      return null;
    }

    return payload.source as ConsentSource;
  } catch {
    return null;
  }
}
