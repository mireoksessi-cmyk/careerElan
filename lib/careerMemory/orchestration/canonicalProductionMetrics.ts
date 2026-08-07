/*
  Phase 6H - production monitoring log emission for the Canonical
  Generate Package system. One structured JSON line per event on
  stdout (Netlify Function Logs already capture this - no new log
  transport needed), matching the exact PII-safe convention
  canonicalShadowComparisonService.ts already established: only safe
  identifiers/enums/numbers ever appear (applicationId, templateId,
  format, a closed errorCode enum, latencyMs) - never job description
  text, resume text, AI output, or a caught error's own free-form
  .message (which could contain fragments of any of those). This
  module is purely additive observability - it never alters control
  flow, status codes, or response bodies; every call site logs around
  an operation without changing its outcome.
*/

export type CanonicalOutcome = "success" | "error";

/*
  Deliberately NOT the full domain-error class hierarchy - a small,
  closed enum of what a dashboard/alert actually needs to distinguish
  (round spec's own metric list: RPC/storage/OpenAI/overlay/template-
  rendering/parser/RLS failures), independent of this codebase's
  internal exception types so the log contract doesn't silently break
  if an internal error class is renamed.
*/
export type CanonicalErrorCode =
  | "validation_failed"
  | "not_found"
  | "conflict_stale_version"
  | "profile_unavailable"
  | "version_unavailable"
  | "deserialization_failed"
  | "tailoring_failed"
  | "overlay_validation_failed"
  | "template_rendering_failed"
  | "template_resolution_failed"
  | "generated_document_failed"
  | "persistence_failed"
  | "transaction_unavailable"
  | "schema_gap"
  | "authentication_required"
  | "authorization_denied"
  | "openai_timeout"
  | "openai_error"
  | "unknown";

/*
  Phase 6I additions - canonical_routing_decision and canonical_fallback.
  Both are purely observational (never change control flow) and exist
  because a rollout stage's actual traffic split and its actual
  fallback rate are exactly the two numbers a canary needs to be
  monitored live (Rollout/Canary Plan docs) but neither was derivable
  from the Phase 6H-era event set without an extra DB join per request.
*/
export type CanonicalMetricEvent =
  | { event: "canonical_generate"; applicationId: string; templateId: string; outcome: CanonicalOutcome; errorCode?: CanonicalErrorCode; latencyMs: number; pdfPersisted?: boolean; docxPersisted?: boolean }
  | { event: "canonical_preview"; applicationId: string; templateId: string; format: "html" | "pdf" | "docx"; outcome: CanonicalOutcome; errorCode?: CanonicalErrorCode; latencyMs: number }
  | { event: "canonical_status"; applicationId: string; outcome: CanonicalOutcome; errorCode?: CanonicalErrorCode; latencyMs: number }
  | { event: "canonical_routing_decision"; route: "legacy" | "canonical"; reason: string; stage: number }
  | { event: "canonical_fallback"; applicationId: string; reason: string; outcome: "legacy_succeeded" | "legacy_failed" };

export function logCanonicalMetric(event: CanonicalMetricEvent): void {
  console.log(JSON.stringify({ ...event, ts: new Date().toISOString() }));
}

/*
  Maps a caught error to the closed CanonicalErrorCode enum without
  ever touching the error's own .message (see this module's own header
  comment on why). Mirrors classifyForFallback's own instanceof
  ordering (canonicalGenerationFallbackService.ts) for the subset of
  classes relevant to observability, plus a few status-mapping-only
  classes that function doesn't need to distinguish.
*/
export function classifyErrorCode(error: unknown): CanonicalErrorCode {
  const name = error instanceof Error ? error.constructor.name : "";
  switch (name) {
    case "ValidationError":
      return "validation_failed";
    case "NotFoundError":
      return "not_found";
    case "ConflictError":
      return "conflict_stale_version";
    case "CanonicalProfileUnavailableError":
      return "profile_unavailable";
    case "CanonicalVersionUnavailableError":
      return "version_unavailable";
    case "CanonicalDeserializationError":
      return "deserialization_failed";
    case "CanonicalTailoringError":
      return "tailoring_failed";
    case "CanonicalOverlayValidationError":
      return "overlay_validation_failed";
    case "TemplateRenderingError":
      return "template_rendering_failed";
    case "TemplateResolutionError":
      return "template_resolution_failed";
    case "GeneratedDocumentError":
      return "generated_document_failed";
    case "PersistenceError":
      return "persistence_failed";
    case "TransactionUnavailableError":
      return "transaction_unavailable";
    case "SchemaGapError":
      return "schema_gap";
    case "AuthenticationRequiredError":
      return "authentication_required";
    case "AuthorizationError":
      return "authorization_denied";
    case "APIConnectionTimeoutError":
      return "openai_timeout";
    default:
      return "unknown";
  }
}
