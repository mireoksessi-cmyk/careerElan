/*
  Phase 5D.3C - Generic Multi-Line Academic Header Recovery Hardening.
  A shared, general-purpose N-line header WINDOW primitive used by every
  academic-family extractor (Education/Credential/Award/Publication) that
  needs to recover more than the old 1-2 line pairing (educationExtractor.ts's
  pre-5D.3C segmentEducationRanges, credentialExtractor.ts's pre-5D.3C
  single-date-closes-cluster rule). Generalizes "Date is the Anchor"
  (Phase 5D.3B) from a single line to an arbitrary run of consecutive
  header-like lines - the window's own boundary is decided PURELY from
  structural signals (blockType, line shape, date-adjacency, count of
  lines already accepted), never from any specific institution/company/
  degree/award name, matching this round's own explicit prohibition on
  keyword-hardcoded parsing.

  This module only computes SHARED SIGNALS (window boundaries, date
  anchoring per line, location shape, generic degree/institution/
  authority category words, generic ID/code shape) - each caller
  extractor still owns its own field-assignment priority for its own
  entry shape (Education wants institution/credential/fieldOfStudy;
  Credential wants name/issuer/credentialId/expiryDateText; Award wants
  name/issuer; Publication wants title/publisherOrVenue) since those
  four entry types don't share one universal role vocabulary.
*/
import type { SemanticContentBlock } from "../losslessSemantic/types";
import { hasDateEvidence, stripDateAnchor, cleanHeaderFragment, type DateAnchorResult } from "./dateRangeParsing";
import { looksLikeLocation } from "./splitOrganizationLocation";

export const MAX_HEADER_WINDOW = 6;
/*
  Bounds how many non-date lines may follow an already-captured date
  group before the window closes - the base required shape (5D.3C) is
  "Date, Institution, Location" (2 lines), so 2 is a structurally-
  justified bound (not an arbitrary constant): it lets a genuine Date-
  first multi-line header keep going, while still stopping the window
  from silently swallowing an unrelated NEXT entry's own header lines
  indefinitely. Real regression evidence (this round's own f14 fixture,
  "Date-first 3-line variant of Shape B" - date + degree + institution,
  immediately followed by a completely separate entry's own institution
  line): naively raising this constant to accommodate a longer required
  shape elsewhere swallows that unrelated 4th line too, since nothing
  distinguishes "one more line legitimately belongs to THIS entry" from
  "the window is now eating the NEXT entry." See
  MAX_LINES_AFTER_DATE_GROUP_WITH_LABEL below for the scoped exception
  that avoids this.
*/
const MAX_LINES_AFTER_DATE_GROUP = 2;
/*
  Phase 5D.3D - a Date-first Joint Program header ("Date, Joint Program:,
  Institution A / Institution B, Degree") legitimately needs a 3rd line
  after the date group - but ONLY when an explicit program-label line
  (detectProgramLabel below) has already been seen within THIS window,
  never unconditionally (see MAX_LINES_AFTER_DATE_GROUP's own comment
  for the real regression this scoping avoids). The label is a strong,
  explicit signal that this genuinely is a multi-line composite header
  needing more room, not just "any date-first entry gets 3 lines for
  free."
*/
const MAX_LINES_AFTER_DATE_GROUP_WITH_LABEL = 3;
const MAX_HEADER_LINE_LENGTH = 100;
const SENTENCE_END_RE = /[.!?]$/;

