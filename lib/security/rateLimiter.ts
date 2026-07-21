import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { createClient } from "@/lib/supabase-server";
import {
  hashGuestIdentity,
  hashUserIdentity,
  resolveGuestIp,
  RateLimitConfigError,
  ClientIpUnavailableError,
} from "@/lib/security/rateLimitIdentity";
import {
  RATE_LIMITS,
  RATE_LIMIT_WINDOW_SECONDS,
  RateLimitedEndpoint,
} from "@/lib/config/rateLimits";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

/*
  Anything that stops the limit from being checked at all - missing
  RATE_LIMIT_HASH_SECRET in production, missing Netlify IP header in
  production, an unresolvable auth-session check, or the
  increment_rate_limit RPC failing. The caller must treat this as a hard
  failure (safe 500), never as "allow the request through" - failing open
  here would defeat the whole point of this check.
*/
export class RateLimitInfrastructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitInfrastructureError";
  }
}

/*
  Resolves the caller's user id for rate-limiting purposes on a
  guest-allowed endpoint, without ever letting an auth failure silently
  fall back to guest treatment. Only a genuine "no session" outcome
  (AuthSessionMissingError - the normal, expected shape for an anonymous
  visitor) resolves to null/guest. Anything else - a network failure
  talking to the auth service, a retryable fetch error, an unexpected
  thrown exception - is a RateLimitInfrastructureError: it must never be
  mistaken for "this caller has no session," since that would let a real
  logged-in user get silently downgraded into a shared IP bucket the
  moment the auth check itself has trouble.
*/
export async function resolveOptionalUserId(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string | null> {
  let result;

  try {
    result = await supabase.auth.getUser();
  } catch (error) {
    throw new RateLimitInfrastructureError(
      error instanceof Error ? error.message : "Failed to verify session."
    );
  }

  const { data, error } = result;

  if (error) {
    if (isAuthSessionMissingError(error)) {
      return null;
    }

    throw new RateLimitInfrastructureError(error.message);
  }

  return data.user?.id ?? null;
}

/*
  Checks and atomically increments the caller's request count for this
  endpoint's current fixed window, before any OpenAI call or outbound
  fetch happens. `userId` should come only from resolveOptionalUserId()
  (never a client-supplied value) - pass null for a confirmed guest,
  which falls back to the Netlify-verified client IP.
*/
export async function checkRateLimit(
  endpoint: RateLimitedEndpoint,
  params: { userId: string | null; requestHeaders: Headers }
): Promise<RateLimitResult> {
  const limits = RATE_LIMITS[endpoint];

  let identityHash: string;
  let limit: number;

  try {
    if (params.userId) {
      identityHash = hashUserIdentity(params.userId);
      limit = limits.user;
    } else {
      const clientIp = resolveGuestIp(params.requestHeaders);
      identityHash = hashGuestIdentity(clientIp);
      limit = limits.guest;
    }
  } catch (error) {
    if (
      error instanceof RateLimitConfigError ||
      error instanceof ClientIpUnavailableError
    ) {
      throw new RateLimitInfrastructureError(error.message);
    }

    throw error;
  }

  const { data, error } = await supabaseAdmin.rpc("increment_rate_limit", {
    p_identity_hash: identityHash,
    p_endpoint: endpoint,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
  });

  if (error) {
    throw new RateLimitInfrastructureError(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    throw new RateLimitInfrastructureError(
      "Rate limit check returned no data."
    );
  }

  const requestCount: number = row.request_count;
  const windowStartedAt = new Date(row.window_started_at).getTime();
  const windowEndsAt = windowStartedAt + RATE_LIMIT_WINDOW_SECONDS * 1000;
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((windowEndsAt - Date.now()) / 1000)
  );

  return {
    allowed: requestCount <= limit,
    limit,
    remaining: Math.max(0, limit - requestCount),
    retryAfterSeconds,
  };
}
