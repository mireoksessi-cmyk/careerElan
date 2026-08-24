/*
  Phase 6I.6.8 - Manual Career Memory -> Canonical Runtime bridge.

  ResumeStructuredModel (lib/documentPreservation/resumeStructured/types.ts)
  is built around content EXTRACTED from a real uploaded document: every
  StructuredTextValue carries a SourceTrace pointing back to actual Phase 1
  parser blocks. A manually-typed Career Memory entry has no source
  document at all - there is nothing to trace to.

  Per this round's explicit product decision: Manual Career Memory is
  intentionally source-document-free. Rather than fabricating a fake
  uploaded document (or redesigning ResumeStructuredModel to add an
  "optional" SourceTrace, which this round's own instruction forbids),
  every manually-entered field is tagged with ONE explicit, documented
  sentinel SourceTrace value - MANUAL_ENTRY_SOURCE_TRACE - whose
  sourceSectionId ("manual-entry") can never collide with a real Phase 1
  extractor id (those are always opaque generated ids, never this literal
  string). This is structural plumbing only: it satisfies the type's
  required shape so the EXISTING registry/renderer/persistence pipeline
  can be reused unmodified. It is never surfaced as resume content, never
  treated as parsing evidence, and never used to claim a manual entry came
  from a real document.

  mappers.ts's own EMPTY_SOURCE_TRACE ({sourceSectionId:"", ...}) already
  establishes the precedent that a non-document-derived SourceTrace is an
  accepted, existing convention in this codebase (used there for legacy DB
  rows with no recoverable envelope) - this file follows that same
  precedent with a self-documenting, non-empty id instead of an empty one.

  languages: ResumeStructuredModel DOES carry `languages: LanguageEntry[]`
  (types.ts), and the template layer consumes it - so the note that used
  to sit here, claiming no such field existed anywhere, described a schema
  that has since changed. career_memory.languages is therefore mapped, and
  the mapping is a rename rather than a parse: the editor already stores
  each entry as two separate typed fields ({language, level}), which is
  the same name/proficiency pair LanguageEntry holds. Nothing is split out
  of a free-text line here, so the extractor's "A (B)" reading rule has
  nothing to act on and no second parser is introduced. A row whose
  `language` is blank is dropped, matching every other isNonEmpty* rule in
  this file; a blank `level` maps to an absent proficiency rather than an
  empty string, so a template renders the bare language name instead of a
  dangling separator.

  Two of the four templates cannot reach model.languages on their own.
  Professional ATS pairs languages into a custom section that shares their
  provenance, and Executive Minimal renders them inside its `custom` slot,
  whose visibility is `customSections.length > 0`. Neither finds anything
  when the only languages a resume has were typed rather than extracted.
  So the Languages field the user actually filled in is ALSO represented as
  a custom section here, carrying the same MANUAL_ENTRY_SOURCE_TRACE as
  every other manual field. That is a second view of one real answer the
  user gave, not a fabricated section: nothing is asserted that was not
  typed, and no uploaded sourceBlockId is invented to carry it.

  model.languages is deliberately kept as well. The templates that read it
  directly still see structured pairs, and the ones that do not get the
  section - and the two views cannot double up, because
  MANUAL_ENTRY_SOURCE_TRACE carries no sourceBlockIds: every template's
  coverage rule requires each of a section's own blocks to be claimed
  exactly once, an empty block list can never satisfy that, so the pairs
  stand down and the section renders alone. That is the shipped safety
  rule behaving as designed, and buildManualLanguageSection's own comment
  restates it where the dependency lives.

  schemaVersion: reuses the real Phase 1/2 parser's own
  RESUME_STRUCTURED_SCHEMA_VERSION constant (types.ts) rather than
  minting a second, parallel version string - this file originally
  defined its own local "resume-structured-v1" constant based on an
  incorrect grep read of test-fixture strings, which diverged from the
  real production value ("1.0.0", buildStructuredResume.ts) and broke
  postWriteBundleValidation's profile/version schema_version equality
  check for any profile that already had a real-upload-produced version
  (career_profiles.schema_version is set once at profile creation and
  never updated on later saves - found via real-account browser UAT
  against a profile with a prior uploaded resume, Phase 6I.6.8 Part G).

  Every id below is a caller-supplied deterministic string derived from
  the entry's own position (never Date.now()/Math.random()/crypto.
  randomUUID()), matching this codebase's established Runtime-layer
  convention (see runtime/types.ts's own header comment).
*/
import {
  RESUME_STRUCTURED_SCHEMA_VERSION,
  type AwardEntry,
  type CredentialEntry,
  type CustomResumeSection,
  type EducationEntry,
  type EntryContentBlock,
  type ExperienceEntry,
  type LanguageEntry,
  type MetricGrid,
  type ProjectEntry,
  type PublicationEntry,
  type ResumeIdentity,
  type ResumeSlotKey,
  type ResumeStructuredModel,
  type SkillGroup,
  type SourceTrace,
  type StructuredResumeValidationReport,
  type StructuredTextValue,
} from "../../documentPreservation/resumeStructured/types";
import { CANONICAL_RUNTIME_SERIALIZER_VERSION, type CanonicalResumeRuntime, type RuntimeVersionReason } from "../runtime/types";

