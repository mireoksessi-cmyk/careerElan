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
import type { EducationEntry, StructuredTextValue } from "./types";

const DEGREE_KEYWORD_RE = /\b(bachelor|master|ph\.?d|doctorate|associate|diploma|certificate|b\.?a\.?|b\.?s\.?|b\.?comm\.?|m\.?a\.?|m\.?s\.?|m\.?b\.?a\.?)\b/i;
/*
  Phase 5D.3B - a generic INSTITUTION-category signal, same kind of
  lexical class already established by DEGREE_KEYWORD_RE above
  (generic degree words, never a specific school's own name) - used
  only as a last-resort disambiguator when NEITHER header line matches
  DEGREE_KEYWORD_RE, so a two-line header still gets its institution
  line correctly identified instead of dropping both lines entirely.
*/
const INSTITUTION_KEYWORD_RE = /\b(university|college|institute|academy|polytechnic|school|seminary|conservatory)\b/i;
const GPA_RE = /\bgpa\b[:\s]*([0-4]\.\d{1,2})(?:\s*\/\s*([0-9](?:\.\d)?))?/i;
const MAX_HEADER_LINE_LENGTH = 100;
const SENTENCE_END_RE = /[.!?]$/;

function looksLikeHeaderLine(block: SemanticContentBlock): boolean {
  const text = block.text.trim();
  return block.blockType !== "bullet" && text.length > 0 && text.length <= MAX_HEADER_LINE_LENGTH && !SENTENCE_END_RE.test(text);
}

export type EducationEntryRange = { headerBlockIndices: number[]; bodyBlockIndices: number[] };

