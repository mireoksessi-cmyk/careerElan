/*
  Single source of truth for "where does the background generation worker
  live, and what secret gates it" - shared by the sync claim route
  (app/api/generate-package/route.ts, which calls it) and
  app/api/internal/generate-package-worker/route.ts (the local-dev target
  itself, which needs to accept the exact same secret this module hands
  the caller).

  Environment split is by isNetlifyRuntime() below, not NODE_ENV: `next
  start` sets NODE_ENV=production even when run purely locally, so
  NODE_ENV can't distinguish "really deployed on Netlify" from "local
  production-mode test server."

  isNetlifyRuntime() checks process.env.URL / SITE_ID / NETLIFY (in that
  priority order) rather than process.env.NETLIFY alone: per the
  "package worker runtime diagnostics" investigation, Netlify's official
  docs confirm URL/SITE_NAME/SITE_ID are available to a serverless
  function's runtime, while NETLIFY/CONTEXT are documented only as
  build-time variables - a Next.js Route Handler on Netlify runs as a
  serverless function, so relying on NETLIFY alone risked silently
  evaluating false in real Production and routing requests to the
  local-dev-only stand-in route instead of the real Background Function.
  Deliberately a function, not a module-level constant snapshot: it must
  reflect the actual runtime environment at the moment each request is
  handled, not whatever process.env looked like when this module was
  first imported.

  Deliberately no "@/..." imports anywhere in this file - it's imported
  by app/api/generate-package/route.ts (a normal Next.js route, alias
  always resolves there) but its own zero-dependency design also makes it
  safe to import (via a relative path) from netlify/functions/*.ts, whose
  bundler is a separate build step from `next build` and may not resolve
  that alias the same way.
*/

export type NetlifyRuntimeDetectedBy = "URL" | "SITE_ID" | "NETLIFY" | "none";

/*
  Priority order matches the official runtime-availability split: URL and
  SITE_ID are confirmed available to a serverless function's runtime,
  while a plain NETLIFY=="true" check is kept last as a narrower backstop
  (it's the one build-time-documented signal that also happens to often
  be readable at runtime in practice, per this codebase's earlier
  diagnostics) rather than the sole signal.
*/
export function detectNetlifyRuntimeSource(): NetlifyRuntimeDetectedBy {
  if (process.env.URL) return "URL";
  if (process.env.SITE_ID) return "SITE_ID";
  if (process.env.NETLIFY === "true") return "NETLIFY";
  return "none";
}

export function isNetlifyRuntime(): boolean {
  return detectNetlifyRuntimeSource() !== "none";
}

/*
  Only ever read when isNetlifyRuntime() is false. The one route this
  secret gates (app/api/internal/generate-package-worker) 404s
  unconditionally whenever isNetlifyRuntime() is true (see that route's
  own guard), so this constant being visible in source is not a real
  secret exposure in any deployed environment - it only ever matters on a
  developer's own machine.
*/
const LOCAL_DEV_FALLBACK_SECRET =
  "local-dev-generate-package-worker-secret";

/*
  Netlify: requires BACKGROUND_FUNCTION_SECRET to be explicitly set - no
  fallback, since this gates a real internet-reachable endpoint there.
  Local: falls back to the fixed dev-only constant above so Generate
  Package works out of the box with zero required env configuration,
  while still allowing BACKGROUND_FUNCTION_SECRET to override it locally
  if a developer wants to.
*/
export function resolveBackgroundFunctionSecret(): string | null {
  if (isNetlifyRuntime()) {
    return process.env.BACKGROUND_FUNCTION_SECRET || null;
  }

  return (
    process.env.BACKGROUND_FUNCTION_SECRET ||
    LOCAL_DEV_FALLBACK_SECRET
  );
}

export type BackgroundFunctionOriginSource = "URL" | "request_origin";

export type BackgroundFunctionUrlResolution = {
  url: string;
  originSource: BackgroundFunctionOriginSource;
};

