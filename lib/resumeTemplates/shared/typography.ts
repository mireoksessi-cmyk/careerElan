/*
  Phase 6F - per-template typography stacks. Every stack is
  system/websafe fonts only (no webfont download, no unclear-license
  embed - spec section 2's explicit prohibition), mirroring the
  existing professionalAtsHtml/professionalAtsDocx convention of a
  plain CSS font-stack plus an explicit East-Asian fallback so Korean
  text never silently falls back to a missing-glyph box (see
  professionalAtsDocx/designTokens.ts's PROFESSIONAL_ATS_DOCX_EAST_ASIA_FONT
  precedent, reused verbatim here for consistency across all 4
  templates rather than left to each template's own guess).
*/
import type { TemplateId } from "../contracts/types";

export type FontStack = {
  heading: string;
  body: string;
  eastAsiaFallback: string;
  docxHeadingFont: string;
  docxBodyFont: string;
  docxEastAsiaFont: string;
};

export const PROFESSIONAL_ATS_FONTS: FontStack = {
  heading: "Georgia, 'Times New Roman', Times, serif",
  body: "Arial, Helvetica, sans-serif",
  eastAsiaFallback: "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
  docxHeadingFont: "Georgia",
  docxBodyFont: "Arial",
  docxEastAsiaFont: "Malgun Gothic",
};

export const MODERN_SIDEBAR_FONTS: FontStack = {
  heading: "'Segoe UI', Calibri, Arial, sans-serif",
  body: "'Segoe UI', Calibri, Arial, sans-serif",
  eastAsiaFallback: "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
  docxHeadingFont: "Calibri",
  docxBodyFont: "Calibri",
  docxEastAsiaFont: "Malgun Gothic",
};

export const EXECUTIVE_MINIMAL_FONTS: FontStack = {
  heading: "Garamond, Georgia, 'Times New Roman', serif",
  body: "Georgia, 'Times New Roman', Times, serif",
  eastAsiaFallback: "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
  docxHeadingFont: "Garamond",
  docxBodyFont: "Georgia",
  docxEastAsiaFont: "Malgun Gothic",
};

export const CREATIVE_TIMELINE_FONTS: FontStack = {
  heading: "'Trebuchet MS', 'Segoe UI', Arial, sans-serif",
  body: "'Segoe UI', Calibri, Arial, sans-serif",
  eastAsiaFallback: "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
  docxHeadingFont: "Trebuchet MS",
  docxBodyFont: "Calibri",
  docxEastAsiaFont: "Malgun Gothic",
};

export const FONTS_BY_TEMPLATE: Record<TemplateId, FontStack> = {
  "professional-ats": PROFESSIONAL_ATS_FONTS,
  "modern-sidebar": MODERN_SIDEBAR_FONTS,
  "executive-minimal": EXECUTIVE_MINIMAL_FONTS,
  "creative-timeline": CREATIVE_TIMELINE_FONTS,
};

export const MIN_SAFE_FONT_SIZE_PT = 10;
export const MIN_SAFE_LINE_HEIGHT = 1.15;
