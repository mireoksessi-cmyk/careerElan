/*
  Shared date-range detection, used by both experienceExtractor.ts and
  educationExtractor.ts. Every date endpoint allows an optional leading
  month name - a real bug found via testing experienceExtractor.ts:
  "Jul 2017 - Feb 2020" was not recognized as one date range because the
  original bare-year pattern couldn't span over "Feb" in the separator,
  silently merging two entries into one.
*/
const MONTH_RE = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?\\s+";
/*
  Phase 5D.1 - a real private entry-level resume dates one entry
  "04/2026 － 05/2026" - numeric MONTH-first, e.g. "04/2026" - which the
  existing year-core's own optional suffix `(?:[/-]\d{1,2})?` cannot
  match (that suffix is YEAR-first, e.g. "2026/04" or "2026-04", the
  opposite token order). Without this, isDateRangeLine() returned false
  for that entry's own header line even after the U+FF0D separator fix,
  because NEITHER endpoint of the range could match YEAR_OR_PRESENT at
  all. Ambiguous with a plain day-of-month lookalike ("15/2026" is not a
  real month) only in the sense that no PDF/DOCX resume date field uses
  a day-of-month here - real fixture evidence (this entry) only ever
  shows a 1-2 digit MONTH before the slash.
*/
const NUMERIC_MONTH_PREFIX_RE = "\\d{1,2}[/-]";
const YEAR_OR_PRESENT = `(?:${MONTH_RE}|${NUMERIC_MONTH_PREFIX_RE})?(?:(?:19|20)\\d{2}(?:[/-]\\d{1,2})?|present|current)`;

/*
  Phase 5D.1 - single source of truth for every dash-like date-range
  separator this parser accepts. A real private entry-level resume used
  U+FF0D (fullwidth hyphen-minus) for every date range on the page - a
  common artifact of certain word-processor/font export pipelines -
  which the previous separator set (-, to, en dash, em dash) did not
  match at all, so isDateRangeLine() returned false for every
  entry-header line in the section and the whole section collapsed into
  one entry (see Phase 5D.0's audit). DATE_RANGE_RE and
  DATE_RANGE_CAPTURE_RE both build from this one constant so they can
  never drift apart. `à` (French "to") is deliberately NOT included -
  no real-fixture evidence, and it collides with the ordinary French
  preposition, an unevaluated false-positive risk.
*/
const DATE_RANGE_SEPARATOR = "(?:-|to|–|—|‒|―|－)";

export const DATE_RANGE_RE = new RegExp(`${YEAR_OR_PRESENT}\\s*${DATE_RANGE_SEPARATOR}\\s*${YEAR_OR_PRESENT}`, "i");
export const DATE_RANGE_CAPTURE_RE = new RegExp(`(${YEAR_OR_PRESENT})\\s*(${DATE_RANGE_SEPARATOR})\\s*(${YEAR_OR_PRESENT})`, "i");
// A single bare year, for graduation-year-only lines with no range
// (e.g. "SAIT Polytechnic | Calgary, AB - 2016" - a real fixture shape,
// bench/resume-C-mid-ats.pdf's certificate line).
export const SINGLE_YEAR_RE = /(?:19|20)\d{2}/;

export function isDateRangeLine(text: string): boolean {
  return DATE_RANGE_RE.test(text);
}

/*
  Range OR a single bare year - used by educationExtractor.ts, where a
  real fixture (bench/resume-C-mid-ats.pdf: "SAIT Polytechnic, Calgary,
  AB - 2016") showed a graduation-year-only line with no range is a
  genuinely common shape, unlike experienceExtractor.ts's sampled
  fixtures which always used a real range. Kept as a separate,
  non-default export so experienceExtractor's boundary detection stays
  on the stricter range-only signal (broadening it there was not
  evidenced by any real fixture and risks false entry splits on
  location lines containing a bare year).
*/
export function hasDateEvidence(text: string): boolean {
  return DATE_RANGE_RE.test(text) || SINGLE_YEAR_RE.test(text);
}

export type DateParts = { dateRangeText: string; startDateText?: string; endDateText?: string };

export function extractDateParts(text: string): DateParts | null {
  const rangeMatch = text.match(DATE_RANGE_CAPTURE_RE);
  if (rangeMatch) {
    return { dateRangeText: rangeMatch[0], startDateText: rangeMatch[1], endDateText: rangeMatch[3] };
  }
  const singleMatch = text.match(SINGLE_YEAR_RE);
  if (singleMatch) {
    return { dateRangeText: singleMatch[0] };
  }
  return null;
}