export { RESUME_STRUCTURED_SCHEMA_VERSION };

export const MANUAL_ENTRY_SOURCE_SECTION_ID = "manual-entry";

/* The one sentinel value every manually-entered field is tagged with.
   Never a real Phase 1 sourceSectionId (those are opaque extractor-
   generated ids, never this literal string) - structural plumbing only,
   never resume content, never Career Memory "evidence" of a document
   that does not exist. */
export const MANUAL_ENTRY_SOURCE_TRACE: SourceTrace = {
  sourceSectionId: MANUAL_ENTRY_SOURCE_SECTION_ID,
  sourceBlockIds: [],
  sourceElementIds: [],
};

export function isManualEntrySourceTrace(trace: SourceTrace | null | undefined): boolean {
  return !!trace && trace.sourceSectionId === MANUAL_ENTRY_SOURCE_SECTION_ID;
}

function manualTextValue(raw: string | null | undefined): StructuredTextValue | undefined {
  const value = (raw ?? "").trim();
  if (!value) return undefined;
  return { value, confidence: 1, extractionMethod: "explicit-label", source: MANUAL_ENTRY_SOURCE_TRACE };
}

function manualDateRangeText(startDate?: string | null, endDate?: string | null, isCurrent?: boolean | null): StructuredTextValue | undefined {
  const start = (startDate ?? "").trim();
  const end = isCurrent ? "Present" : (endDate ?? "").trim();
  if (!start && !end) return undefined;
  const text = [start, end].filter(Boolean).join(" - ");
  return { value: text, confidence: 1, extractionMethod: "explicit-label", source: MANUAL_ENTRY_SOURCE_TRACE };
}

function manualContentBlock(id: string, text: string | null | undefined): EntryContentBlock[] {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];
  return [{ id: `${id}-body`, kind: "paragraph", text: trimmed, source: MANUAL_ENTRY_SOURCE_TRACE }];
}

function manualDescriptionParagraphs(text: string | null | undefined): StructuredTextValue[] {
  const value = manualTextValue(text);
  return value ? [value] : [];
}

// ============================================================
// Manual Career Memory row shapes (client-authored, matching the exact
// jsonb shapes app/career-memory/page.tsx's persistMemory() writes -
// EducationItem/WorkItem/VolunteerItem/CertificationItem/ProjectItem).
// ============================================================
/* The editor writes two different shapes into this one type: WorkItem
   names the party/title `company`/`jobTitle`, VolunteerItem names them
   `organization`/`role` (app/career-memory/page.tsx). buildExperienceEntry
   already reads whichever pair applies; the volunteer names are declared
   here so the emptiness gate below can read them too. */
export type ManualWorkEntry = { company?: string; jobTitle?: string; organization?: string; role?: string; location?: string; startDate?: string; endDate?: string; isCurrent?: boolean; description?: string };
export type ManualEducationEntry = { school?: string; program?: string; startDate?: string; endDate?: string; gpa?: string; coursework?: string };
export type ManualCertificationEntry = { name?: string; issuer?: string; date?: string; description?: string };
export type ManualProjectEntry = { name?: string; role?: string; dates?: string; description?: string };
export type ManualLanguageEntry = { language?: string; level?: string };

export type ManualCareerMemoryInput = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  linkedin?: string | null;
  headline?: string | null;
  summary?: string | null;
  skills?: string[] | null;
  experience?: ManualWorkEntry[] | null;
  volunteerExperience?: ManualWorkEntry[] | null;
  education?: ManualEducationEntry[] | null;
  certifications?: ManualCertificationEntry[] | null;
  projects?: ManualProjectEntry[] | null;
  languages?: ManualLanguageEntry[] | null;
};