export const DEGREE_KEYWORD_RE = /\b(bachelor|master|ph\.?d|doctorate|associate|diploma|certificate|b\.?a\.?|b\.?sc\.?|b\.?s\.?|b\.?comm\.?|m\.?a\.?|m\.?sc\.?|m\.?s\.?|m\.?b\.?a\.?)\b/i;
/*
  Phase 5D.3D - moved here (single source of truth) from
  multiAcademicValueParser.ts, which now imports it instead of
  redefining it - mirrors DEGREE_KEYWORD_RE's own import-not-redefine
  fix (see that module's header comment) and is what lets
  collectHeaderWindow below detect an explicit program-label line
  directly, without a circular import between the two files.
*/
export const PROGRAM_LABEL_RE = /\b(double degree|dual degree|joint degree|joint program|concurrent program|combined degree|double major|dual major)\s*:?\s*$/i;
export function detectProgramLabel(text: string): boolean {
  return PROGRAM_LABEL_RE.test(text.trim());
}
/*
  A generic INSTITUTION-category signal (Phase 5D.3B), same kind of
  lexical class as DEGREE_KEYWORD_RE - matches GENERAL category words,
  never a specific school's own name.
*/
export const INSTITUTION_KEYWORD_RE = /\b(university|college|institute|academy|polytechnic|school|seminary|conservatory)\b/i;
/*
  Phase 5D.3C - a generic AUTHORITY/ISSUER-category signal (a body that
  issues a license/certification/award - never a specific board's own
  name), the same kind of generic lexical class as the two above.
*/
export const AUTHORITY_KEYWORD_RE = /\b(board|association|society|council|commission|authority|federation|bureau|agency|registry|chamber|ministry|department)\b/i;
/*
  A generic ID/CODE SHAPE signal - alphanumeric tokens mixing letters
  and digits, or an explicit "#"/"No." marker ("RN-884213", "#48213",
  "No. 20194", "A1B2C3") - a STRUCTURAL pattern, never a specific
  authority's own numbering scheme. Deliberately does not match a bare
  word or a bare year (SINGLE_YEAR_RE already claims that shape as a
  date, and callers only test this against a line's already-date-
  stripped remainder).
*/
export const ID_CODE_RE = /(#\s?\w+|\bno\.?\s?\d+\b|\b[a-z]{1,4}[-\s]?\d{3,}\b|\b\d{3,}[-\s]?[a-z]{1,4}\b)/i;

/*
  Phase 5D.3C - a real institution/degree/major/location/authority
  header LABEL is a short noun phrase, or several short noun phrases
  chained by field delimiters (comma, pipe, dash - "Bachelor of
  Commerce, Marketing | Toronto, ON - 2017 - 2021" is 11 raw
  whitespace-separated tokens but reads as five short, clearly bounded
  fields). A body or bullet SENTENCE fragment (a PDF's own mid-sentence
  line wrap, which - because it's a wrap, not a real sentence end - has
  no trailing period either, and so would otherwise pass every other
  check here) has no such internal field structure: it is one long run
  of prose with no delimiter to break it up, or a delimiter with a
  still-long clause on one side ("initiative, overseeing a $12M system
  implementation across finance,"). So a raw whole-line word count
  can't tell the two apart - a compact multi-field line can have MORE
  total words than a short prose fragment. Splitting on the same field
  delimiters this module already treats as structural (comma, pipe, any
  dash form) and bounding EACH segment's own word count is what
  actually distinguishes them. This is a purely structural signal (line
  shape via its own delimiters), never a keyword or specific name -
  added after real bench fixture evidence (a two-column Canva resume
  whose PDF text extraction interleaves Education-column lines with
  Experience-column bullet-wrap fragments at the same vertical
  position) showed the plain character-length + no-trailing-punctuation
  checks alone let those long fragments get pulled into a multi-line
  header window right alongside genuine institution/degree lines.
*/
const MAX_WORDS_PER_SEGMENT = 6;
/*
  Phase 5D.3C bugfix - a dash only counts as a FIELD delimiter when it
  has whitespace on both sides (" - ", the same convention
  dateRangeParsing.ts's own DATE_RANGE_SEPARATOR already uses). Without
  the surrounding-whitespace requirement, a dash embedded INSIDE a
  single hyphenated word ("company-wide") would also split - turning a
  genuinely long 7-word prose fragment ("Championed the implementation
  of a company-wide continuous [process]") into two shorter fake
  "segments" that each individually pass the per-segment word cap,
  defeating the whole point of that cap.
*/
const SEGMENT_DELIMITER_RE = /[,|]|\s+(?:-|–|—|‒|―|－)\s+/;
const PARENTHETICAL_RE = /\([^)]*\)?/g;
/*
  Phase 5D.3D bugfix - a trailing period is only "sentence-ending" when
  the word right before it is a genuine word, not a short abbreviation
  ("M.Sc.", "B.A.", "Ph.D.", "Assoc."). A real prose sentence almost
  never ends in a short (<=4 letter) CAPITALIZED token - that shape is
  specific to abbreviations/initialisms, never a common English
  sentence-final word (which is typically lowercase and/or longer).
  Purely structural, never a keyword or specific degree name - without
  this, "B.Sc., M.Sc." (a same-line Double Degree, spec pattern 1) was
  wrongly rejected as a full sentence and its whole header window
  collapsed to zero lines, silently losing the degree pairing entirely.
*/
const ABBREVIATION_TAIL_RE = /\b[A-Z][A-Za-z]{0,3}\.$/;

