/*
  Phase 6C - Mapper Layer. Connects the Phase 6A.2 Runtime Layer
  (lib/careerMemory/runtime/**, CanonicalResumeRuntime/ResumeStructuredModel)
  to the Phase 6B Persistence Layer (this directory's own Row/InsertInput
  types) for real. Unlike Phase 6B's own version of this file, importing
  from lib/careerMemory/runtime/** is now correct and expected - that is
  this round's entire purpose (see this file's own git history: Phase 6B
  deliberately stubbed every function here specifically so a later round
  could implement them once cross-layer imports were allowed).

  ============================================================
  SNAPSHOT IS GROUND TRUTH FOR ROUND-TRIP
  ============================================================
  career_resume_versions.snapshot stores the ENTIRE ResumeStructuredModel
  verbatim (Option A from the Phase 6C design report: no per-table
  metadata duplicated into it, since RuntimeVersion/RuntimeMetadata's own
  fields already have dedicated columns on career_resume_versions itself).
  mapPersistenceBundleToRuntime()/careerProfileToCanonicalRuntime() below
  reconstruct `resume` FROM THIS SNAPSHOT, not by re-assembling the six
  normalized child tables (career_experiences/languages/projects/
  credentials/awards/publications) - this is what makes the Runtime <->
  Persistence round-trip provably lossless despite those child tables
  being unable to independently carry every field:

  - identity/professionalSummary/skillGroups/education/customSections/
    metricGrids/slotAvailability/validation have NO normalized table at
    all (Phase 6B's own 12-table schema never created one) - snapshot is
    their ONLY persisted home.
  - organization/role/location/startDateText/endDateText/dateRangeText
    are StructuredTextValue (value+confidence+extractionMethod+source)
    in Runtime but plain `string | null` columns in career_experiences/
    career_projects/career_credentials/career_awards/career_publications -
    the child-table row can only carry `.value`, never the per-field
    confidence/extractionMethod. snapshot carries the full object.
  - reasonCodes[] has no column on ANY child table; is_uncertain has a
    column ONLY on career_experiences. Both are additionally folded into
    each row's own `source_trace` jsonb envelope (see packEntryEnvelope
    below) as a best-effort child-table enrichment, but snapshot remains
    the authoritative source.

  The six child tables therefore exist as a QUERYABLE, EDITABLE
  projection for a future Phase 6D UI (e.g. "list every experience row
  for this profile without deserializing the whole snapshot blob"), not
  as the round-trip source of truth. Every Row-to-Entry function below
  (careerExperienceRowToEntry, etc.) reconstructs the best it can from
  ONLY that one row and is explicitly a lossy, best-effort operation for
  that use case - it is never used by mapPersistenceBundleToRuntime().

  ============================================================
  ENTRY ID PRESERVATION
  ============================================================
  Runtime entry ids (ExperienceEntry.id, ProjectEntry.id, etc.) are
  source-derived strings (Phase 1/2 extractor-minted), never a DB uuid.
  None of the five entry-shaped child tables has a dedicated
  `source_entry_id` column (a real Phase 6B schema gap, disclosed in the
  Phase 6C design report rather than fixed by a migration this round).
  Instead of inventing a new column, packEntryEnvelope() nests the
  original entry id (plus isUncertain/reasonCodes where no dedicated
  column exists) INSIDE the existing `source_trace` jsonb column, which
  was already flexible JSON and required no migration change:

    source_trace = { entryId, trace: <the real SourceTrace object>,
                      isUncertain?, reasonCodes? }

  unpackEntryEnvelope() is the exact inverse. A source_trace column that
  doesn't carry this envelope shape (e.g. a hand-written legacy row) is
  treated as the trace object itself, with the DB row's own uuid `id`
  used as a documented fallback entry id - see unpackEntryEnvelope's own
  comment.

  ============================================================
  LANGUAGES: A DB-ONLY, RUNTIME-UNSUPPORTED TABLE
  ============================================================
  ResumeStructuredModel has no `languages` field anywhere (confirmed by
  reading lib/documentPreservation/resumeStructured/types.ts in full for
  this round's design report) - career_languages exists in the Phase 6B
  schema with no Runtime-side counterpart to map from. This is NOT data
  loss (nothing in Runtime was ever capable of holding a language), so
  runtimeToCareerLanguageInsertInput() below takes a plain DTO parameter
  instead of a Runtime type - there is no Runtime value to derive it
  from. Table stays empty until a future round adds a languages field to
  ResumeStructuredModel itself (out of scope here - Runtime type changes
  require explicit user approval per this round's own instructions).
*/
import type {
  AwardEntry,
  CredentialEntry,
  CustomResumeSection,
  EntryContentBlock,
  ExperienceEntry,
  HierarchicalContentNode,
  MetricGrid,
  ProjectEntry,
  PublicationEntry,
  ResumeIdentity,
  ResumeStructuredModel,
  SkillGroup,
  SourceTrace,
  StructuredBullet,
  StructuredTextValue,
} from "../../documentPreservation/resumeStructured/types";
import type { TailoredMergeRejection } from "../../documentPreservation/resumeStructured/tailoredOverlay";
import type {
  CanonicalResumeRuntime,
  OverlayApplicationRecord,
  RuntimeMetadata,
  RuntimeOverlayState,
  RuntimeSourceDocument,
  RuntimeVersion,
} from "../runtime/types";
import type { CareerMemoryPersistenceBundle } from "./bundle";
import type {
  CareerAwardInsertInput,
  CareerAwardRow,
  CareerCredentialInsertInput,
  CareerCredentialRow,
  CareerExperienceInsertInput,
  CareerExperienceRow,
  CareerLanguageInsertInput,
  CareerLanguageRow,
  CareerProfileInsertInput,
  CareerProfileRow,
  CareerProjectInsertInput,
  CareerProjectRow,
  CareerPublicationInsertInput,
  CareerPublicationRow,
  CareerResumeVersionInsertInput,
  CareerResumeVersionRow,
  CareerSourceDocumentInsertInput,
  CareerSourceDocumentRow,
  CareerTailoredResumeInsertInput,
  CareerTailoredResumeRow,
  CareerUserEditInsertInput,
  GeneratedResumeDocumentInsertInput,
} from "./types";

