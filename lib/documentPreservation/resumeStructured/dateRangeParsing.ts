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
/*
  Phase 5D.3C bugfix - "present"/"current" need their own word
  boundaries here, or they match as a bare SUBSTRING inside an
  unrelated word ("Presented in Toronto, ON..." was misread as
  containing the date keyword "Present", truncating the real sentence
  down to "ed in Toronto, ON..." and reporting a bogus "Present" date).
  Every other alternative in this group already has an implicit
  boundary (a 4-digit year, or a leading month/numeric-month token), so
  only this pair needed the explicit `\b`.
*/
const YEAR_OR_PRESENT = `(?:${MONTH_RE}|${NUMERIC_MONTH_PREFIX_RE})?(?:(?:19|20)\\d{2}(?:[/-]\\d{1,2})?|\\bpresent\\b|\\bcurrent\\b)`;

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
/*
  Phase 5D.3B - a single (non-range) date token, INCLUDING its optional
  leading month ("Jan 2021 - Registered Nurse License", one of this
  round's required header shapes: Month Year with no range). Using the
  full YEAR_OR_PRESENT alternative here (not the bare SINGLE_YEAR_RE
  above) matters because stripDateAnchor removes exactly the matched
  substring and returns everything else as institution/credential/award/
  publication text - if only the bare year "2021" were matched, the
  leading "Jan " would be left dangling in beforeText and misread as the
  ENTIRE remaining credential/institution name (a real, confirmed data-
  loss bug this fixes: "Jan" becoming the credential name while the real
  credential text "Registered Nurse License" was silently dropped).
*/
export const SINGLE_DATE_RE = new RegExp(YEAR_OR_PRESENT, "i");

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
  const singleMatch = text.match(SINGLE_DATE_RE);
  if (singleMatch) {
    return { dateRangeText: singleMatch[0] };
  }
  return null;
}

/*
  Phase 5D.3B - Generic Single-Line Header Recovery Hardening. A single-
  line (or already-joined multi-line) header can put its date ANYWHERE
  relative to the institution/credential/award/publication text - before
  it ("2019 - 2021 Toronto Metropolitan University"), after it
  ("Toronto Metropolitan University, 2019 - 2021"), or in the middle
  ("Law Clerk (Seneca Polytechnic) Expected in 04/2027 - Toronto, ON").
  The date is only ever an ANCHOR for segmentation, never the field
  being extracted - so this strips just the matched date span (wherever
  it falls) and returns BOTH surrounding fragments, never discarding
  either. Callers (educationExtractor.ts, credentialExtractor.ts,
  awardExtractor.ts, publicationExtractor.ts) decide which fragment(s)
  to use as their own institution/credential/name/title candidate -
  this module has no opinion on resume-section semantics, only on where
  the date sits in the string.
*/
/*
  Phase 5D.3C bugfix - parens are deliberately NOT in this class anymore
  (see stripUnbalancedParens below). Stripping them unconditionally here
  used to eat a legitimate, BALANCED closing paren off the end of a
  parenthetical qualifier ("Bachelor of Engineering (Co-op)" ->
  "Bachelor of Engineering (Co-op" - a real, confirmed data-loss bug),
  since a trailing ")" is indistinguishable from a dangling one by this
  regex alone.
*/
const DANGLING_SEPARATOR_RE = /^[\s,.\-–—|:;]+|[\s,.\-–—|:;]+$/g;
const EMPTY_PARENS_RE = /\(\s*\)/g;

/*
  Strips only an UNBALANCED leading/trailing paren character - e.g. the
  dangling "(" left over in "Institute (" after a date match cut through
  the middle of "Institute (2020)". A BALANCED paren pair anywhere in the
  text (including one whose ")" happens to be the very last character,
  "Bachelor of Engineering (Co-op)") is always left untouched, since it
  isn't dangling at all.
*/
function stripUnbalancedParens(text: string): string {
  let result = text;
  for (let i = 0; i < 6; i++) {
    const opens = (result.match(/\(/g) || []).length;
    const closes = (result.match(/\)/g) || []).length;
    if (opens === closes) break;
    if (opens > closes && result.startsWith("(")) {
      result = result.slice(1).trim();
    } else if (opens > closes && result.endsWith("(")) {
      result = result.slice(0, -1).trim();
    } else if (closes > opens && result.endsWith(")")) {
      result = result.slice(0, -1).trim();
    } else if (closes > opens && result.startsWith(")")) {
      result = result.slice(1).trim();
    } else {
      break;
    }
  }
  return result;
}

export function cleanHeaderFragment(text: string): string {
  let result = text
    .replace(EMPTY_PARENS_RE, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(DANGLING_SEPARATOR_RE, "")
    .trim();
  result = stripUnbalancedParens(result);
  return result.replace(DANGLING_SEPARATOR_RE, "").trim();
}

export type DateAnchorResult = DateParts & {
  /* Text before the matched date span, separators/parens trimmed - "" if
     the date is the very first token or no date was found. */
  beforeText: string;
  /* Text after the matched date span, separators/parens trimmed - "" if
     the date is the very last token or no date was found. */
  afterText: string;
};

export function stripDateAnchor(text: string): DateAnchorResult {
  const dateParts = extractDateParts(text);
  if (!dateParts) {
    return { dateRangeText: "", beforeText: cleanHeaderFragment(text), afterText: "" };
  }
  const idx = text.indexOf(dateParts.dateRangeText);
  if (idx < 0) {
    return { ...dateParts, beforeText: cleanHeaderFragment(text), afterText: "" };
  }
  const before = cleanHeaderFragment(text.slice(0, idx));
  const after = cleanHeaderFragment(text.slice(idx + dateParts.dateRangeText.length));
  return { ...dateParts, beforeText: before, afterText: after };
}
