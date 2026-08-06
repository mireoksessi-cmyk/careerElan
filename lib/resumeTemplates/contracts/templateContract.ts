/*
  Phase 6F - the TemplateRenderer interface every registered template
  must implement. A template module (templates/professionalAts/index.ts
  etc.) exports one object of this shape; the registry never contains
  a switch/if-chain over templateId, only a Map<TemplateId,
  TemplateDefinition> (see registry/templateRegistry.ts).
*/
import type { TemplateCapabilities, TemplateDocxResult, TemplateHtmlResult, TemplatePdfResult, TemplateRenderContext } from "./types";

export interface TemplateRenderer {
  renderHtml(context: TemplateRenderContext): Promise<TemplateHtmlResult>;
  renderPdf(context: TemplateRenderContext): Promise<TemplatePdfResult>;
  renderDocx(context: TemplateRenderContext): Promise<TemplateDocxResult>;
}

export type TemplateDefinition = {
  capabilities: TemplateCapabilities;
  renderer: TemplateRenderer;
};
