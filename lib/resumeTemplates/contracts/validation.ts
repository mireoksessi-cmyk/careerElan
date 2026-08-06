/*
  Phase 6F - shared contract-level error type + pure guard functions.
  These check the REGISTRY CONTRACT (is this template id known, does
  this template support this format/paper size/density, is the input
  runtime well-formed enough to attempt rendering) - not
  content-preservation, which lives in lib/resumeTemplates/parity/.
  Mirrors this repo's established closed-error-code convention (see
  lib/canonicalCareerUi/errors.ts's CanonicalApiError).
*/
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";
import type { PaperSize, TemplateCapabilities, TemplateDensity, TemplateFormat, TemplateId } from "./types";

export type TemplateContractErrorCode =
  | "unknown-template-id"
  | "missing-renderer"
  | "unsupported-format"
  | "unsupported-paper-size"
  | "unsupported-density"
  | "malformed-runtime"
  | "missing-identity";

export class TemplateContractError extends Error {
  code: TemplateContractErrorCode;

  constructor(code: TemplateContractErrorCode, message: string) {
    super(message);
    this.name = "TemplateContractError";
    this.code = code;
  }
}

export function isKnownTemplateId(id: string, knownIds: readonly TemplateId[]): id is TemplateId {
  return (knownIds as readonly string[]).includes(id);
}

export function assertSupportedFormat(capabilities: TemplateCapabilities, format: TemplateFormat): void {
  if (!capabilities.supportedFormats.includes(format)) {
    throw new TemplateContractError("unsupported-format", `Template '${capabilities.id}' does not support format '${format}'.`);
  }
}

export function assertSupportedPaperSize(capabilities: TemplateCapabilities, paperSize: PaperSize): void {
  if (!capabilities.supportedPaperSizes.includes(paperSize)) {
    throw new TemplateContractError("unsupported-paper-size", `Template '${capabilities.id}' does not support paper size '${paperSize}'.`);
  }
}

export function assertSupportedDensity(capabilities: TemplateCapabilities, density: TemplateDensity): void {
  if (!capabilities.supportedDensities.includes(density)) {
    throw new TemplateContractError("unsupported-density", `Template '${capabilities.id}' does not support density '${density}'.`);
  }
}

/*
  A deliberately shallow structural check - not a full schema
  validator (that already exists one layer down, in Phase 2's own
  structuredValidator.ts, and re-implementing it here would be exactly
  the "Parser/Extractor 수정" duplication the spec forbids). This only
  guards against the specific malformed-input shapes a template
  renderer cannot safely proceed on: a missing resume object, and a
  missing/undefined identity when at least a raw fallback should still
  exist.
*/
export function assertRuntimeResumeIsRenderable(resume: ResumeStructuredModel | null | undefined): asserts resume is ResumeStructuredModel {
  if (!resume || typeof resume !== "object") {
    throw new TemplateContractError("malformed-runtime", "TemplateRenderContext.resume is missing or not an object.");
  }
  if (!Array.isArray(resume.professionalExperience) || !Array.isArray(resume.education)) {
    throw new TemplateContractError("malformed-runtime", "TemplateRenderContext.resume is missing required array fields.");
  }
}

export function assertHasIdentity(resume: ResumeStructuredModel): void {
  if (!resume.identity || (!resume.identity.fullName && resume.identity.otherContactLines.length === 0)) {
    throw new TemplateContractError("missing-identity", "Resume has no identity.fullName and no fallback contact line to render a header from.");
  }
}
