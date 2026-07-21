import { createHmac } from "crypto";

/*
  Turns a logged-in user's id or a guest's client IP into an opaque,
  salted identity_hash - the only form either value is ever allowed to
  reach the database or a log line in. Raw IPs and raw user ids never get
  stored or logged; only this module ever sees them, and only long enough
  to compute the hash.
*/

export class RateLimitConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitConfigError";
  }
}

export class ClientIpUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientIpUnavailableError";
  }
}

const DEV_ONLY_FALLBACK_SECRET =
  "insecure-development-only-rate-limit-secret";

const DEV_ONLY_GUEST_IDENTIFIER = "dev-local-guest";

function getHashSecret(): string {
  const secret = process.env.RATE_LIMIT_HASH_SECRET;

  if (secret && secret.trim().length > 0) {
    return secret;
  }

  if (process.env.NODE_ENV !== "production") {
    // Explicit, visible development-only fallback. The NODE_ENV check
    // above means this branch can never be reached in production - a
    // missing secret there throws instead (see below), which the caller
    // must turn into a safe 500 rather than proceeding unprotected.
    return DEV_ONLY_FALLBACK_SECRET;
  }

  throw new RateLimitConfigError(
    "RATE_LIMIT_HASH_SECRET is not configured."
  );
}

function hash(value: string): string {
  return createHmac("sha256", getHashSecret()).update(value).digest("hex");
}

export function hashUserIdentity(userId: string): string {
  return hash(`user:${userId}`);
}

export function hashGuestIdentity(clientIp: string): string {
  return hash(`ip:${clientIp}`);
}

/*
  Netlify sets x-nf-client-connection-ip itself at the edge for standard
  (non-Edge) Functions, which is what this app's Next.js API routes run
  as - a client cannot override it by sending its own copy of that header.
  x-forwarded-for/x-real-ip are NOT used: Netlify does not guarantee they
  reflect the true client IP, and any custom header is fully
  client-controlled, so neither is a safe identity source in production.
*/
export function resolveGuestIp(headers: Headers): string {
  const netlifyIp = headers.get("x-nf-client-connection-ip");

  if (netlifyIp && netlifyIp.trim().length > 0) {
    return netlifyIp.trim();
  }

  if (process.env.NODE_ENV !== "production") {
    // Netlify only injects this header in actual deployed environments -
    // local `next dev` never has it. Fall back to a fixed development
    // identifier rather than leaving guest rate limiting unusable locally.
    return DEV_ONLY_GUEST_IDENTIFIER;
  }

  throw new ClientIpUnavailableError(
    "x-nf-client-connection-ip header is missing."
  );
}
