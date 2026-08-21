/*
  TASK 5 - Education entry extraction. Section 11 of the spec.

  Real-fixture evidence (dev inspection API): institution-first
  ("Toronto Metropolitan University" then "Bachelor of Commerce,
  Marketing | Toronto, ON - 2017 - 2021" - bench/resume-A/C/E) and
  credential-first ("Bachelor of Science in Nursing" then "Toronto
  Metropolitan University, Toronto, ON — 2013 to 2017" -
  threepage-pdf-resume.pdf, word-docx-resume.docx,
  regtest1-regulated-nurse-resume.docx) BOTH appear as real, common
  patterns - roughly evenly split across the sampled fixtures. Unlike
  experienceExtractor.ts's comma-presence heuristic, education entries
  have a much more reliable lexical disambiguator available: a degree
  keyword (Bachelor/Master/Diploma/Certificate/etc.) almost always
  appears on exactly one of the two header lines, regardless of which
  line comes first - so that keyword, not line order, decides which
  line is the credential and which is the institution.

  Phase 5D.3D - Generic Academic Composite Parsing. Every field
  resolution path below now goes through resolveCredentialsFromText/
  resolveInstitutionsFromText, which detect a Double Degree/Double
  Major/Joint Program encoded either across SEPARATE header-window
  lines (degreeLines.length >= 2 / instLines.length >= 2, below) or
  WITHIN one line via a delimiter (multiAcademicValueParser.ts's
  splitMultiValueSegment). All output accumulates into
  credentials[]/fieldsOfStudy[]/institutions[] arrays; the singular
  credential/fieldOfStudy/institution fields are derived from index 0
  of each array at the very end, guaranteeing by construction that any
  consumer reading only the singular field sees exactly the value it
  always would have (backward compatible, never a behavior change for
  the single-degree case).
*/
import type { SemanticContentBlock } from "../losslessSemantic/types";
import { traceFromBlock, traceFromBlocks, mergeTraces } from "./sourceTrace";
import { entryId } from "./ids";
import { hasDateEvidence, stripDateAnchor } from "./dateRangeParsing";
import { parseInlineCompositeHeader } from "./academicCompositeParser";
import { normalizeBulletPresentation } from "./bulletPresentation";
import { looksLikeLocation } from "./splitOrganizationLocation";
import {
  splitMultiValueSegment,
  splitDegreeInMajor,
  detectProgramLabel,
  segmentLooksLikeDegree,
  segmentLooksLikeInstitution,
  segmentLooksLikeFieldOfStudy,
} from "./multiAcademicValueParser";
import {
  collectHeaderWindow,
  classifyWindow,
  looksLikeHeaderLine,
  DEGREE_KEYWORD_RE,
  INSTITUTION_KEYWORD_RE,
  isQualifierOnlyText,
  type HeaderWindowLine,
} from "./headerWindow";
import type { EducationEntry, StructuredTextValue } from "./types";

