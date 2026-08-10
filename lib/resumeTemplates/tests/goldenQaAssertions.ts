/*
  Phase 6I.6.33 (Part AB) - reusable golden structural assertion
  helpers, shared by goldenQa6I633.test.ts. Deliberately black-box:
  every helper operates on a template's already-rendered, already-
  extracted output (visible HTML text / PDF page text / DOCX text),
  never on internal renderer state - the same evidence a human QA pass
  or a real downstream consumer (ATS parser, PDF viewer, Word) would
  see. Kept generic/reusable rather than resume-specific so a future
  phase can reuse these against a different document type without
  copying logic.
*/
import { findMissingFragments, normalizeForMatch } from "../parity/validateOutput";

const PLACEHOLDER_MARKERS = ["lorem ipsum", "sample project", "placeholder", "professional summary placeholder", "your name", "[object object]"];

/*
  Deliberately narrower than PLACEHOLDER_MARKERS: raw "undefined"/"null"
  are legitimate English words in real resume prose far too often (a
  role literally titled "Null Pointer Researcher" is unlikely, but
  "undefined" appears in real IT resumes - "resolved undefined behavior
  in C++"). This only exists to catch the specific "the raw JS value
  leaked into the text" bug shape (Part Z / Part AA), so it is applied
  by noPlaceholder() only when the caller opts in via a dedicated
  check, never as a blanket substring ban.
*/
const RAW_VALUE_LEAK_MARKERS = ["undefined", "null", "[object Object]", "NaN"];

const INTERNAL_TEMPLATE_ID_MARKERS = ["professional-ats", "modern-sidebar", "creative-timeline", "executive-minimal"];

export function sectionPresent(extractedText: string, headingOrFragment: string): boolean {
  return normalizeForMatch(extractedText).includes(normalizeForMatch(headingOrFragment));
}

export function sectionAbsent(extractedText: string, headingOrFragment: string): boolean {
  return !sectionPresent(extractedText, headingOrFragment);
}

export function textPresent(extractedText: string, fragment: string): boolean {
  return sectionPresent(extractedText, fragment);
}

export function textAbsent(extractedText: string, fragment: string): boolean {
  return sectionAbsent(extractedText, fragment);
}

/*
  Counts occurrences of a bullet glyph as a crude but real cross-check
  against a caller-supplied expected count - not a DOM inspection (the
  extracted text has already lost tag structure by the time this runs).
  Callers that need exact per-entry bullet counts should count against
  the source NormalizedResume/ResumeStructuredModel directly instead;
  this helper is for whole-document sanity checks (e.g. "roughly this
  many bullet markers survived, not zero, not obviously duplicated").
*/
export function bulletCount(extractedText: string, glyphs: string[] = ["•", "◦", "▪"]): number {
  let count = 0;
  for (const glyph of glyphs) {
    count += extractedText.split(glyph).length - 1;
  }
  return count;
}

export function pageCountOf(result: { pageCount: number }): number {
  return result.pageCount;
}

export function documentValid(result: { validation: { passed: boolean } }): boolean {
  return result.validation.passed;
}

/*
  Part O - normalized semantic parity between two extracted-text
  strings from the SAME source fixture rendered in two different
  formats (typically PDF vs DOCX). Deliberately whitespace/case
  insensitive (matches parity/validateOutput.ts's own normalizeForMatch
  convention) - callers pass the ground-truth fragment list once and
  get back which fragments are missing from EACH side independently, so
  a genuine one-sided content-loss bug is distinguishable from a
  formatting/extraction-artifact difference.
*/
export function semanticParity(
  fragments: string[],
  textA: string,
  textB: string
): { missingFromA: string[]; missingFromB: string[]; oneSidedGaps: string[]; parityOk: boolean } {
  /*
    Reuses parity/validateOutput.ts's own findMissingFragments (whole-
    string-collapsed-whitespace match, with a whitespace-stripped
    fallback) rather than re-implementing matching here - that fallback
    is what absorbs the known, disclosed PDF-only false-positive class
    where a Chromium PDF text run boundary at a CJK/Latin script change
    can insert/drop a single space (see that file's own header comment).
    Re-deriving a weaker match here would misreport that known artifact
    as a real one-sided content-loss bug.
  */
  const missingFromA = findMissingFragments(fragments, textA);
  const missingFromB = findMissingFragments(fragments, textB);
  /*
    Part O's actual definition of "parity" is agreement BETWEEN the two
    formats, not agreement between each format and a third, independently-
    derived ground-truth fragment list. A fragment the caller's ground
    truth expected but which is legitimately absent from BOTH A and B
    (e.g. a template that by design renders a custom section's original-
    language heading instead of its display-heading translation,
    consistently across every format it produces) is not a cross-format
    divergence - both formats already agree with each other. Only a
    ONE-SIDED gap (present in A, missing from B, or vice versa) is a real
    parity violation, so that is what parityOk gates on.
  */
  const missingFromBSet = new Set(missingFromB);
  const oneSidedGaps = [...missingFromA.filter((f) => !missingFromBSet.has(f)), ...missingFromB.filter((f) => !missingFromA.includes(f))];
  return { missingFromA, missingFromB, oneSidedGaps, parityOk: oneSidedGaps.length === 0 };
}

/*
  Part M/V - a crude but real signal that content ran outside the
  printable area: this codebase's renderers never emit a literal
  "overflow"/"clipped" marker string, so the absence of one is a weak
  guarantee on its own. Combined with documentValid()/pageCount
  sanity checks elsewhere in the suite (a genuinely clipped PDF would
  usually also fail missing-text validation), not relied on alone.
*/
export function noOverflowMarker(extractedText: string): boolean {
  const lowered = extractedText.toLowerCase();
  return !lowered.includes("overflow") && !lowered.includes("[clipped]") && !lowered.includes("[truncated]");
}

export function noPlaceholder(extractedText: string, includeRawValueLeakCheck = true): boolean {
  const lowered = extractedText.toLowerCase();
  const hasPlaceholderMarker = PLACEHOLDER_MARKERS.some((m) => lowered.includes(m));
  const hasRawValueLeak = includeRawValueLeakCheck && RAW_VALUE_LEAK_MARKERS.some((m) => extractedText.includes(m));
  return !hasPlaceholderMarker && !hasRawValueLeak;
}

/*
  Part AA - the rendered DOCUMENT (not an external UI label) must never
  show one of the 4 internal template id strings as literal body text.
*/
export function noTemplateIdLeak(extractedText: string): boolean {
  const lowered = extractedText.toLowerCase();
  return !INTERNAL_TEMPLATE_ID_MARKERS.some((id) => lowered.includes(id));
}
