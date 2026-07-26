/*
  Single source of truth for "where does the background generation worker
  live, and what secret gates it" - shared by the sync claim route
  (app/api/generate-package/route.ts, which calls it) and
  app/api/internal/generate-package-worker/route.ts (the local-dev target
  itself, which needs to accept the exact same secret this module hands
  the caller).

  Environment split is by process.env.NETLIFY, not NODE_ENV: `next start`
  sets NODE_ENV=production even when run purely locally, so NODE_ENV can't
  distinguish "really deployed on Netlify" from "local production-mode
  test server." NETLIFY is set by Netlify's own build/runtime environment
  and nowhere else - the same signal already used by
  lib/config/packageQuota.ts's isNetlifyProductionRuntime() for the
  Production-only quota gate.

  Deliberately no "@/..." imports anywhere in this file - it's imported
  by app/api/generate-package/route.ts (a normal Next.js route, alias
  always resolves there) but its own zero-dependency design also makes it
  safe to import (via a relative path) from netlify/functions/*.ts, whose
  bundler is a separate build step from `next build` and may not resolve
  that alias the same way.
*/

export const IS_NETLIFY_RUNTIME = !!process.env.NETLIFY;

/*
  Only ever read when IS_NETLIFY_RUNTIME is false. The one route this
  secret gates (app/api/internal/generate-package-worker) 404s
  unconditionally whenever IS_NETLIFY_RUNTIME is true (see that route's
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
  if (IS_NETLIFY_RUNTIME) {
    return process.env.BACKGROUND_FUNCTION_SECRET || null;
  }

  return (
    process.env.BACKGROUND_FUNCTION_SECRET ||
    LOCAL_DEV_FALLBACK_SECRET
  );
}

/*
  Derived from the current request's own origin rather than a configured
  BACKGROUND_FUNCTION_URL env var - avoids needing to know a Netlify
  Deploy Preview's own URL in advance, and avoids requiring an env var
  just for Generate Package to work locally.
*/
export function resolveBackgroundFunctionUrl(
  requestOrigin: string
): string {
  return IS_NETLIFY_RUNTIME
    ? `${requestOrigin}/.netlify/functions/generate-package-background`
    : `${requestOrigin}/api/internal/generate-package-worker`;
}