const GPA_RE = /\bgpa\b[:\s]*([0-4]\.\d{1,2})(?:\s*\/\s*([0-9](?:\.\d)?))?/i;
const HONORS_RE = /\b(honou?rs?|dean'?s list|cum laude|distinction)\b/i;
/* A pure descriptive label line ("Double Degree:", "Joint Program:")
   carries no institution/degree/major text of its own - excluded from
   field assignment (still fully preserved via rawHeaderText) so it
   never gets misassigned as an institution/credential value. */
const PURE_LABEL_MAX_WORDS = 4;
function isPureLabelLine(text: string): boolean {
  return detectProgramLabel(text) && text.trim().split(/\s+/).filter((w) => w.length > 0).length <= PURE_LABEL_MAX_WORDS;
}

/*
  Phase 2B Bug A - a decorative list marker that arrived as a block of
  its OWN, with no content beside it. Upstream bullet recognition
  (blockAdapter's BULLET_PREFIX_RE, bulletPresentation's
  DECORATIVE_GLYPH_RE/DASH_MARKER_RE) all require whitespace AFTER the
  glyph, so a lone "•" matches none of them: it is typed "paragraph",
  its marker is never stripped, and it reaches details[] as a literal
  one-character string that renderers then display verbatim.

  The character class mirrors those two existing repository sets rather
  than inventing a new symbol vocabulary, and is anchored to the WHOLE
  trimmed line, so it can only ever match a block that carries no
  content at all. "• Relevant coursework" is unaffected.
*/
const DECORATIVE_MARKER_ONLY_RE = /^[•●○◦▪■□‣⁃·*\-–—]+$/;

function isDecorativeMarkerOnly(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && DECORATIVE_MARKER_ONLY_RE.test(trimmed);
}

/*
  Phase 2B Bug B - some resumes format every education record as its own
  bullet. The three bullet vetoes below (this file's own, plus
  looksLikeHeaderLine's) then make it impossible for ANY of them to
  start an entry, so every record after the first collapses into the
  first entry's details[].

  Relaxing the veto outright would be unsafe: an ordinary detail bullet
  ("Dean's List 2023", "Awarded a scholarship in 2020") would become a
  fabricated school. So a bulleted line qualifies only on a conservative
  COMBINATION of its own evidence - never one signal alone:

    - it is genuinely a bullet, and has content once its marker is
      removed (evaluated only; the stored text is never rewritten);
    - it is short enough to be a header rather than prose;
    - it is not a GPA or honours line, mirroring the same two exclusions
      isNewEntryStart already applies to non-bulleted candidates;
    - it carries its OWN date evidence; AND
    - it carries its OWN degree or institution evidence.

  Both regexes and the date test are the ones this file already uses for
  non-bulleted candidates, so a bulleted record is held to the same
  standard as an ordinary one, plus a mandatory date. Nothing here reads
  a neighbouring line, an indent, or any resume-specific token.
*/
const MAX_BULLETED_ENTRY_LINE_LENGTH = 100;

function hasStrongBulletedEntryEvidence(block: SemanticContentBlock): boolean {
  if (block.blockType !== "bullet") return false;
  const text = normalizeBulletPresentation(block.rawText, { blockType: block.blockType }).displayText.trim();
  if (text.length === 0 || text.length > MAX_BULLETED_ENTRY_LINE_LENGTH) return false;
  if (GPA_RE.test(text) || HONORS_RE.test(text)) return false;
  if (!hasDateEvidence(text)) return false;
  return DEGREE_KEYWORD_RE.test(text) || INSTITUTION_KEYWORD_RE.test(text);
}

export type EducationEntryRange = { headerBlockIndices: number[]; bodyBlockIndices: number[] };

/*
  Phase 5D.3C - Generic Multi-Line Academic Header Recovery Hardening.
  Whether `blocks[k]` is very likely the FIRST line of a NEW entry's
  header (as opposed to a body/detail line - GPA, Honours, or an
  ordinary continuation line - belonging to the entry currently being
  segmented). Deliberately does NOT run a full 6-line collectHeaderWindow
  forward-scan from every candidate body line: a detail line like
  "GPA: 3.85/4.0" is itself short and header-shaped, so a blind forward
  scan from it would keep walking through the rest of the CURRENT
  entry's own detail lines and could reach the NEXT real entry's date
  line, wrongly flagging the detail line itself as a new entry's start.
  Instead this only trusts strong, LOCAL signals: the line's own date
  evidence, or a generic degree/institution keyword on the line itself
  (real body/detail lines for an education entry essentially never
  contain either), with the pre-5D.3C 1-line lookahead kept as a
  narrower fallback for the keyword-free Institution-first case.
*/
/*
  Phase 2B-C1 - continuation metadata, evaluated ONLY while deciding
  whether a following line terminates an ALREADY-OPEN entry range (its
  single call site is that forward scan in segmentEducationRanges).

  A record's own second line often carries nothing but location and/or
  date - "Toronto, ON - 04/2027". isNewEntryStart accepts date evidence
  ALONE as sufficient for a non-bulleted candidate, so such a line was
  starting a second, empty EducationEntry and the record lost its own
  location and date to it.

  The rule is the same two-signal discipline already applied to bulleted
  candidates: a line that carries NO institution and NO degree/credential
  evidence of its own is not an independent education record, whatever
  date it happens to contain. A genuine next record - "University B ...
  2022 - 2024", or a degree line - still carries one of those keywords
  and still terminates the range exactly as before.

  Deliberately NOT a change to isNewEntryStart itself: date evidence
  remains sufficient to START segmentation, which is a different
  question from whether a line ENDS the entry above it. Bulleted
  candidates are excluded here because the guard above already routes
  them through hasStrongBulletedEntryEvidence.
*/
function isContinuationMetadataLine(block: SemanticContentBlock): boolean {
  if (block.blockType === "bullet") return false;
  if (DEGREE_KEYWORD_RE.test(block.text) || INSTITUTION_KEYWORD_RE.test(block.text)) return false;
  return hasDateEvidence(block.text);
}

function isNewEntryStart(blocks: SemanticContentBlock[], index: number): boolean {
  if (index >= blocks.length) return false;
  const block = blocks[index];
  /* Phase 2B Bug B - a bulleted candidate is judged by its own strong
     evidence instead of being rejected outright. Returning here also
     bypasses looksLikeHeaderLine, which rejects every bullet. */
  if (block.blockType === "bullet") return hasStrongBulletedEntryEvidence(block);
  if (!looksLikeHeaderLine(block)) return false;
  if (GPA_RE.test(block.text) || HONORS_RE.test(block.text)) return false;
  if (hasDateEvidence(block.text)) return true;
  if (DEGREE_KEYWORD_RE.test(block.text) || INSTITUTION_KEYWORD_RE.test(block.text)) return true;
  const next = blocks[index + 1];
  return next !== undefined && next.blockType !== "bullet" && looksLikeHeaderLine(next) && hasDateEvidence(next.text);
}

/*
  Phase 5D.3C - replaces the old fixed "exactly 1 or 2 header lines"
  segmentation with headerWindow.ts's shared N-line sliding window
  (up to 6 lines, terminated by purely structural signals - see that
  module's own comments), so Education entries with 3+ header lines
  (Degree, Major, Institution, [Location], Date and its variants) are
  recovered the same way 2-line headers already were, instead of every
  line past the first 1-2 silently falling through to a generic
  `details[]` body bucket.
*/
export function segmentEducationRanges(blocks: SemanticContentBlock[]): EducationEntryRange[] {
  if (blocks.length === 0) return [];
  /* Phase 2B Bug B - a resume whose education records are ALL bullets
     has no non-bulleted dated line, so without this a qualifying
     bulleted record could never segment. */
  if (!blocks.some((b) => (b.blockType !== "bullet" && hasDateEvidence(b.text)) || hasStrongBulletedEntryEvidence(b))) {
    return [{ headerBlockIndices: [0], bodyBlockIndices: blocks.slice(1).map((_, i) => i + 1) }];
  }

  const ranges: EducationEntryRange[] = [];
  let i = 0;
  const n = blocks.length;

  while (i < n) {
    const headerBlockIndices = collectHeaderWindow(blocks, i);
    const headerEnd = headerBlockIndices.length > 0 ? headerBlockIndices[headerBlockIndices.length - 1] : i;

    let k = headerEnd + 1;
    while (k < n) {
      /* Phase 2B Bug B - an ordinary detail bullet still never ends the
         current entry; only one carrying its own strong entry evidence
         is allowed through to isNewEntryStart below. */
      if (blocks[k].blockType === "bullet" && !hasStrongBulletedEntryEvidence(blocks[k])) {
        k++;
        continue;
      }
      if (isNewEntryStart(blocks, k) && !isContinuationMetadataLine(blocks[k])) break;
      k++;
    }

    const bodyBlockIndices: number[] = [];
    for (let j = headerEnd + 1; j < k; j++) bodyBlockIndices.push(j);

    ranges.push({ headerBlockIndices: headerBlockIndices.length > 0 ? headerBlockIndices : [i], bodyBlockIndices });
    i = Math.max(k, i + 1);
  }

  return ranges;
}

function makeValue(value: string, sectionId: string, block: SemanticContentBlock, confidence: number): StructuredTextValue {
  return { value, confidence, extractionMethod: "pattern-rule", source: traceFromBlock(sectionId, block) };
}

/*
  Phase 5D.3D - superset of the pre-5D.3D splitInstitutionLocation:
  parseInlineCompositeHeader adds pipe/middle-dot/bullet/parenthetical
  delimiter recognition on top of the SAME proven dash/trailing-comma
  logic (via its own internal fallback to splitOrganizationLocation),
  so every previously-passing dash/comma case behaves identically.
  `detail` (a middle "campus" segment - "Institute | Campus | City, ST")
  has no dedicated schema field; callers fold it into details[] rather
  than inventing a new field for one rare shape.
*/
function splitInstitutionLocationComposite(text: string): { institution: string; location?: string; detail?: string } {
  const result = parseInlineCompositeHeader(text, "education");
  return { institution: result.primaryText, location: result.location, detail: result.detailText };
}

function splitCredentialField(text: string): { credential: string; fieldOfStudy?: string } {
  const withoutLocationSuffix = text.replace(/\|[^|]*$/, "").trim();
  const parts = withoutLocationSuffix.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length <= 1) return { credential: withoutLocationSuffix };
  /* Phase 5D.3C bugfix - a comma-joined SECOND degree ("Bachelor of
     Arts, Bachelor of Science" - Double Degree) is not a field of
     study; only split into credential/fieldOfStudy when the remainder
     does not itself look like another degree, or the second degree's
     own text gets mislabeled as "major" instead of preserved as part
     of the credential. Phase 5D.3D generalizes this exact case via
     resolveCredentialsFromText's own splitMultiValueSegment call
     (which now properly SPLITS it into 2 credentials instead of just
     refusing to mislabel it) - this guard stays as the fallback for
     when that split isn't reached (single remaining candidate with no
     multi-value shape confirmed). */
  if (DEGREE_KEYWORD_RE.test(parts[1])) return { credential: withoutLocationSuffix };
  return { credential: parts[0], fieldOfStudy: parts.slice(1).join(", ") };
}

