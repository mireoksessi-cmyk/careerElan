/*
  Phase 6I.2 (spec section 11/15/16) - the per-application template
  override, distinct from CanonicalTemplatePreferenceService's
  profile-level default. Sets ONLY applications.selected_template_id -
  no career_tailored_resumes/career_resume_versions/overlay write, no
  OpenAI call, no quota reservation is reachable from this file (it
  imports none of those). "setAsDefault" is the ONLY path that also
  updates career_profiles.default_template_id, and it does so through
  the SAME CanonicalTemplatePreferenceService the profile-level picker
  already uses - one place owns writes to that column.
*/
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureTemplatesRegistered } from "../../resumeTemplates/registry/bootstrap";
import { validateTemplateId } from "../../resumeTemplates/registry/templateRegistry";
import type { TemplateId } from "../../resumeTemplates/contracts/types";
import { InvalidTemplateIdError, TemplatePreferencePersistFailedError, NotFoundError } from "../errors/domainErrors";
import { CanonicalTemplatePreferenceService } from "./canonicalTemplatePreferenceService";
import type { CanonicalRepositoryBundle } from "../repositories/createRepositories";

export type ApplicationTemplateSwitchResult = {
  applicationId: string;
  selectedTemplateId: TemplateId;
  profileDefaultUpdated: boolean;
};

export async function setApplicationTemplate(
  client: SupabaseClient,
  repos: CanonicalRepositoryBundle,
  userId: string,
  applicationId: string,
  rawTemplateId: string,
  setAsDefault: boolean
): Promise<ApplicationTemplateSwitchResult> {
  ensureTemplatesRegistered();
  let templateId: TemplateId;
  try {
    templateId = validateTemplateId(rawTemplateId);
  } catch {
    throw new InvalidTemplateIdError(rawTemplateId);
  }

  // Ownership enforced explicitly (.eq("user_id", userId)) in addition
  // to the application_update RLS policy (auth.uid() = user_id) - this
  // codebase's established defense-in-depth convention.
  const { data, error } = await client
    .from("applications")
    .update({ selected_template_id: templateId })
    .eq("id", applicationId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new TemplatePreferencePersistFailedError(error.message.slice(0, 200));
  }
  if (!data) {
    throw new NotFoundError("Application not found, or does not belong to the current user.");
  }

  let profileDefaultUpdated = false;
  if (setAsDefault) {
    const preferenceService = new CanonicalTemplatePreferenceService(repos);
    await preferenceService.setTemplatePreference(userId, templateId);
    profileDefaultUpdated = true;
  }

  return { applicationId, selectedTemplateId: templateId, profileDefaultUpdated };
}
