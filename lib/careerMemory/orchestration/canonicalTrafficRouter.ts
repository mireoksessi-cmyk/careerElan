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

export type GenerationRoute = "legacy" | "canonical";

export type RoutingReason =
  | "flag_disabled"
  | "stage_0"
  | "allowlisted"
  | "not_in_allowlist"
  | "in_traffic_percent"
  | "not_in_traffic_percent";

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
