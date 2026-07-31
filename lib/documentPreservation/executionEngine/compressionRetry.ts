/*
  Document Preservation Engine (DPE) - Phase 4B completion. Compression
  Retry.

  This module stays a thin, pure forwarder to an INJECTED
  `regeneratePackage` function - this module itself never imports
  Supabase or OpenAI, keeping the Execution Engine's core (this file,
  retryEngine.ts, index.ts) free of any network/DB dependency, exactly
  like every other module in this pipeline.

  What changed from the earlier version of this file: the structural
  limitation it used to document ("Generate Package's public interface
  has no parameter for compression") is now closed. This phase was
  explicitly authorized to extend that interface with a minimal, OFFICIAL
  `LayoutConstraints` contract (lib/generatePackage/shared.ts) - a real
  second parameter, not a workaround. `regeneratePackage` now receives
  these constraints and can forward them into a REAL compression request
  (dpe_generation_mode="layout_compression" + dpe_layout_constraints on
  the applications row, read by generateCore.ts's own prompt builder - see
  that file's own comment). A concrete, real implementation of this
  injection point lives in ./realRegeneratePackage.ts, which actually
  calls Generate Package's own runPackageGeneration() - the real public
  interface, unmodified prompt pipeline, real OpenAI call boundary - not a
  mock.
*/
import type { LayoutConstraints, RegeneratePackageFn } from "./types";

export async function requestCompressionRetry(
  applicationId: string,
  layoutConstraints: LayoutConstraints,
  regeneratePackage: RegeneratePackageFn
): ReturnType<RegeneratePackageFn> {
  return regeneratePackage(applicationId, layoutConstraints);
}
