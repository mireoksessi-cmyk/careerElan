/*
  TASK 2 - Paper size dimensions and density -> CSS spacing tokens.
  Spec section 3/4/5. Font stack reuses this project's own existing
  resume-rendering font stack (app/globals.css's `body` rule -
  Arial/Helvetica/sans-serif) rather than adding a new font file. Font
  size and line-height have a hard safety floor that NO density level
  may cross - only page/section/entry/bullet spacing may shrink.
*/
import type { AssemblyDensity } from "../professionalAtsAssembly/types";
import type { PaperSize } from "./types";

export const PROFESSIONAL_ATS_FONT_STACK = "Arial, Helvetica, sans-serif";

/* CSS "in"/"mm" units - actual measured pixel values are captured via
   getBoundingClientRect() in measurement.ts, never hardcoded here as
   px; these are the print-standard physical dimensions the CSS itself
   declares. */
export const PAPER_DIMENSIONS: Record<PaperSize, { width: string; height: string; margin: string }> = {
  letter: { width: "8.5in", height: "11in", margin: "0.6in" },
  a4: { width: "210mm", height: "297mm", margin: "15mm" },
};

export type DensitySpacingTokens = {
  pagePaddingPx: number;
  sectionGapPx: number;
  headingMarginBottomPx: number;
  entryGapPx: number;
  bulletGapPx: number;
  skillItemGapPx: number;
  lineHeight: number;
  fontSizePt: number;
};

/* Safety floor - no density level may produce a font-size/line-height
   below this. Enforced both here (values never go below it) and by a
   runtime assertion in densityAutoFit.ts. */
export const MIN_SAFE_FONT_SIZE_PT = 10;
export const MIN_SAFE_LINE_HEIGHT = 1.15;

export const DENSITY_SPACING: Record<AssemblyDensity, DensitySpacingTokens> = {
  comfortable: {
    pagePaddingPx: 48, sectionGapPx: 23, headingMarginBottomPx: 10, entryGapPx: 14,
    bulletGapPx: 4, skillItemGapPx: 8, lineHeight: 1.4, fontSizePt: 11,
  },
  balanced: {
    pagePaddingPx: 40, sectionGapPx: 18, headingMarginBottomPx: 8, entryGapPx: 11,
    bulletGapPx: 3, skillItemGapPx: 6, lineHeight: 1.3, fontSizePt: 10.5,
  },
  compact: {
    pagePaddingPx: 32, sectionGapPx: 13, headingMarginBottomPx: 6, entryGapPx: 8,
    bulletGapPx: 2, skillItemGapPx: 5, lineHeight: 1.2, fontSizePt: 10.5,
  },
  "ultra-compact": {
    pagePaddingPx: 24, sectionGapPx: 10, headingMarginBottomPx: 4, entryGapPx: 6,
    bulletGapPx: 2, skillItemGapPx: 4, lineHeight: 1.15, fontSizePt: 10,
  },
};

/* Fixed escalation order - never skip a step, never go backwards once
   a working density is found for a given fixture/model. */
export const DENSITY_ESCALATION_ORDER: AssemblyDensity[] = ["comfortable", "balanced", "compact", "ultra-compact"];
