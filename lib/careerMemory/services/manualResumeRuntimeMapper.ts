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

  languages: ResumeStructuredModel has no `languages` field anywhere (see
  mappers.ts's own header comment, "LANGUAGES: A DB-ONLY, RUNTIME-
  UNSUPPORTED TABLE") - a pre-existing, disclosed schema gap this file
  does not close (that would be a schema redesign, explicitly out of
  scope this round). career_memory.languages is therefore not mapped here
  and stays exactly what it always was: Career Memory data with no
  canonical-resume-rendering counterpart.

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
export type ManualWorkEntry = { company?: string; jobTitle?: string; location?: string; startDate?: string; endDate?: string; isCurrent?: boolean; description?: string };
export type ManualEducationEntry = { school?: string; program?: string; startDate?: string; endDate?: string; gpa?: string; coursework?: string };
export type ManualCertificationEntry = { name?: string; issuer?: string; date?: string; description?: string };
export type ManualProjectEntry = { name?: string; role?: string; dates?: string; description?: string };

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
};

function isNonEmptyWork(entry: ManualWorkEntry): boolean {
  return !!(entry.company?.trim() || entry.jobTitle?.trim() || entry.description?.trim());
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
  const volunteerEntries = (input.volunteerExperience ?? []).filter(isNonEmptyWork);
  const educationEntries = (input.education ?? []).filter(isNonEmptyEducation);
  const certificationEntries = (input.certifications ?? []).filter(isNonEmptyCertification);
  const projectEntries = (input.projects ?? []).filter(isNonEmptyProject);

  const professionalExperience = workEntries.map((e, i) => buildExperienceEntry(`manual-experience-${i}`, e, false));
  const volunteerExperience = volunteerEntries.map((e, i) => buildExperienceEntry(`manual-volunteer-${i}`, e, true));
  const education = educationEntries.map((e, i) => buildEducationEntry(`manual-education-${i}`, e));
  const credentials = certificationEntries.map((e, i) => buildCredentialEntry(`manual-certification-${i}`, e));
  const projects = projectEntries.map((e, i) => buildProjectEntry(`manual-project-${i}`, e));
  const awards: AwardEntry[] = [];
  const publications: PublicationEntry[] = [];
  const languages: LanguageEntry[] = [];
  const customSections: CustomResumeSection[] = [];
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
    additional_information: false,
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
