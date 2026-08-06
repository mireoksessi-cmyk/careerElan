/*
  Phase 6A.2 Implementation - Canonical Runtime Layer factory functions.
  Pure constructors only - createCanonicalRuntime()/createRuntimeMetadata()/
  createRuntimeOverlayState()/createRuntimeVersion() build the wrapper
  objects defined in types.ts, nothing more. None of these functions are
  imported by any file outside lib/careerMemory/runtime/** in this round -
  the Runtime Layer exists standalone, not yet connected to
  app/career-memory, app/api/generate-package, or any other production
  call site (Phase 6A.2's own explicit scope: "생성만. 사용하지 않는다"
  / "Production 연결 금지").

  ResumeStructuredModel (lib/documentPreservation/resumeStructured/
  types.ts) itself is never modified or re-implemented here - these
  factories only ever wrap an already-built model, never construct one.
*/
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";
import { CANONICAL_RUNTIME_SERIALIZER_VERSION } from "./types";
import type { CanonicalResumeRuntime, RuntimeMetadata, RuntimeOverlayState, RuntimeSourceDocument, RuntimeVersion, RuntimeVersionReason } from "./types";

export function createRuntimeMetadata(input: { schemaVersion: string; parserVersion?: string; serializerVersion?: string }): RuntimeMetadata {
  return {
    schemaVersion: input.schemaVersion,
    parserVersion: input.parserVersion,
    serializerVersion: input.serializerVersion ?? CANONICAL_RUNTIME_SERIALIZER_VERSION,
  };
}

export function createRuntimeVersion(input: { id: string; reason: RuntimeVersionReason; createdAt: string; parentVersionId?: string }): RuntimeVersion {
  return {
    id: input.id,
    reason: input.reason,
    createdAt: input.createdAt,
    parentVersionId: input.parentVersionId,
  };
}

/*
  Always starts empty - a freshly created runtime has never had an
  overlay applied to it. applyOverlay() (overlayRuntime.ts) is the only
  place a non-empty RuntimeOverlayState is ever produced.
*/
export function createRuntimeOverlayState(): RuntimeOverlayState {
  return { history: [] };
}

export function createRuntimeSourceDocument(input: { id: string; fileName: string; fileType: "pdf" | "docx"; contentHash?: string; addedAt: string }): RuntimeSourceDocument {
  return {
    id: input.id,
    fileName: input.fileName,
    fileType: input.fileType,
    contentHash: input.contentHash,
    addedAt: input.addedAt,
  };
}

export function createCanonicalRuntime(input: {
  resume: ResumeStructuredModel;
  version: RuntimeVersion;
  sourceDocuments?: RuntimeSourceDocument[];
  metadata?: RuntimeMetadata;
  overlayState?: RuntimeOverlayState;
}): CanonicalResumeRuntime {
  return {
    resume: input.resume,
    metadata: input.metadata ?? createRuntimeMetadata({ schemaVersion: input.resume.schemaVersion }),
    version: input.version,
    sourceDocuments: input.sourceDocuments ?? [],
    serializerVersion: CANONICAL_RUNTIME_SERIALIZER_VERSION,
    overlayState: input.overlayState ?? createRuntimeOverlayState(),
  };
}