/*
  Reduces a raw env var value to a bare "protocol//host" origin - no
  path, query, hash, or trailing slash - or null if it isn't a usable
  http(s) URL at all. Used for process.env.URL specifically: it's a
  Netlify-controlled value, not user input, but normalizing it the same
  defensive way avoids ever concatenating something malformed (or a
  future accidental path/query suffix) into the Background Function URL.
*/
function normalizeToOrigin(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/*
  On Netlify, prefers process.env.URL over the current request's own
  origin - this is what actually closes the "IS_NETLIFY_RUNTIME false in
  Production" failure mode: even if a future runtime-detection signal
  regresses, resolving the target origin from Netlify's own advertised
  URL (when available) rather than solely trusting isNetlifyRuntime()'s
  branch keeps the enqueue call pointed at the real Background Function
  endpoint. Falls back to requestOrigin when process.env.URL is absent or
  fails to parse as an http(s) URL.

  Known residual risk (not solved by this change - flagged, not guessed
  around): official Netlify docs describe URL as the site's main/
  production URL, which may not vary by deploy context the way a Deploy
  Preview's own subdomain would. If Deploy Preview logins ever need to
  reach that preview's own Background Function build (not Production's),
  this preference could misroute. requestOrigin remains the fallback for
  exactly that reason; DEPLOY_PRIME_URL/DEPLOY_URL were not adopted here
  because Netlify's official docs document them as build-time-only, not
  confirmed available to a serverless function's runtime.
*/
export function resolveBackgroundFunctionUrl(
  requestOrigin: string
): BackgroundFunctionUrlResolution {
  if (isNetlifyRuntime()) {
    const netlifyOrigin = process.env.URL
      ? normalizeToOrigin(process.env.URL)
      : null;

    return netlifyOrigin
      ? {
          url: `${netlifyOrigin}/.netlify/functions/generate-package-background`,
          originSource: "URL",
        }
      : {
          url: `${requestOrigin}/.netlify/functions/generate-package-background`,
          originSource: "request_origin",
        };
  }

  return {
    url: `${requestOrigin}/api/internal/generate-package-worker`,
    originSource: "request_origin",
  };
}

/*
  Generalized sibling of resolveBackgroundFunctionUrl() above, for other
  Netlify Background Functions that need the exact same runtime-detection/
  origin-resolution logic (currently: analyze-resume-background - see
  lib/documentAnalysis/). Deliberately a separate function rather than a
  refactor of resolveBackgroundFunctionUrl itself: that function's own
  call site (app/api/generate-package/route.ts) is already verified in
  Production, and this module's whole purpose is precisely to avoid ever
  risking that path - see this file's own top docstring on why even its
  zero-dependency design exists to be safe to import from more places,
  not to be edited in place.
*/
export function resolveNamedBackgroundFunctionUrl(
  requestOrigin: string,
  netlifyFunctionName: string,
  localWorkerRoutePath: string
): BackgroundFunctionUrlResolution {
  if (isNetlifyRuntime()) {
    const netlifyOrigin = process.env.URL
      ? normalizeToOrigin(process.env.URL)
      : null;

    return netlifyOrigin
      ? {
          url: `${netlifyOrigin}/.netlify/functions/${netlifyFunctionName}`,
          originSource: "URL",
        }
      : {
          url: `${requestOrigin}/.netlify/functions/${netlifyFunctionName}`,
          originSource: "request_origin",
        };
  }

  return {
    url: `${requestOrigin}${localWorkerRoutePath}`,
    originSource: "request_origin",
  };
}

/*
  Diagnostics-only (see the "package worker runtime diagnostics"
  investigation) - never used for any control-flow decision, only for
  structured logging so a real Production request can be traced across
  the Next.js route, the Netlify Background Function, and the local-dev
  stand-in route without duplicating this env-var-shape logic three
  times. Deliberately reports presence/shape only, never a secret value -
  CONTEXT is the one non-secret enum Netlify itself defines, safe to log
  verbatim once normalized to its known set of values.
*/
export type NetlifyContextValue =
  | "production"
  | "deploy-preview"
  | "branch-deploy"
  | "dev"
  | "missing";

function normalizeNetlifyContext(
  value: string | undefined
): NetlifyContextValue {
  if (
    value === "production" ||
    value === "deploy-preview" ||
    value === "branch-deploy" ||
    value === "dev"
  ) {
    return value;
  }

  return "missing";
}

export function getRuntimeDiagnosticsSnapshot() {
  return {
    netlifyEnvPresent: typeof process.env.NETLIFY === "string",
    netlifyEnvIsTrue: process.env.NETLIFY === "true",
    contextPresent: typeof process.env.CONTEXT === "string",
    contextValue: normalizeNetlifyContext(process.env.CONTEXT),
    urlEnvPresent: Boolean(process.env.URL),
    siteIdPresent: Boolean(process.env.SITE_ID),
  };
}
