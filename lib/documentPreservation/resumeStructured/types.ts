/*
  Resume Structured Model - Phase 2 feasibility gate. Consumes Phase 1's
  LosslessResumeDocument (lib/documentPreservation/losslessSemantic) and
  decomposes each section into entries/fields a future AI-tailoring
  layer and Professional ATS template can rely on. Dev-only side path,
  same as Phase 1 - not wired into any production route.

  Names here are deliberately scoped to this module only. lib/brand/
  types.ts already defines its own PoC-only ParsedExperienceEntry
  (jobTitle/company/dates/description) for a different, unrelated
  purpose (section-parser POC preview) - this module does not import
  from or extend that type, to avoid conceptual confusion between the
  two, even though TypeScript would not itself conflict on the names.

  Core invariant (mirrors Phase 1's own): every Phase 1 block must end
  up referenced by exactly one structured field/entry's source trace, OR
  be preserved verbatim in a residual bucket - never silently dropped,
  never invented. See structuredValidator.ts.
*/

export type ResumeSlotKey =
  | "identity"
  | "professional_summary"
  | "core_skills"
  | "professional_experience"
  | "volunteer_experience"
  | "education"
  | "certifications_licenses"
  | "projects"
  | "awards"
  | "publications"
  | "additional_information";

/*
  Points back to Phase 1's own deterministic ids - never a newly minted
  id. sourceElementIds is included when available (line-level blocks
  always carry it via block.sourceElementIds) so a value can be traced
  all the way to the original PDF/DOCX element, not just the block.
*/
export type SourceTrace = {
  sourceSectionId: string;
  sourceBlockIds: string[];
  sourceElementIds: string[];
};

export type ExtractionMethod = "explicit-label" | "layout-rule" | "pattern-rule" | "context-rule" | "fallback";

/*
  Every extracted scalar value carries its own confidence + method +
  trace - never a bare string. A field extracted with low confidence
  should be omitted (left undefined) rather than populated with a
  guess; this type exists for the cases where a value IS populated, to
  record how sure the extractor was and why.
*/
export type StructuredTextValue = {
  value: string;
  confidence: number;
  extractionMethod: ExtractionMethod;
  source: SourceTrace;
};

export type StructuredBullet = {
  id: string;
  text: string;
  source: SourceTrace;
};

export type ResumeIdentity = {
  fullName?: StructuredTextValue;
  headline?: StructuredTextValue;
  email?: StructuredTextValue;
  phone?: StructuredTextValue;
  location?: StructuredTextValue;
  linkedin?: StructuredTextValue;
  portfolio?: StructuredTextValue;
  otherContactLines: StructuredTextValue[];
};

export type ResumeSummary = {
  /* All summary paragraphs concatenated in source order, joined by
     "\n\n" - never rewritten, never shortened, never keyword-injected
     (section 7 of the spec). */
  text: string;
  source: SourceTrace;
};

export type SkillGroup = {
  label?: string;
  skills: string[];
  source: SourceTrace;
};

export type ExperienceEntry = {
  id: string;

  organization?: StructuredTextValue;
  role?: StructuredTextValue;
  location?: StructuredTextValue;

  startDateText?: StructuredTextValue;
  endDateText?: StructuredTextValue;
  dateRangeText?: StructuredTextValue;

  bullets: StructuredBullet[];
  descriptionParagraphs: StructuredTextValue[];

  /* The raw entry-header line(s) this entry was segmented from, kept
     verbatim regardless of how much structure was confidently
     extracted - the safety net for "wrong company beats no company". */
  rawHeaderText: string;

  source: SourceTrace;

  isVolunteer: boolean;
  isUncertain: boolean;
  reasonCodes: string[];
};

export type EducationEntry = {
  id: string;

  institution?: StructuredTextValue;
  credential?: StructuredTextValue;
  fieldOfStudy?: StructuredTextValue;
  location?: StructuredTextValue;

  startDateText?: StructuredTextValue;
  endDateText?: StructuredTextValue;
  dateRangeText?: StructuredTextValue;

  gpa?: StructuredTextValue;
  honors: StructuredTextValue[];
  details: StructuredTextValue[];

  rawHeaderText: string;
  source: SourceTrace;
  isUncertain: boolean;
  reasonCodes: string[];
};

