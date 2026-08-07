/*
  Phase 6I.2 - the reusable hard-gate invariant (spec section 13):

    canonical profile exists AND default_template_id IS NULL
      -> TEMPLATE_SELECTION_REQUIRED

  Legacy-only accounts (no canonical profile at all) are explicitly NOT
  gated - they fall through as `{ applicable: false }`, matching
  section 13's own "legacy-only accounts without canonical profiles
  must remain supported" requirement. This function is read-only and
  side-effect-free so it is safe to call from any forward-navigation
  path (career-memory completion, canonical /generate, a future
  Dashboard/Paste-Job guard) without worrying about it mutating state.
*/
import { TemplateSelectionRequiredError } from "../errors/domainErrors";
import type { CanonicalRepositoryBundle } from "../repositories/createRepositories";
import type { TemplateId } from "../../resumeTemplates/contracts/types";

export type TemplateGateResult =
  | { status: "not-applicable" }
  | { status: "selection-required"; profileId: string }
  | { status: "resolved"; profileId: string; defaultTemplateId: TemplateId };

/*
  Read-only check - never throws. Distinguishes all 3 states a caller
  needs (legacy-only user vs. canonical-profile-needs-selection vs.
  already-resolved) - collapsing the last two into one boolean would
  make it impossible for section 14's "existing user, NULL default"
  blocking prompt to tell itself apart from a legacy-only user who
  should never see that prompt at all.

  Use requireTemplateSelected() below when the caller wants the gate
  enforced (throw on violation) instead of just inspected.
*/
export async function checkTemplateGate(repos: CanonicalRepositoryBundle, userId: string): Promise<TemplateGateResult> {
  const profile = await repos.profiles.getByUserId(userId);
  if (!profile) return { status: "not-applicable" };
  if (!profile.default_template_id) return { status: "selection-required", profileId: profile.id };
  return { status: "resolved", profileId: profile.id, defaultTemplateId: profile.default_template_id as TemplateId };
}

/*
  Enforces the gate: throws TemplateSelectionRequiredError when a
  canonical profile exists but has no default_template_id yet. Returns
  null (not an error) when no canonical profile exists at all - the
  caller is a legacy-only user and this gate does not apply to them.
*/
export async function requireTemplateSelected(repos: CanonicalRepositoryBundle, userId: string): Promise<{ profileId: string; defaultTemplateId: TemplateId } | null> {
  const profile = await repos.profiles.getByUserId(userId);
  if (!profile) return null;
  if (!profile.default_template_id) throw new TemplateSelectionRequiredError();
  return { profileId: profile.id, defaultTemplateId: profile.default_template_id as TemplateId };
}
