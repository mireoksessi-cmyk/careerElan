/*
  Phase 6I.6.36 - shared, general-purpose structured operational event
  logger. Generalizes the two domain-scoped patterns this codebase
  already proved out - lib/errors/publicError.ts's logSafeError() (safe
  error summaries) and lib/careerMemory/orchestration/
  canonicalProductionMetrics.ts's logCanonicalMetric() (one JSON line
  per event on stdout, closed error/event enums, no new log transport -
  Netlify Function Logs already capture stdout) - to every other
  operational domain (auth, upload, analyze job, background worker,
  quota, render, storage, API latency) that had no structured event
  emission at all before this phase.

  Never replaces logSafeError/logCanonicalMetric - both keep working
  exactly as before; this module is purely additive, for everything
  they don't already cover. Like both of those, this never alters
  control flow, status codes, or response bodies - every call site logs
  around an operation without changing its outcome.

  PII safety: every typed event field below is a safe identifier, enum,
  or number, never free text, BY CONSTRUCTION - there is no field on
  any event variant that a caller could accidentally populate with
  resume/job/cover-letter/email content. The optional `metadata` escape
  hatch exists only for a few call sites that need one extra ad-hoc
  field (e.g. an HTTP status code) and is still passed through redact()
  as defense in depth - not a license to put sensitive content there.
*/

// Case-insensitive key denylist. Anything in this set is replaced with
// "[redacted]" wherever it appears in `metadata`, at any nesting depth.
const PII_DENYLIST_KEYS = new Set([
  "resumetext",
  "resume_text",
  "coverletter",
  "cover_letter_text",
  "coverlettertext",
  "jobtext",
  "job_text",
  "jobdescription",
  "job_description",
  "emaildraft",
  "email_draft",
  "originaltext",
  "original_text",
  "password",
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "servicerolekey",
  "service_role_key",
  "email",
  "fullname",
  "full_name",
  "phone",
  "message",
  "stack",
  "details",
  "hint",
  "prompt",
  "prompttext",
]);

const MAX_REDACT_DEPTH = 4;
const MAX_STRING_LENGTH = 300;
const MAX_ARRAY_ITEMS = 50;

