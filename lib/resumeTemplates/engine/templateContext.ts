/*
  Phase 6F - builds the one TemplateRenderContext every template
  renderer consumes, from an already-resolved ResumeStructuredModel.
  This is the single place default paperSize/density/locale/photoOption
  get applied, so no individual template has to guess a default.
*/
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";
import type { PaperSize, PhotoOption, TemplateCapabilities, TemplateDensity, TemplateId, TemplateRenderContext } from "../contracts/types";
import { assertHasIdentity, assertRuntimeResumeIsRenderable } from "../contracts/validation";

export type BuildTemplateRenderContextOptions = {
  templateId: TemplateId;
  capabilities: TemplateCapabilities;
  paperSize?: PaperSize;
  density?: TemplateDensity;
  locale?: string;
  photoOption?: PhotoOption;
  generatedAt: string;
  sectionVisibility?: Record<string, boolean>;
};

export function buildTemplateRenderContext(resume: ResumeStructuredModel, options: BuildTemplateRenderContextOptions): TemplateRenderContext {
  assertRuntimeResumeIsRenderable(resume);
  assertHasIdentity(resume);

  return {
    resume,
    templateId: options.templateId,
    paperSize: options.paperSize ?? options.capabilities.defaultPaperSize,
    density: options.density ?? options.capabilities.defaultDensity,
    locale: options.locale ?? "en",
    photoOption: options.photoOption ?? (options.capabilities.supportsPhoto ? "placeholder" : "none"),
    generatedAt: options.generatedAt,
    sectionVisibility: options.sectionVisibility,
  };
}
