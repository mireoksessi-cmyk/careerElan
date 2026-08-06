/*
  Phase 6F - small shared accessibility/semantics helpers used by all
  4 templates' HTML renderers. Kept intentionally minimal: this round
  does not build a full a11y audit, only the handful of concerns that
  double as content-preservation concerns (a decorative marker must
  never be mistaken for real text by a screen reader OR by a PDF text
  extractor - the same aria-hidden/alt-text discipline serves both).
*/
import { MIN_SAFE_FONT_SIZE_PT } from "./typography";

export function clampFontSizePt(requestedPt: number): number {
  return Math.max(requestedPt, MIN_SAFE_FONT_SIZE_PT);
}

/*
  Every decorative-only DOM node (a Creative Timeline marker dot/line,
  a Modern Sidebar divider) must carry this so it is excluded from both
  assistive-technology reading order and (via the shared parity
  engine's own text-extraction pass) from what counts as "real"
  rendered text - see spec section 3's Creative Timeline requirement
  that markers are "decorative and must not obstruct text extraction."
*/
export const DECORATIVE_ARIA_PROPS = { "aria-hidden": "true", role: "presentation" } as const;

export function photoPlaceholderAlt(fullName: string): string {
  return fullName ? `${fullName} (photo not provided)` : "Photo not provided";
}

/*
  A conservative language hint for the <html lang="..."> attribute -
  never inferred from content (no language-detection heuristic), just
  a passthrough of the caller's own locale so the browser/AT/PDF
  reader gets a correct hint instead of defaulting to "en" on
  non-English resumes.
*/
export function resolveHtmlLang(locale: string): string {
  return locale && locale.trim().length > 0 ? locale : "en";
}
