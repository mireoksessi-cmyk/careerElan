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

  "career-insight" and "search-jobs" reuse the exact analyze-job/
  analyze-job-url policy (10/30 per RATE_LIMIT_WINDOW_SECONDS) - both are
  auth-only routes (no guest access), so their guest bucket is never
  actually reachable, but a value is still required by the Record<> shape
  above. The user tier mirrors analyze-job's because both are the same
  cost shape: one OpenAI call (career-insight) or one paid external API
  call (search-jobs, JSearch/RapidAPI) per invocation.
*/

export type RateLimitedEndpoint =
  | "analyze-job"
  | "analyze-job-url"
  | "career-insight"
  | "search-jobs"
  | "login-by-id";

export const RATE_LIMIT_WINDOW_SECONDS = 600; // 10 minutes

export const RATE_LIMITS: Record<
  RateLimitedEndpoint,
  { guest: number; user: number }
> = {
  "analyze-job": { guest: 10, user: 30 },
  "analyze-job-url": { guest: 10, user: 30 },
  "career-insight": { guest: 10, user: 30 },
  "search-jobs": { guest: 10, user: 30 },
  // Unauthenticated, account-enumeration-sensitive lookup - kept far
  // stricter than the AI/search endpoints above, which cost real
  // OpenAI/RapidAPI spend and only see logged-in-leaning traffic. This
  // route is always called by an anonymous visitor on the login screen,
  // so a tight guest bucket directly bounds how many login ids a single
  // caller can probe per window. The "user" value is structurally
  // required by the Record<> shape but not practically reachable - this
  // route never resolves a session - so it is set equally conservative
  // rather than left to invite a future authenticated caller to get a
  // looser limit than intended.
  "login-by-id": { guest: 5, user: 5 },
};