export class MapperNotImplementedError extends Error {
  constructor(mapperName: string) {
    super(`${mapperName} is not implemented yet - see mappers.ts's own header comment.`);
    this.name = "MapperNotImplementedError";
  }
}

// ============================================================
// Shared helpers
// ============================================================

const EMPTY_SOURCE_TRACE: SourceTrace = { sourceSectionId: "", sourceBlockIds: [], sourceElementIds: [] };

/* A plain JSON deep-copy - proves the value is pure data and strips any
   would-be `undefined` values the way a real jsonb column would (JSON.
   stringify drops object keys whose value is undefined), matching the
   Runtime Layer's own established convention in serializer.ts. */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function textValueOrNull(v: StructuredTextValue | undefined): string | null {
  return v ? v.value : null;
}

type EntryEnvelope = {
  entryId: string;
  trace: SourceTrace;
  isUncertain?: boolean;
  reasonCodes?: string[];
};

function packEntryEnvelope(entryId: string, trace: SourceTrace, extra?: { isUncertain?: boolean; reasonCodes?: string[] }): Record<string, unknown> {
  return toPlain({ entryId, trace, ...(extra ?? {}) });
}

/* Inverse of packEntryEnvelope(). A source_trace value that does not
   carry the {entryId, trace, ...} envelope shape (e.g. a legacy or
   hand-authored row written before this convention existed) is treated
   as the SourceTrace object itself, and the row's own DB `id` is used
   as a documented, disclosed fallback entry id - never a silent throw,
   since a missing envelope is a recoverable, expected legacy case, not
   a corrupt-data error. */
function unpackEntryEnvelope(sourceTrace: Record<string, unknown> | null, fallbackDbId: string): EntryEnvelope {
  if (sourceTrace && typeof sourceTrace === "object" && typeof (sourceTrace as Record<string, unknown>).entryId === "string") {
    const env = sourceTrace as { entryId: string; trace?: SourceTrace; isUncertain?: boolean; reasonCodes?: string[] };
    return {
      entryId: env.entryId,
      trace: env.trace ?? EMPTY_SOURCE_TRACE,
      isUncertain: typeof env.isUncertain === "boolean" ? env.isUncertain : undefined,
      reasonCodes: Array.isArray(env.reasonCodes) ? env.reasonCodes : undefined,
    };
  }
  if (sourceTrace && typeof sourceTrace === "object") {
    return { entryId: fallbackDbId, trace: sourceTrace as unknown as SourceTrace };
  }
  return { entryId: fallbackDbId, trace: EMPTY_SOURCE_TRACE };
}

