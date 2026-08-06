/*
  Phase 6A.2 Implementation - Canonical Runtime Layer serializer.
  serializeCanonicalRuntime()/deserializeCanonicalRuntime()/
  validateCanonicalRuntime()/normalizeCanonicalRuntime() operate purely
  on in-memory objects - no Supabase client import, no fetch, no file
  I/O anywhere in this file (Phase 6A.2's own explicit instruction:
  "현재는 메모리 객체만 지원. DB 연결 금지"). A future Phase 6D API
  layer is expected to take serializeCanonicalRuntime()'s output and
  hand it to a real persistence call, but that wiring does not exist
  here or anywhere else in this round.
*/
import type { CanonicalResumeRuntime, RuntimeOverlayState, RuntimeSourceDocument } from "./types";
import { CANONICAL_RUNTIME_SERIALIZER_VERSION } from "./types";

export type SerializedCanonicalRuntime = {
  serializerVersion: string;
  runtime: CanonicalResumeRuntime;
};

export type RuntimeValidationResult = {
  valid: boolean;
  errors: string[];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/*
  A plain JSON round-trip - proves the payload is pure data (no
  functions, class instances, or circular references) before any
  future persistence layer ever sees it. Never mutates the input
  runtime (returns a deep copy).
*/
export function serializeCanonicalRuntime(runtime: CanonicalResumeRuntime): SerializedCanonicalRuntime {
  const plainRuntime = JSON.parse(JSON.stringify(runtime)) as CanonicalResumeRuntime;
  return { serializerVersion: CANONICAL_RUNTIME_SERIALIZER_VERSION, runtime: plainRuntime };
}

/*
  Structural validation only - checks that every field the rest of this
  Runtime Layer (factory.ts/overlayRuntime.ts/assemblyAdapter.ts)
  actually reads is present and shaped correctly. Never trusts
  `serializerVersion` alone as proof of validity; every required nested
  field is checked directly, since a legacy or hand-crafted payload
  could claim any version string. Returns every error found, not just
  the first, so a caller can report all problems at once.
*/
export function validateCanonicalRuntime(data: unknown): RuntimeValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(data)) {
    return { valid: false, errors: ["payload is not a plain object"] };
  }
  if (typeof data.serializerVersion !== "string" || data.serializerVersion.length === 0) {
    errors.push("missing or invalid top-level serializerVersion");
  }
  if (!isPlainObject(data.runtime)) {
    errors.push("missing or invalid runtime object");
    return { valid: false, errors };
  }

  const runtime = data.runtime;

  if (!isPlainObject(runtime.resume)) {
    errors.push("runtime.resume is missing or not an object");
  } else {
    const resume = runtime.resume;
    if (typeof resume.schemaVersion !== "string" || resume.schemaVersion.length === 0) errors.push("runtime.resume.schemaVersion is missing");
    if (!Array.isArray(resume.professionalExperience)) errors.push("runtime.resume.professionalExperience is not an array");
    if (!Array.isArray(resume.volunteerExperience)) errors.push("runtime.resume.volunteerExperience is not an array");
    if (!Array.isArray(resume.education)) errors.push("runtime.resume.education is not an array");
    if (!Array.isArray(resume.skillGroups)) errors.push("runtime.resume.skillGroups is not an array");
  }

  if (!isPlainObject(runtime.metadata)) {
    errors.push("runtime.metadata is missing or not an object");
  } else {
    const metadata = runtime.metadata;
    if (typeof metadata.schemaVersion !== "string" || metadata.schemaVersion.length === 0) errors.push("runtime.metadata.schemaVersion is missing");
    if (typeof metadata.serializerVersion !== "string" || metadata.serializerVersion.length === 0) errors.push("runtime.metadata.serializerVersion is missing");
  }

  if (!isPlainObject(runtime.version)) {
    errors.push("runtime.version is missing or not an object");
  } else {
    const version = runtime.version;
    if (typeof version.id !== "string" || version.id.length === 0) errors.push("runtime.version.id is missing");
    if (typeof version.reason !== "string" || version.reason.length === 0) errors.push("runtime.version.reason is missing");
    if (typeof version.createdAt !== "string" || version.createdAt.length === 0) errors.push("runtime.version.createdAt is missing");
  }

  if (!Array.isArray(runtime.sourceDocuments)) {
    errors.push("runtime.sourceDocuments is not an array");
  } else {
    runtime.sourceDocuments.forEach((doc, i) => {
      if (!isPlainObject(doc) || typeof doc.id !== "string" || doc.id.length === 0) errors.push(`runtime.sourceDocuments[${i}] is missing a valid id`);
    });
  }

  if (typeof runtime.serializerVersion !== "string" || runtime.serializerVersion.length === 0) {
    errors.push("runtime.serializerVersion is missing");
  }

  if (!isPlainObject(runtime.overlayState)) {
    errors.push("runtime.overlayState is missing or not an object");
  } else if (!Array.isArray(runtime.overlayState.history)) {
    errors.push("runtime.overlayState.history is not an array");
  }

  return { valid: errors.length === 0, errors };
}

/*
  Throws on an invalid payload rather than silently returning a
  partially-shaped object - a Runtime Layer consumer should never have
  to re-check the result of deserialize() before trusting its shape.
*/
export function deserializeCanonicalRuntime(data: unknown): CanonicalResumeRuntime {
  const validation = validateCanonicalRuntime(data);
  if (!validation.valid) {
    throw new Error(`deserializeCanonicalRuntime: invalid payload - ${validation.errors.join("; ")}`);
  }
  const serialized = data as SerializedCanonicalRuntime;
  return JSON.parse(JSON.stringify(serialized.runtime)) as CanonicalResumeRuntime;
}

/*
  Idempotent normalization - the ONLY reordering this function performs
  is deduping+sorting sourceDocuments (by id, then addedAt). Every other
  branch (resume, version, overlayState.history) is already
  order-preserving by construction (see factory.ts/overlayRuntime.ts's
  own header comments) - reordering those here would destroy real
  information (overlay application order, source-block order inside the
  resume), so this function deliberately leaves them untouched. Never
  mutates the input; calling this twice on its own output is a no-op.
*/
export function normalizeCanonicalRuntime(runtime: CanonicalResumeRuntime): CanonicalResumeRuntime {
  const seen = new Set<string>();
  const deduped: RuntimeSourceDocument[] = [];
  for (const doc of runtime.sourceDocuments) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    deduped.push(doc);
  }
  const sorted = [...deduped].sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id));

  const overlayState: RuntimeOverlayState = { history: [...runtime.overlayState.history] };

  return { ...runtime, sourceDocuments: sorted, overlayState };
}
