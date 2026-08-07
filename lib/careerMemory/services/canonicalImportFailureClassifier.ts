/*
  Phase 6I.1 bug fix - canonicalResumeImportService.ts used to build its
  ValidationError message from `losslessDoc.validation.warnings` (or
  `structuredModel.validation.warnings`) alone. Both validators' own
  `.warnings` array is populated ONLY for a handful of soft/secondary
  issues (see losslessSemantic/validator.ts and
  resumeStructured/structuredValidator.ts's own header comments) - NONE
  of the fields that actually gate `.passed` false
  (missingElementIds/duplicateElementIds/missingTextSpans/
  inventedTextSpans/orderViolations for lossless;
  missingSectionIds/missingBlockIds/duplicateBlockIds/
  inventedFactValues/volunteerMixedIntoProfessional/
  missingCustomSections for structured) are ever pushed into `.warnings`.
  So a real failure almost always left `.warnings` empty, collapsing
  into the generic "unspecified failure" fallback string - discovered
  via a real user's real resume (see the two functions below for how it
  reproduced, root-caused, and was fixed).

  These two classifiers read the REAL gating fields directly and return
  a small closed code plus a PII-safe count-only summary - counts and
  block/section ids only, never document text - so a caller can log or
  display something actionable without ever risking leaking resume
  content. "First failing invariant" = first non-empty field in the
  same order the validator itself checks them (A before B before C...).
*/
import type { LosslessValidationReport } from "../../documentPreservation/losslessSemantic/types";
import type { StructuredResumeValidationReport } from "../../documentPreservation/resumeStructured/types";

export type LosslessFailureCode =
  | "LOSSLESS_ELEMENT_MISSING"
  | "LOSSLESS_ELEMENT_DUPLICATE"
  | "LOSSLESS_TEXT_MISSING"
  | "LOSSLESS_TEXT_INVENTED"
  | "LOSSLESS_ORDER_VIOLATION"
  | "LOSSLESS_UNKNOWN";

export type StructuredFailureCode =
  | "STRUCTURE_SECTION_MISSING"
  | "STRUCTURE_BLOCK_MISSING"
  | "STRUCTURE_BLOCK_DUPLICATE"
  | "STRUCTURE_FACT_INVENTED"
  | "STRUCTURE_VOLUNTEER_MISCLASSIFIED"
  | "STRUCTURE_CUSTOM_SECTION_MISSING"
  | "STRUCTURE_UNKNOWN";

export function classifyLosslessValidationFailure(v: LosslessValidationReport): { code: LosslessFailureCode; summary: string } {
  if (v.missingElementIds.length > 0) {
    return { code: "LOSSLESS_ELEMENT_MISSING", summary: `${v.missingElementIds.length} of ${v.sourceElementCount} source element(s) are not represented in any block.` };
  }
  if (v.duplicateElementIds.length > 0) {
    return { code: "LOSSLESS_ELEMENT_DUPLICATE", summary: `${v.duplicateElementIds.length} source element(s) are referenced by more than one block.` };
  }
  if (v.missingTextSpans.length > 0) {
    return { code: "LOSSLESS_TEXT_MISSING", summary: `${v.missingTextSpans.length} block(s) do not fully contain their own source elements' text.` };
  }
  if (v.inventedTextSpans.length > 0) {
    return { code: "LOSSLESS_TEXT_INVENTED", summary: `${v.inventedTextSpans.length} block(s) contain text beyond what their source elements provide.` };
  }
  if (v.orderViolations.length > 0) {
    return { code: "LOSSLESS_ORDER_VIOLATION", summary: `${v.orderViolations.length} block(s) appear out of their original page/reading order.` };
  }
  return { code: "LOSSLESS_UNKNOWN", summary: "Lossless validation failed but no known gating field was populated - this indicates a new check was added to validateLosslessDocument() without a matching case here." };
}

export function classifyStructuredValidationFailure(v: StructuredResumeValidationReport): { code: StructuredFailureCode; summary: string } {
  if (v.missingSectionIds.length > 0) {
    return { code: "STRUCTURE_SECTION_MISSING", summary: `${v.missingSectionIds.length} of ${v.sourceSectionCount} source section(s) are not represented in the structured model.` };
  }
  if (v.missingBlockIds.length > 0) {
    return { code: "STRUCTURE_BLOCK_MISSING", summary: `${v.missingBlockIds.length} of ${v.sourceBlockCount} source block(s) are not represented in the structured model.` };
  }
  if (v.duplicateBlockIds.length > 0) {
    return { code: "STRUCTURE_BLOCK_DUPLICATE", summary: `${v.duplicateBlockIds.length} source block(s) are represented more than once in the structured model.` };
  }
  if (v.inventedFactValues.length > 0) {
    return { code: "STRUCTURE_FACT_INVENTED", summary: `${v.inventedFactValues.length} structured field(s) contain a value not traceable to any source block.` };
  }
  if (v.volunteerMixedIntoProfessional.length > 0) {
    return { code: "STRUCTURE_VOLUNTEER_MISCLASSIFIED", summary: `${v.volunteerMixedIntoProfessional.length} volunteer entry/entries were classified as professional experience.` };
  }
  if (v.missingCustomSections.length > 0) {
    return { code: "STRUCTURE_CUSTOM_SECTION_MISSING", summary: `${v.missingCustomSections.length} unclassifiable section(s) were dropped instead of preserved as custom sections.` };
  }
  return { code: "STRUCTURE_UNKNOWN", summary: "Structured validation failed but no known gating field was populated - this indicates a new check was added to validateStructuredResume() without a matching case here." };
}