function isNonEmptyWork(entry: ManualWorkEntry): boolean {
  return !!(entry.company?.trim() || entry.jobTitle?.trim() || entry.description?.trim());
}
/* Volunteer rows carry organization/role instead of company/jobTitle, so
   isNonEmptyWork's field names miss them: a volunteer entry with a real
   organization and role but no description read as blank and was dropped
   before buildExperienceEntry - which does understand both namings - ever
   saw it. Describing a volunteer post without writing a description is
   ordinary, so that entry has to survive. */
function isNonEmptyVolunteer(entry: ManualWorkEntry): boolean {
  return isNonEmptyWork(entry) || !!(entry.organization?.trim() || entry.role?.trim());
}
function isNonEmptyEducation(entry: ManualEducationEntry): boolean {
  return !!(entry.school?.trim() || entry.program?.trim());
}
function isNonEmptyCertification(entry: ManualCertificationEntry): boolean {
  return !!(entry.name?.trim() || entry.issuer?.trim());
}
function isNonEmptyProject(entry: ManualProjectEntry): boolean {
  return !!(entry.name?.trim() || entry.description?.trim());
}
/* A proficiency with no language names nothing, so the language itself is
   what makes the row real - deliberately narrower than the predicates
   above, which accept any one populated field. */
function isNonEmptyLanguage(entry: ManualLanguageEntry): boolean {
  return !!entry.language?.trim();
}

/*
  The user's Career Memory Languages field, expressed as a custom section so
  Professional ATS and Executive Minimal can render it through the rendering
  they already have. Heading is the field's own name; one line per entry, in
  the order entered, joined with the same em dash every template uses for a
  name/proficiency pair. A language with no level contributes its bare name
  rather than a dangling separator.

  Depends on MANUAL_ENTRY_SOURCE_TRACE carrying no sourceBlockIds: that is
  what makes every template's coverage rule decline to pair model.languages
  against this section, leaving exactly one Languages representation instead
  of two. Asserted in this mapper's own tests.
*/
function buildManualLanguageSection(languages: LanguageEntry[]): CustomResumeSection {
  return {
    id: "manual-languages",
    originalHeading: "Languages",
    displayHeading: "Languages",
    paragraphs: languages.map((language) => ({
      value: language.proficiency ? `${language.name} — ${language.proficiency}` : language.name,
      confidence: 1,
      extractionMethod: "explicit-label",
      source: MANUAL_ENTRY_SOURCE_TRACE,
    })),
    bullets: [],
    content: languages.map((language, i) => ({
      id: `manual-languages-${i}`,
      kind: "paragraph" as const,
      text: language.proficiency ? `${language.name} — ${language.proficiency}` : language.name,
      source: MANUAL_ENTRY_SOURCE_TRACE,
    })),
    sourceOrder: 900,
    source: MANUAL_ENTRY_SOURCE_TRACE,
  };
}

function buildExperienceEntry(id: string, entry: ManualWorkEntry, isVolunteer: boolean): ExperienceEntry {
  const organization = manualTextValue(isVolunteer ? (entry as unknown as { organization?: string }).organization ?? entry.company : entry.company);
  const role = manualTextValue(isVolunteer ? (entry as unknown as { role?: string }).role ?? entry.jobTitle : entry.jobTitle);
  return {
    id,
    organization,
    role,
    location: manualTextValue(entry.location),
    startDateText: manualTextValue(entry.startDate),
    endDateText: entry.isCurrent ? undefined : manualTextValue(entry.endDate),
    dateRangeText: manualDateRangeText(entry.startDate, entry.endDate, entry.isCurrent),
    bullets: [],
    descriptionParagraphs: manualDescriptionParagraphs(entry.description),
    content: manualContentBlock(id, entry.description),
    hierarchicalContent: [],
    hasHierarchicalStructure: false,
    rawHeaderText: [role?.value, organization?.value].filter(Boolean).join(" at ") || "",
    source: MANUAL_ENTRY_SOURCE_TRACE,
    isVolunteer,
    isUncertain: false,
    reasonCodes: [],
  };
}

