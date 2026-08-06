/*
  Phase 6F - Template 4, Creative Timeline registration.
*/
import type { TemplateRenderer } from "../../contracts/templateContract";
import { registerTemplate } from "../../registry/templateRegistry";
import { CREATIVE_TIMELINE_CAPABILITIES } from "../../registry/templateMetadata";
import { renderCreativeTimelineHtml } from "./html";
import { renderCreativeTimelinePdf } from "./pdf";
import { renderCreativeTimelineDocx } from "./docx";

export const creativeTimelineRenderer: TemplateRenderer = {
  renderHtml: renderCreativeTimelineHtml,
  renderPdf: renderCreativeTimelinePdf,
  renderDocx: renderCreativeTimelineDocx,
};

export function registerCreativeTimelineTemplate(): void {
  registerTemplate({ capabilities: CREATIVE_TIMELINE_CAPABILITIES, renderer: creativeTimelineRenderer });
}
