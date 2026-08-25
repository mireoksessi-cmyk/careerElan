/*
  The direction that was missing.

  manualResumeRuntimeMapper.ts turns a typed Career Memory row into a
  canonical runtime. Nothing turned a canonical runtime back into the
  shape the 1-8 editor edits, so an uploaded resume could be parsed,
  previewed and generated from - but never opened and corrected. This
  file is that return trip, plus the merge that lets the corrected draft
  become a new canonical version without losing what the editor cannot
  represent.

  Two functions, two jobs:

  canonicalRuntimeToCareerMemoryInput()
    runtime -> ManualCareerMemoryInput, for pre-filling the editor.
    Nothing is invented. A field the canonical model does not carry
    comes back undefined and the user sees an empty input, which is the
    honest state: the parser did not find it. In particular the Career
    Goals step (target roles/industry/location, salary, goal summary) has
    NO canonical counterpart - a resume states experience, not what its
    author wants next - so those are never filled from resume text. They
    are carried from whatever the user themselves already typed.

  buildUserConfirmedRuntime()
    draft + parent runtime -> the runtime to persist as the next version.
    The draft owns everything the editor owns. Everything the editor
    cannot reach - awards, publications, custom sections, metric grids -
    is carried from the parent untouched, because the alternative is
    deleting a user's awards because our form has no box for them.

  Neither function contains any per-document, per-employer or per-file
  logic. Both work from the structured model alone.
*/
import {
  buildManualResumeStructuredModel,
  type ManualCareerMemoryInput,
  type ManualCertificationEntry,
  type ManualEducationEntry,
  type ManualLanguageEntry,
  type ManualProjectEntry,
  type ManualWorkEntry,
} from "./manualResumeRuntimeMapper";
import { CANONICAL_RUNTIME_SERIALIZER_VERSION, type CanonicalResumeRuntime } from "../runtime/types";
import type {
  CredentialEntry,
  EducationEntry,
  ExperienceEntry,
  ProjectEntry,
  ResumeStructuredModel,
  StructuredTextValue,
} from "@/lib/documentPreservation/resumeStructured/types";

/* A StructuredTextValue's text, or undefined - never "" - so an absent
   canonical field renders as an empty input rather than a blank string
   the user has to notice and delete. */
