/*
  Phase 6F - per-density spacing tokens for the 3 NEW templates (Modern
  Sidebar, Executive Minimal, Creative Timeline). Professional ATS's
  wrapper keeps using its own existing professionalAtsHtml/
  professionalAtsDocx designTokens.ts unmodified - these tokens are
  never read by that template. Shape mirrors the existing
  DensitySpacingTokens/DocxDensityTokens (px-based for HTML/PDF,
  twips/half-points for DOCX) so the same mental model transfers, but
  keyed by this round's own 4-value TemplateDensity scale instead of
  AssemblyDensity.
*/
import type { TemplateDensity } from "../contracts/types";

export type HtmlSpacingTokens = {
  pagePaddingPx: number;
  sectionGapPx: number;
  headingMarginBottomPx: number;
  entryGapPx: number;
  bulletGapPx: number;
  lineHeight: number;
  fontSizePt: number;
  sidebarWidthPercent: number;
};

export const HTML_DENSITY_SPACING: Record<TemplateDensity, HtmlSpacingTokens> = {
  spacious: { pagePaddingPx: 64, sectionGapPx: 32, headingMarginBottomPx: 14, entryGapPx: 20, bulletGapPx: 6, lineHeight: 1.5, fontSizePt: 11, sidebarWidthPercent: 30 },
  comfortable: { pagePaddingPx: 48, sectionGapPx: 24, headingMarginBottomPx: 12, entryGapPx: 16, bulletGapPx: 5, lineHeight: 1.4, fontSizePt: 10.5, sidebarWidthPercent: 30 },
  balanced: { pagePaddingPx: 40, sectionGapPx: 18, headingMarginBottomPx: 10, entryGapPx: 12, bulletGapPx: 4, lineHeight: 1.3, fontSizePt: 10.5, sidebarWidthPercent: 32 },
  compact: { pagePaddingPx: 32, sectionGapPx: 14, headingMarginBottomPx: 8, entryGapPx: 9, bulletGapPx: 3, lineHeight: 1.2, fontSizePt: 10, sidebarWidthPercent: 28 },
};

export type DocxSpacingTokens = {
  pageMarginTwips: number;
  sectionSpacingBeforeTwips: number;
  headingSpacingAfterTwips: number;
  entrySpacingBeforeTwips: number;
  bulletSpacingAfterTwips: number;
  lineSpacingTwips: number;
  fontSizeHalfPoints: number;
  bulletIndentTwips: number;
  bulletHangingTwips: number;
};

/* 1440 twips = 1 inch. */
export const DOCX_DENSITY_SPACING: Record<TemplateDensity, DocxSpacingTokens> = {
  spacious: { pageMarginTwips: 1440, sectionSpacingBeforeTwips: 360, headingSpacingAfterTwips: 160, entrySpacingBeforeTwips: 240, bulletSpacingAfterTwips: 80, lineSpacingTwips: 320, fontSizeHalfPoints: 22, bulletIndentTwips: 360, bulletHangingTwips: 260 },
  comfortable: { pageMarginTwips: 1152, sectionSpacingBeforeTwips: 280, headingSpacingAfterTwips: 140, entrySpacingBeforeTwips: 200, bulletSpacingAfterTwips: 60, lineSpacingTwips: 276, fontSizeHalfPoints: 21, bulletIndentTwips: 340, bulletHangingTwips: 240 },
  balanced: { pageMarginTwips: 1008, sectionSpacingBeforeTwips: 220, headingSpacingAfterTwips: 110, entrySpacingBeforeTwips: 150, bulletSpacingAfterTwips: 50, lineSpacingTwips: 252, fontSizeHalfPoints: 21, bulletIndentTwips: 320, bulletHangingTwips: 220 },
  compact: { pageMarginTwips: 864, sectionSpacingBeforeTwips: 160, headingSpacingAfterTwips: 80, entrySpacingBeforeTwips: 100, bulletSpacingAfterTwips: 30, lineSpacingTwips: 232, fontSizeHalfPoints: 20, bulletIndentTwips: 300, bulletHangingTwips: 200 },
};

export const DENSITY_ESCALATION_ORDER: TemplateDensity[] = ["spacious", "comfortable", "balanced", "compact"];
export const MIN_SAFE_FONT_SIZE_HALF_POINTS = 20;