/*
  Boundary detection mirrors experienceExtractor.ts's forward-scan +
  1-token-lookahead approach, since education entries share the exact
  same real-world shape (two header lines, one of which carries the
  date, then zero or more detail lines).
*/
export function segmentEducationRanges(blocks: SemanticContentBlock[]): EducationEntryRange[] {
  if (blocks.length === 0) return [];
  if (!blocks.some((b) => b.blockType !== "bullet" && hasDateEvidence(b.text))) {
    return [{ headerBlockIndices: [0], bodyBlockIndices: blocks.slice(1).map((_, i) => i + 1) }];
  }

  const ranges: EducationEntryRange[] = [];
  let i = 0;
  const n = blocks.length;

  function isNewEntryStart(index: number): boolean {
    if (index >= n) return false;
    const block = blocks[index];
    if (block.blockType === "bullet") return false;
    if (hasDateEvidence(block.text)) return true;
    const next = blocks[index + 1];
    return looksLikeHeaderLine(block) && next !== undefined && next.blockType !== "bullet" && hasDateEvidence(next.text);
  }

  while (i < n) {
    const headerBlockIndices: number[] = [i];
    let headerEnd = i;
    const iHasDate = hasDateEvidence(blocks[i].text);
    const next = i + 1 < n ? blocks[i + 1] : undefined;
    const nextIsPlainHeaderLine = next !== undefined && next.blockType !== "bullet" && looksLikeHeaderLine(next);
    if (!iHasDate && nextIsPlainHeaderLine && hasDateEvidence(next!.text) && looksLikeHeaderLine(blocks[i])) {
      /* Institution-first \n Date-second (bench-A/C/E real shape). */
      headerEnd = i + 1;
      headerBlockIndices.push(i + 1);
    } else if (
      iHasDate &&
      nextIsPlainHeaderLine &&
      !hasDateEvidence(next!.text) &&
      stripDateAnchor(blocks[i].text).beforeText.length === 0 &&
      stripDateAnchor(blocks[i].text).afterText.length === 0
    ) {
      /* Phase 5D.3B - Date-first \n Institution-second (the user's own
         primary bug example: "2027\nLaw Clerk (Seneca Polytechnic)").
         Symmetric with the branch above - previously only the
         institution-first ordering was ever paired into a 2-line
         header, so a bare date-only first line was treated as a
         complete 1-line header and its institution/credential line
         silently fell through to a generic body/details line instead
         of the institution field. Gated on the date line's own
         stripped remainder being EMPTY (a genuinely bare date line,
         e.g. "2019 - 2021") so an already-self-sufficient single-line
         header that merely happens to also have real text before/after
         its date ("Bachelor of Science, Riverton University - 2015")
         is never incorrectly swallowed together with the next,
         unrelated entry's own header line. extractEducationEntries's
         own two-line branch already locates dateBlock by
         hasDateEvidence on either line (order-agnostic), so no further
         change is needed there. */
      headerEnd = i + 1;
      headerBlockIndices.push(i + 1);
    }

    let k = headerEnd + 1;
    while (k < n) {
      if (blocks[k].blockType === "bullet") {
        k++;
        continue;
      }
      if (isNewEntryStart(k)) break;
      k++;
    }

    const bodyBlockIndices: number[] = [];
    for (let j = headerEnd + 1; j < k; j++) bodyBlockIndices.push(j);

    ranges.push({ headerBlockIndices, bodyBlockIndices });
    i = k;
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
      const [lineA, lineB] = headerBlocks;
      const aHasDegree = DEGREE_KEYWORD_RE.test(lineA.text);
      const bHasDegree = DEGREE_KEYWORD_RE.test(lineB.text);
      const aHasInstitutionWord = INSTITUTION_KEYWORD_RE.test(lineA.text);
      const bHasInstitutionWord = INSTITUTION_KEYWORD_RE.test(lineB.text);

      let credentialBlock: SemanticContentBlock | null = null;
      let institutionBlock: SemanticContentBlock | null = null;
      let disambiguatedBy: string | null = null;
      if (aHasDegree && !bHasDegree) {
        credentialBlock = lineA;
        institutionBlock = lineB;
        disambiguatedBy = "two-line-header-degree-keyword-disambiguated";
      } else if (!aHasDegree && bHasDegree) {
        credentialBlock = lineB;
        institutionBlock = lineA;
        disambiguatedBy = "two-line-header-degree-keyword-disambiguated";
      } else if (aHasInstitutionWord && !bHasInstitutionWord) {
        institutionBlock = lineA;
        credentialBlock = lineB;
        disambiguatedBy = "two-line-header-institution-keyword-disambiguated";
      } else if (!aHasInstitutionWord && bHasInstitutionWord) {
        institutionBlock = lineB;
        credentialBlock = lineA;
        disambiguatedBy = "two-line-header-institution-keyword-disambiguated";
      }

      const dateBlock = hasDateEvidence(lineA.text) ? lineA : hasDateEvidence(lineB.text) ? lineB : undefined;
      const dateAnchor = dateBlock ? stripDateAnchor(dateBlock.text) : undefined;
      if (dateAnchor && dateAnchor.dateRangeText.length > 0) {
        dateRangeText = makeValue(dateAnchor.dateRangeText, sectionId, dateBlock!, 0.8);
        if (dateAnchor.startDateText) startDateText = makeValue(dateAnchor.startDateText, sectionId, dateBlock!, 0.75);
        if (dateAnchor.endDateText) endDateText = makeValue(dateAnchor.endDateText, sectionId, dateBlock!, 0.75);
      }

      function remainderOf(block: SemanticContentBlock): string {
        if (block === dateBlock && dateAnchor) {
          return [dateAnchor.beforeText, dateAnchor.afterText].filter((s) => s.length > 0).join(" ");
        }
        return cleanHeaderFragment(block.rawText);
      }

      if (credentialBlock && institutionBlock) {
        reasonCodes.push(disambiguatedBy!);
        const credentialText = remainderOf(credentialBlock);
        const { credential: c, fieldOfStudy: f } = splitCredentialField(credentialText);
        if (c.length > 0) {
          credential = makeValue(c, sectionId, credentialBlock, 0.75);
          if (f) fieldOfStudy = makeValue(f, sectionId, credentialBlock, 0.65);
        }

        const institutionText = remainderOf(institutionBlock);
        const { institution: inst, location: loc } = splitInstitutionLocation(institutionText);
        if (inst.length > 0) {
          institution = makeValue(inst, sectionId, institutionBlock, 0.75);
          if (loc) location = makeValue(loc, sectionId, institutionBlock, 0.7);
        }
      } else if (dateBlock) {
        /* Phase 5D.3B - neither line carries a generic degree or
           institution keyword (both real, evidenced shapes: two plain
           proper-noun lines with no lexical disambiguator). There is no
           signal left to decide WHICH line is credential vs
           institution - never drop either line's text over that
           ambiguity. Institution is the always-visible field (shown
           alone even when credential is empty), so the non-date line
           goes there and the date line's own remainder (if any)
           becomes the credential. segmentEducationRanges only ever
           builds a 2-block header when one of the two lines carries
           date evidence, so dateBlock is guaranteed here. */
        reasonCodes.push("two-line-header-positional-fallback-no-keyword-signal");
        const nonDateBlock = dateBlock === lineA ? lineB : lineA;
        const nonDateText = cleanHeaderFragment(nonDateBlock.rawText);
        if (nonDateText.length > 0) institution = makeValue(nonDateText, sectionId, nonDateBlock, 0.55);
        const dateBlockRemainder = remainderOf(dateBlock);
        if (dateBlockRemainder.length > 0) credential = makeValue(dateBlockRemainder, sectionId, dateBlock, 0.5);
      } else {
        reasonCodes.push("two-line-header-no-date-and-no-keyword-signal");
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