function text(value: StructuredTextValue | undefined | null): string | undefined {
  const trimmed = (value?.value ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/*
  The editor has one description box per entry; the canonical model has
  bullets and paragraphs in an order-preserving list. Joining on newlines
  keeps every line and its order, which is what a user needs to correct
  it. Nothing is summarised or dropped.
*/
function describe(entry: { descriptionParagraphs: StructuredTextValue[]; bullets: { text: string }[] }): string | undefined {
  const lines = [
    ...entry.descriptionParagraphs.map((paragraph) => (paragraph.value ?? "").trim()),
    ...entry.bullets.map((bullet) => (bullet.text ?? "").trim()),
  ].filter((line) => line.length > 0);
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function workEntry(entry: ExperienceEntry): ManualWorkEntry {
  return {
    company: text(entry.organization),
    jobTitle: text(entry.role),
    organization: text(entry.organization),
    role: text(entry.role),
    location: text(entry.location),
    startDate: text(entry.startDateText) ?? text(entry.dateRangeText),
    endDate: text(entry.endDateText),
    description: describe(entry),
  };
}

function educationEntry(entry: EducationEntry): ManualEducationEntry {
  return {
    school: text(entry.institution),
    /* The editor's single "program" box. fieldOfStudy is the more
       specific of the two when both exist; credential alone otherwise. */
    program: text(entry.fieldOfStudy) ?? text(entry.credential),
    startDate: text(entry.startDateText) ?? text(entry.dateRangeText),
    endDate: text(entry.endDateText),
    gpa: text(entry.gpa),
  };
}

function certificationEntry(entry: CredentialEntry): ManualCertificationEntry {
  return {
    name: text(entry.name),
    issuer: text(entry.issuer),
    date: text(entry.issueDateText),
  };
}

function projectEntry(entry: ProjectEntry): ManualProjectEntry {
  return {
    name: text(entry.name),
    role: text(entry.role),
    dates: text(entry.dateRangeText),
    description: describe(entry),
  };
}

/*
  Career Goals (step 8) is the one step with no canonical source. Passing
  the user's existing values through keeps them when an uploaded resume
  is edited by someone who already filled that step in; leaving them out
  entirely would silently clear it.
*/
export type CareerGoalsCarry = Pick<
  ManualCareerMemoryInput,
  never
> & {
  targetRoles?: string[] | null;
  targetIndustry?: string | null;
  targetLocation?: string | null;
  salaryExpectation?: string | null;
  careerGoalSummary?: string | null;
};

export function canonicalRuntimeToCareerMemoryInput(runtime: CanonicalResumeRuntime): ManualCareerMemoryInput {
  const resume = runtime.resume;
  const identity = resume.identity;
  const full = (identity?.fullName?.value ?? "").trim();
  /* One name field upstream, two boxes here. The last whitespace-
     separated token is the surname and everything before it the given
     name(s) - and a single-token name stays entirely in firstName rather
     than being split into a surname it does not have. */
  const parts = full.length > 0 ? full.split(/\s+/) : [];
  const lastName = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const firstName = parts.length > 1 ? parts.slice(0, -1).join(" ") : (parts[0] ?? undefined);

  return {
    firstName,
    lastName,
    email: text(identity?.email),
    phone: text(identity?.phone),
    location: text(identity?.location),
    linkedin: text(identity?.linkedin),
    headline: text(identity?.headline),
    summary: resume.professionalSummary?.text?.trim() || undefined,
    /* Group labels are a canonical-only concept; the editor holds one
       flat list, so the groups are concatenated in order. */
    skills: resume.skillGroups.flatMap((group) => group.skills).map((skill) => skill.trim()).filter(Boolean),
    experience: resume.professionalExperience.map(workEntry),
    volunteerExperience: resume.volunteerExperience.map(workEntry),
    education: resume.education.map(educationEntry),
    certifications: resume.credentials.map(certificationEntry),
    projects: resume.projects.map(projectEntry),
    languages: resume.languages.map<ManualLanguageEntry>((language) => ({
      language: language.name,
      level: language.proficiency ?? undefined,
    })),
  };
}

/*
  Which of the parent's custom sections the draft's Languages field now
  speaks for.

  Identified by provenance, never by heading text: a parent language
  entry records the Phase 1 section it was read from, so any custom
  section carrying that same sourceSectionId is the raw form of the very
  languages the user just edited. Keeping both would render Languages
  twice - once from the section, once from the draft's own entries. Every
  other custom section is untouched.
*/
function languageOwnedSectionIds(parent: ResumeStructuredModel): Set<string> {
  const owned = new Set<string>();
  for (const language of parent.languages) {
    if (language.source?.sourceSectionId) owned.add(language.source.sourceSectionId);
  }
  return owned;
}

export function buildUserConfirmedRuntime(
  draft: ManualCareerMemoryInput,
  parent: CanonicalResumeRuntime,
): CanonicalResumeRuntime {
  const confirmed = buildManualResumeStructuredModel(draft);
  const parentResume = parent.resume;
  const languageOwned = languageOwnedSectionIds(parentResume);

  /*
    The draft's own synthesized Languages section (the manual mapper adds
    one so Professional ATS and Executive Minimal can see typed
    languages) plus every parent section the draft does not speak for.
    Order: the parent's sections keep their relative order and come
    first, because they are the document's own; the synthesized one is an
    addition, not a member of the original document.
  */
  const carriedCustomSections = parentResume.customSections.filter(
    (section) => !languageOwned.has(section.source?.sourceSectionId ?? ""),
  );

  const resume: ResumeStructuredModel = {
    ...confirmed,
    /*
      Carried from the parent verbatim. The 1-8 editor has no box for any
      of these, so re-deriving them from the draft would mean deleting
      them. metricGrids in particular are value/label pairs with their
      own provenance - flattening them into text would be a silent
      downgrade, so they move across as they are.
    */
    awards: parentResume.awards,
    publications: parentResume.publications,
    customSections: [...carriedCustomSections, ...confirmed.customSections],
    metricGrids: parentResume.metricGrids,
    slotAvailability: {
      ...confirmed.slotAvailability,
      awards: parentResume.awards.length > 0,
      publications: parentResume.publications.length > 0,
      additional_information:
        confirmed.slotAvailability.additional_information || carriedCustomSections.length > 0,
    },
    /*
      The source envelope describes where the ORIGINAL document came
      from. It is metadata about provenance, not content the editor
      touched, so it stays pointing at the imported file.
    */
    source: parentResume.source,
  };

  return {
    resume,
    metadata: { schemaVersion: resume.schemaVersion, serializerVersion: CANONICAL_RUNTIME_SERIALIZER_VERSION },
    /*
      parentVersionId links V2 to the version it was edited from, so the
      import stays reachable as history rather than being replaced.

      sourceDocuments is deliberately EMPTY. classifyPreviousVersionSource
      reads version.sourceDocumentId to decide "uploaded vs manual", and a
      user-confirmed edit is not a parser snapshot - copying the import's
      source document id here would make every later check mistake this
      version for a fresh upload. The original import row keeps its own
      link, and the stored file is neither moved nor deleted.
    */
    version: {
      id: "user-confirmed-pending",
      /* "user_edit" already exists in RuntimeVersionReason and means
         exactly this: a version the person themselves confirmed, as
         distinct from "import". No new vocabulary is introduced. */
      reason: "user_edit",
      createdAt: new Date(0).toISOString(),
      parentVersionId: parent.version?.id,
    },
    sourceDocuments: [],
    serializerVersion: CANONICAL_RUNTIME_SERIALIZER_VERSION,
    overlayState: { history: [] },
  };
}

/*
  The career_memory column payload the atomic RPC upserts. Only columns
  the 1-8 editor owns - template/style/selection columns are absent on
  purpose, so saving content cannot re-pick a design.
*/
export function careerMemoryColumnsFromDraft(
  draft: ManualCareerMemoryInput,
  goals: CareerGoalsCarry = {},
): Record<string, unknown> {
  return {
    first_name: draft.firstName ?? null,
    last_name: draft.lastName ?? null,
    email: draft.email ?? null,
    phone: draft.phone ?? null,
    location: draft.location ?? null,
    linkedin: draft.linkedin ?? null,
    headline: draft.headline ?? null,
    summary: draft.summary ?? null,
    skills: draft.skills ?? [],
    experience: draft.experience ?? [],
    volunteer_experience: draft.volunteerExperience ?? [],
    education: draft.education ?? [],
    certifications: draft.certifications ?? [],
    projects: draft.projects ?? [],
    languages: draft.languages ?? [],
    target_roles: goals.targetRoles ?? [],
    target_industry: goals.targetIndustry ?? null,
    target_location: goals.targetLocation ?? null,
    salary_expectation: goals.salaryExpectation ?? null,
    career_goal_summary: goals.careerGoalSummary ?? null,
  };
}
