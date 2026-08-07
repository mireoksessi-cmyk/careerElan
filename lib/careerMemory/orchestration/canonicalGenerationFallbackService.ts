/*
  Phase 6G - decides whether a failed canonical generation attempt
  should fall back to the legacy pipeline. Per round spec §17/§35:
  fallback-eligible categories only; authentication/ownership/quota/
  malformed-input/protected-fact failures are HARD FAILS, never
  silently absorbed into a fallback (those indicate something the
  legacy path should also refuse, not a canonical-specific gap).

  Callers: canonicalShadowComparisonService.ts (shadow mode, result
  never surfaced to the user) and the canary route (real user-facing
  canonical attempt, gated by canonical_generate_enabled +
  canonical_legacy_fallback_enabled).
*/
import {
  CanonicalProfileUnavailableError,
  CanonicalVersionUnavailableError,
  CanonicalDeserializationError,
  CanonicalTailoringError,
  CanonicalOverlayValidationError,
  TemplateRenderingError,
  GeneratedDocumentError,
  AuthenticationRequiredError,
  AuthorizationError,
  QuotaExceededError,
  ValidationError,
  NotFoundError,
} from "../errors/domainErrors";
import { isCanonicalLegacyFallbackEnabled } from "./featureFlags";

export type FallbackReason =
  | "no_canonical_profile"
  | "no_canonical_version"
  | "deserialization_failure"
  | "overlay_validation_failure"
  | "template_rendering_failure"
  | "generated_document_failure"
  | "feature_flag_disabled"
  | "transient_failure";

export type FallbackDecision = { shouldFallback: true; reason: FallbackReason } | { shouldFallback: false; reason: null };

/*
  Never fallback (rethrow instead) for: AuthenticationRequiredError,
  AuthorizationError, QuotaExceededError - these mean the REQUEST
  itself is invalid/forbidden/exhausted, not that canonical generation
  specifically failed; the legacy path must refuse the same request for
  the same reason, not silently serve a different engine's output. A
  plain ValidationError (malformed request shape) is also a hard fail -
  the round spec's own "fallback 없이 새 경로 강제 금지" cuts both ways: a
  malformed REQUEST should be rejected outright, not routed anywhere.
*/
export function classifyForFallback(error: unknown): FallbackDecision {
  if (error instanceof AuthenticationRequiredError || error instanceof AuthorizationError || error instanceof QuotaExceededError) {
    return { shouldFallback: false, reason: null };
  }
  if (error instanceof ValidationError && !(error instanceof CanonicalTailoringError) && !(error instanceof CanonicalOverlayValidationError)) {
    return { shouldFallback: false, reason: null };
  }
  /*
    Phase 6I fix: CanonicalProfileUnavailableError/CanonicalVersionUnavailableError
    both extend NotFoundError but represent a genuine canonical-specific
    gap (fallback-eligible, checked individually below) - a BARE
    NotFoundError (e.g. "Application not found, or does not belong to
    the current user", thrown by an ownership-scoped lookup elsewhere in
    the canonical services) means the REQUEST's own target doesn't
    belong to this caller, which the legacy path must refuse identically,
    not silently serve. Without this check, a real ownership violation
    fell through to the default "transient_failure" branch below and was
    incorrectly treated as fallback-eligible - caught during this
    round's own audit before any fallback path was ever wired to a real
    caller.
  */
  if (error instanceof NotFoundError && !(error instanceof CanonicalProfileUnavailableError) && !(error instanceof CanonicalVersionUnavailableError)) {
    return { shouldFallback: false, reason: null };
  }
  if (error instanceof CanonicalProfileUnavailableError) return { shouldFallback: true, reason: "no_canonical_profile" };
  if (error instanceof CanonicalVersionUnavailableError) return { shouldFallback: true, reason: "no_canonical_version" };
  if (error instanceof CanonicalDeserializationError) return { shouldFallback: true, reason: "deserialization_failure" };
  if (error instanceof CanonicalTailoringError || error instanceof CanonicalOverlayValidationError) return { shouldFallback: true, reason: "overlay_validation_failure" };
  if (error instanceof TemplateRenderingError) return { shouldFallback: true, reason: "template_rendering_failure" };
  if (error instanceof GeneratedDocumentError) return { shouldFallback: true, reason: "generated_document_failure" };
  return { shouldFallback: true, reason: "transient_failure" };
}

export type RunWithFallbackResult<T> =
  | { usedCanonical: true; result: T; fallbackUsed: false; fallbackReason: null }
  | { usedCanonical: false; fallbackUsed: true; fallbackReason: FallbackReason };

/*
  Runs `attemptCanonical`. On a fallback-eligible failure AND
  canonical_legacy_fallback_enabled=true, returns a fallback signal for
  the caller to then run its OWN legacy path (this function never runs
  legacy generation itself - it has no legacy-pipeline dependency, per
  this round's own "existing Generate Package code" ownership boundary
  staying in generateCore.ts). On a hard-fail category, or when
  fallback itself is disabled, rethrows.
*/
export async function runCanonicalWithFallbackDecision<T>(attemptCanonical: () => Promise<T>): Promise<RunWithFallbackResult<T>> {
  try {
    const result = await attemptCanonical();
    return { usedCanonical: true, result, fallbackUsed: false, fallbackReason: null };
  } catch (error) {
    const decision = classifyForFallback(error);
    if (!decision.shouldFallback) throw error;
    if (!isCanonicalLegacyFallbackEnabled()) throw error;
    return { usedCanonical: false, fallbackUsed: true, fallbackReason: decision.reason };
  }
}
