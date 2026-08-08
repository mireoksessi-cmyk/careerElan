/*
  Phase 6I.6.9 - PREVIEW-ONLY structural completion.

  Lets Step 9 (and any other pre-completion canonical preview surface)
  demonstrate all four canonical template designs even when the
  underlying resume has zero or partial real content, WITHOUT weakening
  persisted-resume validation and WITHOUT ever writing placeholder text
  back into career_memory/career_profiles/career_resume_versions/
  source_documents/applications/AI prompts/AI insights/overlays.

  This module is called ONLY from the resume-preview route, on the
  in-memory ResumeStructuredModel it already resolved for rendering -
  never on a write/save/import path (grep confirms no other caller).
  Nothing in this codebase persists a ResumeStructuredModel built by
  this function; every real save goes through
  buildManualResumeStructuredModel/buildStructuredResume instead, which
  never call this file. PREVIEW_PLACEHOLDER_SOURCE_TRACE's own
  sourceSectionId ("preview-placeholder") is a self-documenting, grep-
  able marker distinct from MANUAL_ENTRY_SOURCE_TRACE ("manual-entry") -
  a placeholder value must never be mistaken for something the user
  actually typed, and this id can never collide with a real one (see
  manualResumeRuntimeMapper.ts's own sentinel-trace precedent).

  Deterministic merge rules (Phase 6I.6.9 spec):
    1. Real selected-resume data always wins - a field/section already
       populated is returned completely unchanged.
    2. Placeholder values fill ONLY the rendering gap required to
       demonstrate a section's layout - one minimal, neutrally-labeled
       entry per empty section, never a fabricated specific ("Senior
       Software Engineer", "10 years", a metric, a school name, etc.).
    3. A real value is never replaced by a placeholder.
    4. No substantive fact is ever invented.

  languages: ResumeStructuredModel has no `languages` field at all (a
  pre-existing, disclosed schema gap - see manualResumeRuntimeMapper.ts's
  own header comment) - this function does not/cannot placeholder a
  field that does not exist on the type.
*/
import type {
  CredentialEntry,
  EducationEntry,
  ExperienceEntry,
  ProjectEntry,
  ResumeStructuredModel,
  SkillGroup,
  SourceTrace,
  StructuredTextValue,
} from "../../documentPreservation/resumeStructured/types";

export const PREVIEW_PLACEHOLDER_SOURCE_SECTION_ID = "preview-placeholder";

export const PREVIEW_PLACEHOLDER_SOURCE_TRACE: SourceTrace = {
  sourceSectionId: PREVIEW_PLACEHOLDER_SOURCE_SECTION_ID,
  sourceBlockIds: [],
  sourceElementIds: [],
};

export function isPreviewPlaceholderSourceTrace(trace: SourceTrace | null | undefined): boolean {
  return !!trace && trace.sourceSectionId === PREVIEW_PLACEHOLDER_SOURCE_SECTION_ID;
}

function placeholderText(value: string): StructuredTextValue {
  return { value, confidence: 0, extractionMethod: "fallback", source: PREVIEW_PLACEHOLDER_SOURCE_TRACE };
}

function hasRenderableIdentity(resume: ResumeStructuredModel): boolean {
  return Boolean(resume.identity?.fullName) || Boolean(resume.identity && resume.identity.otherContactLines.length > 0);
}

function placeholderExperience(id: string): ExperienceEntry {
  return {
    id,
    organization: placeholderText("EXPERIENCE"),
    role: undefined,
    location: undefined,
    startDateText: undefined,
    endDateText: undefined,
    dateRangeText: undefined,
    bullets: [],
    descriptionParagraphs: [],
    content: [],
    hierarchicalContent: [],
    hasHierarchicalStructure: false,
    rawHeaderText: "EXPERIENCE",
    source: PREVIEW_PLACEHOLDER_SOURCE_TRACE,
    isVolunteer: false,
    isUncertain: false,
    reasonCodes: [],
  };
}

