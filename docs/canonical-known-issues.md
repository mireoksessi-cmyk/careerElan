# Canonical Career Memory — Remaining Known Issues

Status: Phase 6H. These are architectural gaps discovered during the Production Readiness Audit, not introduced this phase. Per this phase's explicit "no new features" constraint, none of these were built or fixed this round — they are documented here so the Rollout Plan and Release Recommendation are calibrated honestly against them.

## 1. No traffic-routing mechanism into canonical (blocks Rollout Plan Stage 3+)

The only "Generate Package" fetch call site anywhere in `app/` is `app/paste-job/page.tsx` → `/api/generate-package` (legacy). No code path routes any real user's click into the canonical `/generate` route. Canonical is reachable only via its own internal API routes and the dev-only `/canonical-career/*` inspector pages. Percentage-based rollout (Stage 3 onward) requires this to be built — a genuinely new user-facing feature, out of scope for this phase.

## 2. No quota mechanism for canonical generation

The legacy path meters usage via `generate_package_quota_reservations`/`generate_package_quota_periods`. Canonical was confirmed (via direct RPC testing across Phase 6G/6G.1/6H) to consume zero quota — no reservation, no counter, nothing. Shipping any percentage of real traffic through an unmetered AI-generation path is a cost/abuse exposure that should be explicitly accepted or closed before Rollout Plan Stage 3+, especially Stage 5 (50%) and beyond.

## 3. Synchronous execution model, no background-job path

Unlike legacy's 202+Netlify-background-function pattern, `/api/internal/canonical-generate-package/generate` calls `generateCanonicalPackage()` synchronously in the request. Canonical generation latency is therefore bounded by whatever the Netlify Next.js Runtime function timeout is, with no async cushion. This risk is undocumented/unmeasured against Production's actual configured timeout — the same category of platform-level risk the legacy path's own Phase 4 work flagged for itself, never independently re-verified for canonical specifically.

## 4. Fallback-decision wrapper not wired into the production route

`runCanonicalWithFallbackDecision<T>()` (`canonicalGenerationFallbackService.ts`) exists and is unit-tested, but `app/api/internal/canonical-generate-package/generate/route.ts` does not call it — the route calls `generateCanonicalPackage()` directly and lets any thrown error propagate as an HTTP error. `CANONICAL_LEGACY_FALLBACK_ENABLED` therefore currently has no effect on the production route's actual behavior, even when set to `true`. This means the Rollout Plan's assumption that "canonical failures fall back to legacy" is **not yet true in code** — it's the intended design, not the current implemented behavior. This is the single most important gap to close before Stage 3, arguably more urgent than the quota gap, since it directly affects user-facing reliability.

## 5. No quota-accuracy monitoring possible

A direct consequence of #2 — the Monitoring Dashboard's "quota accuracy" metric (explicitly requested in the phase spec) cannot be populated until a quota mechanism exists for canonical.

## 6. Dev-only inspector pages (`/canonical-career/*`) — Production reachability not independently re-verified this phase

These pages are not gated by the same `isNetlifyRuntime()` + flag pattern the API routes use (that gate lives in `withCanonicalAuth`/`routeGuard.ts`, which only the internal API routes call). Before any Stage 1 rollout that assumes these pages are dev-only, confirm independently whether Next.js routing/middleware excludes them from the real Production build, or whether they'd need an explicit guard.

## Priority for a future phase (not this one)

If a future round is scoped to close these: #4 (fallback wiring) first — it's a bug in already-shipped design intent, cheapest to fix, and directly improves reliability at every rollout stage. #1 (traffic routing) and #2 (quota) are both prerequisites for Stage 3 and should be scoped together. #3 (synchronous execution) is the highest-effort item and may be acceptable to carry as a documented risk through Stage 2 rather than fixed outright, depending on real Netlify timeout data once available.
