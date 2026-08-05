/*
  Phase 5D.3D - Generic Academic Composite Parsing & Full Resume Engine
  Capability Audit. Problem A: Double Degree / Double Major / Joint
  Program - a SINGLE physical line (or a single already-disambiguated
  window "slot" - see headerWindow.ts/educationExtractor.ts) that
  actually encodes TWO OR MORE distinct academic values ("B.Sc., M.Sc.,
  Example University", "B.A. in Economics and B.Sc. in Computer
  Science"), which previously collapsed into one combined string or
  (worse) had its second value silently mislabeled as a different field
  (5D.3C's own splitCredentialField bug: a second degree read as
  fieldOfStudy).

  This module never hardcodes a specific degree/major/institution name
  - every decision is delimiter shape + per-segment structural signal
  (a generic lexical category regex, reused from headerWindow.ts, or
  positional/contextual reinforcement), matching every prior round's
  same prohibition.

  Core false-positive defense (spec section 3's own list - "Research &
  Development", "Sales and Marketing", "Health & Safety", ...): "and"/
  "&" are the highest-ambiguity delimiters (they appear constantly in
  ordinary English phrases that are NOT a list of two values). This
  module NEVER splits on "and"/"&" from delimiter presence alone - only
  when EITHER (a) every resulting segment independently confirms the
  expected shape (e.g. both sides carry their own degree keyword - "B.A.
  in Economics" and "B.Sc. in Computer Science" each do, "Research" and
  "Development" each do not), OR (b) an explicit, generic program-label
  line ("Double Degree:", "Joint Program:", ...) reinforces the split.
  Comma/slash/pipe/semicolon are much lower-ambiguity as list delimiters
  and are split more liberally (still gated on per-segment shape,
  never blindly on presence).
*/

/* Phase 5D.3D bugfix - imported (not redefined) from headerWindow.ts so
   this module's own degree-shape test can never silently drift out of
   sync with the SAME constant headerWindow.ts/educationExtractor.ts
   use for degree-keyword line classification - a real, confirmed bug:
   a duplicate copy here was missing "B.Sc./M.Sc." recognition,
   breaking the SAME-LINE Double Degree comma-split entirely even
   though the primitive's OWN copy had already been fixed. */
/* PROGRAM_LABEL_RE/detectProgramLabel also imported from here (not
   redefined) - moved to headerWindow.ts so collectHeaderWindow can
   detect a program-label line directly without a circular import back
   into this module. Re-exported for this module's existing callers. */
import { DEGREE_KEYWORD_RE, PROGRAM_LABEL_RE, detectProgramLabel } from "./headerWindow";
export { PROGRAM_LABEL_RE, detectProgramLabel };
const CREDENTIAL_LIKE_RE = /\b(certified|certificate|certification|credential|licen[sc]e|licen[sc]ed)\b/i;
/*
  A generic ORGANIZATIONAL-UNIT trailing keyword - "Arts and Science
  FACULTY", "Business / Technology DIVISION" are a single named unit,
  not two values, and this generic category word (never a specific
  faculty/division name) is what protects them from being split even
  though they otherwise contain "and"/"/".
*/
const ORG_UNIT_TRAILING_RE = /\b(faculty|division|department|group|team|unit|office|centre|center)\s*$/i;

export function segmentLooksLikeDegree(segment: string): boolean {
  return DEGREE_KEYWORD_RE.test(segment);
}
export function segmentLooksLikeCredential(segment: string): boolean {
  return DEGREE_KEYWORD_RE.test(segment) || CREDENTIAL_LIKE_RE.test(segment);
}
/* Institution/organization-shaped segment - reuses the SAME generic
   category word list headerWindow.ts already established, never a
   specific school's own name. */
const INSTITUTION_KEYWORD_RE = /\b(university|college|institute|academy|polytechnic|school|seminary|conservatory)\b/i;
export function segmentLooksLikeInstitution(segment: string): boolean {
  return INSTITUTION_KEYWORD_RE.test(segment);
}
/*
  A field-of-study/major has no reliable lexical keyword of its own
  (unlike a degree or institution) - this is deliberately PERMISSIVE
  (any short, non-empty, non-organizational-unit phrase passes), which
  is only safe to use for the STRONG delimiters (comma/slash/pipe/
  semicolon - see splitMultiValueSegment's weakConjunctionShapeTest
  override below, which disables this permissive test for "and"/"&"
  specifically, where it would otherwise defeat the false-positive
  guard entirely - "Research" and "Development" both individually pass
  this permissive shape check too).
*/
export function segmentLooksLikeFieldOfStudy(segment: string): boolean {
  const trimmed = segment.trim();
  if (trimmed.length === 0 || ORG_UNIT_TRAILING_RE.test(trimmed)) return false;
  return trimmed.split(/\s+/).filter((w) => w.length > 0).length <= 6;
}

const STRONG_DELIMITERS: Array<{ re: RegExp; name: string }> = [
  { re: /\s*;\s*/, name: "semicolon" },
  { re: /\s*\|\s*/, name: "pipe" },
  { re: /\s*\/\s*/, name: "slash" },
  { re: /\s*,\s*/, name: "comma" },
];
const WEAK_CONJUNCTION_RE = /\s+(?:and|&)\s+/i;

