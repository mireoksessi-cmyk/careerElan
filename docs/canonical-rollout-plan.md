# Canonical Career Memory — Progressive Rollout Plan

Status: Phase 6H. All stages below are flag-flip only — no code deploy is required to move between stages once this phase's code is in Production.

## Prerequisite honesty note

Stage 3 and beyond assume percentage-based routing of **real user traffic** into canonical generation. Today, no code path routes any real user's "Generate Package" click into canonical at all — the only fetch call to a generate-package endpoint anywhere in the app is `app/paste-job/page.tsx` → `/api/generate-package` (legacy). Canonical is reachable only via its own internal routes, used so far by internal test/canary scripts and the dev-only `/canonical-career/*` inspector pages. **Building that traffic-routing mechanism is explicitly out of scope for Phase 6H** (would be new user-visible feature work). Stages 0–2 are fully executable today with existing code. Stages 3–6 are the *target* plan for percentage rollout but require a routing mechanism (e.g., a client-side or server-side split in the paste-job Generate flow) to be built in a future phase before they can begin. This is called out again in `docs/canonical-known-issues.md`.

## Stage 0 — All flags OFF (current Production state)

- **Enable flags:** none. `CANONICAL_GENERATE_ENABLED`, `CANONICAL_SHADOW_MODE`, `CANONICAL_TEMPLATE_SELECTOR_ENABLED`, `CANONICAL_LEGACY_FALLBACK_ENABLED`, `CANONICAL_DOCUMENT_STORAGE_ENABLED` all unset.
- **Success metric:** legacy `/api/generate-package` traffic and error rate unchanged from pre-Phase-6 baseline (canonical code is unreachable in Production, so it cannot regress anything).
- **Rollback trigger:** N/A — this is the rollback target for every later stage.
- **Monitoring:** none canonical-specific; legacy dashboards only.
- **Expected traffic:** 0% canonical.
- **Duration:** indefinite baseline; this is where Production sits today and where it stays until Stage 1 is explicitly approved.

## Stage 1 — Internal developers only

- **Enable flags:** `CANONICAL_GENERATE_ENABLED=true` in Production, scoped by manual routing (developer hits the internal API routes directly, e.g. via `curl`/Postman against `/api/internal/canonical-generate-package/generate` with their own session token, or via the dev-only `/canonical-career/*` pages if those are ever exposed outside dev — today those pages are not gated by `isNetlifyRuntime()` the same way the API routes are, so confirm they 404 or require auth in Production before this stage, or restrict to non-Production access only). `CANONICAL_DOCUMENT_STORAGE_ENABLED=true` (so persistence is exercised for real). `CANONICAL_LEGACY_FALLBACK_ENABLED=true`.
- **Success metric:** every developer-triggered generation reaches `outcome:"success"` in the `canonical_generate` metric log; zero `persistence_failed`/`template_rendering_failed` on the 4 template types tested in Phase 6F/6G.
- **Rollback trigger:** any single `outcome:"error"` with `errorCode` other than a caller mistake (`validation_failed`) — investigate before continuing.
- **Monitoring:** manual tail of `canonical_generate`/`canonical_preview`/`canonical_status` log lines (Netlify Function Logs) during each test run.
- **Expected traffic:** a handful of manual requests from the engineering team, no real users involved.
- **Required duration:** at least 1 full manual pass covering all 4 templates × both paper sizes, minimum 1 day of no-error soak before advancing.

## Stage 2 — Internal employees (dogfooding)