function placeholderEducation(id: string): EducationEntry {
  const institution = placeholderText("EDUCATION");
  return {
    id,
    institution,
    credential: undefined,
    fieldOfStudy: undefined,
    location: undefined,
    credentials: [],
    fieldsOfStudy: [],
    institutions: [institution],
    startDateText: undefined,
    endDateText: undefined,
    dateRangeText: undefined,
    gpa: undefined,
    honors: [],
    details: [],
    rawHeaderText: "EDUCATION",
    source: PREVIEW_PLACEHOLDER_SOURCE_TRACE,
    isUncertain: false,
    reasonCodes: [],
  };
}

function placeholderCredential(id: string): CredentialEntry {
  const name = placeholderText("CERTIFICATIONS");
  return {
    id,
    name,
    issuer: undefined,
    credentialId: undefined,
    issueDateText: undefined,
    expiryDateText: undefined,
    location: undefined,
    names: [name],
    issuers: [],
    details: [],
    kind: "certification",
    rawHeaderText: "CERTIFICATIONS",
    source: PREVIEW_PLACEHOLDER_SOURCE_TRACE,
    isUncertain: false,
    reasonCodes: [],
  };
}

function placeholderProject(id: string): ProjectEntry {
  return {
    id,
    name: placeholderText("PROJECTS"),
    role: undefined,
    dateRangeText: undefined,
    technologies: [],
    bullets: [],
    descriptionParagraphs: [],
    content: [],
    rawHeaderText: "PROJECTS",
    source: PREVIEW_PLACEHOLDER_SOURCE_TRACE,
    isUncertain: false,
    reasonCodes: [],
  };
}

/*
  Returns `resume` UNCHANGED (same reference) whenever it already renders
  successfully as-is (State D / Rule 1/3) - a genuinely complete resume
  is never touched by this function, and no unrelated section gets a
  placeholder just because one other section is missing (Rule 2 governs
  per-section, not per-resume).
*/
export function buildPreviewOnlyResume(resume: ResumeStructuredModel): ResumeStructuredModel {
  const needsIdentityPlaceholder = !hasRenderableIdentity(resume);
  const needsSummaryPlaceholder = !resume.professionalSummary || resume.professionalSummary.text.trim().length === 0;
  const needsSkillsPlaceholder = !resume.skillGroups.some((g) => g.skills.length > 0);
  const needsExperiencePlaceholder = resume.professionalExperience.length === 0;
  const needsEducationPlaceholder = resume.education.length === 0;
  const needsCredentialsPlaceholder = resume.credentials.length === 0;
  const needsProjectsPlaceholder = resume.projects.length === 0;

  const needsAnyPlaceholder =
    needsIdentityPlaceholder ||
    needsSummaryPlaceholder ||
    needsSkillsPlaceholder ||
    needsExperiencePlaceholder ||
    needsEducationPlaceholder ||
    needsCredentialsPlaceholder ||
    needsProjectsPlaceholder;

  if (!needsAnyPlaceholder) return resume;

  return {
    ...resume,
    identity: needsIdentityPlaceholder
      ? { ...(resume.identity ?? { otherContactLines: [] }), fullName: placeholderText("YOUR NAME") }
      : resume.identity,
    professionalSummary: needsSummaryPlaceholder ? { text: "PROFESSIONAL SUMMARY", source: PREVIEW_PLACEHOLDER_SOURCE_TRACE } : resume.professionalSummary,
    skillGroups: needsSkillsPlaceholder ? ([{ label: undefined, skills: ["SKILLS"], source: PREVIEW_PLACEHOLDER_SOURCE_TRACE }] as SkillGroup[]) : resume.skillGroups,
    professionalExperience: needsExperiencePlaceholder ? [placeholderExperience("preview-placeholder-experience-0")] : resume.professionalExperience,
    education: needsEducationPlaceholder ? [placeholderEducation("preview-placeholder-education-0")] : resume.education,
    credentials: needsCredentialsPlaceholder ? [placeholderCredential("preview-placeholder-credential-0")] : resume.credentials,
    projects: needsProjectsPlaceholder ? [placeholderProject("preview-placeholder-project-0")] : resume.projects,
  };
}
