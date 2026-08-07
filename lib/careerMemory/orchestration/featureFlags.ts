/*
  Phase 6G - Canonical Generate Package feature flags. Follows the
  EXISTING repo convention exactly (see
  lib/documentPreservation/visualTree/types.ts's own isVisualTreeEnabled()):
  a small `isXEnabled()` function per flag, reading process.env at CALL
  time (never cached at module load), colocated with the feature it
  gates rather than a central registry table - there is no existing
  config-table-backed flag system in this codebase to plug into, and
  inventing one is explicitly out of this round's scope.

  Fails closed: any value other than the literal string "true" is OFF.
  Required production defaults (round spec §35/§15) - none of these
  env vars should be set to "true" in Production this round; the
  absence of the var is the correct default-OFF state.
*/

export function isCanonicalGenerateEnabled(): boolean {
  return process.env.CANONICAL_GENERATE_ENABLED === "true";
}

export function isCanonicalShadowModeEnabled(): boolean {
  return process.env.CANONICAL_SHADOW_MODE === "true";
}

export function isCanonicalTemplateSelectorEnabled(): boolean {
  return process.env.CANONICAL_TEMPLATE_SELECTOR_ENABLED === "true";
}

/*
  Default-true in spirit (round spec: canonical_legacy_fallback_enabled
  defaults to true) - but per the same fail-closed convention as every
  other flag here, this reads an explicit env var. Deployment config
  must set CANONICAL_LEGACY_FALLBACK_ENABLED=true for the intended
  default; this function itself never assumes a default flip; the
  fail-closed direction (fallback OFF) is the safer failure mode for a
  boolean-parsing bug, so treating an unset var as OFF here is
  deliberate too - see canonicalGenerationFallbackService.ts's own
  header comment for how this interacts with the "fallback is normally
  ON" product requirement.
*/
export function isCanonicalLegacyFallbackEnabled(): boolean {
  return process.env.CANONICAL_LEGACY_FALLBACK_ENABLED === "true";
}

export function isCanonicalDocumentStorageEnabled(): boolean {
  return process.env.CANONICAL_DOCUMENT_STORAGE_ENABLED === "true";
}

export type CanonicalFeatureFlagsSnapshot = {
  canonicalGenerateEnabled: boolean;
  canonicalShadowMode: boolean;
  canonicalTemplateSelectorEnabled: boolean;
  canonicalLegacyFallbackEnabled: boolean;
  canonicalDocumentStorageEnabled: boolean;
};

export function readCanonicalFeatureFlags(): CanonicalFeatureFlagsSnapshot {
  return {
    canonicalGenerateEnabled: isCanonicalGenerateEnabled(),
    canonicalShadowMode: isCanonicalShadowModeEnabled(),
    canonicalTemplateSelectorEnabled: isCanonicalTemplateSelectorEnabled(),
    canonicalLegacyFallbackEnabled: isCanonicalLegacyFallbackEnabled(),
    canonicalDocumentStorageEnabled: isCanonicalDocumentStorageEnabled(),
  };
}