export type CredentialEntry = {
  id: string;

  name?: StructuredTextValue;
  issuer?: StructuredTextValue;
  credentialId?: StructuredTextValue;
  issueDateText?: StructuredTextValue;
  expiryDateText?: StructuredTextValue;
  location?: StructuredTextValue;

  details: StructuredTextValue[];

  kind: "certification" | "license" | "registration" | "unknown";
  rawHeaderText: string;
  source: SourceTrace;
  isUncertain: boolean;
  reasonCodes: string[];
};

export type ProjectEntry = {
  id: string;

  name?: StructuredTextValue;
  role?: StructuredTextValue;
  dateRangeText?: StructuredTextValue;
  technologies: StructuredTextValue[];

  bullets: StructuredBullet[];
  descriptionParagraphs: StructuredTextValue[];

  rawHeaderText: string;
  source: SourceTrace;
  isUncertain: boolean;
  reasonCodes: string[];
};

export type AwardEntry = {
  id: string;

  name?: StructuredTextValue;
  issuer?: StructuredTextValue;
  dateText?: StructuredTextValue;
  details: StructuredTextValue[];

  rawHeaderText: string;
  source: SourceTrace;
  isUncertain: boolean;
  reasonCodes: string[];
};

export type PublicationEntry = {
  id: string;

  title?: StructuredTextValue;
  authors: StructuredTextValue[];
  publisherOrVenue?: StructuredTextValue;
  dateText?: StructuredTextValue;
  urlOrDoi?: StructuredTextValue;

  details: StructuredTextValue[];

  rawHeaderText: string;
  source: SourceTrace;
  isUncertain: boolean;
  reasonCodes: string[];
};

/*
  Phase 5D.2B - a single Value/Label pair recovered from a KPI grid,
  metric dashboard, stat-card row, or similar Number+Caption structure
  ("$212M+" paired with "CUMULATIVE CONTRACT VALUE"). Each side keeps its own
  independent source trace (they usually come from two different Phase
  1 blocks, and - because of a known, pre-existing Phase 1 section-
  boundary bug this round deliberately does not touch, see
  metricGridExtractor.ts's own header comment - can even come from two
  different Phase 1 sections) rather than being merged into one, so
  block/section coverage checks still resolve correctly no matter which
  Phase 1 section either side actually landed in.
*/
export type MetricEntry = {
  id: string;
  value: StructuredTextValue;
  label: StructuredTextValue;
};

/*
  A grid of MetricEntry, in left-to-right / top-to-bottom order exactly
  as detected (never re-sorted by value/label content) - `columns` is
  the number of entries found in the grid's first row-pair (2 for a
  2-column card row, 4 for a 4-column KPI band, 1 for a vertically-
  stacked single-column Score Panel).
*/
export type MetricGrid = {
  id: string;
  entries: MetricEntry[];
  columns: number;
  source: SourceTrace;
};

export type CustomResumeSection = {
  id: string;

  originalHeading: string | null;
  displayHeading: string | null;

  paragraphs: StructuredTextValue[];
  bullets: StructuredBullet[];

  sourceOrder: number;
  source: SourceTrace;
};

export type StructuredResumeValidationReport = {
  passed: boolean;

  sourceSectionCount: number;
  representedSectionCount: number;
  missingSectionIds: string[];

  sourceBlockCount: number;
  representedBlockCount: number;
  missingBlockIds: string[];
  duplicateBlockIds: string[];

  inventedFactValues: string[];

  volunteerMixedIntoProfessional: string[];

  missingCustomSections: string[];

  warnings: string[];
};

export type ResumeStructuredModel = {
  schemaVersion: string;

  source: {
    fileName: string;
    fileType: "pdf" | "docx";
  };

  identity?: ResumeIdentity;
  professionalSummary?: ResumeSummary;
  skillGroups: SkillGroup[];

  professionalExperience: ExperienceEntry[];
  volunteerExperience: ExperienceEntry[];

  education: EducationEntry[];

  credentials: CredentialEntry[];
  projects: ProjectEntry[];
  awards: AwardEntry[];
  publications: PublicationEntry[];

  customSections: CustomResumeSection[];
  metricGrids: MetricGrid[];

  slotAvailability: Record<ResumeSlotKey, boolean>;

  validation: StructuredResumeValidationReport;
};
