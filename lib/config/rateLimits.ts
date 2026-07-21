/*
  Phase 1-C: rate limits for the two guest-allowed AI analysis endpoints
  (/api/analyze-job, /api/analyze-job-url). Each endpoint is its own bucket
  - using up the analyze-job quota does not affect analyze-job-url, and
  vice versa. No per-user custom limits or admin UI in this phase; these
  are the only two policy knobs.

  RateLimitedEndpoint is declared explicitly (not derived from
  RATE_LIMITS's keys) so the set of endpoints this feature is allowed to
  rate-limit is its own contract - RATE_LIMITS is required to have exactly
  these keys via the Record<> annotation, rather than the other way
  around. Nothing outside this module ever passes an arbitrary string as
  an endpoint value.
*/

export type RateLimitedEndpoint = "analyze-job" | "analyze-job-url";

export const RATE_LIMIT_WINDOW_SECONDS = 600; // 10 minutes

export const RATE_LIMITS: Record<
  RateLimitedEndpoint,
  { guest: number; user: number }
> = {
  "analyze-job": { guest: 10, user: 30 },
  "analyze-job-url": { guest: 10, user: 30 },
};