export function looksLikeHeaderLine(block: SemanticContentBlock): boolean {
  const text = block.text.trim();
  if (block.blockType === "bullet" || text.length === 0 || text.length > MAX_HEADER_LINE_LENGTH) return false;
  if (SENTENCE_END_RE.test(text) && !ABBREVIATION_TAIL_RE.test(text)) return false;
  const segments = text.split(SEGMENT_DELIMITER_RE);
  /* A parenthetical qualifier ("Certificate in Lean Six Sigma (Green
     Belt)") is common on an otherwise-short credential/degree segment -
     excluded from the word count (but never from the actual text) so
     it doesn't get misread as a long prose fragment. */
  return segments.every((seg) => seg.replace(PARENTHETICAL_RE, "").trim().split(/\s+/).filter((w) => w.length > 0).length <= MAX_WORDS_PER_SEGMENT);
}

/*
  Collects the maximal run of consecutive header-like lines starting at
  `start`, bounded by MAX_HEADER_WINDOW and by purely structural
  termination signals:
    - a bullet always ends the window (body begins)
    - a line that no longer "looks like a header line" ends the window
      (a long sentence-like paragraph is body text, not more header)
    - a SECOND, non-adjacent date-bearing line ends the window (the
      strongest available "a new entry started here" signal - two dates
      with an ordinary line between them almost never belong to the
      same entry; two ADJACENT date lines are kept together, since that
      is exactly the Issue Date/Expiry Date and Dual-Date shapes this
      round requires)
    - once a date has been captured, at most MAX_LINES_AFTER_DATE_GROUP
      further non-date lines are accepted (see that constant's own
      comment)
  Replaces the old fixed "1-token lookahead" / "exactly 2 lines" rules
  (educationExtractor.ts's pre-5D.3C segmentEducationRanges,
  credentialExtractor.ts's pre-5D.3C clusterEntries) with one general
  primitive shared by every academic-family extractor.
*/
/*
  A generic DATE-QUALIFIER category signal ("Issued", "Expires",
  "Valid until", ...) - the same kind of generic lexical class as
  DEGREE_KEYWORD_RE/INSTITUTION_KEYWORD_RE/AUTHORITY_KEYWORD_RE, never a
  specific authority's own wording. Used only to tell a genuinely BARE
  second date line (the Issue Date/Expiry Date continuation shape, e.g.
  "Expires 2025") apart from a completely different, self-contained
  entry that simply also starts with a date ("2018 - 2020 Brightwater
  Institute" is its own whole entry, not a continuation of the
  PREVIOUS entry's date, even though the two date-bearing lines happen
  to sit adjacently).
*/
const DATE_QUALIFIER_RE = /\b(issued?|expir(?:es?|y|ation)?|valid(?:\s+(?:through|until|thru))?|renewal|effective|through|until|thru)\b/gi;
const NON_WORD_RE = /[:\-–—,.\s]/g;

function hasSubstantialNonDateText(remainderBefore: string, remainderAfter: string, qualifierRe: RegExp = DATE_QUALIFIER_RE): boolean {
  const combined = `${remainderBefore} ${remainderAfter}`.replace(qualifierRe, "").replace(NON_WORD_RE, "");
  return combined.length > 0;
}

