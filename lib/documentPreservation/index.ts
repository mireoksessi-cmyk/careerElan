/*
  Document Preservation Engine (DPE) - Phase 1 entry point.

  Not called from anywhere yet. No route, page, or existing renderer call
  site imports this module - wiring it into the real
  Dashboard -> Generate Package -> DPE -> Renderer -> Validation -> Export
  flow is explicitly out of scope for Phase 1 (that would mean changing
  Renderer/Generate Package/Dashboard call sites, which this phase must
  not touch). This function exists so a later phase has a fixed,
  type-checked target to import and wire in.

  runDocumentPreservationEngine() itself does no layout analysis - it
  only builds an empty, well-formed DPEDocument shell from the inputs
  Generate Package already produces (generatedText/templateId, unchanged)
  and reports status "not_implemented" honestly rather than claiming any
  preservation happened.
*/

import type { DPEPipelineInput, DPEPipelineResult } from "./pipeline";
import type { DPEDocument } from "./types";

export function runDocumentPreservationEngine(
  input: DPEPipelineInput
): DPEPipelineResult {
  const document: DPEDocument = {
    documentType: input.documentType,
    metadata: {
      sourceDocumentId: input.sourceDocumentId ?? null,
      documentType: input.documentType,
    },
    pages: [],
    layout: {},
  };

  return {
    status: "not_implemented",
    document,
  };
}

export * from "./types";
export * from "./status";
export * from "./pipeline";
export * from "./rendererAdapter";
export * from "./validation";
export * from "./exportAdapter";
