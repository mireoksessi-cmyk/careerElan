/*
  Document Preservation Engine (DPE) - Phase 1 skeleton.

  Type-level contract for the recommended flow:

    Dashboard -> Generate Package -> DPE -> Renderer -> Validation -> Export

  Phase 1 defines the stage names and the DPE stage's own input/output
  shape only. It does not implement Layout Analysis, Content Box
  Detection, Overflow handling, or Page Cloning (Phase 2+), and it does
  not change how Dashboard, Generate Package, Renderer, Validation, or
  Export actually work today - see index.ts for the (intentionally inert)
  entry point.
*/

import type { DPEDocumentType, DPEDocument } from "./types";
import type { DPEPreservationStatus } from "./status";

export const DPE_PIPELINE_STAGES = [
  "dashboard",
  "generate_package",
  "document_preservation",
  "renderer",
  "validation",
  "export",
] as const;

export type DPEPipelineStage = (typeof DPE_PIPELINE_STAGES)[number];

/*
  What DPE receives from Generate Package. `generatedText` and
  `templateId` are exactly the existing values already flowing into
  lib/brand/render/A4DocumentPreview.tsx (`text`/`templateId` props) and
  the existing Renderer.exportPdf/exportDocx (`text`, `templateId`) -
  Generate Package's contract is unchanged, DPE just also receives it.
*/
export type DPEPipelineInput = {
  documentType: DPEDocumentType;
  generatedText: string;
  templateId?: string | null;
  /*
    Reserved for a future phase once the original uploaded document can
    actually be analyzed (see lib/documentPreservation/types.ts's
    DPEMetadata.sourceDocumentId comment on why this doesn't exist yet
    upstream). Optional and unused in Phase 1.
  */
  sourceDocumentId?: string | null;
};

export type DPEPipelineResult = {
  status: DPEPreservationStatus;
  document: DPEDocument;
};