/*
  Phase 5D.3D bugfix (real evidence: the f15 fixture's own "Expected
  Graduation 2026" cross-combination case, AND a real regression this
  extension caused in the f14 fixture - see below) - "expected"/
  "anticipated"/"graduation"/"completion" extend the qualifier-word
  category ONLY for this narrower purpose: recognizing a standalone
  "Expected Graduation <year>" line as a qualifier-only continuation
  line in the Date-first lookahead check, and as qualifier-only
  remainder text for field-assignment filtering (isQualifierOnlyText
  below). Deliberately a SEPARATE regex from DATE_QUALIFIER_RE, not a
  shared extension of it - DATE_QUALIFIER_RE is also used by the
  adjacent-second-date-line Issue/Expiry continuation check above, and
  extending it there wrongly let an unrelated "Expected Graduation
  2027" line get treated as an expiry-style continuation of a
  COMPLETELY DIFFERENT, PRECEDING entry's own date (real regression:
  f14's own "Bachelor of Commerce / Marketing / Silverpine University /
  Toronto, ON / 2017 - 2021" Shape F entry wrongly swallowed the NEXT
  entry's "Expected Graduation 2027" line). "Expected Graduation" is
  never a valid continuation of a PRIOR, unrelated date - it is always
  this ENTRY's own single completion date - so it must never affect
  that other check.
*/
const CONTINUATION_QUALIFIER_RE = /\b(issued?|expir(?:es?|y|ation)?|valid(?:\s+(?:through|until|thru))?|renewal|effective|through|until|thru|expected|anticipated|graduation|completion)\b/gi;

/*
  Phase 5D.3D bugfix - a caller-facing wrapper for the SAME check used
  above (using the wider CONTINUATION_QUALIFIER_RE, not the narrower
  DATE_QUALIFIER_RE - see that constant's own comment for why they must
  stay separate): an already date-stripped remainder line ("Expected
  Graduation", left over after "Expected Graduation 2026" gives up its
  date) that is non-empty but consists ENTIRELY of generic date-
  qualifier words carries no real institution/degree/major content of
  its own. Exported so every academic-family extractor
  (educationExtractor.ts's own candidateLines filter, alongside its
  isPureLabelLine) can exclude such lines from field assignment instead
  of re-deriving this same signal locally and risking the SAME kind of
  cross-file drift DEGREE_KEYWORD_RE already had (see
  multiAcademicValueParser.ts's own import-not-redefine fix).
*/
export function isQualifierOnlyText(text: string): boolean {
  return text.trim().length > 0 && !hasSubstantialNonDateText("", text, CONTINUATION_QUALIFIER_RE);
}

/*
  Phase 5D.3C bugfix - a generic, structural (never keyword-based) year
  extractor used only to compare two adjacent date lines chronologically.
  "present"/"current" are treated as later than any explicit year (an
  open-ended range's end is always the latest point).
*/
function extractComparableYear(dateText: string | undefined): number | undefined {
  if (dateText === undefined) return undefined;
  if (/present|current/i.test(dateText)) return Number.POSITIVE_INFINITY;
  const match = dateText.match(/(19|20)\d{2}/);
  return match ? parseInt(match[0], 10) : undefined;
}