function buildEducationEntry(id: string, entry: ManualEducationEntry): EducationEntry {
  const institution = manualTextValue(entry.school);
  const credential = manualTextValue(entry.program);
  return {
    id,
    institution,
    credential,
    fieldOfStudy: undefined,
    location: undefined,
    credentials: credential ? [credential] : [],
    fieldsOfStudy: [],
    institutions: institution ? [institution] : [],
    startDateText: manualTextValue(entry.startDate),
    endDateText: manualTextValue(entry.endDate),
    dateRangeText: manualDateRangeText(entry.startDate, entry.endDate, false),
    gpa: manualTextValue(entry.gpa),
    honors: [],
    details: manualDescriptionParagraphs(entry.coursework),
    rawHeaderText: [credential?.value, institution?.value].filter(Boolean).join(" - ") || "",
    source: MANUAL_ENTRY_SOURCE_TRACE,
    isUncertain: false,
    reasonCodes: [],
  };
}

function buildCredentialEntry(id: string, entry: ManualCertificationEntry): CredentialEntry {
  const name = manualTextValue(entry.name);
  const issuer = manualTextValue(entry.issuer);
  return {
    id,
    name,
    issuer,
    credentialId: undefined,
    issueDateText: manualTextValue(entry.date),
    expiryDateText: undefined,
    location: undefined,
    names: name ? [name] : [],
    issuers: issuer ? [issuer] : [],
    details: manualDescriptionParagraphs(entry.description),
    kind: "certification",
    rawHeaderText: [name?.value, issuer?.value].filter(Boolean).join(" - ") || "",
    source: MANUAL_ENTRY_SOURCE_TRACE,
    isUncertain: false,
    reasonCodes: [],
  };
}

function buildProjectEntry(id: string, entry: ManualProjectEntry): ProjectEntry {
  return {
    id,
    name: manualTextValue(entry.name),
    role: manualTextValue(entry.role),
    dateRangeText: manualTextValue(entry.dates),
    technologies: [],
    bullets: [],
    descriptionParagraphs: manualDescriptionParagraphs(entry.description),
    content: manualContentBlock(id, entry.description),
    rawHeaderText: entry.name?.trim() || "",
    source: MANUAL_ENTRY_SOURCE_TRACE,
    isUncertain: false,
    reasonCodes: [],
  };
}

/* Deterministic, honest validation report - there is no source document
   to count sections/blocks against (sourceSectionCount/sourceBlockCount
   are truthfully 0, not omitted or guessed), and nothing here is
   "invented" (every value is exactly what the user typed). */
function buildManualValidationReport(): StructuredResumeValidationReport {
  return {
    passed: true,
    sourceSectionCount: 0,
    representedSectionCount: 0,
    missingSectionIds: [],
    sourceBlockCount: 0,
    representedBlockCount: 0,
    missingBlockIds: [],
    duplicateBlockIds: [],
    inventedFactValues: [],
    volunteerMixedIntoProfessional: [],
    missingCustomSections: [],
    warnings: ["manual-entry: no source document exists for this resume; every field was entered directly by the user"],
  };
}

