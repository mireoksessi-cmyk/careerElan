/*
  TASK 6 - Publication entry extraction. Section 15 of the spec.
  Real shape (lossless-synthetic/f3): "Chandran, P. (2021). Community
  nutrition outreach in rural Nova Scotia. Atlantic Health Journal,
  14(2)." - one full citation per block. Per the spec's own explicit
  instruction ("완벽한 citation parser를 만들려고 하지 않는다"), this
  only extracts fields when a clean "(YYYY)" marker is present, and
  always preserves the full original line in details regardless -
  never dropping the raw citation even when fields are confidently
  split out.

  Phase 5D.3C - Generic Multi-Line Academic Header Recovery Hardening.
  A citation is usually one long sentence-shaped block (ends in a
  period, has many commas) - the OPPOSITE shape of a short label line,
  so this module cannot reuse headerWindow.ts's looksLikeHeaderLine gate
  for its own top-level segmentation the way Education/Credential/Award
  do. Instead: a block that already carries its own date evidence stays
  exactly the single-block citation case above (unchanged, still no
  attempt at a "perfect" citation parser). Only a block with NO date
  evidence of its own is tried against headerWindow.ts's shared window
  collector, recovering Shape H (Publication, Conference, Location,
  Date - four separate short lines) into title/publisherOrVenue/
  dateText instead of leaving every line but the date stranded with
  nothing extracted at all. Either way, `details[]` always ends up with
  every line's own raw text, one entry per line, so no field-level
  ambiguity can ever cause data loss.
*/
import type { SemanticContentBlock } from "../losslessSemantic/types";
import { traceFromBlock, traceFromBlocks, mergeTraces } from "./sourceTrace";
import { entryId } from "./ids";
import { extractDateParts, hasDateEvidence } from "./dateRangeParsing";
import { collectHeaderWindow, classifyWindow, type HeaderWindowLine } from "./headerWindow";
import type { PublicationEntry, StructuredTextValue, EntryContentBlock } from "./types";

const YEAR_PAREN_RE = /\((?:19|20)\d{2}\)/;
const URL_OR_DOI_RE = /(https?:\/\/\S+)|(\bdoi:\s*\S+)/i;
/*
  A generic PUBLICATION-VENUE-category signal ("Conference",
  "Symposium", "Proceedings", "Journal", ...) - the same kind of
  generic lexical class as DEGREE_KEYWORD_RE/INSTITUTION_KEYWORD_RE/
  AUTHORITY_KEYWORD_RE in headerWindow.ts, never a specific
  publication's own name.
*/
const VENUE_KEYWORD_RE = /\b(conference|symposium|proceedings|journal|review|quarterly|bulletin|workshop|congress)\b/i;

function makeValue(value: string, sectionId: string, block: SemanticContentBlock, confidence: number): StructuredTextValue {
  return { value, confidence, extractionMethod: "pattern-rule", source: traceFromBlock(sectionId, block) };
}

function detailsAndContentFor(sectionId: string, blocks: SemanticContentBlock[], entryId0: string): { details: StructuredTextValue[]; content: EntryContentBlock[] } {
  const details = blocks.map((b) => makeValue(b.rawText, sectionId, b, 1));
  const content = blocks.map((b, i) => ({
    id: `${entryId0}-content-${i}`,
    kind: (b.blockType === "bullet" ? "bullet" : "paragraph") as EntryContentBlock["kind"],
    text: b.rawText,
    source: traceFromBlock(sectionId, b),
  }));
  return { details, content };
}

/*
  The single-block citation path (unchanged from before 5D.3C) - one
  Phase 1 block IS the whole citation, never re-derived from a window.
*/
function extractFromSingleBlock(sectionId: string, block: SemanticContentBlock, index: number): PublicationEntry {
  const text = block.rawText;
  const reasonCodes: string[] = [];
  const thisEntryId = entryId(sectionId, "publication", index);

  const yearMatch = text.match(YEAR_PAREN_RE);
  let authors: StructuredTextValue[] = [];
  let title: StructuredTextValue | undefined;
  let dateText: StructuredTextValue | undefined;
  let publisherOrVenue: StructuredTextValue | undefined;

  if (yearMatch && yearMatch.index !== undefined) {
    reasonCodes.push("year-parenthetical-anchor-found");
    const yearIdx = yearMatch.index;
    const authorsPart = text.slice(0, yearIdx).trim().replace(/[.,]+$/, "").trim();
    if (authorsPart.length > 0) authors = [makeValue(authorsPart, sectionId, block, 0.65)];
    dateText = makeValue(yearMatch[0].replace(/[()]/g, ""), sectionId, block, 0.8);

    const afterYear = text.slice(yearIdx + yearMatch[0].length).replace(/^\.\s*/, "").trim();
    const sentences = afterYear.split(". ").map((s) => s.trim()).filter((s) => s.length > 0);
    if (sentences.length >= 1) title = makeValue(sentences[0].replace(/\.$/, ""), sectionId, block, 0.6);
    if (sentences.length >= 2) publisherOrVenue = makeValue(sentences.slice(1).join(". "), sectionId, block, 0.55);
  } else {
    const dateParts = extractDateParts(text);
    if (dateParts) {
      dateText = makeValue(dateParts.dateRangeText, sectionId, block, 0.6);
      reasonCodes.push("general-date-evidence-anchor-found-no-year-parenthetical");
    } else {
      reasonCodes.push("no-year-anchor-preserved-as-detail-only");
    }
  }

  const urlMatch = text.match(URL_OR_DOI_RE);
  const urlOrDoi = urlMatch ? makeValue(urlMatch[0], sectionId, block, 0.75) : undefined;
  const { details, content } = detailsAndContentFor(sectionId, [block], thisEntryId);

  return {
    id: thisEntryId,
    title,
    titles: title ? [title] : [],
    authors,
    publisherOrVenue,
    dateText,
    urlOrDoi,
    details,
    content,
    rawHeaderText: text,
    source: mergeTraces(traceFromBlocks(sectionId, [block])),
    isUncertain: title === undefined,
    reasonCodes,
  };
}

