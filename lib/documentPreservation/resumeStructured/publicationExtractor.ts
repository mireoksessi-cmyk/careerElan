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
*/
import type { SemanticContentBlock } from "../losslessSemantic/types";
import { traceFromBlock, traceFromBlocks, mergeTraces } from "./sourceTrace";
import { entryId } from "./ids";
import type { PublicationEntry, StructuredTextValue } from "./types";

const YEAR_PAREN_RE = /\((?:19|20)\d{2}\)/;
const URL_OR_DOI_RE = /(https?:\/\/\S+)|(\bdoi:\s*\S+)/i;

function makeValue(value: string, sectionId: string, block: SemanticContentBlock, confidence: number): StructuredTextValue {
  return { value, confidence, extractionMethod: "pattern-rule", source: traceFromBlock(sectionId, block) };
}

export function extractPublicationEntries(sectionId: string, bodyBlocks: SemanticContentBlock[]): PublicationEntry[] {
  const relevant = bodyBlocks.filter((b) => b.blockType !== "heading" && b.rawText.length > 0);

  return relevant.map((block, index) => {
    const text = block.rawText;
    const reasonCodes: string[] = [];

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
      reasonCodes.push("no-year-anchor-preserved-as-detail-only");
    }

    const urlMatch = text.match(URL_OR_DOI_RE);
    const urlOrDoi = urlMatch ? makeValue(urlMatch[0], sectionId, block, 0.75) : undefined;

    return {
      id: entryId(sectionId, "publication", index),
      title,
      authors,
      publisherOrVenue,
      dateText,
      urlOrDoi,
      details: [makeValue(text, sectionId, block, 1)],
      rawHeaderText: text,
      source: mergeTraces(traceFromBlocks(sectionId, [block])),
      isUncertain: title === undefined,
      reasonCodes,
    };
  });
}
