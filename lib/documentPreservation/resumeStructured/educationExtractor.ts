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
import { hasDateEvidence, extractDateParts } from "./dateRangeParsing";
import type { EducationEntry, StructuredTextValue } from "./types";

const DEGREE_KEYWORD_RE = /\b(bachelor|master|ph\.?d|doctorate|associate|diploma|certificate|b\.?a\.?|b\.?s\.?|b\.?comm\.?|m\.?a\.?|m\.?s\.?|m\.?b\.?a\.?)\b/i;
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
    if (!hasDateEvidence(blocks[i].text) && i + 1 < n && blocks[i + 1].blockType !== "bullet" && hasDateEvidence(blocks[i + 1].text) && looksLikeHeaderLine(blocks[i])) {
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

function stripDateAndTrailingPunctuation(text: string, dateRangeText: string): string {
  const idx = text.indexOf(dateRangeText);
  const before = idx >= 0 ? text.slice(0, idx) : text;
  return before.trim().replace(/[,–—|-]+$/, "").trim();
}

function splitInstitutionLocation(text: string): { institution: string; location?: string } {
  const parts = text.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length <= 1) return { institution: text.trim() };
  return { institution: parts[0], location: parts.slice(1).join(", ") };
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
      const dateParts = extractDateParts(block.text);
      if (dateParts) {
        dateRangeText = makeValue(dateParts.dateRangeText, sectionId, block, 0.8);
        if (dateParts.startDateText) startDateText = makeValue(dateParts.startDateText, sectionId, block, 0.75);
        if (dateParts.endDateText) endDateText = makeValue(dateParts.endDateText, sectionId, block, 0.75);
        const before = stripDateAndTrailingPunctuation(block.text, dateParts.dateRangeText);
        const segments = before.replace(/\([^)]*$/, "").trim().split(",").map((s) => s.trim()).filter((s) => s.length > 0);
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
          reasonCodes.push("single-line-header-insufficient-comma-evidence");
        }
      } else {
        reasonCodes.push("single-line-header-no-date-evidence");
      }
    } else {
      const [lineA, lineB] = headerBlocks;
      const aHasDegree = DEGREE_KEYWORD_RE.test(lineA.text);
      const bHasDegree = DEGREE_KEYWORD_RE.test(lineB.text);
      const credentialBlock = aHasDegree && !bHasDegree ? lineA : !aHasDegree && bHasDegree ? lineB : null;
      const institutionBlock = credentialBlock === lineA ? lineB : credentialBlock === lineB ? lineA : null;

      const dateBlock = hasDateEvidence(lineA.text) ? lineA : hasDateEvidence(lineB.text) ? lineB : undefined;
      if (dateBlock) {
        const dateParts = extractDateParts(dateBlock.text);
        if (dateParts) {
          dateRangeText = makeValue(dateParts.dateRangeText, sectionId, dateBlock, 0.8);
          if (dateParts.startDateText) startDateText = makeValue(dateParts.startDateText, sectionId, dateBlock, 0.75);
          if (dateParts.endDateText) endDateText = makeValue(dateParts.endDateText, sectionId, dateBlock, 0.75);
        }
      }

      if (credentialBlock && institutionBlock) {
        reasonCodes.push("two-line-header-degree-keyword-disambiguated");
        const credentialText = dateBlock === credentialBlock ? stripDateAndTrailingPunctuation(credentialBlock.text, dateRangeText?.value ?? "") : credentialBlock.rawText;
        const { credential: c, fieldOfStudy: f } = splitCredentialField(credentialText);
        credential = makeValue(c, sectionId, credentialBlock, 0.75);
        if (f) fieldOfStudy = makeValue(f, sectionId, credentialBlock, 0.65);

        const institutionText = dateBlock === institutionBlock ? stripDateAndTrailingPunctuation(institutionBlock.text, dateRangeText?.value ?? "") : institutionBlock.rawText;
        const { institution: inst, location: loc } = splitInstitutionLocation(institutionText);
        institution = makeValue(inst, sectionId, institutionBlock, 0.75);
        if (loc) location = makeValue(loc, sectionId, institutionBlock, 0.7);
      } else {
        reasonCodes.push("two-line-header-no-degree-keyword-disambiguator");
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