- **Enable flags:** same as Stage 1, plus this is the first stage where a small, known set of real (employee) `auth.users` accounts use it — access still requires manually hitting the internal routes or a temporary internal-only entry point (no public UI wiring exists yet), so this stage is realistically limited to employees comfortable using the API directly or via the dev inspector, until a UI entry point is built.
- **Success metric:** `canonical_generate` success rate ≥ 95% across all employee-triggered attempts; `pdfPersisted`/`docxPersisted` both `true` on every success; zero cross-user RLS violations (verified via the existing canary test's ownership assertions, re-run manually against real employee accounts).
- **Rollback trigger:** success rate < 95% over any 10-attempt window, or any RLS/ownership violation (auto-rollback trigger — treat as a P0).
- **Monitoring:** same log-based monitoring as Stage 1, now watched over a longer window; start tracking latency P50/P95 from the logged `latencyMs` field.
- **Expected traffic:** low tens of requests over the stage duration, all from identified internal accounts.
- **Required duration:** minimum 3–5 business days of dogfooding with no P0 rollback trigger before advancing.

## Stage 3 — 1% of real users

- **Blocked today** — requires the traffic-routing mechanism described in the prerequisite note above (not built this phase) plus a quota-metering decision (canonical currently has zero quota enforcement — see Known Issues; shipping 1% of real traffic through an unmetered generation path is a cost/abuse risk that should be explicitly accepted or closed before this stage begins).
- **Enable flags (once unblocked):** all Stage 2 flags remain on; the routing mechanism itself decides which 1% of requests go to canonical vs legacy.
- **Success metric:** canonical success rate within 2 percentage points of legacy's own baseline success rate over the same window; latency P95 no more than 2× legacy P95 (canonical's synchronous execution model — see Architecture doc §5 — makes this the metric most likely to reveal a Netlify timeout risk).
- **Rollback trigger:** success rate drop > 2pp vs legacy, P95 latency regression beyond the 2× threshold, or any fallback-rate spike (`fallback_used=true` on `applications`) beyond a to-be-set baseline.
- **Monitoring:** `canonical_generate` success/error rate and P50/P95/P99 latency, broken out from legacy's own dashboard (see Monitoring Dashboard doc); fallback-rate tracked via `applications.fallback_used`.
- **Expected traffic:** ~1% of legacy's current daily Generate Package volume.
- **Required duration:** minimum 1–2 weeks, long enough to observe weekday/weekend traffic variance.

## Stage 4 — 10% of real users

- **Enable flags:** unchanged from Stage 3; only the routing percentage changes.
- **Success metric:** same thresholds as Stage 3, now required to hold at 10× the traffic volume — specifically watch for the synchronous-execution timeout risk (Architecture doc §5) becoming visible under concurrency that wasn't present at 1%.
- **Rollback trigger:** same as Stage 3, plus: any observed Netlify function timeout on the canonical generate route (a new failure mode that 1% traffic may not have surfaced).
- **Monitoring:** same metrics as Stage 3; add concurrency/queueing observation if available at the platform level.
- **Expected traffic:** ~10% of legacy's daily volume.
- **Required duration:** minimum 2 weeks.

## Stage 5 — 50% of real users

- **Enable flags:** unchanged; routing percentage only.
- **Success metric:** parity with legacy within 1 percentage point (tighter bar than Stage 3/4, since this stage is a genuine A/B split at scale).
- **Rollback trigger:** same category of triggers as Stage 4, at the tighter 1pp threshold.
- **Monitoring:** full dashboard (Monitoring doc) actively watched by on-call, not just periodically reviewed.
- **Expected traffic:** ~50% of legacy's daily volume.
- **Required duration:** minimum 2–3 weeks, including at least one full billing/reporting cycle if usage is ever tied to cost accounting.
- **Additional gate:** revisit the quota gap (Known Issues) before this stage — at 50% real traffic, unmetered generation is a materially larger cost/abuse exposure than at 1–10%.

## Stage 6 — 100% (canonical becomes primary)

- **Enable flags:** unchanged; routing percentage set to 100%. Consider this the point where `CANONICAL_LEGACY_FALLBACK_ENABLED` remains `true` as a permanent safety net (per product spec's own stated default), not turned off — legacy stays as the fallback target indefinitely, not just during rollout.
- **Success metric:** sustained parity with the pre-cutover legacy baseline for at least the full duration below, with fallback rate trending down over time (fewer canonical failures needing legacy rescue).
- **Rollback trigger:** any sustained (multi-hour) success-rate or latency regression; full stage-by-stage rollback capability (Rollback Runbook) must remain tested and ready even after reaching 100%.
- **Monitoring:** full dashboard, standard on-call rotation.
- **Expected traffic:** 100% of Generate Package volume.
- **Required duration:** indefinite — this is the terminal state, not a time-boxed stage. Legacy code and its background-function infrastructure should NOT be deleted at this point without a separate, explicit deprecation decision (out of scope here).

## Cross-stage constants

- Every stage keeps `CANONICAL_LEGACY_FALLBACK_ENABLED=true` from Stage 1 onward — canonical failures fall back to the legacy path rather than surfacing a hard error to the user, at every traffic level.
- Rolling back from any stage to Stage 0 requires only flipping `CANONICAL_GENERATE_ENABLED` (and, if desired, the other 4 flags) back off — no database rollback, verified in `docs/canonical-rollback-runbook.md`.
