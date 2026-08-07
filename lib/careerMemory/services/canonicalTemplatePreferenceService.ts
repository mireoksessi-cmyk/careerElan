/*
  Phase 6I.2 - Canonical Template Lifecycle Integration.

  Owns career_profiles.default_template_id: the profile-level template
  preference set once by the user (spec section 3/4). Deliberately a
  plain repository update, not a new RPC - this column has no child
  tables, no idempotency-key replay requirement (setting the same
  template twice is naturally idempotent - a no-op UPDATE), and no
  multi-table atomicity need, unlike saveCanonicalRuntime's own
  disclosed TRANSACTION_SCHEMA_GAP (see transactions/README.md). Never
  touches career_resume_versions, career_tailored_resumes, or any
  overlay/version table - switching a template preference is a single
  UPDATE on career_profiles and nothing else (spec section 4's own "no
  new Resume Version, no Overlay, no OpenAI, no quota" requirement is
  satisfied structurally: this file imports no AI client, no overlay
  service, no quota RPC).
*/
import { ensureTemplatesRegistered } from "../../resumeTemplates/registry/bootstrap";
import { validateTemplateId } from "../../resumeTemplates/registry/templateRegistry";
import type { TemplateId } from "../../resumeTemplates/contracts/types";
import { CanonicalProfileUnavailableForTemplateError, InvalidTemplateIdError, TemplatePreferencePersistFailedError } from "../errors/domainErrors";
import type { CanonicalRepositoryBundle } from "../repositories/createRepositories";
import type { CareerProfileRow } from "../persistence/types";

export type TemplatePreferenceResult = {
  profileId: string;
  defaultTemplateId: TemplateId | null;
};

function toResult(profile: CareerProfileRow): TemplatePreferenceResult {
  return { profileId: profile.id, defaultTemplateId: (profile.default_template_id as TemplateId | null) ?? null };
}

export class CanonicalTemplatePreferenceService {
  constructor(private readonly repos: CanonicalRepositoryBundle) {}

  /*
    Returns null (not an error) when no canonical profile exists yet -
    callers that need "no profile" to be an error use
    requireCanonicalProfileForTemplate() (canonicalTemplateGate.ts)
    instead. A pure read has no reason to force that distinction on
    every caller (e.g. Dashboard's own eligibility check just wants
    "do I show the picker or not," not a thrown error).
  */
  async getTemplatePreference(userId: string): Promise<TemplatePreferenceResult | null> {
    const profile = await this.repos.profiles.getByUserId(userId);
    if (!profile) return null;
    return toResult(profile);
  }

  /*
    Idempotent by construction: re-setting the SAME template id is just
    another UPDATE to the same value - no separate short-circuit
    needed, no new row, no version bump anywhere. Validates the raw id
    against the real Template Registry (never a hand-maintained literal
    list) before touching the DB, so a newly-added/removed template
    automatically stays in sync with what this endpoint accepts.
  */
  async setTemplatePreference(userId: string, rawTemplateId: string): Promise<TemplatePreferenceResult> {
    ensureTemplatesRegistered();
    let templateId: TemplateId;
    try {
      templateId = validateTemplateId(rawTemplateId);
    } catch {
      throw new InvalidTemplateIdError(rawTemplateId);
    }

    const profile = await this.repos.profiles.getByUserId(userId);
    if (!profile) throw new CanonicalProfileUnavailableForTemplateError();

    try {
      const updated = await this.repos.profiles.update(profile.id, { default_template_id: templateId });
      return toResult(updated);
    } catch (error) {
      throw new TemplatePreferencePersistFailedError(error instanceof Error ? error.message.slice(0, 200) : "unknown persistence failure");
    }
  }
}