/*
  Phase 5D.3D - resolves one line/segment of text into 1+ credentials
  (+ their own field-of-study, via " in " - splitDegreeInMajor) using
  splitMultiValueSegment's delimiter+shape analysis first; falls back
  to the pre-5D.3D single-value splitCredentialField (unchanged
  behavior) when no multi-value split is justified.
*/
function resolveCredentialsFromText(
  text: string,
  sectionId: string,
  block: SemanticContentBlock,
  hasReinforcingLabel: boolean,
  baseConfidence: number
): { credentials: StructuredTextValue[]; fieldsOfStudy: StructuredTextValue[]; reasonCodes: string[] } {
  const split = splitMultiValueSegment(text, { segmentShapeTest: segmentLooksLikeDegree, hasReinforcingLabel });
  const credentials: StructuredTextValue[] = [];
  const fieldsOfStudy: StructuredTextValue[] = [];
  if (split.values.length >= 2) {
    for (const v of split.values) {
      const { credential, fieldOfStudy } = splitDegreeInMajor(v);
      if (credential.length > 0) credentials.push(makeValue(credential, sectionId, block, baseConfidence));
      if (fieldOfStudy) fieldsOfStudy.push(makeValue(fieldOfStudy, sectionId, block, baseConfidence - 0.05));
    }
    return { credentials, fieldsOfStudy, reasonCodes: ["multi-credential-same-line-split", ...split.reasonCodes] };
  }
  /* Phase 5D.3D bugfix (real-fixture shape - see this file's own header
     comment: "Bachelor of Science in Nursing") - a single, unsplit
     credential line may still encode its own field of study via " in "
     ("Degree in Major"), which the pre-5D.3D comma-only
     splitCredentialField never recognized. Tried first since it is
     more specific; falls back to the comma-based split unchanged when
     no " in " pattern is found. */
  const inMajorResult = splitDegreeInMajor(text);
  if (inMajorResult.fieldOfStudy) {
    credentials.push(makeValue(inMajorResult.credential, sectionId, block, baseConfidence));
    fieldsOfStudy.push(makeValue(inMajorResult.fieldOfStudy, sectionId, block, baseConfidence - 0.05));
    return { credentials, fieldsOfStudy, reasonCodes: [...split.reasonCodes, "single-value-in-major-pattern"] };
  }
  const { credential: c, fieldOfStudy: f } = splitCredentialField(text);
  if (c.length > 0) credentials.push(makeValue(c, sectionId, block, baseConfidence));
  if (f) fieldsOfStudy.push(makeValue(f, sectionId, block, baseConfidence - 0.05));
  return { credentials, fieldsOfStudy, reasonCodes: split.reasonCodes };
}

/*
  Phase 5D.3D - resolves one line/segment of text into 1+ institutions
  (+ optional location/detail via parseInlineCompositeHeader) using
  splitMultiValueSegment's institution-shape test first (same-line
  Joint Program: "Institution A / Institution B"); falls back to the
  pre-5D.3D single-institution splitInstitutionLocationComposite when
  no multi-value split is justified.
*/
function resolveInstitutionsFromText(
  text: string,
  sectionId: string,
  block: SemanticContentBlock,
  hasReinforcingLabel: boolean,
  baseConfidence: number
): { institutions: StructuredTextValue[]; location?: StructuredTextValue; detail?: StructuredTextValue; reasonCodes: string[] } {
  const split = splitMultiValueSegment(text, { segmentShapeTest: segmentLooksLikeInstitution, hasReinforcingLabel, excludeCommaDelimiter: true });
  if (split.values.length >= 2) {
    const institutions = split.values.filter((v) => v.length > 0).map((v) => makeValue(v, sectionId, block, baseConfidence));
    return { institutions, reasonCodes: ["multi-institution-same-line-split", ...split.reasonCodes] };
  }
  const { institution: inst, location: loc, detail } = splitInstitutionLocationComposite(text);
  const institutions: StructuredTextValue[] = [];
  if (inst.length > 0) institutions.push(makeValue(inst, sectionId, block, baseConfidence));
  return {
    institutions,
    location: loc ? makeValue(loc, sectionId, block, baseConfidence - 0.05) : undefined,
    detail: detail ? makeValue(detail, sectionId, block, baseConfidence - 0.1) : undefined,
    reasonCodes: split.reasonCodes,
  };
}

/*
  Phase 5D.3D - Double Major ("Dual Major:\nDegree\nMajor A / Major B\n
  Institution" / "Double Major:\nDegree\nMajor A and Major B\n
  Institution"). A field of study has no reliable lexical keyword,
  hence the permissive segmentLooksLikeFieldOfStudy shape test, gated
  much more conservatively than degree/institution splitting: "and"/"&"
  NEVER splits from shape alone (weakConjunctionShapeTest: () => false
  - only a genuine reinforcing program-label line unlocks it), and a
  comma split is capped at exactly 2 segments (maxStrongDelimiterSegments:
  2 - see that option's own comment: protects a 3+-item Oxford-comma
  department/focus-area name like "Strategy, Operations, and Finance"
  from being misread as 3 separate majors).
*/
function resolveFieldsOfStudyFromText(text: string, sectionId: string, block: SemanticContentBlock, hasReinforcingLabel: boolean, baseConfidence: number): StructuredTextValue[] {
  const split = splitMultiValueSegment(text, {
    segmentShapeTest: segmentLooksLikeFieldOfStudy,
    hasReinforcingLabel,
    weakConjunctionShapeTest: () => false,
    maxStrongDelimiterSegments: 2,
  });
  if (split.values.length >= 2) {
    return split.values.map((v) => makeValue(v, sectionId, block, baseConfidence));
  }
  return [makeValue(text, sectionId, block, baseConfidence)];
}

function extractGpa(sectionId: string, blocks: SemanticContentBlock[]): StructuredTextValue | undefined {
  for (const block of blocks) {
    const match = block.text.match(GPA_RE);
    if (match) return makeValue(match[0], sectionId, block, 0.85);
  }
  return undefined;
}

const SENTENCE_TERMINAL_RE = /[.!?]$/;

/*
  An institution line that sits AFTER its entry's date.

  The shared header window deliberately closes a date-last header at the
  date - a line following it is far more often the next entry's own
  header, a GPA or honours line, a program label, or plain description
  prose than it is more header material, and that early exit is what
  keeps all four out. It is also shared with the credential, award and
  publication extractors, so it is not the place to make an Education-
  shaped exception.

  But one real Education order puts the school last - credential, then
  the date, then the school and its city - and there the institution
  falls outside the window and lands in details[], leaving the entry
  with no institution at all. This reads only the block immediately
  after the header, only when the entry ended up with no institution,
  and only when every one of the shapes that early exit protects has
  been ruled out first: a date of its own, a degree word, a program
  label, GPA or honours, or a line that closes like a sentence. Even
  then it must show positive evidence - the Education splitter finding
  a trailing place name, or a recognised institution word - because
  that splitter alone can read comma-heavy prose as an organization
  and a location, so it is never sufficient by itself.

  Adjacency is doing real work here: only the first body block is ever
  considered, never a search through the details for something that
  looks like a school.
*/
function adoptTrailingInstitutionLine(
  block: SemanticContentBlock | undefined
): { block: SemanticContentBlock; institution: string; location?: string; detail?: string } | undefined {
  if (block === undefined || block.blockType === "bullet") return undefined;
  const text = block.text.trim();
  if (text.length === 0) return undefined;
  if (!looksLikeHeaderLine(block)) return undefined;
  if (hasDateEvidence(text)) return undefined;
  if (DEGREE_KEYWORD_RE.test(text)) return undefined;
  if (detectProgramLabel(text)) return undefined;
  if (GPA_RE.test(text) || HONORS_RE.test(text)) return undefined;
  if (SENTENCE_TERMINAL_RE.test(text)) return undefined;

  const split = splitInstitutionLocationComposite(block.rawText);
  const hasLocationEvidence = split.location !== undefined && split.location.length > 0;
  if (!hasLocationEvidence && !INSTITUTION_KEYWORD_RE.test(text)) return undefined;
  if (split.institution.length === 0) return undefined;
  return { block, institution: split.institution, location: split.location, detail: split.detail };
}

