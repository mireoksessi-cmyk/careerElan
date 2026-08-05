/*
  TASK 3 - Paper size (twips) and density -> DOCX paragraph/run token
  mapping. A separate token set from Phase 4's designTokens.ts
  (px-based, for CSS) - per spec section 8, DOCX gets its own
  point/twip-native mapping rather than a px->twips unit conversion of
  Phase 4's exact numbers, while preserving the same 4 density names
  and the same comfortable->ultra-compact spacing INTENT.

  OOXML unit conventions (docx package, verified against
  node_modules/docx/dist/index.d.ts this session):
  - w:spacing before/after: twips (1/20 pt, 1440 per inch).
  - w:sz (run font size): half-points (docx package's `size` field is
    already in half-points, e.g. size: 22 = 11pt).
  - w:spacing line (with lineRule: "auto"): twips-of-240-per-line
    convention (240 = single, 276 = 1.15x, 360 = 1.5x).
  - page margins / page size: twips.

  Font size floor mirrors Phase 4's own MIN_SAFE_FONT_SIZE_PT (10pt) -
  same safety floor, independently enforced here since this is a
  genuinely separate token set (spec section 8: no density level may
  shrink content, only spacing).
*/
import type { AssemblyDensity } from "../professionalAtsAssembly/types";
import type { PaperSize } from "../professionalAtsHtml/types";

export const PROFESSIONAL_ATS_DOCX_FONT = "Arial";
/* Word's own eastAsia font fallback slot - not a new font file, just a
   font-family NAME reference to a commonly pre-installed Windows/Mac
   font, so Korean text renders with real glyphs instead of Word's
   generic tofu fallback. */
export const PROFESSIONAL_ATS_DOCX_EAST_ASIA_FONT = "Malgun Gothic";

const TWIPS_PER_INCH = 1440;
const TWIPS_PER_MM = TWIPS_PER_INCH / 25.4;

export const PAGE_SIZE_TWIPS: Record<PaperSize, { widthTwips: number; heightTwips: number }> = {
  letter: { widthTwips: Math.round(8.5 * TWIPS_PER_INCH), heightTwips: Math.round(11 * TWIPS_PER_INCH) },
  a4: { widthTwips: Math.round(210 * TWIPS_PER_MM), heightTwips: Math.round(297 * TWIPS_PER_MM) },
};

export type DocxDensityTokens = {
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

export const MIN_SAFE_FONT_SIZE_HALF_POINTS = 20; /* 10pt, matches Phase 4's own MIN_SAFE_FONT_SIZE_PT */

export const DOCX_DENSITY_SPACING: Record<AssemblyDensity, DocxDensityTokens> = {
  comfortable: {
    pageMarginTwips: 1080, // 0.75in
    sectionSpacingBeforeTwips: 280,
    headingSpacingAfterTwips: 140,
    entrySpacingBeforeTwips: 200,
    bulletSpacingAfterTwips: 60,
    lineSpacingTwips: 276, // 1.15x
    fontSizeHalfPoints: 22, // 11pt
    bulletIndentTwips: 360,
    bulletHangingTwips: 360,
  },
  balanced: {
    pageMarginTwips: 900, // 0.625in
    sectionSpacingBeforeTwips: 220,
    headingSpacingAfterTwips: 110,
    entrySpacingBeforeTwips: 160,
    bulletSpacingAfterTwips: 45,
    lineSpacingTwips: 264, // 1.1x
    fontSizeHalfPoints: 21, // 10.5pt
    bulletIndentTwips: 340,
    bulletHangingTwips: 340,
  },
  compact: {
    pageMarginTwips: 720, // 0.5in
    sectionSpacingBeforeTwips: 160,
    headingSpacingAfterTwips: 80,
    entrySpacingBeforeTwips: 120,
    bulletSpacingAfterTwips: 30,
    lineSpacingTwips: 252, // 1.05x
    fontSizeHalfPoints: 21, // 10.5pt
    bulletIndentTwips: 320,
    bulletHangingTwips: 320,
  },
  "ultra-compact": {
    pageMarginTwips: 576, // 0.4in
    sectionSpacingBeforeTwips: 110,
    headingSpacingAfterTwips: 55,
    entrySpacingBeforeTwips: 90,
    bulletSpacingAfterTwips: 20,
    lineSpacingTwips: 240, // 1.0x
    fontSizeHalfPoints: 20, // 10pt (safety floor)
    bulletIndentTwips: 300,
    bulletHangingTwips: 300,
  },
};