export function buildManualResumeStructuredModel(input: ManualCareerMemoryInput): ResumeStructuredModel {
  const fullName = [input.firstName, input.lastName].map((v) => (v ?? "").trim()).filter(Boolean).join(" ");
  const identity: ResumeIdentity = {
    fullName: manualTextValue(fullName),
    headline: manualTextValue(input.headline),
    email: manualTextValue(input.email),
    phone: manualTextValue(input.phone),
    location: manualTextValue(input.location),
    linkedin: manualTextValue(input.linkedin),
    portfolio: undefined,
    otherContactLines: [],
  };
  const hasIdentity = !!(identity.fullName || identity.headline || identity.email || identity.phone || identity.location || identity.linkedin);

  const summaryText = (input.summary ?? "").trim();
  const professionalSummary = summaryText ? { text: summaryText, source: MANUAL_ENTRY_SOURCE_TRACE } : undefined;

  const skillList = (input.skills ?? []).map((s) => s.trim()).filter(Boolean);
  const skillGroups: SkillGroup[] = skillList.length > 0 ? [{ label: undefined, skills: skillList, source: MANUAL_ENTRY_SOURCE_TRACE }] : [];

  const workEntries = (input.experience ?? []).filter(isNonEmptyWork);
  const volunteerEntries = (input.volunteerExperience ?? []).filter(isNonEmptyVolunteer);
  const educationEntries = (input.education ?? []).filter(isNonEmptyEducation);
  const certificationEntries = (input.certifications ?? []).filter(isNonEmptyCertification);
  const projectEntries = (input.projects ?? []).filter(isNonEmptyProject);
  const languageEntries = (input.languages ?? []).filter(isNonEmptyLanguage);

  const professionalExperience = workEntries.map((e, i) => buildExperienceEntry(`manual-experience-${i}`, e, false));
  const volunteerExperience = volunteerEntries.map((e, i) => buildExperienceEntry(`manual-volunteer-${i}`, e, true));
  const education = educationEntries.map((e, i) => buildEducationEntry(`manual-education-${i}`, e));
  const credentials = certificationEntries.map((e, i) => buildCredentialEntry(`manual-certification-${i}`, e));
  const projects = projectEntries.map((e, i) => buildProjectEntry(`manual-project-${i}`, e));
  const awards: AwardEntry[] = [];
  const publications: PublicationEntry[] = [];
  const languages: LanguageEntry[] = languageEntries.map((entry) => ({
    name: entry.language!.trim(),
    proficiency: entry.level?.trim() ? entry.level.trim() : undefined,
    source: MANUAL_ENTRY_SOURCE_TRACE,
  }));
  const customSections: CustomResumeSection[] = languages.length > 0 ? [buildManualLanguageSection(languages)] : [];
  const metricGrids: MetricGrid[] = [];

  const slotAvailability: Record<ResumeSlotKey, boolean> = {
    identity: hasIdentity,
    professional_summary: !!professionalSummary,
    core_skills: skillGroups.length > 0,
    professional_experience: professionalExperience.length > 0,
    volunteer_experience: volunteerExperience.length > 0,
    education: education.length > 0,
    certifications_licenses: credentials.length > 0,
    projects: projects.length > 0,
    awards: false,
    publications: false,
    additional_information: customSections.length > 0,
  };

  return {
    schemaVersion: RESUME_STRUCTURED_SCHEMA_VERSION,
    source: { fileName: "", fileType: "docx" },
    identity: hasIdentity ? identity : undefined,
    professionalSummary,
    skillGroups,
    professionalExperience,
    volunteerExperience,
    education,
    credentials,
    projects,
    awards,
    publications,
    languages,
    customSections,
    metricGrids,
    slotAvailability,
    validation: buildManualValidationReport(),
  };
}

/*
  Distinguishes, for a given user's EXISTING canonical runtime (or null),
  whether it's safe to preselect career_profiles.default_template_id as
  the Manual wizard's own Step 9 selection - the signal that distinguishes
  "this profile's CURRENT version came from an uploaded resume" (a prior
  default must NOT leak into a new Manual entry) from "this profile's
  current version is already a Manual entry" (its own persisted selection
  MAY be restored). Extracted as its own pure function so it can be
  unit/real-DB tested independent of the HTTP route that calls it.

  Uses existing.version.sourceDocumentId (career_resume_versions.
  source_document_id for the CURRENT version row specifically) - NOT
  existing.sourceDocuments.length. The latter was the original (buggy)
  implementation: runtime.sourceDocuments lists EVERY document ever
  attached to the whole profile (Phase 6D's profile-wide history), so
  once a profile had ANY real upload, that list stayed non-empty forever
  - even after a later version was purely manually entered - permanently
  misclassifying every subsequent manual edit as "uploaded" and silently
  losing the user's own persisted template selection on every re-entry.
  Found via real-account browser UAT against a profile with genuine
  upload history, Phase 6I.6.8 Part G.
*/
export function classifyPreviousVersionSource(existing: CanonicalResumeRuntime | null): "none" | "manual" | "uploaded" {
  if (!existing) return "none";
  return existing.version.sourceDocumentId ? "uploaded" : "manual";
}

export function buildManualCanonicalRuntime(
  input: ManualCareerMemoryInput,
  options: { reason: RuntimeVersionReason; parentVersionId?: string | null } = { reason: "initial" },
): CanonicalResumeRuntime {
  const resume = buildManualResumeStructuredModel(input);
  return {
    resume,
    metadata: { schemaVersion: RESUME_STRUCTURED_SCHEMA_VERSION, serializerVersion: CANONICAL_RUNTIME_SERIALIZER_VERSION },
    // version.id/createdAt are reassigned server-side by save_canonical_runtime()
    // regardless of what is supplied here (see mappers.ts's own comment on
    // validateRuntimeRoundTrip) - this placeholder is never persisted verbatim.
    version: { id: "manual-entry-pending", reason: options.reason, createdAt: new Date(0).toISOString(), parentVersionId: options.parentVersionId ?? undefined },
    sourceDocuments: [],
    serializerVersion: CANONICAL_RUNTIME_SERIALIZER_VERSION,
    overlayState: { history: [] },
  };
}
