# Production Monitoring Runbook (Phase 6I.6.36)

Operator-facing runbook for Career Élan's observability foundation. Scope: operational
health (is the system working?), not business analytics and not an Admin Dashboard UI
(both explicitly out of scope for this phase - see "Not built" below).

## 1. What exists today

| Layer | Where | What it gives you |
|---|---|---|
| Safe error responses | `lib/errors/publicError.ts` (`logSafeError`/`toSafeResponse`) | One safe JSON line per caught error: `{requestId, route, userId, generationRequestId, message}`. Pre-dates this phase. |
| Canonical generation metrics | `lib/careerMemory/orchestration/canonicalProductionMetrics.ts` (`logCanonicalMetric`) | Success/error/latency/fallback events for the canonical Generate Package pipeline specifically, with a closed `CanonicalErrorCode` enum. Pre-dates this phase. |
| **General operational events (this phase)** | `lib/observability/logger.ts` (`logOperationalEvent`) | One JSON line per event across auth, upload, analyze-job, quota, background-worker, OpenAI calls, and storage - domains the two helpers above didn't cover. |
| **Health aggregation helpers (this phase)** | `lib/observability/health.ts` | Read-only, aggregate-only counts: stuck-pending generations, recent success/failure rate. No public endpoint (see §7). |

All three logging layers write **one JSON line to stdout via `console.log`/`console.error`
- no new transport, no new service.** In Production (Netlify), stdout is already captured
by Netlify Function Logs - this is not new plumbing, it's the same mechanism the two
pre-existing layers already rely on.

## 2. How to actually look at logs today

**Netlify Dashboard -> Site -> Logs -> Functions.** Filter by function name (the route
path, e.g. `generate-package`, `analyze-job-url`) and time range. Every line this phase
adds is valid JSON with a `domain` and `event` field - paste a line into any JSON viewer,
or `grep '"domain":"openai"'` a downloaded log export, to filter by category.

There is no log aggregation service (Datadog, Better Stack, etc.) wired up. If log volume
or retention becomes a real problem, that's a separate, later decision - not silently
assumed here.

## 3. Answering the 12 operational questions

| Question | How to answer it today |
|---|---|
| Is Generate Package working right now? | Filter Netlify Function Logs for the `canonical-generate-package-worker`/`generate-package-worker` functions, `event:"canonical_generate"` lines (`logCanonicalMetric`) - `outcome` field. |
| Is OpenAI responding / slow? | `domain:"openai"` lines from `logOperationalEvent` - `event:"call_started"/"call_succeeded"/"call_failed"/"call_retried"`, `latencyMs` field. |
| Are uploads failing? | `domain:"upload"` lines - `event:"resume_analysis_failed"`/`"cover_letter_analysis_failed"`, `errorCode` field. |
| Is Analyze Job failing? | `domain:"analyze_job"` lines, `route` + `errorCode` fields. |
| Is the background worker enqueueing successfully? | `domain:"background_worker"` lines - `event:"enqueued"` vs `"enqueue_failed"`. |
| Are generations getting stuck? | Run `getStuckPendingGenerationsHealth()` (see §6) or watch for `event:"stale_pending_reclaimed"` lines (a reclaim already happened, meaning one WAS stuck). |
| Is quota being denied a lot? | `domain:"generate_package"`, `event:"quota_denied"` lines. |
| Are documents actually being stored (PDF/DOCX)? | `domain:"storage"` lines - `event:"document_persisted"` vs `"document_persist_skipped"` (+ `reason`). |
| Are logins failing? | `domain:"auth"` lines - `event:"login_failed"`, `reason` field. |
| What's the overall error rate right now? | Run `getRecentGenerationOutcomeHealth(windowMinutes)` (see §6). |
| Which route is slow? | `domain:"api_latency"` lines where wired (see §8 gap), or the `latencyMs` field on any domain event above. |
| Did a specific request succeed or fail? | Every event and every `logSafeError`/`toSafeResponse` call carries `requestId`/`generationRequestId` - grep by that id to trace one request end-to-end across layers. |

