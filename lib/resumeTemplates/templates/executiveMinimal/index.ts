/*
  Phase 6F - Template 3, Executive Minimal registration.
*/
import type { TemplateRenderer } from "../../contracts/templateContract";
import { registerTemplate } from "../../registry/templateRegistry";
import { EXECUTIVE_MINIMAL_CAPABILITIES } from "../../registry/templateMetadata";
import { renderExecutiveMinimalHtml } from "./html";
import { renderExecutiveMinimalPdf } from "./pdf";
import { renderExecutiveMinimalDocx } from "./docx";

export const executiveMinimalRenderer: TemplateRenderer = {
  renderHtml: renderExecutiveMinimalHtml,
  renderPdf: renderExecutiveMinimalPdf,
  renderDocx: renderExecutiveMinimalDocx,
};

export function registerExecutiveMinimalTemplate(): void {
  registerTemplate({ capabilities: EXECUTIVE_MINIMAL_CAPABILITIES, renderer: executiveMinimalRenderer });
}