/*
  Phase 5D.3C - Shape H (Publication, Conference, Location, Date): a
  genuine N-line window with no line of its own carrying the citation's
  date. Title/venue are resolved from the window's own non-date lines -
  first unclaimed line is the title, a VENUE_KEYWORD_RE or location-
  shaped line becomes the venue, any further leftover lines join into
  the venue too (never dropped) - and `details[]`/`content[]` mirror
  every window line's own raw text 1:1, so no field-level ambiguity here
  can ever lose text.
*/
function extractFromWindow(sectionId: string, relevant: SemanticContentBlock[], indices: number[], index: number): PublicationEntry {
  const blocks = indices.map((i) => relevant[i]);
  const thisEntryId = entryId(sectionId, "publication", index);
  const reasonCodes: string[] = ["multi-line-window"];

  const classified = classifyWindow(relevant, indices);
  const { dateLines } = classified;

  let dateText: StructuredTextValue | undefined;
  if (dateLines.length > 0) {
    dateText = makeValue(dateLines[0].dateAnchor.dateRangeText, sectionId, dateLines[0].block, 0.7);
    reasonCodes.push("window-date-anchor-found");
  } else {
    reasonCodes.push("no-year-anchor-preserved-as-detail-only");
  }

  type Candidate = { line: HeaderWindowLine; text: string };
  const candidates: Candidate[] = classified.lines.filter((l) => l.remainderText.length > 0).map((l) => ({ line: l, text: l.remainderText }));

  let title: StructuredTextValue | undefined;
  let publisherOrVenue: StructuredTextValue | undefined;
  if (candidates.length > 0) {
    title = makeValue(candidates[0].text, sectionId, candidates[0].line.block, 0.6);
    const venueParts = candidates.slice(1);
    if (venueParts.length > 0) {
      const venueText = venueParts.map((c) => c.text).join(", ");
      publisherOrVenue = makeValue(venueText, sectionId, venueParts[0].line.block, 0.5);
      if (venueParts.some((c) => c.line.hasAuthorityKeyword || VENUE_KEYWORD_RE.test(c.text))) reasonCodes.push("venue-keyword-disambiguated");
    }
  }

  const urlMatch = blocks.map((b) => b.rawText).join(" ").match(URL_OR_DOI_RE);
  const urlOrDoi = urlMatch ? makeValue(urlMatch[0], sectionId, blocks[0], 0.75) : undefined;

  const { details, content } = detailsAndContentFor(sectionId, blocks, thisEntryId);

  return {
    id: thisEntryId,
    title,
    titles: title ? [title] : [],
    authors: [],
    publisherOrVenue,
    dateText,
    urlOrDoi,
    details,
    content,
    rawHeaderText: blocks.map((b) => b.rawText).join("\n"),
    source: mergeTraces(traceFromBlocks(sectionId, blocks)),
    isUncertain: title === undefined,
    reasonCodes,
  };
}

export function extractPublicationEntries(sectionId: string, bodyBlocks: SemanticContentBlock[]): PublicationEntry[] {
  const relevant = bodyBlocks.filter((b) => b.blockType !== "heading" && b.rawText.length > 0);

  const entries: PublicationEntry[] = [];
  let i = 0;
  while (i < relevant.length) {
    const block = relevant[i];
    if (block.blockType === "bullet" || hasDateEvidence(block.text) || YEAR_PAREN_RE.test(block.rawText)) {
      entries.push(extractFromSingleBlock(sectionId, block, entries.length));
      i++;
      continue;
    }

    const window = collectHeaderWindow(relevant, i);
    if (window.length > 1) {
      entries.push(extractFromWindow(sectionId, relevant, window, entries.length));
      i = window[window.length - 1] + 1;
    } else {
      entries.push(extractFromSingleBlock(sectionId, block, entries.length));
      i++;
    }
  }
  return entries;
}
