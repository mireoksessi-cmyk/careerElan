# Canonical Career Memory — Production Architecture

Status: Phase 6H (Production Transition). Describes the system as it exists in code today — no architecture changes were made in this phase.

## 1. System boundary

The Canonical Career Memory system is a parallel resume-generation path living alongside the existing (legacy) `/api/generate-package` pipeline. It does not replace the legacy path in this phase; it is reachable only through its own internal routes, all gated OFF by default.

```
                        ┌─────────────────────────────┐
                        │        Client (browser)      │
                        └──────────────┬───────────────┘
                                        │
        ┌───────────────────────────────────────────────────────┐
        │                                                         │
        ▼                                                         ▼
┌───────────────────┐                                  ┌───────────────────────────┐
│ /api/generate-     │  (production entry point,        │ /canonical-career/*        │
│  package (legacy)  │   used by paste-job page)         │  (dev-only inspector UI)   │
└─────────┬──────────┘                                  └─────────────┬──────────────┘
          │                                                            │
          ▼                                                            ▼
┌────────────────────┐                              ┌──────────────────────────────────┐
│ generate_package_*  │                              │ /api/internal/canonical-generate- │
│ quota + Netlify      │                              │  package/{generate,preview,status}│
│ background function  │                              └───────────────┬────────────────────┘
└────────────────────┘                                                │
                                                                        ▼
                                                        ┌────────────────────────────────┐
                                                        │ generateCanonicalPackage()       │
                                                        │  (synchronous, in-request)       │
                                                        └───────────────┬───────────────────┘
                                                                        │
                                       ┌────────────────────────────────┼────────────────────────────────┐
                                       ▼                                ▼                                ▼
                          ┌─────────────────────┐        ┌──────────────────────┐       ┌──────────────────────────┐
                          │ AI tailoring (OpenAI) │        │ renderCanonicalPackage │       │ complete_canonical_       │
                          │  → overlay            │        │  (html/pdf/docx,        │       │  generation (RPC, atomic) │
                          └─────────────────────┘        │   Phase 6F engine)      │       └──────────────────────────┘
                                                          └──────────────────────┘
```

## 2. Feature flags (`lib/careerMemory/orchestration/featureFlags.ts`)

All flags fail closed — only the literal string `"true"` is ON, read at call time (never cached). Confirmed via `.env.local` and `grep` that none are currently set anywhere in this repo (all OFF by default, matching the required Production posture).

| Flag | Gates | Current default |
|---|---|---|
| `CANONICAL_GENERATE_ENABLED` | `/generate`, `/preview` routes return 404 when off | OFF |
| `CANONICAL_SHADOW_MODE` | Shadow-compare canonical vs legacy output without serving canonical | OFF |
| `CANONICAL_TEMPLATE_SELECTOR_ENABLED` | Exposes template switching UI/API | OFF |
| `CANONICAL_LEGACY_FALLBACK_ENABLED` | Whether a classified-fallback-eligible canonical error falls back to legacy | OFF (product spec says this should default ON in an eventual rollout — see Known Issues) |
| `CANONICAL_DOCUMENT_STORAGE_ENABLED` | Whether rendered PDF/DOCX are uploaded to Storage and recorded | OFF |

`withCanonicalAuth` additionally 404s all canonical routes outright when `isNetlifyRuntime()` is true and the generate flag is off — a second, independent gate for real Netlify Production.

## 3. Data model

Canonical data lives in a dedicated set of `career_*` tables, entirely separate from the legacy `resumes`/`cover_letters`/`applications.resume_text` columns:

- `career_profiles` (1:1 with `auth.users`)
- `career_source_documents`, `career_resume_versions` — versioned canonical resume content
- `career_experiences`, `career_projects`, `career_publications`, `career_credentials`, `career_awards`, `career_languages` — structured entries, each versioned via `career_resume_versions`
- `career_tailored_resumes` — one row per (application, generation), holds the AI-produced overlay
- `career_user_edits` — manual user edits layered on top of AI output
- `career_idempotency_keys` — shared idempotency ledger for the canonical RPCs
- `career_memory` — legacy free-text memory (pre-canonical, still separately in use)

