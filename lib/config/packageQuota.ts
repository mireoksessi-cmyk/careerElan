/*
  Lifetime (not monthly/daily) Generate Package quota for Production only.
  Deliberately unrelated to the pre-existing FREE_PACKAGE_LIMIT/
  packagesThisMonth display in app/dashboard/page.tsx - that is a
  client-computed, unenforced monthly stat used purely for a dashboard
  widget. This constant backs a server-enforced, per-account, all-time cap.
*/
export const GENERATE_PACKAGE_LIFETIME_LIMIT = 5;

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