export function collectHeaderWindow(blocks: SemanticContentBlock[], start: number): number[] {
  const indices: number[] = [];
  let dateSeen = false;
  let lastWasDate = false;
  let previousDateRangeText: string | undefined;
  /* Whether a non-date line was already collected BEFORE the window's
     first date-bearing line - i.e. this is a "Date-last" shape (A, C,
     D, E, F, ...), not a "Date-first" one (B). Only a genuine Date-
     first window (the date is the very first content collected) is
     allowed to keep accepting more lines after its date group - that
     is the only required shape with real header content AFTER the
     date. A Date-last window closes immediately once its date group is
     complete, so a trailing detail line (GPA, Honours) or the NEXT
     entry's own header never gets pulled in just because it happens to
     also look header-shaped. */
  let sawNonDateBeforeFirstDate = false;
  let linesAfterDateGroup = 0;
  /* Phase 5D.3D - whether an explicit program-label line ("Joint
     Program:") has already been accepted into THIS window - see
     MAX_LINES_AFTER_DATE_GROUP_WITH_LABEL's own comment for why this
     must be scoped to an explicit signal rather than a blanket cap
     increase. */
  let sawProgramLabelInWindow = false;

  for (let k = start; k < blocks.length && indices.length < MAX_HEADER_WINDOW; k++) {
    const block = blocks[k];
    if (block.blockType === "bullet") break;
    if (!looksLikeHeaderLine(block)) break;

    const isDate = hasDateEvidence(block.text);
    let currentDateRangeText: string | undefined;
    if (isDate) {
      if (dateSeen && !lastWasDate) break;
      if (dateSeen && lastWasDate) {
        /* Adjacent second date line - only a genuine Issue/Expiry-style
           continuation stays in THIS window: its own remainder, if any,
           must be just a date-qualifier word (never substantial text of
           its own - "2018 - 2020 Brightwater Institute" is a fully
           self-contained, SEPARATE entry that merely happens to sit
           right after this one's own date), AND it must itself be a
           single point-in-time date, not a two-sided range - an Issue
           Date/Expiry Date pair is always two single dates, so a bare
           RANGE ("2013 - 2017") immediately following another entry's
           own date is almost certainly that NEXT entry's own Date-first
           header, not a continuation of this one. */
        const anchor = stripDateAnchor(block.text);
        const isRange = anchor.startDateText !== undefined && anchor.endDateText !== undefined;
        if (isRange || hasSubstantialNonDateText(anchor.beforeText, anchor.afterText)) break;
        /* Phase 5D.3C bugfix - a genuine Issue Date/Expiry Date pair is
           chronologically non-decreasing (expiry >= issue). If this
           second bare date is EARLIER than the window's own first date,
           it cannot be a real expiry continuation - it is almost
           certainly the NEXT, entirely separate entry's own (date-
           first) header, which merely happens to sit immediately
           adjacent (real evidence: "... Excellence Award / National
           Retail Federation / 2020" immediately followed by a
           completely separate "2019 / Outstanding Community Service
           Award / ..." entry was wrongly merged into one). Purely
           numeric/structural, never a keyword or specific name. */
        const firstYear = extractComparableYear(previousDateRangeText);
        const secondYear = extractComparableYear(anchor.dateRangeText);
        if (firstYear !== undefined && secondYear !== undefined && secondYear < firstYear) break;
        currentDateRangeText = anchor.dateRangeText;
      } else {
        currentDateRangeText = stripDateAnchor(block.text).dateRangeText;
      }
      dateSeen = true;
      lastWasDate = true;
      linesAfterDateGroup = 0;
      previousDateRangeText = currentDateRangeText ?? previousDateRangeText;
    } else {
      if (dateSeen) {
        if (sawNonDateBeforeFirstDate) break;
        /* Date-first continuation (Shape B): only pull in a further
           line if it does NOT itself look like it is about to pair
           with ITS OWN date on the very next line - that shape
           (Institution, Date) is a brand new entry's own 2-line header,
           not a continuation of the current one.
           Phase 5D.3D bugfix (f15 fixture evidence: "Bachelor of Arts"
           immediately followed by "Expected Graduation 2026") - a bare
           qualifier-only date line ("Expected Graduation 2026",
           "Expires 2025") is NOT a new entry's own "Institution, Date"
           pair - it has no institution-shaped text of its own, only
           generic date-qualifier words (DATE_QUALIFIER_RE) alongside
           its date. Requiring the pre-qualifier-strip remainder to be
           NON-EMPTY keeps a genuinely bare date line ("2022 - Present",
           no text at all) triggering the original break - only a line
           that has SOME text, and that text is entirely qualifier
           vocabulary, is treated as a continuation instead. */
        const next = blocks[k + 1];
        if (next !== undefined && next.blockType !== "bullet" && hasDateEvidence(next.text)) {
          const nextAnchor = stripDateAnchor(next.text);
          const nextRawRemainder = `${nextAnchor.beforeText} ${nextAnchor.afterText}`.trim();
          const nextIsQualifierOnly = nextRawRemainder.length > 0 && !hasSubstantialNonDateText(nextAnchor.beforeText, nextAnchor.afterText, CONTINUATION_QUALIFIER_RE);
          if (!nextIsQualifierOnly) break;
        }
        linesAfterDateGroup++;
        const effectiveCap = sawProgramLabelInWindow ? MAX_LINES_AFTER_DATE_GROUP_WITH_LABEL : MAX_LINES_AFTER_DATE_GROUP;
        if (linesAfterDateGroup > effectiveCap) break;
        if (detectProgramLabel(block.text)) sawProgramLabelInWindow = true;
      } else {
        sawNonDateBeforeFirstDate = true;
      }
      lastWasDate = false;
    }
    indices.push(k);
  }
  return indices;
}

