/*
  TASK 6 - Award entry extraction. Section 14 of the spec. Real shape
  (lossless-synthetic/f1): "Northline Media Rising Star Award, 2022" -
  one bullet per award, "Name, Year". Reuses credentialExtractor.ts's
  date-anchored clustering (a name can also wrap across lines the same
  way a certification can).
*/
import type { SemanticContentBlock } from "../losslessSemantic/types";
import { traceFromBlock, traceFromBlocks, mergeTraces } from "./sourceTrace";
import { entryId } from "./ids";
import { hasDateEvidence, extractDateParts } from "./dateRangeParsing";
import type { AwardEntry, StructuredTextValue } from "./types";

const BULLET_PREFIX_RE = /^[•\-*◦▪·‣⁃]\s+/;

function stripBullet(text: string): string {
  return text.replace(BULLET_PREFIX_RE, "").trim();
}

function makeValue(value: string, sectionId: string, block: SemanticContentBlock, confidence: number): StructuredTextValue {
  return { value, confidence, extractionMethod: "pattern-rule", source: traceFromBlock(sectionId, block) };
}

function clusterEntries(blocks: SemanticContentBlock[]): number[][] {
  const clusters: number[][] = [];
  let pending: number[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.rawText.length === 0) continue;
    pending.push(i);
    if (hasDateEvidence(block.text) || block.blockType === "bullet") {
      clusters.push(pending);
      pending = [];
    }
  }
  if (pending.length > 0) clusters.push(pending);
  return clusters;
}

export function extractAwardEntries(sectionId: string, bodyBlocks: SemanticContentBlock[]): AwardEntry[] {
  const relevant = bodyBlocks.filter((b) => b.blockType !== "heading");
  const clusters = clusterEntries(relevant);

  return clusters.map((indices, index) => {
    const blocks = indices.map((i) => relevant[i]);
    const combinedText = blocks.map((b) => stripBullet(b.text)).join(" ");
    const lastBlock = blocks[blocks.length - 1];
    const reasonCodes: string[] = [];

    const dateParts = extractDateParts(combinedText);
    let name: StructuredTextValue | undefined;
    let dateText: StructuredTextValue | undefined;

    if (dateParts) {
      dateText = makeValue(dateParts.dateRangeText, sectionId, lastBlock, 0.75);
      const nameText = combinedText.slice(0, combinedText.indexOf(dateParts.dateRangeText)).trim().replace(/[,–—-]+$/, "").trim();
      if (nameText.length > 0) name = makeValue(nameText, sectionId, lastBlock, 0.7);
      reasonCodes.push("date-anchored-cluster");
    } else {
      if (combinedText.length > 0) name = makeValue(combinedText, sectionId, lastBlock, 0.55);
      reasonCodes.push("no-date-evidence-in-cluster");
    }

    return {
      id: entryId(sectionId, "award", index),
      name,
      issuer: undefined,
      dateText,
      details: [],
      // Phase 5D.3A - mirrors `details` 1:1 (see types.ts's own comment
      // on AwardEntry.content: this extractor never separates a detail
      // line from the name/date-bearing line today).
      content: [],
      rawHeaderText: blocks.map((b) => b.rawText).join("\n"),
      source: mergeTraces(traceFromBlocks(sectionId, blocks)),
      isUncertain: name === undefined,
      reasonCodes,
    };
  });
}