export type MultiValueSplitResult = {
  /* 1 item = no split justified (the whole trimmed input, unchanged).
     2+ items = a genuine multi-value split, each item non-empty and
     verbatim from the source text (never invented, never truncated). */
  values: string[];
  delimiter?: string;
  reasonCodes: string[];
};

/*
  segmentShapeTest: a generic per-segment structural signal (e.g.
  segmentLooksLikeDegree) - EVERY resulting segment must pass it for a
  strong-delimiter split to be accepted. hasReinforcingLabel: true only
  when the caller already found a generic program-label line
  (detectProgramLabel) elsewhere in the same header window - lets a
  weak "and"/"&" split through even when segments don't independently
  confirm shape (plain major names rarely carry a keyword of their
  own), but ONLY with that explicit reinforcement.
*/
export function splitMultiValueSegment(
  text: string,
  opts: {
    segmentShapeTest: (segment: string) => boolean;
    hasReinforcingLabel: boolean;
    /* Overrides segmentShapeTest for the "and"/"&" branch only. Pass
       `() => false` for low-signal contexts (field of study - see
       segmentLooksLikeFieldOfStudy's own comment) so a bare "and"/"&"
       NEVER splits from shape alone, only via hasReinforcingLabel -
       the permissive fieldOfStudy shape test is only safe to trust for
       the strong (comma/slash/pipe/semicolon) delimiters above.
       Defaults to segmentShapeTest when omitted (degree/institution
       keyword tests are precise enough to trust for both). */
    weakConjunctionShapeTest?: (segment: string) => boolean;
    /* Phase 5D.3D bugfix (real bench-fixture evidence: "University of
       Calgary, Haskayne School of Business") - a comma is a much
       WEAKER signal for institution-splitting specifically than for
       degree-splitting: DEGREE_KEYWORD_RE is a tight, specific list
       ("bachelor", "master", ...), while INSTITUTION_KEYWORD_RE
       ("university", "college", "school", ...) very commonly appears
       TWICE on one line for a single institution's own comma-separated
       sub-unit ("Institution, Faculty/School of X"), not two co-equal
       institutions (Joint Program - which this round's own spec
       example instead shows slash-separated: "Institution A /
       Institution B"). Excluding comma here does not affect degree/
       credential/field-of-study splitting, which never sets this. */
    excludeCommaDelimiter?: boolean;
    /* Phase 5D.3D bugfix (spec false-positive example: "Strategy,
       Operations, and Finance") - a genuine "Major A, Major B" double
       major is exactly 2 items; a 3+-item comma list is much more
       likely to be a single compound area-of-focus name (an Oxford-
       comma enumeration), not 3 separate majors. Caps how many strong-
       delimiter segments are accepted - never set for degree/
       institution splitting (a real "B.Sc., M.Sc., Ph.D." legitimately
       has 3+ items), only for the low-signal field-of-study context. */
    maxStrongDelimiterSegments?: number;
  }
): MultiValueSplitResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { values: [], reasonCodes: ["empty-input"] };

  const strongDelimiters = opts.excludeCommaDelimiter ? STRONG_DELIMITERS.filter((d) => d.name !== "comma") : STRONG_DELIMITERS;
  for (const { re, name } of strongDelimiters) {
    const parts = trimmed.split(re).map((s) => s.trim()).filter((s) => s.length > 0);
    if (parts.length >= 2 && (opts.maxStrongDelimiterSegments === undefined || parts.length <= opts.maxStrongDelimiterSegments) && parts.every((p) => opts.segmentShapeTest(p))) {
      return { values: parts, delimiter: name, reasonCodes: [`strong-delimiter-${name}-shape-confirmed`] };
    }
  }

  const weakShapeTest = opts.weakConjunctionShapeTest ?? opts.segmentShapeTest;
  const weakParts = trimmed.split(WEAK_CONJUNCTION_RE).map((s) => s.trim()).filter((s) => s.length > 0);
  if (weakParts.length >= 2 && !ORG_UNIT_TRAILING_RE.test(trimmed)) {
    const allShaped = weakParts.every((p) => weakShapeTest(p));
    if (allShaped) {
      return { values: weakParts, delimiter: "and/&", reasonCodes: ["weak-conjunction-shape-confirmed"] };
    }
    if (opts.hasReinforcingLabel) {
      return { values: weakParts, delimiter: "and/&", reasonCodes: ["weak-conjunction-label-reinforced"] };
    }
  }

  return { values: [trimmed], reasonCodes: ["no-multi-value-split-justified"] };
}

/*
  "Degree A in Major A" -> { credential: "Degree A", fieldOfStudy:
  "Major A" }. Used per-segment AFTER splitMultiValueSegment, so
  "B.A. in Economics and B.Sc. in Computer Science" first splits into
  two segments, then EACH segment splits its own embedded major via
  " in ". Never applied before the outer split (would wrongly treat
  the whole joined string as one "X in Y").
*/
export function splitDegreeInMajor(segment: string): { credential: string; fieldOfStudy?: string } {
  const match = segment.match(/^(.*?)\s+in\s+(.+)$/i);
  if (match && match[1].trim().length > 0 && match[2].trim().length > 0) {
    return { credential: match[1].trim(), fieldOfStudy: match[2].trim() };
  }
  return { credential: segment.trim() };
}
