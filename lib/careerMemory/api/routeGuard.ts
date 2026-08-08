/*
  Phase 6D - shared API route boilerplate. Every route under
  app/api/internal/canonical-career-memory/** (and the client-facing
  routes under app/api/internal/canonical-generate-package/**) calls
  withCanonicalAuth() first, which:
  1. Requires a real authenticated Supabase session, in every runtime
     (local, Netlify Production, Netlify Deploy Preview, Netlify Branch
     Deploy) - the ONLY generic gate. Unauthenticated -> 401
     AUTHENTICATION_REQUIRED (see errorResponse/STATUS_BY_CODE in
     ./httpErrorMapping.ts), never a blanket 404.
  2. Never reads `user_id`/`userId` from the request body - the ONLY
     source of truth for who is making the request is the session.

  Phase 6I.6.12 - this function used to also return a 404 whenever
  isNetlifyRuntime() was true, UNCONDITIONALLY, before auth ever ran -
  copied at Phase 6D from app/api/internal/resume-structured-preview/
  route.ts's own gate. That precedent is a genuinely different class of
  route: an UNAUTHENTICATED fixture-file reader with no session check
  of its own, where the runtime 404 is its ONLY protection against
  being reachable from the internet - removing it there would expose an
  unauthenticated endpoint. Every route behind withCanonicalAuth is the
  opposite: real per-user data, always session-authenticated, always
  ownership-checked server-side (see assertOwnership in ../auth/
  authContext.ts and every repository/RPC's own ownership check) - the
  runtime gate was therefore redundant with (and, per current product
  direction, actively blocking) the auth this function already enforces.
  Audited before removal (Phase 6I.6.12 investigation): (a) the exact
  same session-cookie createClient() pattern already runs unguarded in
  Netlify Production today via other existing routes (e.g.
  app/api/resumes/[id]/preview-url/route.ts), proving no platform
  incompatibility; (b) app/api/internal/canonical-generate-package/
  config,preview,status,template are already real production client
  dependencies (Dashboard/Career Memory/Job Tracker/Job Detail all
  fetch them), so the blanket 404 was breaking already-shipped UI
  affordances, not just gating unused internal tooling; (c) Generate
  Package's own production traffic routing (decideGenerationRoute() /
  CANONICAL_CANARY_STAGE, called from app/api/generate-package/
  route.ts) never went through this function at all, so this change has
  no effect on canary routing or Stage-0 (0% canonical) traffic.
  Routes that still legitimately need an isNetlifyRuntime() gate (the
  unauthenticated dev/fixture routes, and the Bearer-secret background-
  worker stand-ins that only exist because a real Netlify Background
  Function replaces them in Production) call isNetlifyRuntime()
  directly themselves and do not go through withCanonicalAuth - this
  change does not touch them.

  Uses lib/supabase-server.ts's own createClient() (existing file, not
  modified) - the same authenticated, RLS-respecting server client
  every other existing API route in this codebase already uses.
*/
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "../../supabase-server";
import { getAuthenticatedUserId, type AuthClient } from "../auth/authContext";
import { createCanonicalRepositories, type CanonicalRepositoryBundle } from "../repositories/createRepositories";
import { errorResponse } from "./httpErrorMapping";

const MAX_REQUEST_BODY_BYTES = 256 * 1024;

export type CanonicalRouteContext = {
  userId: string;
  repos: CanonicalRepositoryBundle;
  /*
    The raw RLS-authenticated client, exposed alongside `repos` so a
    route can read a legacy table outside the canonical repository
    bundle (e.g. `resumes`) with the same ownership guarantee every
    other existing route already gets from `.eq("user_id", user.id)` -
    see app/api/resumes/[id]/preview-url/route.ts's own pattern. Every
    existing caller destructures only `{userId, repos}`, so this is a
    purely additive field.
  */
  client: SupabaseClient;
};

/*
  Client-agnostic core: auth extraction + repository construction +
  domain-error-to-HTTP mapping, with NO dependency on next/headers'
  cookies() - takes an already-constructed client. withCanonicalAuth()
  (below) is the thin production wrapper that supplies the real
  cookie-based client; tests call runWithAuthenticatedContext() directly
  with a FakeSupabaseClient (repositories/testSupport/fakeSupabaseClient.ts),
  exercising the EXACT SAME auth/error-mapping code path a real request
  goes through, without needing a real Next.js request context.
*/
export async function runWithAuthenticatedContext(client: AuthClient & SupabaseClient, handler: (ctx: CanonicalRouteContext) => Promise<NextResponse>): Promise<NextResponse> {
  try {
    const userId = await getAuthenticatedUserId(client);
    const repos = createCanonicalRepositories(client);
    return await handler({ userId, repos, client });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function withCanonicalAuth(handler: (ctx: CanonicalRouteContext) => Promise<NextResponse>): Promise<NextResponse> {
  const supabase = await createClient();
  return runWithAuthenticatedContext(supabase, handler);
}

export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

/*
  Phase 6D.1 - every write route backed by one of the 5 idempotency-key-
  aware SQL RPCs requires this header; a request without it gets 400
  before touching the database (the header exists so the SAME key can
  be re-sent by the caller after a network failure/timeout, matching
  the RPC's own dedup contract - see career_idempotency_keys in
  supabase/migrations/20260806020000_career_memory_transaction_idempotency.sql).
*/
export function requireIdempotencyKey(request: Request): { ok: true; key: string } | { ok: false; response: NextResponse } {
  const key = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (!key || key.trim().length === 0) {
    return { ok: false, response: NextResponse.json({ error: { code: "VALIDATION_FAILED", message: `"${IDEMPOTENCY_KEY_HEADER}" header is required.` } }, { status: 400, headers: { "cache-control": "no-store" } }) };
  }
  if (key.length > 200) {
    return { ok: false, response: NextResponse.json({ error: { code: "VALIDATION_FAILED", message: `"${IDEMPOTENCY_KEY_HEADER}" header must be 200 characters or fewer.` } }, { status: 400, headers: { "cache-control": "no-store" } }) };
  }
  return { ok: true, key };
}

/*
  Parses and size-guards the request body in one step - a request
  whose body exceeds MAX_REQUEST_BODY_BYTES or isn't valid JSON gets a
  structured 400/413, never an unhandled exception that would surface
  a raw parser error message.
*/
export async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_REQUEST_BODY_BYTES) {
    return { ok: false, response: NextResponse.json({ error: { code: "VALIDATION_FAILED", message: "Request body too large." } }, { status: 413 }) };
  }

  const text = await request.text();
  if (text.length > MAX_REQUEST_BODY_BYTES) {
    return { ok: false, response: NextResponse.json({ error: { code: "VALIDATION_FAILED", message: "Request body too large." } }, { status: 413 }) };
  }
  if (text.length === 0) return { ok: true, body: {} };

  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: NextResponse.json({ error: { code: "VALIDATION_FAILED", message: "Request body is not valid JSON." } }, { status: 400 }) };
  }
}