function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_REDACT_DEPTH) return "[max-depth]";
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => redact(item, depth + 1));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = PII_DENYLIST_KEYS.has(key.toLowerCase()) ? "[redacted]" : redact(val, depth + 1);
    }
    return out;
  }

  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]` : value;
  }

  return value;
}

export type AuthEvent =
  | { domain: "auth"; event: "login_succeeded"; userId: string; provider: string }
  | { domain: "auth"; event: "login_failed"; provider: string; reason: "invalid_credentials" | "oauth_exchange_failed" | "unknown" }
  | { domain: "auth"; event: "signup_succeeded"; userId: string; provider: string }
  | { domain: "auth"; event: "profile_upsert_failed"; userId: string }
  | { domain: "auth"; event: "consent_record_failed"; userId: string };

export type UploadEvent =
  | { domain: "upload"; event: "resume_analysis_succeeded"; userId: string; resumeId: string; latencyMs: number }
  | { domain: "upload"; event: "resume_analysis_failed"; userId: string; resumeId: string; errorCode: string; latencyMs: number }
  | { domain: "upload"; event: "cover_letter_analysis_succeeded"; userId: string; coverLetterId: string; latencyMs: number }
  | { domain: "upload"; event: "cover_letter_analysis_failed"; userId: string; coverLetterId: string; errorCode: string; latencyMs: number };

export type AnalyzeJobEvent =
  | { domain: "analyze_job"; event: "succeeded"; route: "analyze-job" | "analyze-job-url"; latencyMs: number }
  | { domain: "analyze_job"; event: "failed"; route: "analyze-job" | "analyze-job-url"; errorCode: string; latencyMs: number };

export type GeneratePackageEvent =
  | { domain: "generate_package"; event: "quota_reserved"; userId: string; generationRequestId: string; engine: "canonical" | "legacy" }
  | { domain: "generate_package"; event: "quota_denied"; userId: string; generationRequestId: string; used: number; limit: number; engine: "canonical" | "legacy" }
  | { domain: "generate_package"; event: "stale_pending_reclaimed"; applicationId: string; generationRequestId: string; pendingAgeMs: number; engine: "canonical" | "legacy" };

export type OpenAiEvent =
  | { domain: "openai"; event: "call_started"; route: string; model: string; attempt: number }
  | { domain: "openai"; event: "call_succeeded"; route: string; model: string; attempt: number; latencyMs: number }
  | { domain: "openai"; event: "call_retried"; route: string; model: string; attempt: number; reason: string }
  | { domain: "openai"; event: "call_failed"; route: string; model: string; attempt: number; latencyMs: number; reason: string };

export type BackgroundWorkerEvent =
  | { domain: "background_worker"; event: "enqueued"; applicationId: string; generationRequestId: string; engine: "canonical" | "legacy" }
  | { domain: "background_worker"; event: "enqueue_failed"; applicationId: string; generationRequestId: string; engine: "canonical" | "legacy" };

export type RenderEvent = { domain: "render"; event: "storage_write_failed"; applicationId: string; format: "pdf" | "docx" };

export type StorageEvent =
  | { domain: "storage"; event: "document_persisted"; applicationId: string; pdfDocumentId: string; docxDocumentId: string }
  | { domain: "storage"; event: "document_persist_skipped"; applicationId: string; reason: "storage_disabled" | "upload_failed" | "no_tailored_resume" };

export type ApiLatencyEvent = { domain: "api_latency"; route: string; status: number; latencyMs: number; outcome: "success" | "error" };

/*
  Phase 6I.6.38A - OpenAI monthly budget threshold-crossing events. Fired
  by lib/openai/budgetAlerts.ts at most once per threshold per UTC month
  (the openai_budget_alert_state table is the source of truth for that
  dedup, not this log line - this is purely an observability record of
  what already happened). Only safe budget figures, never user data.
*/
export type OpenAiBudgetEvent =
  | { domain: "openai_budget"; event: "warning_80"; budgetUsedPercent: number; monthSpendUsd: number; monthlyBudgetUsd: number; emailSent: boolean }
  | { domain: "openai_budget"; event: "critical_90"; budgetUsedPercent: number; monthSpendUsd: number; monthlyBudgetUsd: number; emailSent: boolean }
  | { domain: "openai_budget"; event: "exceeded_100"; budgetUsedPercent: number; monthSpendUsd: number; monthlyBudgetUsd: number; emailSent: boolean };

/*
  Phase 6I.6.37 - admin console events. actorUserId is always a UUID,
  never an email - matches this module's own PII-safety convention
  (see PII_DENYLIST_KEYS above) of only ever logging safe identifiers.
*/
export type AdminEvent =
  | { domain: "admin"; event: "access_denied"; userId: string; permission: string }
  | { domain: "admin"; event: "role_updated"; actorUserId: string; targetUserId: string; newRole: string }
  | { domain: "admin"; event: "staff_disabled"; actorUserId: string; targetUserId: string }
  | { domain: "admin"; event: "staff_enabled"; actorUserId: string; targetUserId: string }
  | { domain: "admin"; event: "alert_acknowledged"; actorUserId: string; alertKey: string };

export type OperationalEvent =
  | AuthEvent
  | UploadEvent
  | AnalyzeJobEvent
  | GeneratePackageEvent
  | OpenAiEvent
  | BackgroundWorkerEvent
  | RenderEvent
  | StorageEvent
  | ApiLatencyEvent
  | AdminEvent
  | OpenAiBudgetEvent;

export function logOperationalEvent(event: OperationalEvent & { metadata?: Record<string, unknown> }): void {
  const { metadata, ...rest } = event;
  console.log(
    JSON.stringify({
      ...rest,
      ...(metadata ? { metadata: redact(metadata) } : {}),
      ts: new Date().toISOString(),
    })
  );
}

/*
  Small timing helper so call sites don't each re-derive `Date.now() -
  startedAt` by hand. Purely additive - returns a plain number, no
  side effects.
*/
export function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}
