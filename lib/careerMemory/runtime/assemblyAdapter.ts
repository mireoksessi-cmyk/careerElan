/*
  Phase 6A.2 Implementation - Assembly Adapter. The ONLY bridge from the
  new Canonical Runtime Layer to the existing, unmodified Phase 3
  professionalAtsAssembly pipeline (lib/documentPreservation/
  professionalAtsAssembly/buildProfessionalAtsAssembly.ts, not touched
  by this round). Satisfies the Phase 6A.2 audit's own Template
  Integration Contract (§I): every future template reads a
  ProfessionalAtsAssemblyDocument, never Career Memory's raw storage
  directly - this adapter is where a CanonicalResumeRuntime crosses that
  boundary, and it is the only place in this directory that imports
  from professionalAtsAssembly.
*/
import { buildProfessionalAtsAssembly } from "../../documentPreservation/professionalAtsAssembly/buildProfessionalAtsAssembly";
import type { ProfessionalAtsAssemblyDocument } from "../../documentPreservation/professionalAtsAssembly/types";
import type { CanonicalResumeRuntime } from "./types";
import { resolveTailoredResume } from "./overlayRuntime";

/*
  useTailored defaults to false (the pristine canonical resume) - a
  caller must opt in to seeing the tailored view, matching this whole
  Runtime Layer's own default-safe posture (Phase 6A.2 §F: canonical is
  never silently replaced by a tailored version).
*/
export function toProfessionalAtsAssemblyDocument(runtime: CanonicalResumeRuntime, options: { useTailored?: boolean } = {}): ProfessionalAtsAssemblyDocument {
  const model = options.useTailored ? resolveTailoredResume(runtime) : runtime.resume;
  return buildProfessionalAtsAssembly(model);
}
