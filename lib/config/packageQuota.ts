/*
  Phase 6I.6.23 - the CURRENT pre-launch policy value: 3 Generate Package
  uses per CALENDAR MONTH (UTC), enforced server-side, Production only.
  This is a compatibility/display constant, not the authoritative source
  of the limit - the real, per-user-resolved limit lives in the DB
  (supabase/migrations/20260725073100_generate_package_lifetime_quota.sql's
  resolve_generate_package_quota_limit(), which reads quota_plans via
  subscriptions and already defaults every user to the 'free' plan's
  monthly_generation_limit = 3). reserve_generate_package_usage()/
  get_generate_package_usage() ignore the p_limit parameter entirely
  (see that migration's own comment) and always resolve the limit
  themselves - so this constant only matters for: (a) the p_limit
  argument's required-but-unused value at each call site, and (b) a
  display fallback before the server's real /usage response has loaded.
  A future Pro tier needs NO change here or in the generation pipeline -
  only a real 'pro' row in public.subscriptions - see docs referenced in
  this phase's final report for the full future-extension path.

  Deliberately unrelated to the pre-existing FREE_PACKAGE_LIMIT/
  packagesThisMonth display in app/dashboard/page.tsx - that is a
  separate, client-computed, UNENFORCED monthly stat used purely for a
  dashboard widget when the real quota isn't available (e.g. outside
  Production).
*/
export const GENERATE_PACKAGE_MONTHLY_LIMIT = 3;

/*
  How long a "reserved" quota row is honored before it's treated as
  abandoned (server crashed/killed before it could mark the row completed
  or released) and no longer counted against the live limit. Mirrors
  app/api/generate-package/route.ts's own PENDING_STALE_THRESHOLD_MS
  (3 * OPENAI_CALL_TIMEOUT_MS = 180s) - kept as a separate literal here
  rather than importing that route-local constant, since the two are only
  conceptually related, not required to change in lockstep.
*/
export const GENERATE_PACKAGE_QUOTA_STALE_SECONDS = 180;

/*
  Netlify sets NETLIFY="true" for every build/runtime it manages, and
  CONTEXT to "production" | "deploy-preview" | "branch-deploy" (and
  "dev" under `netlify dev`). Both are server-only env vars set by the
  platform itself - never derived from a request header, query param, or
  request body, none of which a client can influence. `next build`/
  `next start` run locally never set NETLIFY, so this is false there
  regardless of NODE_ENV (NODE_ENV alone is not a safe signal: it is
  "production" for a local `next build`/`next start` too).
*/
export function isNetlifyProductionRuntime(): boolean {
  return (
    process.env.NETLIFY === "true" &&
    process.env.CONTEXT === "production"
  );
}
