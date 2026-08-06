/*
  Phase 6F - physical paper dimensions for the 3 NEW templates (CSS
  print sizing + px equivalents for real-browser measurement, 96px/in,
  96/25.4 px/mm - the standard CSS reference pixel). Professional ATS
  keeps using its own existing professionalAtsHtml/designTokens.ts
  PAPER_DIMENSIONS unmodified.
*/
import type { PaperSize } from "../contracts/types";

export type PaperDimensions = {
  widthCss: string;
  heightCss: string;
  widthPx: number;
  heightPx: number;
};

export const PAPER_DIMENSIONS: Record<PaperSize, PaperDimensions> = {
  letter: { widthCss: "8.5in", heightCss: "11in", widthPx: 816, heightPx: 1056 },
  a4: { widthCss: "210mm", heightCss: "297mm", widthPx: 794, heightPx: 1123 },
};