/* Reconstructs a StructuredTextValue from a plain child-table string
   column. confidence/extractionMethod are NOT recoverable at the
   child-table level (a disclosed Phase 6B schema gap - see this file's
   header comment) - `extractionMethod: "fallback"` is the exact union
   member ExtractionMethod already reserves for "we don't actually know
   how this was extracted" (lib/documentPreservation/resumeStructured/
   types.ts's own ExtractionMethod type), so this is not an invented
   value, it's the type's own documented escape hatch used correctly. */
function structuredFromColumn(value: string | null, trace: SourceTrace): StructuredTextValue | undefined {
  if (value === null) return undefined;
  return { value, confidence: 0, extractionMethod: "fallback", source: trace };
}

function sortByCreatedAtThenId<T extends { created_at: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

function bySortOrderThenCreatedAt<T extends { sort_order: number; created_at: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

// ============================================================
// career_profiles <-> Runtime identity/metadata slice
// ============================================================
export type CareerProfileRuntimeSlice = {
  identity: ResumeIdentity | undefined;
  professionalSummaryText: string | null;
  schemaVersion: string;
  serializerVersion: string;
};

export function careerProfileRowToRuntime(row: CareerProfileRow): CareerProfileRuntimeSlice {
  const identity = row.identity && Object.keys(row.identity).length > 0 ? (toPlain(row.identity) as unknown as ResumeIdentity) : undefined;
  return {
    identity,
    professionalSummaryText: row.summary_text,
    schemaVersion: row.schema_version,
    serializerVersion: row.serializer_version,
  };
}

/* summary_text carries ONLY professionalSummary.text - the summary's
   own SourceTrace has no column here (a plain string column, not
   jsonb), so it is not independently recoverable from this row alone;
   the version snapshot carries the full ResumeSummary object. */
export function runtimeToCareerProfileInsertInput(userId: string, runtime: CanonicalResumeRuntime): CareerProfileInsertInput {
  return {
    user_id: userId,
    identity: runtime.resume.identity ? toPlain(runtime.resume.identity) : {},
    summary_text: runtime.resume.professionalSummary?.text ?? null,
    preferences: {},
    schema_version: runtime.metadata.schemaVersion,
    serializer_version: runtime.metadata.serializerVersion,
  };
}

// ============================================================
// career_source_documents <-> RuntimeSourceDocument
// ============================================================
export function careerSourceDocumentRowToRuntimeSourceDocument(row: CareerSourceDocumentRow): RuntimeSourceDocument {
  return {
    id: row.id,
    fileName: row.original_file_name ?? "",
    fileType: row.file_type,
    contentHash: row.content_hash ?? undefined,
    addedAt: row.created_at,
  };
}

export function runtimeSourceDocumentToInsertInput(
  profileId: string,
  doc: RuntimeSourceDocument,
  storage: { storageBucket: string; storagePath: string; mimeType?: string | null; byteSize?: number | null; parserVersion?: string | null },
): CareerSourceDocumentInsertInput {
  return {
    id: doc.id,
    profile_id: profileId,
    storage_bucket: storage.storageBucket,
    storage_path: storage.storagePath,
    original_file_name: doc.fileName,
    mime_type: storage.mimeType ?? null,
    byte_size: storage.byteSize ?? null,
    content_hash: doc.contentHash ?? null,
    parser_version: storage.parserVersion ?? null,
    file_type: doc.fileType,
    created_at: doc.addedAt,
  };
}

// ============================================================
// career_resume_versions <-> a full Runtime snapshot (ground truth)
// ============================================================
export function careerResumeVersionRowToRuntime(row: CareerResumeVersionRow): { resume: ResumeStructuredModel; version: RuntimeVersion; metadata: Pick<RuntimeMetadata, "schemaVersion" | "serializerVersion"> } {
  return {
    resume: toPlain(row.snapshot) as unknown as ResumeStructuredModel,
    version: {
      id: row.id,
      reason: row.reason,
      createdAt: row.created_at,
      parentVersionId: row.parent_version_id ?? undefined,
    },
    metadata: { schemaVersion: row.schema_version, serializerVersion: row.serializer_version },
  };
}

export function runtimeToCareerResumeVersionInsertInput(profileId: string, runtime: CanonicalResumeRuntime): CareerResumeVersionInsertInput {
  return {
    id: runtime.version.id,
    profile_id: profileId,
    source_document_id: runtime.sourceDocuments.length > 0 ? runtime.sourceDocuments[runtime.sourceDocuments.length - 1].id : null,
    parent_version_id: runtime.version.parentVersionId ?? null,
    reason: runtime.version.reason,
    snapshot: toPlain(runtime.resume) as unknown as Record<string, unknown>,
    schema_version: runtime.metadata.schemaVersion,
    serializer_version: runtime.metadata.serializerVersion,
    created_at: runtime.version.createdAt,
  };
}

// ============================================================
// career_experiences <-> ExperienceEntry (professionalExperience[]/
// volunteerExperience[] both map through here, disambiguated by the
// row's own `is_volunteer` column).
// ============================================================
export function careerExperienceRowToEntry(row: CareerExperienceRow): ExperienceEntry {
  const env = unpackEntryEnvelope(row.source_trace, row.id);
  return {
    id: env.entryId,
    organization: structuredFromColumn(row.organization, env.trace),
    role: structuredFromColumn(row.role, env.trace),
    location: structuredFromColumn(row.location, env.trace),
    startDateText: structuredFromColumn(row.start_date_text, env.trace),
    endDateText: structuredFromColumn(row.end_date_text, env.trace),
    dateRangeText: structuredFromColumn(row.date_range_text, env.trace),
    // bullets/descriptionParagraphs are not independently recoverable
    // from this row (no dedicated columns - see this file's header
    // comment); content[] below is the row's own complete body-content
    // representation.
    bullets: [],
    descriptionParagraphs: [],
    content: (row.content ?? []) as EntryContentBlock[],
    hierarchicalContent: (row.hierarchical_content ?? []) as HierarchicalContentNode[],
    hasHierarchicalStructure: row.has_hierarchical_structure,
    rawHeaderText: row.raw_header_text ?? "",
    source: env.trace,
    isVolunteer: row.is_volunteer,
    isUncertain: row.is_uncertain,
    reasonCodes: env.reasonCodes ?? [],
  };
}

export function runtimeToCareerExperienceInsertInput(profileId: string, runtimeEntry: ExperienceEntry, extra: { sourceDocumentId?: string | null; sortOrder: number }): CareerExperienceInsertInput {
  return {
    id: runtimeEntry.id,
    profile_id: profileId,
    source_document_id: extra.sourceDocumentId ?? null,
    organization: textValueOrNull(runtimeEntry.organization),
    role: textValueOrNull(runtimeEntry.role),
    location: textValueOrNull(runtimeEntry.location),
    date_range_text: textValueOrNull(runtimeEntry.dateRangeText),
    start_date_text: textValueOrNull(runtimeEntry.startDateText),
    end_date_text: textValueOrNull(runtimeEntry.endDateText),
    is_volunteer: runtimeEntry.isVolunteer,
    content: toPlain(runtimeEntry.content),
    hierarchical_content: toPlain(runtimeEntry.hierarchicalContent),
    has_hierarchical_structure: runtimeEntry.hasHierarchicalStructure,
    source_trace: packEntryEnvelope(runtimeEntry.id, runtimeEntry.source, { reasonCodes: runtimeEntry.reasonCodes }),
    // No natural single "entry confidence" exists in Runtime (each
    // field carries its own) - left null rather than guessing a
    // priority order among fields; the snapshot has every real value.
    confidence: null,
    is_uncertain: runtimeEntry.isUncertain,
    is_hidden: false,
    raw_header_text: runtimeEntry.rawHeaderText,
    sort_order: extra.sortOrder,
  };
}

// ============================================================
// career_languages <-> a single language entry (Runtime has NO source
// for this - see this file's header comment. DTO-only, not derived
// from any CanonicalResumeRuntime field.)
// ============================================================
export type LanguageDto = { name: string; proficiency?: string | null };

export function careerLanguageRowToRuntime(row: CareerLanguageRow): LanguageDto {
  return { name: row.name, proficiency: row.proficiency };
}

export function runtimeToCareerLanguageInsertInput(profileId: string, language: LanguageDto, sortOrder = 0): CareerLanguageInsertInput {
  return {
    profile_id: profileId,
    name: language.name,
    proficiency: language.proficiency ?? null,
    sort_order: sortOrder,
  };
}

// ============================================================
// career_projects <-> ProjectEntry
// ============================================================
export function careerProjectRowToEntry(row: CareerProjectRow): ProjectEntry {
  const env = unpackEntryEnvelope(row.source_trace, row.id);
  return {
    id: env.entryId,
    name: structuredFromColumn(row.name, env.trace),
    role: structuredFromColumn(row.role, env.trace),
    dateRangeText: structuredFromColumn(row.date_range_text, env.trace),
    technologies: (row.technologies ?? []) as StructuredTextValue[],
    bullets: [],
    descriptionParagraphs: [],
    content: (row.content ?? []) as EntryContentBlock[],
    rawHeaderText: row.raw_header_text ?? "",
    source: env.trace,
    isUncertain: env.isUncertain ?? false,
    reasonCodes: env.reasonCodes ?? [],
  };
}

export function runtimeToCareerProjectInsertInput(profileId: string, runtimeProject: ProjectEntry, extra: { sourceDocumentId?: string | null; sortOrder: number }): CareerProjectInsertInput {
  return {
    id: runtimeProject.id,
    profile_id: profileId,
    source_document_id: extra.sourceDocumentId ?? null,
    name: textValueOrNull(runtimeProject.name),
    role: textValueOrNull(runtimeProject.role),
    date_range_text: textValueOrNull(runtimeProject.dateRangeText),
    // technologies[] is a jsonb array column - full StructuredTextValue
    // objects (confidence/extractionMethod included) are preserved
    // verbatim, no reduction to plain strings needed.
    technologies: toPlain(runtimeProject.technologies),
    content: toPlain(runtimeProject.content),
    source_trace: packEntryEnvelope(runtimeProject.id, runtimeProject.source, { isUncertain: runtimeProject.isUncertain, reasonCodes: runtimeProject.reasonCodes }),
    is_hidden: false,
    raw_header_text: runtimeProject.rawHeaderText,
    sort_order: extra.sortOrder,
  };
}

// ============================================================
// career_credentials <-> CredentialEntry
// ============================================================
export function careerCredentialRowToEntry(row: CareerCredentialRow): CredentialEntry {
  const env = unpackEntryEnvelope(row.source_trace, row.id);
  return {
    id: env.entryId,
    name: structuredFromColumn(row.name, env.trace),
    issuer: structuredFromColumn(row.issuer, env.trace),
    credentialId: structuredFromColumn(row.credential_id, env.trace),
    issueDateText: structuredFromColumn(row.issue_date_text, env.trace),
    expiryDateText: structuredFromColumn(row.expiry_date_text, env.trace),
    location: structuredFromColumn(row.location, env.trace),
    // names[]/issuers[] (Phase 5D.3D "full list" composite fields) have
    // no dedicated column - not independently recoverable from this row
    // alone; falls back to the singular name/issuer as a 1-item list
    // when present, matching ResumeStructuredModel's own documented
    // invariant ("institution/credential/fieldOfStudy above are ALWAYS
    // equal to institutions[0]/credentials[0]/fieldsOfStudy[0]").
    names: row.name !== null ? [structuredFromColumn(row.name, env.trace) as StructuredTextValue] : [],
    issuers: row.issuer !== null ? [structuredFromColumn(row.issuer, env.trace) as StructuredTextValue] : [],
    details: (row.details ?? []) as StructuredTextValue[],
    kind: row.kind,
    rawHeaderText: row.raw_header_text ?? "",
    source: env.trace,
    isUncertain: env.isUncertain ?? false,
    reasonCodes: env.reasonCodes ?? [],
  };
}

export function runtimeToCareerCredentialInsertInput(profileId: string, runtimeCredential: CredentialEntry, extra: { sourceDocumentId?: string | null; sortOrder: number }): CareerCredentialInsertInput {
  return {
    id: runtimeCredential.id,
    profile_id: profileId,
    source_document_id: extra.sourceDocumentId ?? null,
    name: textValueOrNull(runtimeCredential.name),
    issuer: textValueOrNull(runtimeCredential.issuer),
    credential_id: textValueOrNull(runtimeCredential.credentialId),
    issue_date_text: textValueOrNull(runtimeCredential.issueDateText),
    expiry_date_text: textValueOrNull(runtimeCredential.expiryDateText),
    location: textValueOrNull(runtimeCredential.location),
    kind: runtimeCredential.kind,
    details: toPlain(runtimeCredential.details),
    source_trace: packEntryEnvelope(runtimeCredential.id, runtimeCredential.source, { isUncertain: runtimeCredential.isUncertain, reasonCodes: runtimeCredential.reasonCodes }),
    is_hidden: false,
    raw_header_text: runtimeCredential.rawHeaderText,
    sort_order: extra.sortOrder,
  };
}

// ============================================================
// career_awards <-> AwardEntry
// ============================================================
export function careerAwardRowToEntry(row: CareerAwardRow): AwardEntry {
  const env = unpackEntryEnvelope(row.source_trace, row.id);
  const nameValue = structuredFromColumn(row.name, env.trace);
  return {
    id: env.entryId,
    name: nameValue,
    issuer: structuredFromColumn(row.issuer, env.trace),
    names: nameValue ? [nameValue] : [],
    dateText: structuredFromColumn(row.date_text, env.trace),
    details: (row.details ?? []) as StructuredTextValue[],
    content: (row.details ?? []) as unknown as EntryContentBlock[],
    rawHeaderText: row.raw_header_text ?? "",
    source: env.trace,
    isUncertain: env.isUncertain ?? false,
    reasonCodes: env.reasonCodes ?? [],
  };
}

export function runtimeToCareerAwardInsertInput(profileId: string, runtimeAward: AwardEntry, extra: { sourceDocumentId?: string | null; sortOrder: number }): CareerAwardInsertInput {
  return {
    id: runtimeAward.id,
    profile_id: profileId,
    source_document_id: extra.sourceDocumentId ?? null,
    name: textValueOrNull(runtimeAward.name),
    issuer: textValueOrNull(runtimeAward.issuer),
    date_text: textValueOrNull(runtimeAward.dateText),
    details: toPlain(runtimeAward.details),
    source_trace: packEntryEnvelope(runtimeAward.id, runtimeAward.source, { isUncertain: runtimeAward.isUncertain, reasonCodes: runtimeAward.reasonCodes }),
    is_hidden: false,
    raw_header_text: runtimeAward.rawHeaderText,
    sort_order: extra.sortOrder,
  };
}

// ============================================================
// career_publications <-> PublicationEntry
// ============================================================
export function careerPublicationRowToEntry(row: CareerPublicationRow): PublicationEntry {
  const env = unpackEntryEnvelope(row.source_trace, row.id);
  const titleValue = structuredFromColumn(row.title, env.trace);
  return {
    id: env.entryId,
    title: titleValue,
    titles: titleValue ? [titleValue] : [],
    authors: (row.authors ?? []) as StructuredTextValue[],
    publisherOrVenue: structuredFromColumn(row.publisher_or_venue, env.trace),
    dateText: structuredFromColumn(row.date_text, env.trace),
    urlOrDoi: structuredFromColumn(row.url_or_doi, env.trace),
    details: (row.details ?? []) as StructuredTextValue[],
    content: (row.details ?? []) as unknown as EntryContentBlock[],
    rawHeaderText: row.raw_header_text ?? "",
    source: env.trace,
    isUncertain: env.isUncertain ?? false,
    reasonCodes: env.reasonCodes ?? [],
  };
}

export function runtimeToCareerPublicationInsertInput(profileId: string, runtimePublication: PublicationEntry, extra: { sourceDocumentId?: string | null; sortOrder: number }): CareerPublicationInsertInput {
  return {
    id: runtimePublication.id,
    profile_id: profileId,
    source_document_id: extra.sourceDocumentId ?? null,
    title: textValueOrNull(runtimePublication.title),
    // authors[] is a jsonb array column - full StructuredTextValue
    // objects preserved verbatim.
    authors: toPlain(runtimePublication.authors),
    publisher_or_venue: textValueOrNull(runtimePublication.publisherOrVenue),
    date_text: textValueOrNull(runtimePublication.dateText),
    url_or_doi: textValueOrNull(runtimePublication.urlOrDoi),
    details: toPlain(runtimePublication.details),
    source_trace: packEntryEnvelope(runtimePublication.id, runtimePublication.source, { isUncertain: runtimePublication.isUncertain, reasonCodes: runtimePublication.reasonCodes }),
    is_hidden: false,
    raw_header_text: runtimePublication.rawHeaderText,
    sort_order: extra.sortOrder,
  };
}

// ============================================================
// career_tailored_resumes <-> one OverlayApplicationRecord. Each row is
// ONE historical overlay-application event; overlayState.history is
// reconstructed as every such row for the profile, ordered by
// created_at (the table has no dedicated sequence column - see this
// file's header comment on DERIVED ordering).
//
// application_id/resume_version_id/template_id/ai_model/prompt_version
// are DB-only bookkeeping with no Runtime-side counterpart
// (OverlayApplicationRecord carries only {overlay, appliedEntryIds,
// rejections}) - supplied as an explicit extra parameter, never
// invented, and simply dropped (not lost - they were never Runtime
// data) when reconstructing the Runtime-side record.
// ============================================================
export function careerTailoredResumeRowToOverlayRecord(row: CareerTailoredResumeRow): OverlayApplicationRecord {
  const payload = row.overlay as { overlay?: unknown; appliedEntryIds?: string[]; rejections?: TailoredMergeRejection[] };
  return {
    overlay: payload?.overlay,
    appliedEntryIds: Array.isArray(payload?.appliedEntryIds) ? payload!.appliedEntryIds! : [],
    rejections: Array.isArray(payload?.rejections) ? payload!.rejections! : [],
  };
}

export function runtimeToCareerTailoredResumeInsertInput(
  profileId: string,
  runtimeOverlay: OverlayApplicationRecord,
  extra: { applicationId?: string | null; resumeVersionId?: string | null; templateId?: string | null; aiModel?: string | null; promptVersion?: string | null } = {},
): CareerTailoredResumeInsertInput {
  return {
    profile_id: profileId,
    application_id: extra.applicationId ?? null,
    resume_version_id: extra.resumeVersionId ?? null,
    overlay: toPlain({ overlay: runtimeOverlay.overlay, appliedEntryIds: runtimeOverlay.appliedEntryIds, rejections: runtimeOverlay.rejections }),
    template_id: extra.templateId ?? null,
    ai_model: extra.aiModel ?? null,
    prompt_version: extra.promptVersion ?? null,
  };
}

function mapTailoredResumeRowsToOverlayState(rows: CareerTailoredResumeRow[]): RuntimeOverlayState {
  const ordered = sortByCreatedAtThenId(rows);
  return { history: ordered.map(careerTailoredResumeRowToOverlayRecord) };
}

// ============================================================
// career_user_edits <-> a single audit-log entry. Not Runtime-backed
// (Runtime has no concept of a user-edit log) - plain DTO parameters.
// ============================================================
export function mapUserEditToInsertInput(profileId: string, edit: { targetTable: string; targetId: string; fieldPath: string; previousValue?: unknown; newValue?: unknown; editedAt?: string }): CareerUserEditInsertInput {
  return {
    profile_id: profileId,
    target_table: edit.targetTable,
    target_id: edit.targetId,
    field_path: edit.fieldPath,
    previous_value: edit.previousValue === undefined ? null : toPlain(edit.previousValue),
    new_value: edit.newValue === undefined ? null : toPlain(edit.newValue),
    edited_at: edit.editedAt,
  };
}

// ============================================================
// generated_resume_documents <-> file metadata. Not Runtime-backed
// (Runtime never touches rendered PDF/DOCX bytes).
// ============================================================
export function mapGeneratedDocumentToInsertInput(tailoredResumeId: string, doc: { storageBucket: string; storagePath: string; fileType: "pdf" | "docx" }): GeneratedResumeDocumentInsertInput {
  return {
    tailored_resume_id: tailoredResumeId,
    storage_bucket: doc.storageBucket,
    storage_path: doc.storagePath,
    file_type: doc.fileType,
  };
}

// ============================================================
// Aggregate: Persistence Bundle -> full CanonicalResumeRuntime
// (the Phase 6B mappers.ts's own TODO comment named this
// `careerProfileToCanonicalRuntime` - kept exactly that name).
// ============================================================
export function careerProfileToCanonicalRuntime(bundle: CareerMemoryPersistenceBundle): CanonicalResumeRuntime {
  const resume = toPlain(bundle.latestVersion.snapshot) as unknown as ResumeStructuredModel;

  const orderedDocs = sortByCreatedAtThenId(bundle.sourceDocuments);
  const sourceDocuments: RuntimeSourceDocument[] = orderedDocs.map(careerSourceDocumentRowToRuntimeSourceDocument);

  const linkedDoc = bundle.latestVersion.source_document_id ? bundle.sourceDocuments.find((d) => d.id === bundle.latestVersion.source_document_id) : undefined;

  const metadata: RuntimeMetadata = {
    schemaVersion: bundle.latestVersion.schema_version,
    parserVersion: linkedDoc?.parser_version ?? undefined,
    serializerVersion: bundle.latestVersion.serializer_version,
  };

  const version: RuntimeVersion = {
    id: bundle.latestVersion.id,
    reason: bundle.latestVersion.reason,
    createdAt: bundle.latestVersion.created_at,
    parentVersionId: bundle.latestVersion.parent_version_id ?? undefined,
    sourceDocumentId: bundle.latestVersion.source_document_id ?? undefined,
  };

  return {
    resume,
    metadata,
    version,
    sourceDocuments,
    serializerVersion: bundle.latestVersion.serializer_version,
    overlayState: mapTailoredResumeRowsToOverlayState(bundle.tailoredResumes),
  };
}

/*
  Runtime -> a FULL bundle of InsertInputs (one call, every table). The
  six child-table arrays are the lossy queryable projection described in
  this file's header comment; `resumeVersion.snapshot` is the lossless
  round-trip source. sortOrder is assigned by array index (Ordering
  Contract - see the Phase 6C design report's "Ordering Contract"
  section: array position IS the stored order for every entry-shaped
  table, recovered later via `sort_order asc`).
*/
export type CanonicalRuntimeInsertBundle = {
  profile: CareerProfileInsertInput;
  resumeVersion: CareerResumeVersionInsertInput;
  experiences: CareerExperienceInsertInput[];
  projects: CareerProjectInsertInput[];
  credentials: CareerCredentialInsertInput[];
  awards: CareerAwardInsertInput[];
  publications: CareerPublicationInsertInput[];
};

export function canonicalRuntimeToInsertBundle(userId: string, profileId: string, runtime: CanonicalResumeRuntime): CanonicalRuntimeInsertBundle {
  const latestSourceDocumentId = runtime.sourceDocuments.length > 0 ? runtime.sourceDocuments[runtime.sourceDocuments.length - 1].id : null;

  const experiences = [
    ...runtime.resume.professionalExperience.map((e) => ({ ...e, isVolunteer: false as const })),
    ...runtime.resume.volunteerExperience.map((e) => ({ ...e, isVolunteer: true as const })),
  ].map((entry, index) => runtimeToCareerExperienceInsertInput(profileId, entry, { sourceDocumentId: latestSourceDocumentId, sortOrder: index }));

  return {
    profile: runtimeToCareerProfileInsertInput(userId, runtime),
    resumeVersion: runtimeToCareerResumeVersionInsertInput(profileId, runtime),
    experiences,
    projects: runtime.resume.projects.map((p, index) => runtimeToCareerProjectInsertInput(profileId, p, { sourceDocumentId: latestSourceDocumentId, sortOrder: index })),
    credentials: runtime.resume.credentials.map((c, index) => runtimeToCareerCredentialInsertInput(profileId, c, { sourceDocumentId: latestSourceDocumentId, sortOrder: index })),
    awards: runtime.resume.awards.map((a, index) => runtimeToCareerAwardInsertInput(profileId, a, { sourceDocumentId: latestSourceDocumentId, sortOrder: index })),
    publications: runtime.resume.publications.map((p, index) => runtimeToCareerPublicationInsertInput(profileId, p, { sourceDocumentId: latestSourceDocumentId, sortOrder: index })),
  };
}

export { bySortOrderThenCreatedAt, sortByCreatedAtThenId };
