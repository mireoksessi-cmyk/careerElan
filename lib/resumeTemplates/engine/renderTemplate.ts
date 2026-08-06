/*
  Phase 6F - top-level orchestration: CanonicalResumeRuntime -> resolved
  model -> TemplateRenderContext -> registered renderer -> result.
  This is the one function the Gallery API route and tests call; it
  never re-implements resolution/context-building/registry lookup
  itself, only composes the three smaller functions that do.
*/
import type { CanonicalResumeRuntime } from "../../careerMemory/runtime/types";
import type { PaperSize, PhotoOption, TemplateDensity, TemplateDocxResult, TemplateFormat, TemplateHtmlResult, TemplateId, TemplatePdfResult } from "../contracts/types";
import { getTemplateCapabilities, renderRegisteredTemplate } from "../registry/templateRegistry";
import { resolveResumeFromRuntime } from "./resolveTemplate";
import { buildTemplateRenderContext } from "./templateContext";

export type RenderTemplateFromRuntimeOptions = {
  templateId: TemplateId;
  useTailored?: boolean;
  paperSize?: PaperSize;
  density?: TemplateDensity;
  locale?: string;
  photoOption?: PhotoOption;
  generatedAt: string;
};

async function prepare(runtime: CanonicalResumeRuntime, options: RenderTemplateFromRuntimeOptions) {
  const capabilities = getTemplateCapabilities(options.templateId);
  const resume = resolveResumeFromRuntime(runtime, { useTailored: options.useTailored });
  const context = buildTemplateRenderContext(resume, {
    templateId: options.templateId,
    capabilities,
    paperSize: options.paperSize,
    density: options.density,
    locale: options.locale,
    photoOption: options.photoOption,
    generatedAt: options.generatedAt,
  });
  return context;
}

export async function renderTemplateFromRuntime(runtime: CanonicalResumeRuntime, options: RenderTemplateFromRuntimeOptions, format: "html"): Promise<TemplateHtmlResult>;
export async function renderTemplateFromRuntime(runtime: CanonicalResumeRuntime, options: RenderTemplateFromRuntimeOptions, format: "pdf"): Promise<TemplatePdfResult>;
export async function renderTemplateFromRuntime(runtime: CanonicalResumeRuntime, options: RenderTemplateFromRuntimeOptions, format: "docx"): Promise<TemplateDocxResult>;
export async function renderTemplateFromRuntime(runtime: CanonicalResumeRuntime, options: RenderTemplateFromRuntimeOptions, format: TemplateFormat): Promise<TemplateHtmlResult | TemplatePdfResult | TemplateDocxResult> {
  const context = await prepare(runtime, options);
  if (format === "html") return renderRegisteredTemplate(options.templateId, context, "html");
  if (format === "pdf") return renderRegisteredTemplate(options.templateId, context, "pdf");
  return renderRegisteredTemplate(options.templateId, context, "docx");
}
