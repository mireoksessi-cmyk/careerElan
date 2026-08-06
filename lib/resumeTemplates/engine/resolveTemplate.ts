/*
  Phase 6F - Canonical Runtime -> resolved ResumeStructuredModel. This
  is a thin, deliberate wrapper around the EXISTING, unmodified
  runtime/overlayRuntime.ts:resolveTailoredResume() - it does not
  re-implement overlay folding. Mirrors the same useTailored-default-
  false posture as runtime/assemblyAdapter.ts's
  toProfessionalAtsAssemblyDocument(), so a template consumer opts in
  to a tailored view rather than getting one silently.
*/
import type { CanonicalResumeRuntime } from "../../careerMemory/runtime/types";
import { resolveTailoredResume } from "../../careerMemory/runtime/overlayRuntime";
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";

export function resolveResumeFromRuntime(runtime: CanonicalResumeRuntime, options: { useTailored?: boolean } = {}): ResumeStructuredModel {
  return options.useTailored ? resolveTailoredResume(runtime) : runtime.resume;
}
