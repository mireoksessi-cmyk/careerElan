/*
  Phase 6I.6.14 - per-resume canonical template ownership.

  Root cause this file fixes: every existing template read/write path
  (canonicalTemplateGate.ts, canonicalTemplatePreferenceService.ts,
  template-preference/route.ts) resolves ONLY career_profiles.
  default_template_id - a single value keyed by user_id (career_profiles
  has a UNIQUE(user_id) constraint, confirmed via \d career_profiles).
  Since a user's uploaded resumes (the `resumes` table, many rows per
  user) all bridge into that SAME one profile via canonical import
  (canonicalResumeImportService.ts's own ensureProfile() call - it adds
  to an existing profile, never requires zero profiles), every uploaded
  resume was reading/writing the exact same shared default_template_id.
  Changing one resume's template silently changed the visible template
  for every other resume, and the Manual ("Career Memory Resume")
  identity, since Manual's own Step 9 (career-memory/page.tsx) PUTs to
  the exact same career_profiles.default_template_id via the exact same
  template-preference endpoint.

  Fix (no migration): reuse `resumes.selected_template` - a text column
  already added by supabase/migrations/20260721010218_resume_preview_
  fields.sql, confirmed unreferenced anywhere in application code (grep
  for the bare "selected_template" substring, excluding "_id" suffix,
  returns zero hits outside that migration file and one prior-round
  comment confirming it was dead) - as each UPLOADED resume's own
  explicit, resume-scoped template override. career_profiles.
  default_template_id keeps its existing meaning as (a) the Manual/
  Career-Memory-authored resume's own effective template (Manual has no
  separate identity table row of its own to attach a preference to -
  it IS the profile's own identity/summary_text/preferences) and (b)
  the backward-compatible fallback for any uploaded resume that has
  never had an explicit per-resume preference set (Phase 6I.6.14 spec
  section 22's own compatibility requirement: "No explicit resume
  preference -> use profile default. Once user sets a template for that
  resume -> explicit resume-level preference takes precedence.").

  This does NOT touch applications.selected_template_id or
  applicationTemplateResolver.ts - an application's OWN template
  override remains a completely separate, already-correct axis (see
  that file's own priority chain, unchanged by this file).
*/
import type { SupabaseClient } from "@supabase/supabase-js";
import { NotFoundError, PersistenceError } from "../errors/domainErrors";
import type { CanonicalRepositoryBundle } from "../repositories/createRepositories";
import type { TemplateId } from "../../resumeTemplates/contracts/types";
import { validateTemplateId } from "../../resumeTemplates/registry/templateRegistry";
import { resolveCanonicalResumeContext } from "./resolveCanonicalResumeContext";
import { SelectedResumeUnavailableError } from "../errors/domainErrors";

export type ResumeTemplateResolution =
  | { kind: "legacy" }
  | { kind: "selection-required"; profileId: string }
  | {
      kind: "canonical";
      templateId: TemplateId;
      /* "resume-explicit": resumes.selected_template was set for this
         exact resume. "profile-default": no explicit preference yet -
         falling back to career_profiles.default_template_id (the
         compatibility path, see this file's own header comment). */
      source: "resume-explicit" | "profile-default";
      profileId: string;
      versionId: string;
    };

/*
  Resolves "what canonical template renders THIS specific uploaded
  resume" - never the currently-selected resume, never the profile's
  globally-latest version, matching spec section 11's explicit
  prohibition list. Ownership-checked against `resumes` directly (never
  trusts resumeId alone) before doing anything else.
*/
export async function resolveResumeTemplate(
  repos: CanonicalRepositoryBundle,
  client: SupabaseClient,
  userId: string,
  resumeId: string
): Promise<ResumeTemplateResolution> {
  const { data: resumeRow, error: resumeError } = await client
    .from("resumes")
    .select("id, selected_template")
    .eq("id", resumeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (resumeError || !resumeRow) {
    throw new NotFoundError("Resume");
  }

  let context;
  try {
    context = await resolveCanonicalResumeContext({ mode: "session", repos, client, userId, resumeId });
  } catch (error) {
    /*
      "not-yet-importable" means this exact resume has never been
      bridged into Canonical Career Memory - a real, current, non-error
      state (spec section 6/11: the fallback for a genuinely
      non-canonical resume is the existing original-file preview, not
      an error). Any OTHER SelectedResumeUnavailableError reason
      (resume-deleted, resume-not-owned) is a real problem and must
      propagate, not be silently swallowed into "legacy".
    */
    if (error instanceof SelectedResumeUnavailableError && error.reason === "not-yet-importable") {
      return { kind: "legacy" };
    }
    throw error;
  }

  if (context.status !== "resolved") {
    // "not-canonical" (career_memory-authored - cannot apply to a
    // `resumes` row at all) or "legacy-only" (no profile exists yet).
    return { kind: "legacy" };
  }

  const explicitRaw = typeof resumeRow.selected_template === "string" ? resumeRow.selected_template.trim() : "";
  if (explicitRaw) {
    try {
      const templateId = validateTemplateId(explicitRaw);
      return { kind: "canonical", templateId, source: "resume-explicit", profileId: context.profileId, versionId: context.versionId };
    } catch {
      // A stored value outside the current known template set (e.g. a
      // retired id) - fall through to the profile-default path below
      // rather than erroring a Preview click.
    }
  }

  const profile = await repos.profiles.getByUserId(userId);
  if (profile?.default_template_id) {
    const templateId = validateTemplateId(profile.default_template_id);
    return { kind: "canonical", templateId, source: "profile-default", profileId: context.profileId, versionId: context.versionId };
  }

  return { kind: "selection-required", profileId: context.profileId };
}

/*
  Sets Resume B's OWN template preference - resumes.selected_template
  for that row only. Never touches career_profiles.default_template_id
  (spec section 12: "persist template for B only... A/C unchanged").
  Ownership-checked the same way as resolveResumeTemplate() above.
*/
export async function setResumeTemplatePreference(
  client: SupabaseClient,
  userId: string,
  resumeId: string,
  rawTemplateId: string
): Promise<{ resumeId: string; templateId: TemplateId }> {
  const templateId = validateTemplateId(rawTemplateId);

  const { data: resumeRow, error: findError } = await client
    .from("resumes")
    .select("id")
    .eq("id", resumeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (findError || !resumeRow) {
    throw new NotFoundError("Resume");
  }

  const { error: updateError } = await client
    .from("resumes")
    .update({ selected_template: templateId })
    .eq("id", resumeId)
    .eq("user_id", userId);
  if (updateError) {
    throw new PersistenceError("could not save resume template preference");
  }

  return { resumeId, templateId };
}
