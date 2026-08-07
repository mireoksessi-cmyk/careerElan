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
function isNewEntryStart(blocks: SemanticContentBlock[], index: number): boolean {
  if (index >= blocks.length) return false;
  const block = blocks[index];
  if (block.blockType === "bullet") return false;
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
  if (!blocks.some((b) => b.blockType !== "bullet" && hasDateEvidence(b.text))) {
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
      if (blocks[k].blockType === "bullet") {
        k++;
        continue;
      }
      if (isNewEntryStart(blocks, k)) break;
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

export function extractEducationEntries(sectionId: string, bodyBlocks: SemanticContentBlock[]): EducationEntry[] {
  const ranges = segmentEducationRanges(bodyBlocks);

  return ranges.map((range, index) => {
    const headerBlocks = range.headerBlockIndices.map((i) => bodyBlocks[i]);
    const bodyRunBlocks = range.bodyBlockIndices.map((i) => bodyBlocks[i]);
    const reasonCodes: string[] = [];

    const credentialsAcc: StructuredTextValue[] = [];
    const fieldsOfStudyAcc: StructuredTextValue[] = [];
    const institutionsAcc: StructuredTextValue[] = [];
    const extraDetails: StructuredTextValue[] = [];
    let location: StructuredTextValue | undefined;
    let dateRangeText: StructuredTextValue | undefined;
    let startDateText: StructuredTextValue | undefined;
    let endDateText: StructuredTextValue | undefined;

    if (headerBlocks.length === 1) {
      const block = headerBlocks[0];
      const anchor = stripDateAnchor(block.text);
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
              reasonCodes.push("single-line-header-whole-remainder-as-institution");
              institutionsAcc.push(makeValue(segments[0] ?? primary, sectionId, block, 0.6));
            }
          }
          if (secondary.length > 0) location = makeValue(secondary, sectionId, block, 0.5);
        } else {
          reasonCodes.push("single-line-header-empty-after-date-strip");
        }
      } else {
        reasonCodes.push("single-line-header-no-date-evidence");
      }
    } else {
      /* Phase 5D.3C - Generic Multi-Line Academic Header Recovery
         Hardening, extended in Phase 5D.3D for Double Degree/Double
         Major/Joint Program spanning SEPARATE window lines. */
      const classified = classifyWindow(bodyBlocks, range.headerBlockIndices);
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

    const gpa = extractGpa(sectionId, [...headerBlocks, ...bodyRunBlocks]);
    const honors: StructuredTextValue[] = [];
    const details: StructuredTextValue[] = [...extraDetails];
    for (const block of bodyRunBlocks) {
      if (block.rawText.length === 0) continue;
      if (GPA_RE.test(block.text)) continue;
      if (/\b(honou?rs?|dean'?s list|cum laude|distinction)\b/i.test(block.text)) {
        honors.push(makeValue(normalizeBulletPresentation(block.rawText, { blockType: block.blockType }).displayText, sectionId, block, 0.7));
      } else {
        details.push(makeValue(normalizeBulletPresentation(block.rawText, { blockType: block.blockType }).displayText, sectionId, block, 0.6));
      }
    }

    const allBlocks = [...headerBlocks, ...bodyRunBlocks];
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
      dateRangeText,
      gpa,
      honors,
      details,
      rawHeaderText: headerBlocks.map((b) => b.rawText).join("\n"),
      source: mergeTraces(traceFromBlocks(sectionId, allBlocks)),
      isUncertain,
      reasonCodes,
    };
  });
}
