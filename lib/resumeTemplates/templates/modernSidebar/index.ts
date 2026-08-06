/*
  Phase 6F - Template 2, Modern Sidebar registration.
*/
import type { TemplateRenderer } from "../../contracts/templateContract";
import { registerTemplate } from "../../registry/templateRegistry";
import { MODERN_SIDEBAR_CAPABILITIES } from "../../registry/templateMetadata";
import { renderModernSidebarHtml } from "./html";
import { renderModernSidebarPdf } from "./pdf";
import { renderModernSidebarDocx } from "./docx";

export const modernSidebarRenderer: TemplateRenderer = {
  renderHtml: renderModernSidebarHtml,
  renderPdf: renderModernSidebarPdf,
  renderDocx: renderModernSidebarDocx,
};

export function registerModernSidebarTemplate(): void {
  registerTemplate({ capabilities: MODERN_SIDEBAR_CAPABILITIES, renderer: modernSidebarRenderer });
}
