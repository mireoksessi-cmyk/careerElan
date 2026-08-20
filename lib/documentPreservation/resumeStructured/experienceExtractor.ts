/*
  TASK 4 - Experience/Volunteer entry extraction. Shared by both
  professional_experience and volunteer_experience (spec section 9/10) -
  the caller passes isVolunteer and this module never itself decides
  which array an entry belongs to.

  Entry-boundary algorithm (verified against real fixtures, not
  invented in the abstract):
  - bench/resume-A-junior-ats.pdf, bench/resume-C-mid-ats.pdf, threepage-
    pdf-resume.pdf, regtest1-regulated-nurse-resume.docx, word-docx-
    resume.docx all use a two-line header ("Role" then "Company,
    Location - Date") - IMPORTANTLY, bench-C and threepage have FIVE and
    SIX entries respectively with ZERO bullets (Phase 1 line-grouping
    never marked their description lines as blockType "bullet" for
    those PDFs) - description sentences instead wrap across several
    consecutive plain "paragraph" blocks. A naive "new entry after a
    bullet" rule would silently merge all of bench-C's 5 jobs into one.
  - google-docs-resume.docx uses a ONE-line self-contained header
    ("Role, Company, Location (Date)") with plain description
    paragraphs, no bullets, two entries.
  - generated-table-resume.pdf uses "Company" then "Role | Date" -
    ORGANIZATION FIRST, the opposite line order from every other
    sampled fixture.

  Because of this real variety, boundaries are detected by a forward
  scan with 1-token lookahead: a block starts a new entry if it itself
  matches a date-range pattern, OR it "looks like a header line" (short,
  no terminal sentence punctuation) AND the very next non-bullet block
  matches a date-range pattern. This correctly separates wrapped
  description-sentence fragments (which are either long, or end in
  terminal punctuation, or are not immediately followed by a date line)
  from real entry-header lines, without needing bullets at all.
*/
import type { SemanticContentBlock } from "../losslessSemantic/types";
import { traceFromBlock, traceFromBlocks, mergeTraces } from "./sourceTrace";
import { entryId, bulletId } from "./ids";
import { isDateRangeLine, extractDateParts as extractDatePartsShared } from "./dateRangeParsing";
import { splitOrganizationLocation } from "./splitOrganizationLocation";
import { normalizeBulletPresentation } from "./bulletPresentation";
import { buildHierarchicalContent } from "./hierarchicalGrouping";
import type { ExperienceEntry, StructuredTextValue } from "./types";

const MAX_HEADER_LINE_LENGTH = 90;
const SENTENCE_END_RE = /[.!?]$/;

function looksLikeHeaderLine(block: SemanticContentBlock): boolean {
  const text = block.text.trim();
  return block.blockType !== "bullet" && text.length > 0 && text.length <= MAX_HEADER_LINE_LENGTH && !SENTENCE_END_RE.test(text);
}

export type EntryRange = {
  headerBlockIndices: number[];
  bodyBlockIndices: number[];
};

