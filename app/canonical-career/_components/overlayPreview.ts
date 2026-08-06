/*
  Phase 6E - client-side overlay preview helper. Reuses the REAL
  Runtime Layer (lib/careerMemory/runtime/**) exactly as spec section 5
  requires ("Repository → Runtime Layer → UI") - never reimplements
  overlay-merge logic. A CareerTailoredResumeRow only stores the raw
  `overlay` JSON, not the appliedEntryIds/rejections that were only
  ever in the create-time HTTP response - this recomputes them
  on-demand from the SAME pure applyOverlay() the server calls, so
  reopening an overlay in the viewer always shows an accurate preview,
  not a stale cached one.
*/
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeVersion, createRuntimeOverlayState } from "@/lib/careerMemory/runtime/factory";
import { applyOverlay, resolveTailoredResume } from "@/lib/careerMemory/runtime/overlayRuntime";
import type { CanonicalResumeRuntime, ResumeStructuredModel, TailoredMergeRejection } from "@/lib/canonicalCareerUi/types";

export type OverlayPreviewResult = {
  tailored: ResumeStructuredModel;
  appliedEntryIds: string[];
  rejections: TailoredMergeRejection[];
};

export function previewOverlay(baseResume: ResumeStructuredModel, versionId: string, overlay: unknown): OverlayPreviewResult {
  const runtime: CanonicalResumeRuntime = createCanonicalRuntime({
    resume: baseResume,
    version: createRuntimeVersion({ id: versionId, reason: "initial", createdAt: new Date(0).toISOString() }),
    metadata: createRuntimeMetadata({ schemaVersion: baseResume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });
  const applied = applyOverlay(runtime, overlay);
  const tailored = resolveTailoredResume(applied.runtime);
  return { tailored, appliedEntryIds: applied.appliedEntryIds, rejections: applied.rejections };
}