## 4. Event catalog (this phase)

See `lib/observability/logger.ts` for the exact typed shape of every event - the file
itself is the authoritative contract. Domains: `auth`, `upload`, `analyze_job`,
`generate_package`, `openai`, `background_worker`, `render`, `storage`, `api_latency`.

## 5. PII safety

Every typed event field is a safe identifier/enum/number by construction - there is no
field on any event variant that free-form resume/job/cover-letter/email text could land
in. The optional `metadata` escape hatch (used at only a few call sites) is passed through
`redact()` before logging, which strips (case-insensitively, at any nesting depth):

```
resumeText, resume_text, coverLetter, cover_letter_text, jobText, job_text,
emailDraft, email_draft, password, token, access_token, refresh_token,
authorization, cookie, apiKey, serviceRoleKey, email, fullName, phone,
message, stack, details, hint, prompt
```

Long string values (>300 chars) are truncated regardless of key name, as a second layer
of defense against an unexpectedly large field slipping through.

**Part Z audit finding (fixed this phase):** 8 pre-existing raw `console.error(label,
errorObject)` calls dumped a caught Supabase/Node error object directly to stdout instead
of extracting just `.message` (the established safe convention in `publicError.ts`).
Fixed in `lib/documentAnalysis/resumeAnalysisCore.ts` (3 call sites),
`lib/documentAnalysis/coverLetterAnalysisCore.ts` (4 call sites), and
`app/auth/callback/route.ts` (5 call sites, one of which was also a pure duplicate of an
already-safe log two lines below it and was removed rather than fixed). A ninth,
client-side-only instance in `lib/auth/auth.ts` was narrowed to `.message` as well
(lower severity - it only ever reaches the user's own browser console, never a server
log - but still worth matching the convention). None of the 9 were proven to have ever
leaked resume/job/cover-letter text specifically (they were all Supabase/module-load
error objects, not user-content variables), but all could have echoed internal
Postgres constraint/schema detail (`.details`/`.hint`) that the codebase's own convention
says never to log.

## 6. Health helpers (no UI, no public endpoint)

`lib/observability/health.ts` exports:

- `getStuckPendingGenerationsHealth()` - count + oldest age of `applications` rows stuck
  at `generation_status='pending'` past the same 5-minute threshold
  (`WORKER_STALE_THRESHOLD_MS`) the reclaim logic in
  `canonicalGenerateDispatchService.ts` already uses.
- `getRecentGenerationOutcomeHealth(windowMinutes)` - succeeded/failed/pending counts and
  error rate over a rolling window.

Both are plain async functions, callable from a one-off script (`npx tsx`, using
`supabaseAdmin`) or a future authenticated admin route. **Not exposed as a public HTTP
endpoint** - see §7.

A third helper, a stale-quota-reservation count, was drafted and then removed - see
§9's `OBSERVABILITY_SCHEMA_CHANGE_REQUIRED` entry.

## 7. Admin auth gap

`ADMIN_AUTH_REQUIRED_FOR_MONITORING_UI`: this codebase has no admin-authentication
mechanism today (confirmed by this phase's own Admin/User Operations Data Readiness
audit - no `is_admin` flag, no admin role, no admin-gated route anywhere). Building a
monitoring dashboard or a public health-check endpoint would need one first. Out of
scope for this phase (which is monitoring plumbing, not the Admin Dashboard - see
"Not built" below) - the health helpers above are ready to be wired into one once it
exists.

## 8. Known coverage gaps (disclosed, not silently dropped)

- **DB query latency** and **generic per-route API latency** are not broadly instrumented.
  A `logOperationalEvent({domain:"api_latency", ...})` shape exists and is wired at the
  two Analyze Job routes; extending it to every route (Generate Package, uploads, etc.)
  was judged lower-value than the domain-specific success/failure/latency events already
  wired at each of those routes' own natural instrumentation points (e.g. the OpenAI
  call events already carry latency for the AI-heavy paths) - revisit if a specific route
  needs its own latency alert.
