/*
  Phase 6I - Canary rollout stage configuration for Canonical Generate
  Package. Single source of truth for "what stage is Production
  currently at" and "does this user belong in it" - read by
  canonicalTrafficRouter.ts, which is the only caller that should ever
  need this module directly.

  Stage selection is a single env var (CANONICAL_CANARY_STAGE, an
  integer 0-6) rather than a flag per stage - the 6 stages form a
  strictly ordered progression (see docs/canonical-canary-plan.md),
  never an independent on/off combination, so a single ordinal is the
  correct representation, not 6 booleans that could contradict each
  other. Absent or invalid input defaults to stage 0 (all traffic to
  legacy) - fails toward the safer, already-proven path, matching this
  codebase's established fail-closed convention for every other
  canonical flag (see featureFlags.ts's own header comment).
*/

export type CanaryStageNumber = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type CanaryStageConfig = {
  stage: CanaryStageNumber;
  name: string;
  /* 0-100. Ignored (stage decided by allowlist instead) when
     requiresAllowlist is true. */
  trafficPercent: number;
  /* Stages 1-2 (internal developers/employees) are a small, explicitly
     enumerated set of real accounts, not a traffic percentage - a 1%
     random bucket could easily contain zero or several internal
     accounts by chance, which is not what "internal only" means. */
  requiresAllowlist: boolean;
};

const STAGES: Record<CanaryStageNumber, CanaryStageConfig> = {
  0: { stage: 0, name: "all_flags_off", trafficPercent: 0, requiresAllowlist: false },
  1: { stage: 1, name: "internal_developers", trafficPercent: 0, requiresAllowlist: true },
  2: { stage: 2, name: "internal_employees", trafficPercent: 0, requiresAllowlist: true },
  3: { stage: 3, name: "canary_1_percent", trafficPercent: 1, requiresAllowlist: false },
  4: { stage: 4, name: "canary_10_percent", trafficPercent: 10, requiresAllowlist: false },
  5: { stage: 5, name: "canary_50_percent", trafficPercent: 50, requiresAllowlist: false },
  6: { stage: 6, name: "general_availability", trafficPercent: 100, requiresAllowlist: false },
};

function isValidStageNumber(value: number): value is CanaryStageNumber {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

/* Read at call time, never cached - matches every other canonical
   config value in this codebase (see featureFlags.ts). */
export function getCurrentCanaryStage(): CanaryStageConfig {
  const raw = process.env.CANONICAL_CANARY_STAGE;
  const parsed = raw === undefined ? NaN : Number(raw);
  const stage: CanaryStageNumber = isValidStageNumber(parsed) ? parsed : 0;
  return STAGES[stage];
}

export function getAllCanaryStages(): CanaryStageConfig[] {
  return [STAGES[0], STAGES[1], STAGES[2], STAGES[3], STAGES[4], STAGES[5], STAGES[6]];
}

/*
  Comma-separated real Supabase auth user ids - operator-managed, never
  emails/names (this env var may end up in deploy logs/dashboards, so
  it must never carry PII). Empty/unset is a valid, common state (every
  environment before Stage 1 is ever enabled).
*/
function getAllowlistedUserIds(): Set<string> {
  const raw = process.env.CANONICAL_CANARY_ALLOWLIST_USER_IDS || "";
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  );
}

export function isUserInCanaryAllowlist(userId: string): boolean {
  return getAllowlistedUserIds().has(userId);
}

/*
  Deterministic FNV-1a-style string hash reduced to a 0-99 bucket - NOT
  a security/crypto hash, just a stable, uniformly-distributed
  per-user bucket so the SAME user always lands on the SAME side of the
  routing decision for as long as the stage's traffic percent doesn't
  change (a stable experience across repeated requests, not a coin
  flip every time) while still distributing different users
  approximately uniformly across [0, 100) for the percentage to be
  meaningful at scale.
*/
export function hashUserIdToBucket(userId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash) % 100;
}

export function isUserInTrafficPercent(userId: string, percent: number): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  return hashUserIdToBucket(userId) < percent;
}