The legacy `applications` table gained canonical-linkage columns (`canonical_profile_id`, `tailored_resume_id`, `selected_template_id`, `generated_pdf_document_id`, `generated_docx_document_id`, `generation_engine`, `fallback_used`, `fallback_reason`) — these are read/written exclusively through RPCs (`system_create_canonical_overlay`, `complete_canonical_generation`, `mark_canonical_fallback`, `get_canonical_generation_status`), never through a direct `service_role` table query. Confirmed via `information_schema.role_table_grants`: `service_role` has no SELECT/INSERT/UPDATE/DELETE grant on `applications` — only TRUNCATE/REFERENCES/TRIGGER. This is by design, not an oversight — see each RPC's own migration header comment.

## 4. RLS coverage (audited this phase)

Every `career_*` data table has RLS enabled with exactly 4 policies (SELECT/INSERT/UPDATE/DELETE, each scoped to `auth.uid()` ownership via a join to `career_profiles.user_id`), confirmed directly against `pg_class`/`pg_policy` on the local Supabase instance:

```
career_profiles, career_experiences, career_projects, career_publications,
career_credentials, career_awards, career_languages, career_resume_versions,
career_source_documents, career_tailored_resumes, career_user_edits, career_memory
  → rls_enabled = true, 4 policies each
career_idempotency_keys → rls_enabled = true, 2 policies
applications → rls_enabled = true, 4 policies (pre-existing, legacy)
```

No canonical table was found with RLS disabled or zero policies. `career_fair_ingest_runs` / `career_fair_ingestion_lock` (unrelated career-fairs subsystem) have RLS enabled with 0 policies — intentional service-role-only bookkeeping tables, not part of the canonical surface.

## 5. Request execution model — the key architectural fact for rollout planning

Unlike the legacy path (`/api/generate-package` → 202 response → Netlify background function `generate-package-background.ts` does the actual work asynchronously), the canonical `/generate` route calls `generateCanonicalPackage()` **synchronously, in the same request**. There is no canonical equivalent of the background-function pattern. This means:

- Canonical generation latency is bounded by whatever Netlify's Next.js Runtime function timeout is (same platform-level risk the legacy path's own Phase 4 documentation already flagged, undocumented today for canonical specifically).
- There is no "pending/succeeded/failed" polling story for canonical the way the legacy path has via `applications.generation_status` + `/api/applications/[id]/status`. Canonical status is only ever read after the synchronous call already returned (via `get_canonical_generation_status`).

This is flagged as a known architectural gap in `docs/canonical-known-issues.md` — not something this phase builds a fix for (out of scope per the phase's own "no new features" rule), but material to how aggressively real user traffic can be routed to canonical in later rollout stages.

## 6. Quota

The legacy path meters usage via `generate_package_quota_reservations` / `generate_package_quota_periods`. The canonical path was confirmed via direct RPC testing (Phase 6G/6G.1/6H sessions) to consume **zero quota** — no reservation, no period increment, no metering mechanism of any kind exists for canonical generation. This is a deliberate absence in the current code (not a bug), but it means a percentage-based rollout (Part B, Stage 3+) cannot yet enforce any per-user rate limit on canonical traffic specifically. Flagged in Known Issues.

## 7. Monitoring (added this phase, see `docs/canonical-monitoring-dashboard.md`)

`lib/careerMemory/orchestration/canonicalProductionMetrics.ts` emits one structured, PII-safe JSON line per `canonical_generate`/`canonical_preview`/`canonical_status` call to stdout (captured by Netlify Function Logs, no new transport). Purely additive — verified to add zero behavioral change via before/after regression (see `docs/canonical-production-checklist.md`).

## 8. What this phase deliberately did not change

Per the phase's own explicit constraints: no new user-visible features, no template redesign, no change to Career Memory / Canonical Runtime / overlay semantics. The architecture described above is exactly the Phase 6F/6G/6G.1 architecture; Phase 6H's only code changes are the purely-additive monitoring wiring in the three internal route handlers.
