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
*/
import type { SemanticContentBlock } from "../losslessSemantic/types";
import { traceFromBlock, traceFromBlocks, mergeTraces } from "./sourceTrace";
import { entryId } from "./ids";
import { hasDateEvidence, stripDateAnchor, cleanHeaderFragment } from "./dateRangeParsing";
import { splitOrganizationLocation } from "./splitOrganizationLocation";
import {
  collectHeaderWindow,
  classifyWindow,
  looksLikeHeaderLine,
  DEGREE_KEYWORD_RE,
  INSTITUTION_KEYWORD_RE,
  type HeaderWindowLine,
} from "./headerWindow";
import type { EducationEntry, StructuredTextValue } from "./types";

const GPA_RE = /\bgpa\b[:\s]*([0-4]\.\d{1,2})(?:\s*\/\s*([0-9](?:\.\d)?))?/i;
const HONORS_RE = /\b(honou?rs?|dean'?s list|cum laude|distinction)\b/i;

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
  Phase 5D.2A - delegates to the shared, general-purpose
  splitOrganizationLocation (dash-separator detection first, gated on
  looksLikeLocation, falling back to the pre-existing unconditional
  comma-based split) and relabels its "organization" field as
  "institution" - the same boundary concept, just a different field
  name in this extractor's own output shape.
*/
function splitInstitutionLocation(text: string): { institution: string; location?: string } {
  const { organization, location } = splitOrganizationLocation(text);
  return { institution: organization, location };
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
     of the credential. */
  if (DEGREE_KEYWORD_RE.test(parts[1])) return { credential: withoutLocationSuffix };
  return { credential: parts[0], fieldOfStudy: parts.slice(1).join(", ") };
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

    let institution: StructuredTextValue | undefined;
    let credential: StructuredTextValue | undefined;
    let fieldOfStudy: StructuredTextValue | undefined;
    let location: StructuredTextValue | undefined;
    let dateRangeText: StructuredTextValue | undefined;
    let startDateText: StructuredTextValue | undefined;
    let endDateText: StructuredTextValue | undefined;

    if (headerBlocks.length === 1) {
      const block = headerBlocks[0];
      const anchor = stripDateAnchor(block.text);
      const hasDate = anchor.dateRangeText.length > 0;
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
           dropped. Scoped to the date-anchored case only (Date is the
           Anchor this round's spec is built around) - a header with NO
           date evidence at all isn't one of the listed header shapes,
           so it's left to the renderer's own RawHeaderFallback (see
           renderers.tsx) rather than guessed at here from comma
           structure alone. */
        const primary = anchor.beforeText.length > 0 ? anchor.beforeText : anchor.afterText;
        const secondary = anchor.beforeText.length > 0 ? anchor.afterText : "";

        if (primary.length > 0) {
          const withoutParenTail = primary.replace(/\([^)]*$/, "").trim();
          const segments = (withoutParenTail.length > 0 ? withoutParenTail : primary).split(",").map((s) => s.trim()).filter((s) => s.length > 0);
          if (segments.length >= 2) {
            reasonCodes.push("single-line-header-comma-split");
            credential = makeValue(segments[0], sectionId, block, 0.7);
            if (segments.length >= 3) {
              fieldOfStudy = makeValue(segments[1], sectionId, block, 0.65);
              institution = makeValue(segments[2], sectionId, block, 0.65);
            } else {
              institution = makeValue(segments[1], sectionId, block, 0.65);
            }
          } else {
            /* No comma structure to split on, but the remainder text
               itself IS real information (e.g. "Cheonan Bukil High
               School" or "Law Clerk (Seneca Polytechnic)") - never drop
               it. Institution is the safer default (EducationView/
               renderEducation both show institution on its own even
               when credential is empty). */
            reasonCodes.push("single-line-header-whole-remainder-as-institution");
            institution = makeValue(segments[0] ?? primary, sectionId, block, 0.6);
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
         Hardening. Generalizes the old exactly-2-line degree/
         institution keyword disambiguation (still applied verbatim
         when there are exactly 2 non-date/non-location candidate
         lines) up to headerWindow.ts's full N-line window (Shape
         E/F: Degree, Major, Institution, [Location], Date and its
         variants). Every date-bearing line's own remainder text (the
         mixed-line case, e.g. "Law Clerk - 2027, Toronto, ON") is
         folded in as an ordinary candidate alongside the genuinely
         non-date lines, exactly like the single-line branch above
         already does - never assumes the date line carries nothing
         else. */
      const classified = classifyWindow(bodyBlocks, range.headerBlockIndices);
      const { dateLines } = classified;

      if (dateLines.length > 0) {
        const primaryDate = dateLines[0];
        dateRangeText = makeValue(primaryDate.dateAnchor.dateRangeText, sectionId, primaryDate.block, 0.8);
        if (primaryDate.dateAnchor.startDateText) startDateText = makeValue(primaryDate.dateAnchor.startDateText, sectionId, primaryDate.block, 0.75);
        if (primaryDate.dateAnchor.endDateText) endDateText = makeValue(primaryDate.dateAnchor.endDateText, sectionId, primaryDate.block, 0.75);
      }

      type Candidate = { line: HeaderWindowLine; text: string };
      const candidateLines: Candidate[] = classified.lines
        .filter((l) => l.remainderText.length > 0)
        .map((l) => ({ line: l, text: l.remainderText }));

      const locationCandidate = candidateLines.find((c) => c.line.looksLikeLocationShape);
      if (locationCandidate) location = makeValue(locationCandidate.text, sectionId, locationCandidate.line.block, 0.7);

      const remaining = candidateLines.filter((c) => c !== locationCandidate);

      if (remaining.length === 0) {
        reasonCodes.push("multi-line-header-only-date-and-location");
      } else if (remaining.length === 1) {
        const only = remaining[0];
        if (only.line.hasDegreeKeyword && !only.line.hasInstitutionKeyword) {
          reasonCodes.push("multi-line-header-single-remainder-as-credential");
          const { credential: c, fieldOfStudy: f } = splitCredentialField(only.text);
          if (c.length > 0) {
            credential = makeValue(c, sectionId, only.line.block, 0.7);
            if (f) fieldOfStudy = makeValue(f, sectionId, only.line.block, 0.65);
          }
        } else {
          reasonCodes.push("multi-line-header-single-remainder-as-institution");
          const { institution: inst, location: loc } = splitInstitutionLocation(only.text);
          if (inst.length > 0) institution = makeValue(inst, sectionId, only.line.block, 0.65);
          if (loc && !location) location = makeValue(loc, sectionId, only.line.block, 0.6);
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
          const { credential: c, fieldOfStudy: f } = splitCredentialField(credentialCand.text);
          if (c.length > 0) {
            credential = makeValue(c, sectionId, credentialCand.line.block, 0.75);
            if (f) fieldOfStudy = makeValue(f, sectionId, credentialCand.line.block, 0.65);
          }
          const { institution: inst, location: loc } = splitInstitutionLocation(institutionCand.text);
          if (inst.length > 0) institution = makeValue(inst, sectionId, institutionCand.line.block, 0.75);
          if (loc && !location) location = makeValue(loc, sectionId, institutionCand.line.block, 0.7);
        } else {
          /* Phase 5D.3B/5D.3C - neither line carries a generic degree
             or institution keyword. There is no lexical signal left to
             decide WHICH line is credential vs institution - never drop
             either line's text over that ambiguity. When exactly one of
             the two remaining candidates was derived from the window's
             own date line (a mixed date+text line, e.g. "Beta Learning
             Centre - 2022"), the established 5D.3B convention applies
             unchanged regardless of position: the plain non-date line
             becomes institution (the always-visible field), the date
             line's own remainder becomes credential. Only when BOTH
             candidates are plain non-date lines (a genuine 3+ line
             window collapsing to 2 after location removal) does this
             fall back to pure position (last = institution, closest to
             the date; first = credential). */
          reasonCodes.push("multi-line-header-positional-fallback-no-keyword-signal");
          const dateDerived = remaining.find((r) => r.line.hasDate);
          const nonDateDerived = remaining.find((r) => !r.line.hasDate);
          const institutionCandFallback = dateDerived && nonDateDerived && dateDerived !== nonDateDerived ? nonDateDerived : remaining[remaining.length - 1];
          const credentialCandFallback = dateDerived && nonDateDerived && dateDerived !== nonDateDerived ? dateDerived : remaining[0] !== institutionCandFallback ? remaining[0] : undefined;

          const { institution: inst, location: loc } = splitInstitutionLocation(institutionCandFallback.text);
          if (inst.length > 0) institution = makeValue(inst, sectionId, institutionCandFallback.line.block, 0.55);
          if (loc && !location) location = makeValue(loc, sectionId, institutionCandFallback.line.block, 0.5);
          if (credentialCandFallback) {
            const { credential: c, fieldOfStudy: f } = splitCredentialField(credentialCandFallback.text);
            if (c.length > 0) {
              credential = makeValue(c, sectionId, credentialCandFallback.line.block, 0.5);
              if (f) fieldOfStudy = makeValue(f, sectionId, credentialCandFallback.line.block, 0.45);
            }
          }
        }
      } else {
        /* 3+ remaining candidate lines - Shape E/F (Degree, Major,
           Institution[, ...]). Institution and Degree are each
           resolved by keyword first (order-independent), falling back
           to position (institution = closest to the date/last;
           degree = first) only when no line carries either keyword.
           Every remaining, unclaimed line becomes fieldOfStudy (joined
           if more than one) - never dropped. */
        reasonCodes.push("multi-line-header-shape-scored");
        const institutionCand = remaining.find((r) => r.line.hasInstitutionKeyword) ?? remaining[remaining.length - 1];
        const degreeCand = remaining.find((r) => r !== institutionCand && r.line.hasDegreeKeyword) ?? (remaining[0] !== institutionCand ? remaining[0] : undefined);

        const { institution: inst, location: loc } = splitInstitutionLocation(institutionCand.text);
        if (inst.length > 0) institution = makeValue(inst, sectionId, institutionCand.line.block, 0.7);
        if (loc && !location) location = makeValue(loc, sectionId, institutionCand.line.block, 0.6);

        if (degreeCand) {
          const { credential: c, fieldOfStudy: f } = splitCredentialField(degreeCand.text);
          if (c.length > 0) {
            credential = makeValue(c, sectionId, degreeCand.line.block, 0.65);
            if (f) fieldOfStudy = makeValue(f, sectionId, degreeCand.line.block, 0.6);
          }
        }

        const majorLines = remaining.filter((r) => r !== institutionCand && r !== degreeCand);
        if (majorLines.length > 0 && !fieldOfStudy) {
          /* Phase 5D.3C - joined with a plain space, matching exactly
             how structuredValidator.ts's own fact-preservation check
             reconstructs a multi-block value's expected source text
             (blockById(...).rawText.join(" ")) - a comma-joined value
             would never be found as a substring of that space-joined
             source and would be flagged as "invented" even though every
             word came verbatim from a real source block. */
          const majorText = majorLines.map((m) => m.text).join(" ");
          if (majorText.length > 0) {
            fieldOfStudy = {
              value: majorText,
              confidence: 0.55,
              extractionMethod: "pattern-rule",
              source: mergeTraces(traceFromBlocks(sectionId, majorLines.map((m) => m.line.block))),
            };
          }
        }
      }
    }

    const gpa = extractGpa(sectionId, [...headerBlocks, ...bodyRunBlocks]);
    const honors: StructuredTextValue[] = [];
    const details: StructuredTextValue[] = [];
    for (const block of bodyRunBlocks) {
      if (block.rawText.length === 0) continue;
      if (GPA_RE.test(block.text)) continue;
      if (/\b(honou?rs?|dean'?s list|cum laude|distinction)\b/i.test(block.text)) {
        honors.push(makeValue(block.rawText, sectionId, block, 0.7));
      } else {
        details.push(makeValue(block.rawText, sectionId, block, 0.6));
      }
    }

    const allBlocks = [...headerBlocks, ...bodyRunBlocks];
    const isUncertain = institution === undefined || credential === undefined;

    return {
      id: entryId(sectionId, "education", index),
      institution,
      credential,
      fieldOfStudy,
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
