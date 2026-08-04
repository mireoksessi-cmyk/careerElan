/*
  Shared date-range detection, used by both experienceExtractor.ts and
  educationExtractor.ts. Every date endpoint allows an optional leading
  month name - a real bug found via testing experienceExtractor.ts:
  "Jul 2017 - Feb 2020" was not recognized as one date range because the
  original bare-year pattern couldn't span over "Feb" in the separator,
  silently merging two entries into one.
*/
const MONTH_RE = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?\\s+";
const YEAR_OR_PRESENT = `(?:${MONTH_RE})?(?:(?:19|20)\\d{2}(?:[/-]\\d{1,2})?|present|current)`;

export const DATE_RANGE_RE = new RegExp(`${YEAR_OR_PRESENT}\\s*(?:-|to|–|—)\\s*${YEAR_OR_PRESENT}`, "i");
export const DATE_RANGE_CAPTURE_RE = new RegExp(`(${YEAR_OR_PRESENT})\\s*(-|to|–|—)\\s*(${YEAR_OR_PRESENT})`, "i");
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