- **Retry-attempt-level detail for the legacy (non-canonical) Generate Package engine**
  (`lib/generatePackage/generateCore.ts`) was not separately instrumented with the new
  logger - it already has its own detailed `generation_stage`/timing columns written
  directly to the `applications` row (Phase 3/4-era work), which serves the same purpose
  through a different, pre-existing mechanism.
- **Client-side (browser) monitoring** was explicitly out of scope per this phase's own
  instructions (no session replay, no keystroke recording) and was not added.

## 9. Stop conditions encountered

- **`OBSERVABILITY_SCHEMA_CHANGE_REQUIRED`**: a stale-quota-reservation count helper was
  drafted, then removed after a live test proved `public.generate_package_quota_reservations`
  revokes all direct access from every role except its own `SECURITY DEFINER` RPCs
  (`supabase/migrations/20260725073100_generate_package_lifetime_quota.sql:305`). None
  of the existing RPCs (`reserve`/`complete`/`release`/`reclaim_generate_package_usage`)
  expose a plain count. Answering "how many reservations are currently stale" safely
  would require a new read-only `SECURITY DEFINER` RPC - a genuine schema change, not
  added in this phase per its own "no silent schema migration" rule. If this metric is
  needed later, add a migration for a `count_stale_generate_package_quota_reservations()`
  function (mirroring `reclaim_generate_package_quota_reservations()`'s own threshold
  logic) rather than granting direct table access, which would weaken an intentional
  lockdown.
- **`ADMIN_AUTH_REQUIRED_FOR_MONITORING_UI`**: see §7. Not a hard stop for this phase
  (no UI was in scope), but blocks a future public monitoring endpoint.
- **`SENTRY_REMOTE_CONFIGURATION_REQUIRED`**: see §10. Sentry was evaluated, found
  compatible, but not installed - no DSN exists to configure, and one cannot be
  fabricated.

## 10. Sentry decision

**Not installed in this phase.** Findings:

- `@sentry/nextjs` (current version, checked live) officially supports Next.js `^16.0.0-0`
  - compatible with this repo's installed `next@16.2.9`. Compatibility is not the blocker.
- The standard setup (`npx @sentry/wizard@latest -i nextjs`) requires a real Sentry DSN at
  init time and a `SENTRY_AUTH_TOKEN` for build-time source-map upload. **Neither exists in
  this codebase or environment**, and per this phase's explicit instruction, a DSN must
  never be fabricated.
- The wizard also wraps `next.config.ts` with `withSentryConfig` and adds
  `instrumentation.ts`/`instrumentation-client.ts`/`sentry.server.config.ts`/
  `sentry.edge.config.ts`/`app/global-error.tsx` - a real change to the build pipeline
  on a Netlify-deployed app that has never run any of this before, with no way to verify
  end-to-end (no Sentry project to send a test event to).

**Decision: do not install now.** The structured-logger approach in this phase (stdout
JSON, already captured by Netlify Function Logs) is safe, proportionate, and requires
zero new credentials or build-pipeline changes - a better fit for "genuinely safe and
proportionate" than installing an inert, unverifiable SDK. If/when a real Sentry account
+ DSN + auth token exist, revisit with this checklist:

**Manual setup checklist (when a DSN becomes available):**
1. Create a Sentry project (Next.js platform), copy its DSN.
2. Add `SENTRY_DSN` (client + server, or split public/private DSNs per Sentry's current
   docs) and `SENTRY_AUTH_TOKEN` (source-map upload, build-time only) to Netlify
   environment variables - **never commit these**.
3. Run `npx @sentry/wizard@latest -i nextjs` and review every generated file before
   committing (do not blindly accept defaults - set `sendDefaultPii: false` explicitly,
   scrub `Authorization`/`Cookie` headers in `beforeSend`, and disable session replay
   unless a separate decision explicitly turns it on).
4. Set a release identifier from `process.env.COMMIT_REF` (Netlify's own build-time env
   var - already used nowhere else in this repo, confirm it's actually populated in a
   real Netlify build before relying on it) rather than inventing a new versioning scheme.
