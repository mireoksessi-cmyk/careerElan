/*
  Phase 6A.2 Implementation - Canonical Runtime Layer types. Wraps an
  existing ResumeStructuredModel (lib/documentPreservation/resumeStructured/
  types.ts, NEVER modified by this file or any file in this directory)
  in a Runtime object carrying the version/overlay/source-document
  bookkeeping the Phase 6A.2 audit's own Runtime Contract called for
  (§C Canonical Runtime Object, §E Versioning Contract, §F Overlay
  Contract). Not wired into any production route/page/API in this
  round - see factory.ts's own header comment for the full disclosure.

  Every id/timestamp field below is caller-supplied, never generated
  internally with Date.now()/Math.random()/crypto.randomUUID() - this
  matches the established convention already documented on
  resumeStructured/types.ts's own SourceTrace comment ("never a newly
  minted id") and keeps every factory function here a pure, deterministic,
  easily-testable constructor.
*/
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";
import type { TailoredMergeRejection } from "../../documentPreservation/resumeStructured/tailoredOverlay";

export const CANONICAL_RUNTIME_SERIALIZER_VERSION = "career-memory-runtime-v1";

/*
  Phase 6A.2 §K's future "career_source_documents" table, expressed as
  a plain Runtime value - no Storage/DB access here, purely bookkeeping
  metadata about where a resume's source bytes came from.
*/
export type RuntimeSourceDocument = {
  id: string;
  fileName: string;
  fileType: "pdf" | "docx";
  contentHash?: string;
  addedAt: string;
};

export type RuntimeMetadata = {
  schemaVersion: string;
  parserVersion?: string;
  serializerVersion: string;
};

/*
  Mirrors Phase 6A.2 §E's Versioning Contract event table exactly -
  every reason a new RuntimeVersion is allowed to be created for
  ("Template 변경"/"PDF 생성"/"Tailoring" are explicitly NOT version
  events per that contract - those only ever touch overlayState, never
  bump the version).
*/
export type RuntimeVersionReason = "initial" | "reanalysis" | "user_edit" | "merge" | "import" | "restore";

export type RuntimeVersion = {
  id: string;
  reason: RuntimeVersionReason;
  createdAt: string;
  parentVersionId?: string;
};

/*
  One applyOverlay() call's own result, kept verbatim (never re-derived
  after the fact) so overlayRuntime.ts's removeOverlay can reconstruct
  history precisely by re-folding the remaining records - see that
  file's own header comment for why the canonical `resume` field is
  never itself mutated by an overlay.
*/
export type OverlayApplicationRecord = {
  overlay: unknown;
  appliedEntryIds: string[];
  rejections: TailoredMergeRejection[];
};

export type RuntimeOverlayState = {
  history: OverlayApplicationRecord[];
};

/*
  The Canonical Runtime Object itself - Phase 6A.2 §C's five required
  fields (resume/metadata/version/sourceDocuments/serializerVersion)
  plus overlayState (§F). `resume` is always the pristine, untailored
  ResumeStructuredModel - see overlayRuntime.ts for how a tailored VIEW
  is derived without ever mutating it.
*/
export type CanonicalResumeRuntime = {
  resume: ResumeStructuredModel;
  metadata: RuntimeMetadata;
  version: RuntimeVersion;
  sourceDocuments: RuntimeSourceDocument[];
  serializerVersion: string;
  overlayState: RuntimeOverlayState;
};
