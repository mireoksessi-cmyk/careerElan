/*
  Phase 6E - Runtime Inspector (spec section 12, "Developer Mode").
  Pure read-only summarization of a CanonicalResumeRuntime - never
  mutates it, never calls the network. buildRuntimeJsonPreview is the
  literal source of truth the UI renders in a <pre> block (spec: "JSON
  Preview... Readonly 표시") - it must never diverge from what
  JSON.stringify(runtime) actually contains, so it does not reshape or
  redact anything.
*/
import type { CanonicalResumeRuntime, MergeSectionKey, RuntimeInspectorSummary } from "./types";

export function buildRuntimeInspectorSummary(runtime: CanonicalResumeRuntime): RuntimeInspectorSummary {
  const entryCounts: Record<MergeSectionKey, number> = {
    professionalExperience: runtime.resume.professionalExperience.length,
    volunteerExperience: runtime.resume.volunteerExperience.length,
    education: runtime.resume.education.length,
    projects: runtime.resume.projects.length,
    credentials: runtime.resume.credentials.length,
  };

  return {
    schemaVersion: runtime.metadata.schemaVersion,
    serializerVersion: runtime.metadata.serializerVersion,
    runtimeSerializerVersion: runtime.serializerVersion,
    versionId: runtime.version.id,
    versionReason: runtime.version.reason,
    parentVersionId: runtime.version.parentVersionId,
    overlayCount: runtime.overlayState.history.length,
    sourceDocumentCount: runtime.sourceDocuments.length,
    validationPassed: runtime.resume.validation.passed,
    validationWarningCount: runtime.resume.validation.warnings.length,
    entryCounts,
  };
}

export function buildRuntimeJsonPreview(runtime: CanonicalResumeRuntime): string {
  return JSON.stringify(runtime, null, 2);
}
