# Canonical Career Memory — Incident Response Runbook

Status: Phase 6H. For on-call use once any rollout stage beyond Stage 0 is active in Production.

## 1. How you'll find out something is wrong

- A spike in `outcome:"error"` in the `canonical_generate`/`canonical_preview`/`canonical_status` log lines (see Monitoring Dashboard doc).
- A spike in `applications.fallback_used=true` for `generation_engine='canonical'` rows.
- A user report that canonical-generated output (once user-facing) looks wrong, is missing content, or failed outright.
- Elevated latency P95/P99 approaching or exceeding the Netlify function timeout (Architecture doc §5 — canonical's synchronous execution model has no background-job cushion the way legacy does).

## 2. First response — triage by errorCode

| Symptom | errorCode(s) | Likely cause | First action |
|---|---|---|---|
| Sudden spike in failures, all templates | `openai_timeout`, `openai_error` | OpenAI outage/degradation | Check OpenAI status page; if confirmed, this is expected — fallback should be absorbing it if `CANONICAL_LEGACY_FALLBACK_ENABLED=true`. Verify fallback rate rose correspondingly. |
| Failures on one specific template only | `template_rendering_failed`, `template_resolution_failed` | A template-specific content-preservation validation failure (same class as the Phase 6G.1 professional-ats blocker) | Reproduce with a real profile against that template locally; check `docs/KNOWN_LIMITATIONS.md` for a known, disclosed cause first before assuming a new bug |
| Success but no PDF/DOCX | `pdfPersisted:false`/`docxPersisted:false` on an `outcome:"success"` generate event | Storage upload failure, not a generation failure | Check Supabase Storage service health; user's overlay/tailored-resume row is still valid, safe to retry preview/download once Storage recovers |
| `persistence_failed`/`transaction_unavailable` | RPC/DB layer issue | Check local/Production Supabase connectivity and RPC function health directly (`get_canonical_generation_status`, `complete_canonical_generation`) |
| Rising `unknown` errorCode | Unclassified — possibly a new failure mode, possibly an RLS gap | Do not assume it's benign. Pull the actual server-side error via Netlify Function Logs (the log line itself deliberately omits `.message` for PII safety — the raw error is still in the surrounding Netlify log context) and classify manually |
| Elevated P95/P99 approaching function timeout | (any) | Netlify function timeout risk (canonical has no async/background path) | If this correlates with a rollout stage traffic increase, consider pausing further stage advancement immediately, even before root-causing |

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