export type HeaderWindowLine = {
  block: SemanticContentBlock;
  dateAnchor: DateAnchorResult;
  hasDate: boolean;
  /* Non-date text on this line - both sides of the date (if any)
     joined, "" for a bare date-only line, the FULL cleaned line text
     for a line with no date at all. */
  remainderText: string;
  looksLikeLocationShape: boolean;
  hasDegreeKeyword: boolean;
  hasInstitutionKeyword: boolean;
  hasAuthorityKeyword: boolean;
  hasIdCodeShape: boolean;
};

/*
  A lone bullet-type entry (e.g. a credential/award list where each
  bullet IS its own complete entry) never enters a multi-line window
  via collectHeaderWindow (bullets always end/exclude a window), but
  segmentCredentialRanges-style callers still fall back to treating it
  as its own 1-line entry - so its leading glyph must be stripped here
  too, or it leaks into the extracted value ("• PMP" instead of "PMP").
*/
const BULLET_PREFIX_RE = /^[•\-*◦▪·‣⁃]\s+/;

export function classifyWindowLine(block: SemanticContentBlock): HeaderWindowLine {
  const text = block.text.replace(BULLET_PREFIX_RE, "");
  const dateAnchor = stripDateAnchor(text);
  const hasDate = dateAnchor.dateRangeText.length > 0;
  const remainderText = cleanHeaderFragment([dateAnchor.beforeText, dateAnchor.afterText].filter((s) => s.length > 0).join(" "));
  const hasDegreeKeyword = DEGREE_KEYWORD_RE.test(text);
  const hasInstitutionKeyword = INSTITUTION_KEYWORD_RE.test(text);
  /*
    Phase 5D.3D bugfix (real-composite evidence: "Example Institute |
    Downtown Campus | Vancouver, BC" - a Shape "Institution | Campus |
    City, ST" line) - looksLikeLocation only inspects the trailing
    comma-segment ("...BC"), so a composite Institution/Location line
    was wrongly classified as a PURE location line and swallowed whole
    into the entry's location field, stripping the institution out of
    the window entirely. A genuine pure-location line ("Toronto, ON")
    never independently carries an institution/degree keyword, so
    requiring the ABSENCE of both here is purely structural and safe -
    it only changes classification for a line that ALSO carries one of
    those keywords, which academicCompositeParser.ts's own institution-
    resolution path (parseInlineCompositeHeader) already knows how to
    split into institution + embedded location correctly.
  */
  return {
    block,
    dateAnchor,
    hasDate,
    remainderText,
    looksLikeLocationShape: remainderText.length > 0 && !hasDegreeKeyword && !hasInstitutionKeyword && looksLikeLocation(remainderText),
    hasDegreeKeyword,
    hasInstitutionKeyword,
    hasAuthorityKeyword: AUTHORITY_KEYWORD_RE.test(text),
    hasIdCodeShape: remainderText.length > 0 && ID_CODE_RE.test(remainderText),
  };
}

export type ClassifiedWindow = {
  /* In original window order. */
  lines: HeaderWindowLine[];
  /* The 1 or 2 (adjacent) date-bearing lines, in window order. */
  dateLines: HeaderWindowLine[];
  /* Every non-date line, in window order. */
  nonDateLines: HeaderWindowLine[];
};

export function classifyWindow(blocks: SemanticContentBlock[], indices: number[]): ClassifiedWindow {
  const lines = indices.map((i) => classifyWindowLine(blocks[i]));
  const dateLines = lines.filter((l) => l.hasDate);
  const nonDateLines = lines.filter((l) => !l.hasDate);
  return { lines, dateLines, nonDateLines };
}
