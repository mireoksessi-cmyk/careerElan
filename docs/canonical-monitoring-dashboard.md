# Canonical Career Memory — Monitoring Dashboard Specification

Status: Phase 6I. Extends the Phase 6H event catalogue with `canonical_routing_decision` and `canonical_fallback` (§2), and closes 2 of the 3 gaps the Phase 6H version of this document flagged: fallback rate and quota accuracy are now directly observable (§3). No dashboarding tool is wired up (out of scope; this remains a specification for whoever configures Netlify's log drain / an external log sink).

## 1. Log source

`lib/careerMemory/orchestration/canonicalProductionMetrics.ts`'s `logCanonicalMetric()` emits one JSON line per event to stdout, captured automatically by Netlify Function Logs for the 3 internal canonical routes (`generate`, `preview`, `status`). No new log transport was introduced — this reuses the exact mechanism `canonicalShadowComparisonService.ts` already established.

Verified this phase: re-running the existing real-DB route test suite (`phase6gCanonicalGeneratePackageRoutes.realdb.test.mts`) with the new logging wired in produces real, well-formed lines, e.g.:

```json
{"event":"canonical_preview","applicationId":"...","templateId":"professional-ats","format":"html","outcome":"success","latencyMs":960,"ts":"2026-08-07T11:03:07.734Z"}
```

## 2. Event schema

```ts
{ event: "canonical_generate", applicationId, templateId, outcome: "success"|"error", errorCode?, latencyMs, pdfPersisted?, docxPersisted? }
{ event: "canonical_preview",  applicationId, templateId, format: "html"|"pdf"|"docx", outcome, errorCode?, latencyMs }
{ event: "canonical_status",   applicationId, outcome, errorCode?, latencyMs }
// Phase 6I additions:
{ event: "canonical_routing_decision", route: "legacy"|"canonical", reason, stage }
{ event: "canonical_fallback", applicationId, reason, outcome: "legacy_succeeded"|"legacy_failed" }
```

`canonical_routing_decision` is logged at every `/api/generate-package` request, for both legacy- and canonical-routed traffic — this is the canary's own traffic-split observability (Canary Plan doc), deliberately unfiltered so the actual live split can be measured directly rather than inferred. `canonical_fallback` is logged once per fallback attempt, after the legacy handoff resolves (`canonicalGenerationWorker.ts`) — `outcome` reflects whether legacy's own subsequent attempt actually succeeded, not just whether the fallback was triggered.

`errorCode` is one of a closed 19-value enum (`validation_failed`, `not_found`, `conflict_stale_version`, `profile_unavailable`, `version_unavailable`, `deserialization_failed`, `tailoring_failed`, `overlay_validation_failed`, `template_rendering_failed`, `template_resolution_failed`, `generated_document_failed`, `persistence_failed`, `transaction_unavailable`, `schema_gap`, `authentication_required`, `authorization_denied`, `openai_timeout`, `openai_error`, `unknown`) — never a free-form error message. `applicationId`/`templateId` are safe identifiers (UUIDs / template slugs), never resume or job content.

## 3. Requested metric → log field mapping

| Requested metric | How to compute from logs |
|---|---|
| Generation success rate | `count(event=canonical_generate, outcome=success) / count(event=canonical_generate)` over a window |
| PDF success rate | `count(canonical_generate, outcome=success, pdfPersisted=true) / count(canonical_generate, outcome=success)` |
| DOCX success rate | same, `docxPersisted=true` |
| HTML success rate | `count(canonical_preview, format=html, outcome=success) / count(canonical_preview, format=html)` |
| Fallback rate | **Now directly in the log stream (Phase 6I)**: `count(canonical_fallback) / count(canonical_generate, outcome=error following a fallback-eligible errorCode)`, or simply `count(canonical_fallback, outcome=legacy_succeeded) / count(canonical_routing_decision, route=canonical)` for "what fraction of canonical-routed attempts ended up served by legacy." Still cross-checkable against `applications.fallback_used` via `get_canonical_generation_status` for reconciliation. |
| Quota accuracy | **Resolved (Phase 6I)**: canonical shares legacy's own quota ledger (`generate_package_quota_periods`/`generate_package_quota_reservations`, Production Architecture doc §7) — the SAME `get_generate_package_usage` RPC and existing legacy quota-accuracy verification method apply unchanged; no canonical-specific query needed. |
| Latency P50/P95/P99 | Percentile over `latencyMs`, filterable by `event` and `templateId`/`format` |
| RPC failures | `errorCode` ∈ {`persistence_failed`, `transaction_unavailable`, `not_found`, `conflict_stale_version`} on `canonical_status`/`canonical_generate` |
| Storage failures | `canonical_generate` success with `pdfPersisted=false`/`docxPersisted=false` — this is a *partial* success (generation succeeded, upload didn't); cross-reference with `documentStorage.reason` in the route's own success response body if deeper detail is needed (not in the log line by design, to keep the schema closed) |
| OpenAI failures | `errorCode` ∈ {`openai_timeout`, `openai_error`, `tailoring_failed`} |
| Overlay failures | `errorCode = overlay_validation_failed` |
| Template rendering failures | `errorCode ∈ {template_rendering_failed, template_resolution_failed, generated_document_failed}` |
| Parser failures | `errorCode = deserialization_failed` (canonical has no separate upload/parse step distinct from `career_source_documents` ingestion, which is outside these 3 routes and not covered by this log stream) |
| RLS failures | Not directly observable from these logs — RLS violations surface as `not_found` (ownership-scoped queries return no row rather than a permission error, by design) or, for RPC-level ownership checks, the RPC's own `not_found` return. A true unexpected RLS gap would show as a Postgres permission error, which the route's generic catch classifies as `unknown` — a spike in `unknown` errorCode is the signal to investigate manually. |

## 4. Suggested dashboard layout

1. **Top strip** — 4 big numbers: overall `canonical_generate` success rate (last 24h), P95 latency, current fallback rate, and live traffic-split % (from `canonical_routing_decision`) — each with a sparkline against the prior 7 days.
2. **Breakdown table** — success rate and P50/P95/P99 latency per `templateId`, per `event` type (generate/preview/status), per `format` (for preview).
3. **Error composition** — stacked bar of `errorCode` counts over time, so a spike is attributable to a specific failure category at a glance (openai vs template-rendering vs persistence vs RLS/unknown).
4. **Fallback panel** — `canonical_fallback` rate and reason breakdown over time, directly from the log stream (Phase 6I — previously required a separate SQL rollup).
5. **Canary stage marker** — an annotation track showing which canary stage (Canary Plan doc) was active at each point in time, so a metric shift can be correlated with a stage change; derivable directly from `canonical_routing_decision.stage`.

## 5. What this phase did NOT build

No actual dashboard tool (Grafana, Datadog, etc.) was provisioned or configured — this document remains the specification for that future work. No log drain was configured beyond Netlify's own default Function Log capture.