export function extractEducationEntries(sectionId: string, bodyBlocks: SemanticContentBlock[]): EducationEntry[] {
  /*
    Phase 2B-final - a marker-only block carries zero semantic content,
    so it is removed before ANY Education classification runs, not just
    before details[].

    The details-loop filter added with the marker rule is too late for
    one source-proven path: looksLikeHeaderLine("•") is true (it is not
    a bullet, is under the length cap, has no sentence terminator and is
    one word), so isNewEntryStart promotes such a block through its
    next-line date lookahead, and collectHeaderWindow then absorbs it
    into an entry's header window - where it reaches rawHeaderText and
    never passes through the body loop at all.

    Filtering here rather than guarding each call site is not a
    stylistic choice: collectHeaderWindow lives in headerWindow.ts,
    which this change may not touch, so the array it receives is the
    only place the header path can be covered. All four index lookups
    below read from this same filtered array, so the ranges returned by
    segmentEducationRanges stay in sync; each retained block keeps its
    own id, sourceOrder and sourceElementIds untouched.
  */
  const blocks = bodyBlocks.filter((b) => !isDecorativeMarkerOnly(b.rawText));
  const ranges = segmentEducationRanges(blocks);

  return ranges.map((range, index) => {
    const headerBlocks = range.headerBlockIndices.map((i) => blocks[i]);
    const bodyRunBlocks = range.bodyBlockIndices.map((i) => blocks[i]);
    const reasonCodes: string[] = [];

    const credentialsAcc: StructuredTextValue[] = [];
    const fieldsOfStudyAcc: StructuredTextValue[] = [];
    const institutionsAcc: StructuredTextValue[] = [];
    const extraDetails: StructuredTextValue[] = [];
    let location: StructuredTextValue | undefined;
    let dateQualifierText: StructuredTextValue | undefined;
    let dateRangeText: StructuredTextValue | undefined;
    let startDateText: StructuredTextValue | undefined;
    let endDateText: StructuredTextValue | undefined;

    if (headerBlocks.length === 1) {
      const block = headerBlocks[0];
      /*
        Phase 2B-H1 - the header line's own inline bullet glyph is
        PRESENTATION, never Education semantics, so it must not reach
        field resolution. Actual-source evidence: a bulleted date-first
        record ("<glyph> 1990-1994 Example University - B.S. in
        Engineering") gives stripDateAnchor a date in the MIDDLE, so the
        glyph alone becomes beforeText and is taken as the primary
        candidate - the marker was assigned as institution and the real
        institution demoted to location.

        Normalized here, at the parse input, rather than by repairing an
        already-corrupted field afterwards: only this expression feeds
        the resolvers, and every one of them below stays untouched. The
        existing bulletPresentation module makes the decision (it is
        blockType-gated, so a non-bullet header is returned verbatim and
        ordinary non-bullet parsing is bit-for-bit unchanged), and it
        reads text without writing it - rawHeaderText is still built
        from block.rawText verbatim, marker included.
      */
      const headerParseText = normalizeBulletPresentation(block.text, { blockType: block.blockType }).displayText;
      const anchor = stripDateAnchor(headerParseText);
      const hasDate = anchor.dateRangeText.length > 0;
      const hasReinforcingLabel = detectProgramLabel(block.text);
      if (hasDate) {
        dateRangeText = makeValue(anchor.dateRangeText, sectionId, block, 0.8);
        if (anchor.startDateText) startDateText = makeValue(anchor.startDateText, sectionId, block, 0.75);
        if (anchor.endDateText) endDateText = makeValue(anchor.endDateText, sectionId, block, 0.75);

        /* Phase 5D.3B - the date can appear before, after, or in the
           middle of the credential/institution text ("2027\nLaw Clerk
           (Seneca Polytechnic)" vs "Law Clerk, Seneca Polytechnic -
           2027" vs "Law Clerk (Seneca Polytechnic) Expected in 04/2027
           - Toronto, ON"). Whichever side carries real text becomes the
           primary candidate; the other side (if also non-empty) becomes
           a trailing location candidate - neither is ever silently
           dropped. */
        const primary = anchor.beforeText.length > 0 ? anchor.beforeText : anchor.afterText;
        const secondary = anchor.beforeText.length > 0 ? anchor.afterText : "";

        if (primary.length > 0) {
          const withoutParenTail = primary.replace(/\([^)]*$/, "").trim();
          const candidateText = withoutParenTail.length > 0 ? withoutParenTail : primary;
          const segments = candidateText.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
          if (segments.length >= 2) {
            reasonCodes.push("single-line-header-comma-split");
            /*
              Phase 2B-H2-A - everything below encodes ONE positional
              contract, "Credential, [Field,] Institution", and applies
              it without ever asking what the segments actually look
              like. A real, source-proven line takes the OPPOSITE shape,
              "Institution, descriptive suffix" (a cohort/class phrase
              trailing the school), so segment[0] - carrying plain
              institution evidence and no degree evidence at all - was
              assigned as the credential, and the suffix became the
              institution.

              Both shapes are comma-separated, so only the segments own
              evidence can separate them. This gate uses exactly the
              signals this file already imports and already trusts
              elsewhere, and requires ALL of them: exactly two segments
              (the narrowest shape the source proves - three or more is
              still the credential-first enumeration the positional
              branch was written for); the left side looks like an
              institution and does NOT look like a degree (that pair
              alone is what every existing "Bachelor of ..., ..." shape
              fails on); and the right side is not a second institution,
              not a degree, not honours and not a GPA - the categories
              this entry already resolves into fields of their own (the
              GPA exclusion also prevents a duplicate, since extractGpa
              scans the header blocks too).

              The suffix has no structured category of its own here, and
              in particular it is NOT a location: this repository defines
              that shape through looksLikeLocation, which a bare
              comma-free phrase cannot satisfy, and academicCompositeParser
              deliberately re-gates its own comma result on exactly that
              test because academic lines have this precise
              false-positive shape. So it is preserved through the SAME
              extraDetails/details[] channel every unclassified-but-
              meaningful Education line already uses, with the same
              makeValue provenance, instead of being pushed into a field
              that would assert a meaning the source never states.
              rawHeaderText is untouched and still carries the whole
              line verbatim.
            */
            const isInstitutionWithDescriptiveSuffix =
              segments.length === 2 &&
              segmentLooksLikeInstitution(segments[0]) &&
              !segmentLooksLikeDegree(segments[0]) &&
              !segmentLooksLikeInstitution(segments[1]) &&
              !segmentLooksLikeDegree(segments[1]) &&
              !HONORS_RE.test(segments[1]) &&
              !GPA_RE.test(segments[1]);
            if (isInstitutionWithDescriptiveSuffix) {
              reasonCodes.push("single-line-header-institution-descriptive-suffix");
              institutionsAcc.push(makeValue(segments[0], sectionId, block, 0.65));
              extraDetails.push(makeValue(segments[1], sectionId, block, 0.6));
            } else {
              /* Phase 5D.3D - the first comma segment may itself be a
                 same-line Double Degree ("B.Sc., M.Sc., Example
                 University" - 3 comma parts total, first two are both
                 degrees). Try multi-credential resolution on segment[0]
                 joined back with any OTHER leading degree-shaped
                 segments before falling to the pre-5D.3D positional
                 assignment. */
              let consumedCount = 1;
              const degreeRun: string[] = [segments[0]];
              while (consumedCount < segments.length - 1 && segmentLooksLikeDegree(segments[consumedCount])) {
                degreeRun.push(segments[consumedCount]);
                consumedCount++;
              }
              if (degreeRun.length >= 2) {
                reasonCodes.push("single-line-header-comma-multi-degree-run");
                for (const d of degreeRun) {
                  const { credential, fieldOfStudy } = splitDegreeInMajor(d);
                  if (credential.length > 0) credentialsAcc.push(makeValue(credential, sectionId, block, 0.7));
                  if (fieldOfStudy) fieldsOfStudyAcc.push(makeValue(fieldOfStudy, sectionId, block, 0.65));
                }
              } else {
                const { credential, fieldOfStudy } = splitDegreeInMajor(segments[0]);
                if (credential.length > 0) credentialsAcc.push(makeValue(credential, sectionId, block, 0.7));
                if (fieldOfStudy) fieldsOfStudyAcc.push(makeValue(fieldOfStudy, sectionId, block, 0.65));
              }
              const remainderSegments = segments.slice(consumedCount);
              if (remainderSegments.length >= 2) {
                fieldsOfStudyAcc.push(makeValue(remainderSegments[0], sectionId, block, 0.65));
                institutionsAcc.push(makeValue(remainderSegments.slice(1).join(", "), sectionId, block, 0.65));
              } else if (remainderSegments.length === 1) {
                institutionsAcc.push(makeValue(remainderSegments[0], sectionId, block, 0.65));
              }
            }
          } else if (
            /*
              Phase 2B-H2-B - a real, source-proven Education shape puts
              the school FIRST and its degree after a dash: "Institution
              <dash> Credential in Field". No delimiter set in this
              repository gives a dash that meaning - the only dash-aware
              splitter is location-gated - so the whole line fell to the
              whole-remainder fallback below and became one institution,
              losing the credential and the major entirely.

              All three conditions are required, and all three are read
              from evidence this file already imports:

              BOUNDARY - exactly ONE explicitly space-separated dash. The
              spacing is the safety signal: every other dash in the
              Education corpus is a date separator already consumed by
              stripDateAnchor, and a hyphenated organisation name carries
              no surrounding spaces. Requiring exactly two parts refuses
              an ambiguous multi-dash line rather than guessing.

              RIGHT - genuine degree evidence, and not merely a keyword:
              the existing degree test must pass AND the existing
              "Degree in Major" decomposition must actually yield a
              field. That pair is what separates a credential expression
              from a department, a campus, a location or ordinary prose.

              LEFT - non-empty and NOT itself degree-shaped. This is the
              condition that refuses "Degree <dash> Degree in Field",
              where the right side legitimately satisfies everything
              above and only the left side reveals the line is not an
              institution composite. It is deliberately a NEGATIVE test:
              requiring positive institution evidence here would reject
              every acronym institution, which carries none.

              The right side is then handed to the SAME credential
              resolver the fallback below already uses, so degree/field
              parsing is reused rather than reimplemented, and the
              generic multi-credential gate below is left untouched -
              relaxing it globally would turn every plain institution
              line into a credential.
            */
            ((parts) =>
              parts.length === 2 &&
              parts[0].length > 0 &&
              !segmentLooksLikeDegree(parts[0]) &&
              segmentLooksLikeDegree(parts[1]) &&
              splitDegreeInMajor(parts[1]).fieldOfStudy !== undefined)(candidateText.split(/\s+[-\u2013\u2014]\s+/))
          ) {
            const compositeParts = candidateText.split(/\s+[-\u2013\u2014]\s+/);
            reasonCodes.push("single-line-header-institution-credential-composite");
            institutionsAcc.push(makeValue(compositeParts[0], sectionId, block, 0.65));
            const compositeCredResult = resolveCredentialsFromText(compositeParts[1], sectionId, block, hasReinforcingLabel, 0.68);
            credentialsAcc.push(...compositeCredResult.credentials);
            fieldsOfStudyAcc.push(...compositeCredResult.fieldsOfStudy);
          } else {
            /* No comma structure - try a same-line delimiter-based
               multi-credential split (slash/pipe/semicolon/ampersand/
               and) before falling to the pre-5D.3D whole-remainder-as-
               institution default. */
            const credResult = resolveCredentialsFromText(candidateText, sectionId, block, hasReinforcingLabel, 0.68);
            if (credResult.credentials.length >= 2) {
              reasonCodes.push("single-line-header-delimiter-multi-credential", ...credResult.reasonCodes);
              credentialsAcc.push(...credResult.credentials);
              fieldsOfStudyAcc.push(...credResult.fieldsOfStudy);
            } else {
              /*
                Phase 2B-C3 recognises "Credential (Institution)" - but it
                sits in the no-date arm below, so a header carrying its date
                INLINE ("Law Clerk (Seneca Polytechnic) Expected in 04/2027
                - Toronto, ON", the real shape 5D.3B's own comment above
                already names) could never reach it and fell straight to the
                whole-remainder default, gluing credential, school and a
                trailing qualifier into one institution string.

                This is C3's test applied to the dated path's own candidate,
                not a second parenthetical parser: same regex, same three
                positive/negative guards, same confidences, same reason code.
                The bracket contents must still EARN the institution role, so
                "(Machine Vision)", "(Honours)", "(Co-op)" and a reversed
                "<School> (<Program>)" are refused here exactly as they are
                below. The trailing group is what keeps "Expected in" out of
                both fields while rawHeaderText keeps the line verbatim.
              */
              const datedParenthetical = candidateText.match(/^([^()]*[^\s()])\s*\(([^()]+)\)\s*([^()]*)$/);
              const datedLeft = datedParenthetical ? datedParenthetical[1].trim() : "";
              const datedInner = datedParenthetical ? datedParenthetical[2].trim() : "";
              if (
                datedParenthetical !== null &&
                datedLeft.length > 0 &&
                !segmentLooksLikeInstitution(datedLeft) &&
                segmentLooksLikeInstitution(datedInner) &&
                !HONORS_RE.test(datedInner) &&
                !hasDateEvidence(datedInner) &&
                !looksLikeLocation(datedInner)
              ) {
                reasonCodes.push("single-line-header-credential-parenthetical-institution");
                credentialsAcc.push(makeValue(datedLeft, sectionId, block, 0.65));
                institutionsAcc.push(makeValue(datedInner, sectionId, block, 0.65));
                /*
                  Whatever the author wrote AFTER the bracket is real text
                  this line resolved into no field of its own - a status
                  ("Expected in"), a mode, a note. Left dropped it was gone
                  from the page entirely: rawHeaderText carries it, but the
                  renderers' raw fallback is off by design once an entry has
                  structured fields, so nothing would ever show it.

                  Preserved the way every other unresolved Education
                  remainder in this file already is - the same extraDetails
                  channel at the same 0.6 confidence the descriptive-suffix
                  branch above uses, which is also what makes a qualifier-
                  only remainder survive on the multi-line path. Only the
                  remainder, never the bracket or its left side, so nothing
                  already structured is repeated; and nothing at all when
                  the line simply ends at the bracket.
                */
                const datedTrailing = datedParenthetical[3].trim();
                if (datedTrailing.length > 0) dateQualifierText = makeValue(datedTrailing, sectionId, block, 0.6);
              } else {
                reasonCodes.push("single-line-header-whole-remainder-as-institution");
                institutionsAcc.push(makeValue(segments[0] ?? primary, sectionId, block, 0.6));
              }
            }
          }
          if (secondary.length > 0) {
            /*
              Whatever sits on the far side of the date is the location
              candidate, and stripDateAnchor hands it over still carrying
              the glyph that separated the two - for the ASCII/en/em dash
              and pipe it already removes them, but a fullwidth hyphen
              (U+FF0D, what the real source actually uses) or a middle dot
              survives and became part of the value, e.g. "- Toronto, ON".

              Anchored to the START of the candidate and limited to those
              separator characters, so internal punctuation is untouched:
              "Winston-Salem, NC" and "Saint-Jean-sur-Richelieu, QC" keep
              every hyphen they came with. A candidate that is nothing but
              a separator yields no location rather than an empty one.
            */
            const locationCandidate = secondary.replace(/^[\s\-\u2013\u2014\uFF0D|\u00B7]+/, "").trim();
            if (locationCandidate.length > 0) location = makeValue(locationCandidate, sectionId, block, 0.5);
          }
        } else {
          reasonCodes.push("single-line-header-empty-after-date-strip");
        }
      } else {
        reasonCodes.push("single-line-header-no-date-evidence");
        /*
          Phase 2B-C2-S - semantic preservation only.

          This branch resolves NOTHING: with no date anchor the whole
          field-resolution body above is skipped, so the header line
          survives only in rawHeaderText. That is not enough on its own,
          because the renderer's fallback shows rawHeaderText ONLY while
          the entry has no other structured content - and any body block
          (a detail, a GPA line, an honours line) makes the entry count
          as structured, switching the fallback off and taking this
          line's meaning off the page with it.

          So it is preserved through the SAME details channel every body
          block already uses, with the same normalization and the same
          source-traced value construction, appearing ahead of the body
          lines in source order.

          Gated on a body block existing, because that is exactly when
          the fallback is suppressed: with no body block the entry stays
          unstructured, the fallback still renders this line as the
          entry's own header, and nothing here should change that.

          Nothing structured was produced on this path, so this can
          neither duplicate a resolved field nor a resolver remainder.
        */
        const unresolvedHeaderText = normalizeBulletPresentation(block.rawText, { blockType: block.blockType }).displayText.trim();
        if (unresolvedHeaderText.length > 0 && bodyRunBlocks.some((b) => b.rawText.trim().length > 0)) {
          extraDetails.push(makeValue(unresolvedHeaderText, sectionId, block, 0.6));
        }

        /*
          Phase 2B-C2 - a record's own second line often carries nothing
          but location and/or date ("- Example City, ST - 04/2027"), and
          C1 already keeps that line inside THIS range. But the header
          above it has no date of its own, so the branch resolved
          nothing at all and the record's only date stayed buried inside
          a detail string - structured nowhere.

          Only the DATE is taken, and only from a candidate that clears
          every one of the following. Each signal already exists in this
          file; none is relaxed, and none is new vocabulary:

            - the candidate is bodyRunBlocks[0], i.e. the line
              immediately continuing this header, inside the SAME range
              C1 already segmented. Scanning further body blocks was
              proven unsafe: an ordinary note, honour or award line that
              merely mentions a year would supply a date.
            - this branch itself proves the header carries no date, so
              this can only ever fill an empty field, never override or
              supplement a real header date.
            - isContinuationMetadataLine already agrees the line is
              metadata rather than a new record (its C1 contract, called
              here and otherwise untouched).
            - it is neither GPA- nor honours-shaped, using the same two
              tests the body loop below already applies.
            - it yields a real date under the existing date parser.
            - and, decisively, what is LEFT of the line once its date is
              removed is either nothing at all or recognisably a
              location. That is what separates true metadata from prose:
              "Awarded a scholarship in 2020" and "Exchange semester
              2019" leave a sentence fragment behind and are refused,
              while "- Example City, ST - 04/2027" and a bare "04/2027"
              are accepted. The trailing presentation middle dot is
              ignored for that judgement only - stripDateAnchor's own
              cleanup does not list it, and it would otherwise defeat
              the location test on the exact shape this fixes.

          looksLikeLocation is used ONLY as that eligibility evidence.
          location itself stays undefined: this repository's adapter has
          no education location field, so structuring it would render in
          one template and vanish in three. The continuation line
          therefore also stays in details[] verbatim, exactly as the
          body loop already places it - accepting that the date reads
          twice rather than risking the loss of its location text.
        */
        const continuationCandidate = bodyRunBlocks[0];
        if (
          continuationCandidate !== undefined &&
          isContinuationMetadataLine(continuationCandidate) &&
          !GPA_RE.test(continuationCandidate.text) &&
          !HONORS_RE.test(continuationCandidate.text)
        ) {
          const continuationAnchor = stripDateAnchor(continuationCandidate.text);
          const continuationRemainder = [continuationAnchor.beforeText, continuationAnchor.afterText]
            .filter((t) => t.length > 0)
            .join(" ")
            .replace(/\s*\u00b7\s*$/, "")
            .trim();
          if (
            continuationAnchor.dateRangeText.length > 0 &&
            (continuationRemainder.length === 0 || looksLikeLocation(continuationRemainder))
          ) {
            reasonCodes.push("single-line-header-continuation-date");
            dateRangeText = makeValue(continuationAnchor.dateRangeText, sectionId, continuationCandidate, 0.7);
            if (continuationAnchor.startDateText) startDateText = makeValue(continuationAnchor.startDateText, sectionId, continuationCandidate, 0.65);
            if (continuationAnchor.endDateText) endDateText = makeValue(continuationAnchor.endDateText, sectionId, continuationCandidate, 0.65);
          }
        }

        /*
          Phase 2B-C3 - some records name the award first and put the
          school in brackets after it ("Generic Program (Example
          Polytechnic)"). This branch resolves nothing, so both halves
          were left unclassified even though the line states them
          plainly.

          A bracketed suffix is NOT automatically a school. The same
          syntax carries a specialization ("(Machine Vision)"), an
          honour ("(Honours)"), a status ("(Expected 2027)"), a place
          ("(Toronto, ON)") and plain descriptions ("(Online)",
          "(Accelerated)") - and negative evidence cannot separate those
          last two from a school, because they look identical to every
          predicate here. So the bracket content must EARN the
          institution role with the positive institution evidence this
          file already trusts; that single requirement is what refuses
          every one of those shapes at once, with the honours, date and
          location tests kept as independent second gates.

          The left side is only required to exist and to not itself be
          institution-shaped. It is deliberately NOT required to look
          like a degree: the real source line reads "Law Clerk", a
          diploma title that carries no degree keyword, and demanding
          one would refuse exactly the case this fixes. The
          not-institution test is what refuses the reversed shapes -
          "<School> (<Program>)" and "<School> (<City, ST>)" - where the
          school is on the left and the brackets hold something else.

          Exactly one bracket group is required, with nothing bracketed
          inside it. A line with two groups, or nested ones, is left
          unresolved rather than guessed at, and any trailing text after
          the group ("Expected in") is neither consumed nor rewritten -
          it stays preserved through the details the branch above
          already wrote, exactly as rawHeaderText keeps the whole line.
          Only credential and institution are set here; the date this
          entry has already come from the continuation line above, and
          fieldOfStudy and location stay untouched.
        */
        const parentheticalMatch = anchor.beforeText.match(/^([^()]*[^\s()])\s*\(([^()]+)\)\s*([^()]*)$/);
        if (parentheticalMatch) {
          const parentheticalLeft = parentheticalMatch[1].trim();
          const parentheticalInner = parentheticalMatch[2].trim();
          if (
            parentheticalLeft.length > 0 &&
            !segmentLooksLikeInstitution(parentheticalLeft) &&
            segmentLooksLikeInstitution(parentheticalInner) &&
            !HONORS_RE.test(parentheticalInner) &&
            !hasDateEvidence(parentheticalInner) &&
            !looksLikeLocation(parentheticalInner)
          ) {
            reasonCodes.push("single-line-header-credential-parenthetical-institution");
            credentialsAcc.push(makeValue(parentheticalLeft, sectionId, block, 0.65));
            institutionsAcc.push(makeValue(parentheticalInner, sectionId, block, 0.65));
          }
        }
      }
    } else {
      /* Phase 5D.3C - Generic Multi-Line Academic Header Recovery
         Hardening, extended in Phase 5D.3D for Double Degree/Double
         Major/Joint Program spanning SEPARATE window lines. */
      const classified = classifyWindow(blocks, range.headerBlockIndices);
      const { dateLines } = classified;

      if (dateLines.length > 0) {
        const primaryDate = dateLines[0];
        dateRangeText = makeValue(primaryDate.dateAnchor.dateRangeText, sectionId, primaryDate.block, 0.8);
        if (primaryDate.dateAnchor.startDateText) startDateText = makeValue(primaryDate.dateAnchor.startDateText, sectionId, primaryDate.block, 0.75);
        if (primaryDate.dateAnchor.endDateText) endDateText = makeValue(primaryDate.dateAnchor.endDateText, sectionId, primaryDate.block, 0.75);
      }

      const windowHasProgramLabel = classified.lines.some((l) => detectProgramLabel(l.remainderText.length > 0 ? l.remainderText : l.block.text));

      type Candidate = { line: HeaderWindowLine; text: string };
      const allCandidateLines: Candidate[] = classified.lines
        .filter((l) => l.remainderText.length > 0)
        .map((l) => ({ line: l, text: l.remainderText }));
      /* Pure program-label lines ("Joint Program:") and pure date-
         qualifier remainders ("Expected Graduation", left over after
         "Expected Graduation 2026" gives up its date - Phase 5D.3D
         bugfix, f15 fixture evidence) carry no institution/degree/major
         text of their own - excluded from field assignment, still
         preserved via rawHeaderText. */
      const candidateLines = allCandidateLines.filter((c) => !isPureLabelLine(c.text) && !isQualifierOnlyText(c.text));
      /*
        Phase 2B-C2-S - semantic preservation only, for the lines the
        filter above just excluded.

        Those lines stay excluded from field assignment exactly as
        before: the comment above is right that they carry no
        institution/degree/major text of their own. What it also says -
        "still preserved via rawHeaderText" - is the part that no longer
        holds, because the renderer's fallback shows rawHeaderText ONLY
        while the entry has nothing else, and this branch has already
        set a date and/or location by the time it runs.

        The excluded set is derived from the filter's OWN result rather
        than by re-testing the predicates, so the two can never drift,
        and only `text` (the post-date-strip remainder) is preserved -
        never the whole raw line, whose date is already structured.

        Excluded lines are unreachable from locationCandidate/remaining
        below, which read candidateLines only, so nothing preserved here
        can also become an institution, credential or field of study.
      */
      for (const excluded of allCandidateLines) {
        if (candidateLines.includes(excluded)) continue;
        extraDetails.push(makeValue(excluded.text, sectionId, excluded.line.block, 0.6));
      }

      const locationCandidate = candidateLines.find((c) => c.line.looksLikeLocationShape);
      if (locationCandidate) location = makeValue(locationCandidate.text, sectionId, locationCandidate.line.block, 0.7);

      const remaining = candidateLines.filter((c) => c !== locationCandidate);
      const degreeLines = remaining.filter((c) => c.line.hasDegreeKeyword);
      const instLines = remaining.filter((c) => c.line.hasInstitutionKeyword && !c.line.hasDegreeKeyword);
      const otherLines = remaining.filter((c) => !degreeLines.includes(c) && !instLines.includes(c));

      if (remaining.length === 0) {
        reasonCodes.push("multi-line-header-only-date-and-location");
      } else if (degreeLines.length >= 2 || instLines.length >= 2) {
        /* Explicit multi-line Double Degree ("Degree A in Major A" /
           "Degree B in Major B" / Institution) or Joint Program
           ("Institution A" / "Institution B" / Degree) - each
           qualifying line becomes its own credentials[]/institutions[]
           entry in window order, instead of only the FIRST match being
           kept (the pre-5D.3D behavior). */
        reasonCodes.push("multi-line-header-explicit-multi-value-lines");
        for (const d of degreeLines) {
          const r = resolveCredentialsFromText(d.text, sectionId, d.line.block, windowHasProgramLabel, 0.75);
          credentialsAcc.push(...r.credentials);
          fieldsOfStudyAcc.push(...r.fieldsOfStudy);
        }
        for (const inst of instLines) {
          const r = resolveInstitutionsFromText(inst.text, sectionId, inst.line.block, windowHasProgramLabel, 0.75);
          institutionsAcc.push(...r.institutions);
          if (r.location && !location) location = r.location;
          if (r.detail) extraDetails.push(r.detail);
        }
        if (otherLines.length > 0) {
          if (otherLines.length >= 2) {
            for (const o of otherLines) fieldsOfStudyAcc.push(makeValue(o.text, sectionId, o.line.block, 0.55));
          } else {
            fieldsOfStudyAcc.push(...resolveFieldsOfStudyFromText(otherLines[0].text, sectionId, otherLines[0].line.block, windowHasProgramLabel, 0.55));
          }
        }
      } else if (remaining.length === 1) {
        const only = remaining[0];
        if (only.line.hasDegreeKeyword && !only.line.hasInstitutionKeyword) {
          reasonCodes.push("multi-line-header-single-remainder-as-credential");
          const r = resolveCredentialsFromText(only.text, sectionId, only.line.block, windowHasProgramLabel, 0.7);
          credentialsAcc.push(...r.credentials);
          fieldsOfStudyAcc.push(...r.fieldsOfStudy);
          reasonCodes.push(...r.reasonCodes);
        } else {
          reasonCodes.push("multi-line-header-single-remainder-as-institution");
          const r = resolveInstitutionsFromText(only.text, sectionId, only.line.block, windowHasProgramLabel, 0.65);
          institutionsAcc.push(...r.institutions);
          if (r.location && !location) location = r.location;
          if (r.detail) extraDetails.push(r.detail);
          reasonCodes.push(...r.reasonCodes);
        }
      } else if (remaining.length === 2) {
        const [a, b] = remaining;
        const aHasDegree = a.line.hasDegreeKeyword;
        const bHasDegree = b.line.hasDegreeKeyword;
        const aHasInstitutionWord = a.line.hasInstitutionKeyword;
        const bHasInstitutionWord = b.line.hasInstitutionKeyword;

        let credentialCand: Candidate | null = null;
        let institutionCand: Candidate | null = null;
        let disambiguatedBy: string | null = null;
        if (aHasDegree && !bHasDegree) {
          credentialCand = a;
          institutionCand = b;
          disambiguatedBy = "multi-line-header-degree-keyword-disambiguated";
        } else if (!aHasDegree && bHasDegree) {
          credentialCand = b;
          institutionCand = a;
          disambiguatedBy = "multi-line-header-degree-keyword-disambiguated";
        } else if (aHasInstitutionWord && !bHasInstitutionWord) {
          institutionCand = a;
          credentialCand = b;
          disambiguatedBy = "multi-line-header-institution-keyword-disambiguated";
        } else if (!aHasInstitutionWord && bHasInstitutionWord) {
          institutionCand = b;
          credentialCand = a;
          disambiguatedBy = "multi-line-header-institution-keyword-disambiguated";
        }

        if (credentialCand && institutionCand) {
          reasonCodes.push(disambiguatedBy!);
          const credR = resolveCredentialsFromText(credentialCand.text, sectionId, credentialCand.line.block, windowHasProgramLabel, 0.75);
          credentialsAcc.push(...credR.credentials);
          fieldsOfStudyAcc.push(...credR.fieldsOfStudy);
          const instR = resolveInstitutionsFromText(institutionCand.text, sectionId, institutionCand.line.block, windowHasProgramLabel, 0.75);
          institutionsAcc.push(...instR.institutions);
          if (instR.location && !location) location = instR.location;
          if (instR.detail) extraDetails.push(instR.detail);
        } else {
          /* Phase 5D.3B/5D.3C - neither line carries a generic degree
             or institution keyword. There is no lexical signal left to
             decide WHICH line is credential vs institution - never drop
             either line's text over that ambiguity. */
          reasonCodes.push("multi-line-header-positional-fallback-no-keyword-signal");
          const dateDerived = remaining.find((r) => r.line.hasDate);
          const nonDateDerived = remaining.find((r) => !r.line.hasDate);
          const institutionCandFallback = dateDerived && nonDateDerived && dateDerived !== nonDateDerived ? nonDateDerived : remaining[remaining.length - 1];
          const credentialCandFallback = dateDerived && nonDateDerived && dateDerived !== nonDateDerived ? dateDerived : remaining[0] !== institutionCandFallback ? remaining[0] : undefined;

          const instR = resolveInstitutionsFromText(institutionCandFallback.text, sectionId, institutionCandFallback.line.block, windowHasProgramLabel, 0.55);
          institutionsAcc.push(...instR.institutions);
          if (instR.location && !location) location = instR.location;
          if (instR.detail) extraDetails.push(instR.detail);
          if (credentialCandFallback) {
            const credR = resolveCredentialsFromText(credentialCandFallback.text, sectionId, credentialCandFallback.line.block, windowHasProgramLabel, 0.5);
            credentialsAcc.push(...credR.credentials);
            fieldsOfStudyAcc.push(...credR.fieldsOfStudy);
          }
        }
      } else {
        /* 3+ remaining candidate lines (with at most 1 degree-keyword
           line and at most 1 institution-keyword line, otherwise the
           explicit-multi-value branch above would have fired) - Shape
           E/F (Degree, Major, Institution[, ...]). */
        reasonCodes.push("multi-line-header-shape-scored");
        const institutionCand = remaining.find((r) => r.line.hasInstitutionKeyword) ?? remaining[remaining.length - 1];
        const degreeCand = remaining.find((r) => r !== institutionCand && r.line.hasDegreeKeyword) ?? (remaining[0] !== institutionCand ? remaining[0] : undefined);

        const instR = resolveInstitutionsFromText(institutionCand.text, sectionId, institutionCand.line.block, windowHasProgramLabel, 0.7);
        institutionsAcc.push(...instR.institutions);
        if (instR.location && !location) location = instR.location;
        if (instR.detail) extraDetails.push(instR.detail);

        if (degreeCand) {
          const credR = resolveCredentialsFromText(degreeCand.text, sectionId, degreeCand.line.block, windowHasProgramLabel, 0.65);
          credentialsAcc.push(...credR.credentials);
          fieldsOfStudyAcc.push(...credR.fieldsOfStudy);
        }

        const majorLines = remaining.filter((r) => r !== institutionCand && r !== degreeCand);
        if (majorLines.length === 1 && fieldsOfStudyAcc.length === 0) {
          /* Phase 5D.3D - a SINGLE leftover major line may itself
             encode a Double Major via delimiter (see
             resolveFieldsOfStudyFromText's own comment). */
          fieldsOfStudyAcc.push(...resolveFieldsOfStudyFromText(majorLines[0].text, sectionId, majorLines[0].line.block, windowHasProgramLabel, 0.55));
        } else if (majorLines.length > 0 && fieldsOfStudyAcc.length === 0) {
          /* Phase 5D.3C - 2+ SEPARATE major lines joined with a plain
             space, matching exactly how structuredValidator.ts's own
             fact-preservation check reconstructs a multi-block value's
             expected source text - kept unchanged from 5D.3C (each
             line here is already a distinct physical block, so no
             delimiter-based splitting decision is needed; per-line
             splitting was evaluated but deferred as a known limitation
             - see the round's final report). */
          const majorText = majorLines.map((m) => m.text).join(" ");
          if (majorText.length > 0) {
            fieldsOfStudyAcc.push({
              value: majorText,
              confidence: 0.55,
              extractionMethod: "pattern-rule",
              source: mergeTraces(traceFromBlocks(sectionId, majorLines.map((m) => m.line.block))),
            });
          }
        }
      }
    }

    /* Only when the header itself yielded no institution - an entry that
       already found one is never reinterpreted. */
    const adoptedInstitutionLine = institutionsAcc.length === 0 ? adoptTrailingInstitutionLine(bodyRunBlocks[0]) : undefined;
    if (adoptedInstitutionLine !== undefined) {
      institutionsAcc.push(makeValue(adoptedInstitutionLine.institution, sectionId, adoptedInstitutionLine.block, 0.7));
      if (location === undefined && adoptedInstitutionLine.location !== undefined) {
        location = makeValue(adoptedInstitutionLine.location, sectionId, adoptedInstitutionLine.block, 0.65);
      }
      /* A middle campus segment has no field of its own - same details
         channel the composite splitter's other callers already use. */
      if (adoptedInstitutionLine.detail !== undefined && adoptedInstitutionLine.detail.length > 0) {
        extraDetails.push(makeValue(adoptedInstitutionLine.detail, sectionId, adoptedInstitutionLine.block, 0.6));
      }
      reasonCodes.push("trailing-institution-line-adopted-into-header");
    }
    /* The adopted block is header material now, so it is handed to the
       header side BEFORE details are built rather than being removed
       from them afterwards. Both lists together still cover exactly the
       same blocks as before. */
    const headerOwnedBlocks = adoptedInstitutionLine !== undefined ? [...headerBlocks, adoptedInstitutionLine.block] : headerBlocks;
    const detailOwnedBlocks = adoptedInstitutionLine !== undefined ? bodyRunBlocks.slice(1) : bodyRunBlocks;

    const gpa = extractGpa(sectionId, [...headerOwnedBlocks, ...detailOwnedBlocks]);
    const honors: StructuredTextValue[] = [];
    const details: StructuredTextValue[] = [...extraDetails];
    for (const block of detailOwnedBlocks) {
      if (block.rawText.length === 0) continue;
      /* Phase 2B Bug A - the emptiness guard above tests rawText, which
         still carries the marker, so a marker-only block passes it and
         reaches details[] as a literal glyph. */
      if (isDecorativeMarkerOnly(block.rawText)) continue;
      if (GPA_RE.test(block.text)) continue;
      if (/\b(honou?rs?|dean'?s list|cum laude|distinction)\b/i.test(block.text)) {
        honors.push(makeValue(normalizeBulletPresentation(block.rawText, { blockType: block.blockType }).displayText, sectionId, block, 0.7));
      } else {
        details.push(makeValue(normalizeBulletPresentation(block.rawText, { blockType: block.blockType }).displayText, sectionId, block, 0.6));
      }
    }

    const allBlocks = [...headerOwnedBlocks, ...detailOwnedBlocks];
    const institution = institutionsAcc[0];
    const credential = credentialsAcc[0];
    const fieldOfStudy = fieldsOfStudyAcc[0];
    const isUncertain = institution === undefined || credential === undefined;
    if (institutionsAcc.length >= 2) reasonCodes.push("multiple-institutions-preserved");
    if (credentialsAcc.length >= 2) reasonCodes.push("multiple-credentials-preserved");
    if (fieldsOfStudyAcc.length >= 2) reasonCodes.push("multiple-fields-of-study-preserved");

    return {
      id: entryId(sectionId, "education", index),
      institution,
      credential,
      fieldOfStudy,
      credentials: credentialsAcc,
      fieldsOfStudy: fieldsOfStudyAcc,
      institutions: institutionsAcc,
      location,
      startDateText,
      endDateText,
      dateQualifierText,
      dateRangeText,
      gpa,
      honors,
      details,
      rawHeaderText: headerOwnedBlocks.map((b) => b.rawText).join("\n"),
      source: mergeTraces(traceFromBlocks(sectionId, allBlocks)),
      isUncertain,
      reasonCodes,
    };
  });
}