5. Verify no E2E run ever sends a real event: `CAREER_ELAN_E2E=1` must gate
   `Sentry.init()` the same way it already gates `wrapOpenAiClientForE2eSafety()`
   (`lib/testing/e2eAiIsolation.ts`) - add this check explicitly, do not assume the SDK
   no-ops safely on its own.
6. Confirm source maps upload correctly and are NOT publicly served (Sentry's Next.js
   plugin handles this by default - verify, don't assume, especially given point 3 about
   build defaults).

**Source-map policy (whether or not Sentry is added):** Next.js's own production build
does not ship source maps to the client by default; this repo has not changed that
default (confirmed - no `productionBrowserSourceMaps: true` anywhere in `next.config.ts`).
Keep it that way unless Sentry (or another tool) is added and configured to upload maps
privately at build time rather than serve them publicly.

## 11. Alert policy (designed, not wired to a delivery channel)

No alerting service (PagerDuty, Slack webhook, email) is wired up in this phase - that
would be a new integration, out of scope. This section documents the **policy**
(thresholds + what should page vs. log) so it can be wired to a real channel later
without re-deriving the numbers.

| Signal | Threshold | Severity | Why |
|---|---|---|---|
| `REAL_AI_CALL_SAFETY_BREACH` (E2E-mode OpenAI call reaching the real network) | Any occurrence | Critical - page immediately | Already has a real, tested detector (`e2e/openaiNetworkWatch.cjs`) from Phase 6I.6.35/35B; this is a policy statement, not new code. |
| Generate Package error rate (`getRecentGenerationOutcomeHealth`) | >20% failed over a 30-min window with ≥5 terminal attempts | High | Matches this repo's own quota (3/month) - a real user's whole month's budget is small, so failures are proportionally expensive. |
| Stuck-pending generations (`getStuckPendingGenerationsHealth`) | count > 0 for >15 minutes straight (i.e., reclaim isn't keeping up) | High | The 5-minute reclaim threshold already exists; a persistently non-zero count means reclaim itself may be broken, not just one slow request. |
| `background_worker` `enqueue_failed` | >3 in a 10-minute window | High | A cluster of enqueue failures usually means the background function endpoint itself is unreachable (Netlify outage, misconfigured secret) - Phase 6I.6.33's own real production bug was exactly this class of failure. |
| `openai` `call_failed` rate | >30% of calls over a 15-min window | Medium | OpenAI-side degradation; the existing per-call retry (max 2 attempts) already absorbs transient blips, so a sustained elevated failure rate after retries is the real signal. |
| `storage` `document_persist_skipped` (reason `upload_failed`) | >2 in 30 minutes | Medium | Supabase Storage degradation; generation "succeeds" from the user's perspective but the document silently isn't saved. |
| `auth` `login_failed` (reason `oauth_exchange_failed`) | >10 in 10 minutes | Low/Medium | Could indicate an OAuth provider outage or a misconfigured redirect URL after a deploy (this exact class of bug was found and fixed in an earlier phase). |

Delivery mechanism (Slack webhook, email digest, PagerDuty) is intentionally
unspecified - wire whichever channel the team actually monitors once one is chosen; the
thresholds above are the reusable part.

## 12. Production environment checklist

- [ ] Confirm `OPENAI_API_KEY` is set in Netlify (already required by existing features -
      no new variable from this phase).
- [ ] No new environment variables are required by this phase's code (the logger/health
      modules read no env vars of their own).
- [ ] If Sentry is added later, add `SENTRY_DSN` + `SENTRY_AUTH_TOKEN` per §10 - not
      required now.
- [ ] Verify Netlify Function Logs retention/access matches what the team expects for
      incident investigation (a platform setting, not something this phase's code
      controls).

## 13. Not built (explicitly out of scope for this phase)

- Admin Dashboard UI (Phase 6I.6.37, per the round's own instruction).
- Business/usage analytics (registration trends, plan mix, feature adoption) - separate
  from operational health; see this phase's own Admin/User Operations Data Readiness
  audit for what's derivable when that phase happens.
- Any external log aggregation / alert delivery service.
- Sentry installation (see §10).
