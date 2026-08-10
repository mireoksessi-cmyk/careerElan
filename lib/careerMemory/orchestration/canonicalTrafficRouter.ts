/*
  Phase 6I - Part A: the single routing decision service for "should
  this Generate Package request run through the legacy pipeline or the
  Canonical pipeline." Isolated here specifically so
  app/api/generate-package/route.ts's own dispatch point (see that
  file's own comment) never has to know HOW the decision is made -
  only that it calls decideGenerationRoute(userId) and branches on the
  result. Contains no generation logic of any kind - it never calls
  OpenAI, never touches career_memory/career_profiles, never renders
  anything. That separation is what makes "no duplicated generation
  logic" true by construction: this file could be deleted and replaced
  with a different routing strategy without either pipeline's own
  generation code changing at all.
*/
import { isCanonicalGenerateEnabled } from "./featureFlags";
import { getCurrentCanaryStage, isUserInCanaryAllowlist, isUserInTrafficPercent, type CanaryStageNumber } from "./canonicalCanaryConfig";
import { isE2eAiModeActive } from "../../testing/e2eAiIsolation";

export type GenerationRoute = "legacy" | "canonical";

export type RoutingReason =
  | "flag_disabled"
  | "stage_0"
  | "allowlisted"
  | "not_in_allowlist"
  | "in_traffic_percent"
  | "not_in_traffic_percent"
  | "e2e_forced_canonical";

export type RoutingDecision = {
  route: GenerationRoute;
  reason: RoutingReason;
  stage: CanaryStageNumber;
};

/*
  Legacy is the return value on every branch except the two explicit
  "route to canonical" cases below - there is no code path in this
  function that can produce "canonical" as a side effect of an
  unexpected env value, a missing allowlist var, or any other
  misconfiguration. That is what "legacy remains default" means
  structurally, not just as a default parameter value.
*/
export function decideGenerationRoute(userId: string): RoutingDecision {
  /*
    Phase 6I.6.35 - the canary allowlist (CANONICAL_CANARY_ALLOWLIST_USER_IDS)
    is a fixed env var baked in at server spawn time (see
    e2e/globalSetup.ts), but every E2E spec creates its OWN fresh
    synthetic user at test-run time via createSyntheticE2eUser() - that
    user's id can never be added to a comma-separated env var after the
    dedicated E2E server has already started, so real per-spec users
    would always fall through to "not_in_allowlist" -> legacy, even
    though the canonical engine is the one with a deterministic E2E
    fixture path wired in (buildE2eCanonicalTailoringResponseText, see
    canonicalGeneratePackageService.ts) and is the intended production
    output system. This override only ever fires when
    isE2eAiModeActive() is true (itself fail-closed to Netlify/non-local
    Supabase, see e2eAiIsolation.ts) - it changes which already-safe
    engine handles the request, not any content-quality/security
    validator, so it carries none of the "weakened validator" risk the
    phase spec explicitly warns against.
  */
  if (isE2eAiModeActive()) {
    return { route: "canonical", reason: "e2e_forced_canonical", stage: getCurrentCanaryStage().stage };
  }
  if (!isCanonicalGenerateEnabled()) {
    return { route: "legacy", reason: "flag_disabled", stage: 0 };
  }

  const stageConfig = getCurrentCanaryStage();

  if (stageConfig.stage === 0) {
    return { route: "legacy", reason: "stage_0", stage: 0 };
  }

  if (stageConfig.requiresAllowlist) {
    return isUserInCanaryAllowlist(userId)
      ? { route: "canonical", reason: "allowlisted", stage: stageConfig.stage }
      : { route: "legacy", reason: "not_in_allowlist", stage: stageConfig.stage };
  }

  return isUserInTrafficPercent(userId, stageConfig.trafficPercent)
    ? { route: "canonical", reason: "in_traffic_percent", stage: stageConfig.stage }
    : { route: "legacy", reason: "not_in_traffic_percent", stage: stageConfig.stage };
}