/*
  Pure segmentation - returns index ranges into `blocks`, never mutates
  or reorders. If NO date-range line exists anywhere (a genuinely
  date-less document - spec's own required test case), the entire block
  set becomes ONE entry rather than guessing false boundaries.
*/
export function segmentEntryRanges(blocks: SemanticContentBlock[]): EntryRange[] {
  if (blocks.length === 0) return [];
  if (!blocks.some((b) => b.blockType !== "bullet" && isDateRangeLine(b.text))) {
    return [{ headerBlockIndices: [0], bodyBlockIndices: blocks.slice(1).map((_, i) => i + 1) }];
  }

  const ranges: EntryRange[] = [];
  let i = 0;
  const n = blocks.length;

  function isNewEntryStart(index: number): boolean {
    if (index >= n) return false;
    const block = blocks[index];
    if (block.blockType === "bullet") return false;
    if (isDateRangeLine(block.text)) return true;
    const next = blocks[index + 1];
    if (looksLikeHeaderLine(block) && next !== undefined && next.blockType !== "bullet" && isDateRangeLine(next.text)) return true;
    return isStackedRoleHeader(index);
  }

  /*
    A header stacked over three lines - role, then organization, then
    the date on its own. The two-line shapes above cannot see it: the
    line after the role is the organization, not a date, so the role
    either falls out as a date-less entry of its own or is swallowed as
    body text by the entry above it, and every job loses its title.

    Shape alone is far too weak to claim it. Three short unpunctuated
    lines before a date line are also exactly what ordinary description
    prose looks like in a resume that uses no bullets, and reading the
    last two sentences of one job as the title and employer of the next
    is a worse failure than the one being fixed. So the document has to
    show that the first line is a title and not a sentence: it must be
    set LARGER than the organization line beneath it, which is what a
    stacked header does and what running prose never does. Both sizes
    have to be known - absent that evidence the shape is left alone
    rather than guessed at. The comparison is between two lines of the
    same document, so no point size is assumed anywhere.
  */
  function isStackedRoleHeader(index: number): boolean {
    if (index + 2 >= n) return false;
    const roleLine = blocks[index];
    const organizationLine = blocks[index + 1];
    const dateLine = blocks[index + 2];
    if (!looksLikeHeaderLine(roleLine) || isDateRangeLine(roleLine.text)) return false;
    if (organizationLine.blockType === "bullet" || !looksLikeHeaderLine(organizationLine) || isDateRangeLine(organizationLine.text)) return false;
    if (dateLine.blockType === "bullet" || !isDateRangeLine(dateLine.text)) return false;
    const roleFontSize = roleLine.style?.fontSize;
    const organizationFontSize = organizationLine.style?.fontSize;
    if (typeof roleFontSize !== "number" || typeof organizationFontSize !== "number") return false;
    return roleFontSize > organizationFontSize;
  }

  /*
    Phase 5D.1 - date-FIRST two-line header: blocks[i] is itself a
    self-contained "Role, Date" line, and blocks[i+1] is a separate,
    non-date "Company, Location" line immediately after it. Guarded
    against misreading blocks[i+1] as this entry's org/location line
    when it is actually the ROLE half of the NEXT entry's own,
    dominant role-first/date-second header (blocks[i+2] itself has a
    date) - that existing, more common shape must keep winning.
  */
  function isDateFirstTwoLineHeader(index: number): boolean {
    if (index + 1 >= n) return false;
    const first = blocks[index];
    const next = blocks[index + 1];
    if (!isDateRangeLine(first.text) || !looksLikeHeaderLine(first)) return false;
    if (next.blockType === "bullet" || isDateRangeLine(next.text) || !looksLikeHeaderLine(next)) return false;
    const afterNext = blocks[index + 2];
    if (afterNext && afterNext.blockType !== "bullet" && isDateRangeLine(afterNext.text)) return false;
    return true;
  }

  while (i < n) {
    const headerBlockIndices: number[] = [i];
    let headerEnd = i;
    if (!isDateRangeLine(blocks[i].text) && i + 1 < n && blocks[i + 1].blockType !== "bullet" && isDateRangeLine(blocks[i + 1].text) && looksLikeHeaderLine(blocks[i])) {
      headerEnd = i + 1;
      headerBlockIndices.push(i + 1);
    } else if (isStackedRoleHeader(i)) {
      headerEnd = i + 2;
      headerBlockIndices.push(i + 1, i + 2);
    } else if (isDateFirstTwoLineHeader(i)) {
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
  return {
    value,
    confidence,
    extractionMethod: "pattern-rule",
    source: traceFromBlock(sectionId, block),
  };
}

const extractDateParts = extractDatePartsShared;

function buildFieldsFromHeader(
  sectionId: string,
  headerBlocks: SemanticContentBlock[]
): {
  organization?: StructuredTextValue;
  role?: StructuredTextValue;
  location?: StructuredTextValue;
  dateRangeText?: StructuredTextValue;
  startDateText?: StructuredTextValue;
  endDateText?: StructuredTextValue;
  reasonCodes: string[];
} {
  const reasonCodes: string[] = [];

  if (headerBlocks.length === 1) {
    const block = headerBlocks[0];
    const dateParts = extractDateParts(block.text);
    if (!dateParts) {
      // No date anywhere in a single-line header - too little evidence
      // to safely split role/organization; preserve as rawHeaderText
      // only (handled by the caller).
      reasonCodes.push("single-line-header-no-date-evidence");
      return { reasonCodes };
    }
    const before = block.text.slice(0, block.text.indexOf(dateParts.dateRangeText));
    const cleaned = before.replace(/[([]+$/, "").trim();
    const segments = cleaned.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    const dateValue = makeValue(dateParts.dateRangeText, sectionId, block, 0.85);
    const startValue = dateParts.startDateText ? makeValue(dateParts.startDateText, sectionId, block, 0.8) : undefined;
    const endValue = dateParts.endDateText ? makeValue(dateParts.endDateText, sectionId, block, 0.8) : undefined;
    if (segments.length >= 3) {
      // "Role, Company, Location" (google-docs-resume.docx real shape)
      reasonCodes.push("single-line-header-comma-split");
      return {
        role: makeValue(segments[0], sectionId, block, 0.7),
        organization: makeValue(segments[1], sectionId, block, 0.7),
        location: makeValue(segments.slice(2).join(", "), sectionId, block, 0.65),
        dateRangeText: dateValue,
        startDateText: startValue,
        endDateText: endValue,
        reasonCodes,
      };
    }
    reasonCodes.push("single-line-header-insufficient-comma-evidence");
    return { dateRangeText: dateValue, startDateText: startValue, endDateText: endValue, reasonCodes };
  }

  // Phase 5D.1 - date-first two-line header: headerBlocks[0] is itself
  // a self-contained "Role, Date" line (segmentEntryRanges only groups
  // this shape via isDateFirstTwoLineHeader), headerBlocks[1] is the
  // separate, non-date "Company[, Location]" line. Handled before the
  // (dominant, pre-existing) "headerBlocks[0] has no date" shape below,
  // since that shape's own logic assumes headerBlocks[0] never has a
  // date - true for every case that reaches it once this branch has
  // first claimed the date-first shape.
  if (isDateRangeLine(headerBlocks[0].text)) {
    const [roleBlock, orgBlock] = headerBlocks;
    const dateParts = extractDateParts(roleBlock.text);
    if (!dateParts) {
      reasonCodes.push("two-line-header-missing-expected-date");
      return { reasonCodes };
    }
    const dateStartIndex = roleBlock.text.indexOf(dateParts.dateRangeText);
    const dateValue = makeValue(dateParts.dateRangeText, sectionId, roleBlock, 0.85);
    const startValue = dateParts.startDateText ? makeValue(dateParts.startDateText, sectionId, roleBlock, 0.8) : undefined;
    const endValue = dateParts.endDateText ? makeValue(dateParts.endDateText, sectionId, roleBlock, 0.8) : undefined;

    const roleText = roleBlock.text.slice(0, dateStartIndex).trim().replace(/[,]+$/, "").trim();
    const roleClean = roleText.length > 0 && !/[/\d]$/.test(roleText);

    const { organization, location } = splitOrganizationLocation(orgBlock.rawText);
    reasonCodes.push("two-line-header-date-first-role-then-organization-location");
    return {
      role: roleClean ? makeValue(roleText, sectionId, roleBlock, 0.75) : undefined,
      organization: makeValue(organization, sectionId, orgBlock, 0.75),
      location: location ? makeValue(location, sectionId, orgBlock, 0.7) : undefined,
      dateRangeText: dateValue,
      startDateText: startValue,
      endDateText: endValue,
      reasonCodes,
    };
  }

  /*
    Stacked three-line header - role, organization[, location], date.
    Only segmentEntryRanges' own isStackedRoleHeader groups this shape,
    and it has already established the typographic evidence, so each
    line simply goes to the parser that already owns it.
  */
  if (headerBlocks.length === 3) {
    const [roleBlock, organizationBlock, stackedDateBlock] = headerBlocks;
    const stackedDateParts = extractDateParts(stackedDateBlock.text);
    if (!stackedDateParts) {
      reasonCodes.push("three-line-header-missing-expected-date");
      return { reasonCodes };
    }
    const { organization, location } = splitOrganizationLocation(organizationBlock.rawText);
    reasonCodes.push("three-line-header-role-organization-date");
    return {
      role: makeValue(roleBlock.rawText, sectionId, roleBlock, 0.75),
      organization: makeValue(organization, sectionId, organizationBlock, 0.75),
      location: location ? makeValue(location, sectionId, organizationBlock, 0.7) : undefined,
      dateRangeText: makeValue(stackedDateParts.dateRangeText, sectionId, stackedDateBlock, 0.85),
      startDateText: stackedDateParts.startDateText ? makeValue(stackedDateParts.startDateText, sectionId, stackedDateBlock, 0.8) : undefined,
      endDateText: stackedDateParts.endDateText ? makeValue(stackedDateParts.endDateText, sectionId, stackedDateBlock, 0.8) : undefined,
      reasonCodes,
    };
  }

  // Two-line header: headerBlocks[0] has no date, headerBlocks[1] has the date.
  const [firstBlock, dateBlock] = headerBlocks;
  const dateParts = extractDateParts(dateBlock.text);
  if (!dateParts) {
    reasonCodes.push("two-line-header-missing-expected-date");
    return { reasonCodes };
  }
  const before = dateBlock.text.slice(0, dateBlock.text.indexOf(dateParts.dateRangeText));
  const dateValue = makeValue(dateParts.dateRangeText, sectionId, dateBlock, 0.85);
  const startValue = dateParts.startDateText ? makeValue(dateParts.startDateText, sectionId, dateBlock, 0.8) : undefined;
  const endValue = dateParts.endDateText ? makeValue(dateParts.endDateText, sectionId, dateBlock, 0.8) : undefined;

  // Disambiguator verified against real fixtures: when the date-bearing
  // line ALSO contains a comma before the date (e.g. "Northgate Consumer
  // Brands, Mississauga, ON - Jun 2023 - Present"), that line is
  // "Company[, Location]" and line 1 is the role (the dominant real
  // pattern - bench-A/C/E, threepage, word-docx-resume, regtest1). When
  // the date line has NO comma (e.g. generated-table-resume.pdf's
  // "Software Engineer | 2019-01 - Present"), line 1 is instead the
  // organization and the date line's own text (minus the date) is the
  // role - the pipe-delimited minority pattern.
  if (before.includes(",")) {
    reasonCodes.push("two-line-header-role-first-company-comma-location");
    const { organization, location } = splitOrganizationLocation(before);
    return {
      role: makeValue(firstBlock.rawText, sectionId, firstBlock, 0.75),
      organization: makeValue(organization, sectionId, dateBlock, 0.75),
      location: location ? makeValue(location, sectionId, dateBlock, 0.7) : undefined,
      dateRangeText: dateValue,
      startDateText: startValue,
      endDateText: endValue,
      reasonCodes,
    };
  }

  reasonCodes.push("two-line-header-organization-first-no-comma-on-date-line");
  const roleFromDateLine = before.trim().replace(/[|]+$/, "").trim();
  return {
    organization: makeValue(firstBlock.rawText, sectionId, firstBlock, 0.6),
    role: roleFromDateLine.length > 0 ? makeValue(roleFromDateLine, sectionId, dateBlock, 0.6) : undefined,
    dateRangeText: dateValue,
    startDateText: startValue,
    endDateText: endValue,
    reasonCodes,
  };
}

export function extractExperienceEntries(sectionId: string, bodyBlocks: SemanticContentBlock[], isVolunteer: boolean): ExperienceEntry[] {
  const ranges = segmentEntryRanges(bodyBlocks);

  return ranges.map((range, index) => {
    const headerBlocks = range.headerBlockIndices.map((i) => bodyBlocks[i]);
    const bodyRunBlocks = range.bodyBlockIndices.map((i) => bodyBlocks[i]);

    const fields = buildFieldsFromHeader(sectionId, headerBlocks);

    const bullets = bodyRunBlocks
      .filter((b) => b.blockType === "bullet" && b.rawText.length > 0)
      .map((b, bi) => ({
        id: bulletId(entryId(sectionId, "experience", index), bi),
        text: normalizeBulletPresentation(b.rawText, { blockType: b.blockType }).displayText,
        source: traceFromBlock(sectionId, b),
      }));

    const descriptionParagraphs = bodyRunBlocks
      .filter((b) => b.blockType !== "bullet" && b.rawText.length > 0)
      .map((b) => makeValue(normalizeBulletPresentation(b.rawText, { blockType: b.blockType }).displayText, sectionId, b, 0.6));

    // Phase 5D.3A - same bodyRunBlocks, in their original order, each
    // tagged with its own blockType instead of split into the two
    // arrays above. See types.ts's own comment on why renderers use
    // this instead of bullets/descriptionParagraphs.
    const content = bodyRunBlocks
      .filter((b) => b.rawText.length > 0)
      .map((b, ci) => {
        const normalized = normalizeBulletPresentation(b.rawText, { blockType: b.blockType });
        return {
          id: `${entryId(sectionId, "experience", index)}-content-${ci}`,
          kind: b.blockType === "bullet" ? ("bullet" as const) : ("paragraph" as const),
          text: normalized.displayText,
          source: traceFromBlock(sectionId, b),
        };
      });

    const allEntryBlocks = [...headerBlocks, ...bodyRunBlocks];
    const isUncertain = fields.organization === undefined || fields.role === undefined;

    // Phase 5D.7 TASK C - built from the SAME bodyRunBlocks/content
    // arrays above (same order, same indices) - see
    // hierarchicalGrouping.ts's own header comment. Additive only:
    // content[] above stays the complete flat list every existing
    // consumer already relies on.
    const bodyContentBlocks = bodyRunBlocks
      .filter((b) => b.rawText.length > 0)
      .map((b, ci) => ({ id: `${entryId(sectionId, "experience", index)}-content-${ci}`, text: content[ci]?.text ?? b.rawText, source: traceFromBlock(sectionId, b) }));
    const hierarchy = buildHierarchicalContent(
      bodyRunBlocks.filter((b) => b.rawText.length > 0),
      bodyContentBlocks
    );

    return {
      id: entryId(sectionId, "experience", index),
      organization: fields.organization,
      role: fields.role,
      location: fields.location,
      startDateText: fields.startDateText,
      endDateText: fields.endDateText,
      dateRangeText: fields.dateRangeText,
      bullets,
      descriptionParagraphs,
      content,
      hierarchicalContent: hierarchy.nodes,
      hasHierarchicalStructure: hierarchy.hasHierarchy,
      rawHeaderText: headerBlocks.map((b) => b.rawText).join("\n"),
      source: mergeTraces(traceFromBlocks(sectionId, allEntryBlocks)),
      isVolunteer,
      isUncertain,
      reasonCodes: fields.reasonCodes,
    };
  });
}
