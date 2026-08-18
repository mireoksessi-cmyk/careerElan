import { createHmac } from "crypto";

/*
  Stage 1 foundation for Generate Package monthly entitlement continuity.

  Turns a user's VERIFIED email address into an opaque, keyed digest - the
  only form that value is ever allowed to reach the database. The database
  never sees an address and never holds the key, so a claim row cannot be
  reversed back to a person, and a database compromise alone cannot confirm
  whether a guessed address was ever registered.

  Deliberately mirrors lib/security/rateLimitIdentity.ts's shape (HMAC-SHA256,
  secret from the environment, explicit dev-only fallback, production throw)
  because that file already established this project's fail-closed convention
  for identity hashing - a missing secret in production throws rather than
  letting the caller proceed unprotected.

  A DEDICATED secret, not RATE_LIMIT_HASH_SECRET: the two serve different
  data classes with different rotation cadences, and sharing one key would
  let a rate-limit identity hash and an entitlement claim be cross-correlated
  by anyone holding both values.

  Nothing here is wired to a route in Stage 1. Stage 2 owns the integration,
  including the caller-side requirement that the address has actually been
  verified (user.email_confirmed_at) before it is passed in.
*/

export class EntitlementIdentityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntitlementIdentityConfigError";
  }
}

export class EntitlementIdentityInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntitlementIdentityInputError";
  }
}

const DEV_ONLY_FALLBACK_SECRET =
  "insecure-development-only-generate-package-entitlement-secret";

function getEntitlementSecret(): string {
  const secret = process.env.GENERATE_PACKAGE_ENTITLEMENT_HMAC_SECRET;

  if (secret && secret.trim().length > 0) {
    return secret;
  }

  if (process.env.NODE_ENV !== "production") {
    // Explicit, visible development-only fallback, exactly as
    // rateLimitIdentity.ts does. The NODE_ENV check above means this branch
    // can never be reached in production - a missing secret there throws
    // instead, which the caller must turn into a safe retryable failure
    // rather than falling back to a fresh per-account allowance.
    return DEV_ONLY_FALLBACK_SECRET;
  }

  throw new EntitlementIdentityConfigError(
    "GENERATE_PACKAGE_ENTITLEMENT_HMAC_SECRET is not configured."
  );
}

/*
  trim + lowercase ONLY.

  Deliberately NOT provider-specific: no Gmail dot stripping, no plus-tag
  collapsing. Those rules are correct for at most one provider and wrong for
  most others, so applying them globally would merge unrelated real people
  into one entitlement - a false collision is far worse than the
  under-linking this conservative rule accepts.
*/
export function normalizeEntitlementEmail(email: string): string {
  const normalized = email.trim().toLowerCase();

  if (normalized.length === 0) {
    throw new EntitlementIdentityInputError("Email is empty after normalization.");
  }

  return normalized;
}

/*
  The only value ever sent to the database. Domain-separated with a fixed
  prefix so this digest can never collide with a digest computed for some
  other purpose under the same key.

  Never log the return value: it is a stable pseudonymous identifier, and
  anyone with log access could use it to correlate every account that has
  ever shared an address - precisely the linkage the keyed digest exists to
  keep inside the database.
*/
export function entitlementEmailHmac(email: string): string {
  return createHmac("sha256", getEntitlementSecret())
    .update(`generate-package-entitlement:${normalizeEntitlementEmail(email)}`)
    .digest("hex");
}
