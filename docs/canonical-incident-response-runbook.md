# Canonical Career Memory — Incident Response Runbook

Status: Phase 6I. For on-call use once any canary stage beyond Stage 0 is active in Production. §1/§2 amended for the routing/fallback/background-execution mechanisms this phase added; §3/§4 carry forward from Phase 6H with a stage-only rollback option added (see Rollback Runbook §6).

## 1. How you'll find out something is wrong

- A spike in `outcome:"error"` in the `canonical_generate`/`canonical_preview`/`canonical_status` log lines (see Monitoring Dashboard doc).
- A spike in `canonical_fallback` events, or `outcome:"legacy_failed"` within them (Phase 6I — a fallback that ALSO fails means the user got no package at all, the most serious canonical-caused failure mode).
- A user report that canonical-generated output (once user-facing) looks wrong, is missing content, or failed outright.
- Elevated latency P95/P99 approaching or exceeding the Netlify Background Function's 15-minute execution ceiling (unlikely in practice — this is legacy's own long-standing ceiling, not a new canonical-specific risk since Phase 6I moved canonical generation into the same background-worker model — Architecture doc §5).
- A generation stuck at `generation_status='pending'` for an unusual duration with `generation_worker_claimed_at` still null — likely a silent enqueue failure (Operations Runbook §6).

## 2. First response — triage by errorCode

| Symptom | errorCode(s) | Likely cause | First action |
|---|---|---|---|
| Sudden spike in failures, all templates | `openai_timeout`, `openai_error` | OpenAI outage/degradation | Check OpenAI status page; if confirmed, this is expected — fallback should be absorbing it if `CANONICAL_LEGACY_FALLBACK_ENABLED=true`. Verify fallback rate rose correspondingly. |
| Failures on one specific template only | `template_rendering_failed`, `template_resolution_failed` | A template-specific content-preservation validation failure (same class as the Phase 6G.1 professional-ats blocker) | Reproduce with a real profile against that template locally; check `docs/KNOWN_LIMITATIONS.md` for a known, disclosed cause first before assuming a new bug |
| Success but no PDF/DOCX | `pdfPersisted:false`/`docxPersisted:false` on an `outcome:"success"` generate event | Storage upload failure, not a generation failure | Check Supabase Storage service health; user's overlay/tailored-resume row is still valid, safe to retry preview/download once Storage recovers |
| `persistence_failed`/`transaction_unavailable` | RPC/DB layer issue | Check local/Production Supabase connectivity and RPC function health directly (`get_canonical_generation_status`, `complete_canonical_generation`) |
| Rising `unknown` errorCode | Unclassified — possibly a new failure mode, possibly an RLS gap | Do not assume it's benign. Pull the actual server-side error via Netlify Function Logs (the log line itself deliberately omits `.message` for PII safety — the raw error is still in the surrounding Netlify log context) and classify manually |
| Elevated P95/P99 | (any) | Background worker cold-start or concurrency degradation under increased canary traffic | If this correlates with a canary stage traffic increase, consider a stage-only rollback (Rollback Runbook §6) before root-causing |
| `canonical_fallback` with `outcome:"legacy_failed"` | (fallback's own reason, plus whatever legacy's own error handling recorded on the row) | Both engines failed for this request - the most severe canonical-caused user impact | Treat as P1: check `generation_error_code`/`generation_error_summary` on the row (now legacy's own, since `mark_canonical_fallback` set `generation_engine='legacy'`); this is a genuine legacy-path failure surfaced BY a canonical attempt, not a canonical bug per se, unless it correlates tightly with fallback volume |
| Rows stuck `pending`, never claimed | N/A (no errorCode - nothing threw) | Enqueue call to the canonical Background Function failed silently, or the function itself never started | Operations Runbook §6-7 (health check + manual reconciliation) |

## 3. Escalation / rollback decision

Immediate rollback (flag flip, see Rollback Runbook) is warranted when:
- Success rate for `canonical_generate` drops below the active stage's rollback trigger threshold (Rollout Plan doc) for a sustained window (not a single blip).
- Any confirmed RLS/ownership violation (a canonical row or document becomes visible to a user who doesn't own it) — treat as P0, roll back immediately, do not wait for a pattern.
- Any confirmed data loss or corruption in `career_*` tables.

Rollback is NOT warranted for:
- A single transient OpenAI error absorbed cleanly by the existing fallback path.
- A known, already-disclosed limitation (check `docs/KNOWN_LIMITATIONS.md` and `docs/canonical-known-issues.md` first).

## 4. Post-incident

- Record the incident: which rollout stage was active, which errorCode(s) dominated, whether rollback was executed, root cause once known.
- If the root cause is a genuine product bug (not infrastructure, not a known limitation), fix it with the same "reproduce with real profiles first" discipline established in Phase 6G.1 before re-advancing the rollout stage.
- Re-run the full canonical real-DB regression suite (`docs/canonical-production-checklist.md` §Regression) before re-enabling any flag that was rolled back.
