/*
  Phase 6I.6.38A - the ONE centralized OpenAI call instrumentation
  mechanism (Part C: "Do NOT manually duplicate telemetry logic across
  every route"). Every real call site wraps its actual
  client.responses.create(...)/client.chat.completions.create(...) call
  with withOpenAiTelemetry() instead of hand-rolling its own
  timing/usage/error-classification logic.

  Contract:
  - Records telemetry on BOTH success and failure (Part C).
  - NEVER changes the calling code's control flow: on failure, the
    original error is re-thrown completely unchanged after telemetry is
    recorded, so upstream retry logic (e.g. generateCore.ts's
    shouldRetryOpenAiError) keeps inspecting the real error it always
    inspected - this module is purely an observer, never a decision
    point.
  - A telemetry DB-write failure NEVER fails the product operation: the
    insert is wrapped in its own try/catch, and any error is logged via
    logOperationalEvent as OPENAI_TELEMETRY_WRITE_FAILED (safe metadata
    only) and swallowed.
  - Never persists prompt, response, or any request/response body -
    only the structural fields openai_usage_events itself accepts.
*/
import OpenAI from "openai";
import { supabaseAdmin } from "../supabaseAdmin";
import { logOperationalEvent } from "../observability/logger";
import { estimateCostUsd } from "./pricing";
import { checkAndTriggerBudgetAlerts } from "./budgetAlerts";
import type { OpenAiOperation } from "./operations";

export type TelemetryParams = {
  operation: OpenAiOperation;
  model: string;
  retryCount: number;
  applicationId?: string | null;
  userId?: string | null;
  requestId?: string | null;
};

type NormalizedUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

/*
  Handles both OpenAI SDK response shapes seen in this codebase's own
  call sites: Responses API (input_tokens/output_tokens/total_tokens)
  and Chat Completions API (prompt_tokens/completion_tokens/
  total_tokens). Returns all-null (never fabricated) if neither shape
  matches - e.g. an endpoint that doesn't return usage at all.
*/
function extractUsage(response: unknown): NormalizedUsage {
  if (!response || typeof response !== "object" || !("usage" in response)) {
    return { inputTokens: null, outputTokens: null, totalTokens: null };
  }
  const usage = (response as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") {
    return { inputTokens: null, outputTokens: null, totalTokens: null };
  }
  const u = usage as Record<string, unknown>;

  if (typeof u.input_tokens === "number" || typeof u.output_tokens === "number") {
    return {
      inputTokens: typeof u.input_tokens === "number" ? u.input_tokens : null,
      outputTokens: typeof u.output_tokens === "number" ? u.output_tokens : null,
      totalTokens: typeof u.total_tokens === "number" ? u.total_tokens : null,
    };
  }
  if (typeof u.prompt_tokens === "number" || typeof u.completion_tokens === "number") {
    return {
      inputTokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : null,
      outputTokens: typeof u.completion_tokens === "number" ? u.completion_tokens : null,
      totalTokens: typeof u.total_tokens === "number" ? u.total_tokens : null,
    };
  }
  return { inputTokens: null, outputTokens: null, totalTokens: null };
}

export type HttpStatusClass = "2xx" | "429" | "4xx" | "5xx" | "timeout" | "network" | "unknown";
export type ErrorCategory = "rate_limit" | "timeout" | "server_error" | "client_error" | "network_error" | "unknown";

export function classifyOpenAiError(error: unknown): { httpStatusClass: HttpStatusClass; errorCategory: ErrorCategory } {
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return { httpStatusClass: "timeout", errorCategory: "timeout" };
  }
  if (error instanceof OpenAI.RateLimitError) {
    return { httpStatusClass: "429", errorCategory: "rate_limit" };
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return { httpStatusClass: "network", errorCategory: "network_error" };
  }
  if (error instanceof OpenAI.APIError) {
    const status = typeof error.status === "number" ? error.status : null;
    if (status !== null && status >= 500) return { httpStatusClass: "5xx", errorCategory: "server_error" };
    if (status !== null && status >= 400) return { httpStatusClass: "4xx", errorCategory: "client_error" };
    return { httpStatusClass: "unknown", errorCategory: "unknown" };
  }
  return { httpStatusClass: "unknown", errorCategory: "unknown" };
}

async function persistUsageEvent(row: {
  operation: OpenAiOperation;
  model: string;
  status: "success" | "error";
  durationMs: number;
  usage: NormalizedUsage;
  retryCount: number;
  httpStatusClass: HttpStatusClass | null;
  errorCategory: ErrorCategory | null;
  requestId?: string | null;
  applicationId?: string | null;
  userId?: string | null;
}): Promise<void> {
  try {
    const cost = estimateCostUsd(row.model, row.usage.inputTokens, row.usage.outputTokens);
    const { error } = await supabaseAdmin.from("openai_usage_events").insert({
      operation: row.operation,
      model: row.model,
      status: row.status,
      duration_ms: row.durationMs,
      input_tokens: row.usage.inputTokens,
      output_tokens: row.usage.outputTokens,
      total_tokens: row.usage.totalTokens,
      estimated_cost_usd: cost.costUsd,
      cost_classification: cost.classification,
      retry_count: row.retryCount,
      http_status_class: row.httpStatusClass,
      error_category: row.errorCategory,
      request_id: row.requestId ?? null,
      application_id: row.applicationId ?? null,
      user_id: row.userId ?? null,
    });
    if (error) {
      logOperationalEvent({
        domain: "openai",
        event: "call_failed",
        route: "lib/openai/telemetry#persistUsageEvent",
        model: row.model,
        attempt: row.retryCount + 1,
        latencyMs: row.durationMs,
        reason: "OPENAI_TELEMETRY_WRITE_FAILED",
      });
    } else if (cost.classification === "ESTIMATED_COST" && cost.costUsd > 0) {
      // Cheap (one aggregate read + at most 3 atomic claims) and has its
      // own internal try/catch - never allowed to affect this insert's
      // success or the caller's OpenAI result.
      await checkAndTriggerBudgetAlerts();
    }
  } catch {
    // Telemetry must never throw into the caller - see this module's own
    // header comment. Swallowed deliberately; the write-failure event
    // above (best-effort) is the only trace, and even that is allowed
    // to fail silently here.
    logOperationalEvent({
      domain: "openai",
      event: "call_failed",
      route: "lib/openai/telemetry#persistUsageEvent",
      model: row.model,
      attempt: row.retryCount + 1,
      latencyMs: row.durationMs,
      reason: "OPENAI_TELEMETRY_WRITE_FAILED",
    });
  }
}

/*
  Wraps exactly one physical OpenAI request attempt. Call once per
  attempt inside an existing retry loop (pass the loop's own attempt-1
  as retryCount) or once for a single-shot call site (retryCount: 0).
*/
export async function withOpenAiTelemetry<T>(params: TelemetryParams, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt;
    const usage = extractUsage(result);
    await persistUsageEvent({
      operation: params.operation,
      model: params.model,
      status: "success",
      durationMs,
      usage,
      retryCount: params.retryCount,
      httpStatusClass: "2xx",
      errorCategory: null,
      requestId: params.requestId,
      applicationId: params.applicationId,
      userId: params.userId,
    });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const { httpStatusClass, errorCategory } = classifyOpenAiError(error);
    await persistUsageEvent({
      operation: params.operation,
      model: params.model,
      status: "error",
      durationMs,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      retryCount: params.retryCount,
      httpStatusClass,
      errorCategory,
      requestId: params.requestId,
      applicationId: params.applicationId,
      userId: params.userId,
    });
    throw error;
  }
}
