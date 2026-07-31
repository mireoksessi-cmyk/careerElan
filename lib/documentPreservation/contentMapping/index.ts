/*
  Document Preservation Engine (DPE) - Phase 4A (Generated Content
  Mapping) entry point. Not called from anywhere yet - no route, worker,
  or existing Generate Package/Renderer code imports this module (see the
  final report's "Generate Package/Renderer/Dashboard 변경 여부"
  sections). Wiring this into a real caller, and actually replacing text
  (the next phase), are both out of scope here - this only decides WHICH
  generated content unit targets WHICH Content Box.
*/
import type { DPEDocumentType } from "../types";
import type { DocumentLayerModel } from "../contentBox/types";
import { createResumeMapping } from "./resumeMapping";
import { createCoverLetterMapping } from "./coverLetterMapping";
import type { ReplacementPlan } from "./types";

/*
  10. Mapping Entry Point.

  `generatedText` is exactly one field of the existing, unmodified
  GeneratedPackage the caller already has (`.resume` for a resume
  document, `.coverLetter` for a cover letter document) - this function
  never fetches or re-derives Generate Package output itself.
  `layerModel` is Phase 3's DocumentLayerModel for the SAME document
  (its editableBoxes are the only mapping targets - Template Layer boxes
  are never touched, per this phase's "Template Layer는 절대 수정 대상이
  아니다").
*/
export function createReplacementPlan(
  documentType: DPEDocumentType,
  generatedText: string,
  layerModel: DocumentLayerModel
): ReplacementPlan {
  return documentType === "resume"
    ? createResumeMapping(generatedText, layerModel)
    : createCoverLetterMapping(generatedText, layerModel);
}

export * from "./types";
export { createResumeMapping, matchEditableBoxes, matchSectionBoxes } from "./resumeMapping";
export { createCoverLetterMapping } from "./coverLetterMapping";
export { pairPositionally } from "./positionalPairing";
