import { isNetlifyRuntime } from "../generatePackage/backgroundTarget";

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
  Whether THIS runtime is explicitly authorized to enforce the real
  Generate Package quota against the Production database.

  Two independent signals, in this order:

  1. isNetlifyRuntime() (lib/generatePackage/backgroundTarget.ts) answers
     "am I running on Netlify at all", from URL/SITE_ID - the variables
     Netlify documents as available to a serverless function's RUNTIME. It
     deliberately does NOT answer "am I in Production": it is identically
     true for Deploy Previews and Branch Deploys.

  2. PACKAGE_QUOTA_PRODUCTION is the explicit per-deploy-context
     authorization, set in the Netlify UI with the Functions/Runtime scope
     (a netlify.toml declaration would carry only the Builds scope and so
     would be invisible here): "true" in Production, "false" in Deploy
     Previews, Branch deploys and Local development.

  Why not NETLIFY/CONTEXT, which this function used before: Netlify
  documents both as BUILD-time variables, and only URL/SITE_NAME/SITE_ID
  are available to a serverless function at runtime. A Next.js Route
  Handler on Netlify runs as a serverless function, so the old condition
  could never become true in Production - it silently disabled quota
  enforcement entirely. backgroundTarget.ts had already reached this same
  conclusion for its own detector; this function was never updated to
  match.

  Exact string comparison only - no trim, no case-folding, no truthiness.
  A typo such as "TRUE" must NOT authorize metering a real user's quota.

  Fail-closed: on Netlify with the value missing or unrecognized this
  throws rather than returning false. Returning false there would silently
  restore unlimited Generate Package usage - precisely the failure this
  function is being repaired for - so a loud configuration error is the
  safer outcome. Off Netlify (local dev, tests, any other host) the first
  guard returns false before the flag is ever consulted, so ordinary
  development needs no configuration at all, and a PACKAGE_QUOTA_PRODUCTION
  value accidentally copied into a local .env cannot start metering against
  Production.
*/
export class PackageQuotaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageQuotaConfigError";
  }
}

export function isNetlifyProductionRuntime(): boolean {
  /*
    MUST stay first. It is what keeps local development, tests, non-Netlify
    hosts and any accidental client-side call on the plain `false` path,
    where the flag is neither required nor read.
  */
  if (!isNetlifyRuntime()) {
    return false;
  }

  const value = process.env.PACKAGE_QUOTA_PRODUCTION;

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new PackageQuotaConfigError(
    "PACKAGE_QUOTA_PRODUCTION is missing or invalid in a Netlify runtime."
  );
}
