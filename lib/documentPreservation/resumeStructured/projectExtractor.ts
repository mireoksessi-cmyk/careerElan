/*
  TASK 6 - Project entry extraction. Section 13 of the spec.
  Real-fixture shape (lossless-synthetic/f4-projects.docx): "Shift
  Scheduler" (short, no bullet) then bullet(s), repeating - no dates.
  Boundary: any short, non-sentence-ending, non-bullet line becomes a
  new project name; everything until the next such line is its body.
*/
import type { SemanticContentBlock } from "../losslessSemantic/types";
import { traceFromBlock, traceFromBlocks, mergeTraces } from "./sourceTrace";
import { entryId, bulletId } from "./ids";
import { extractDateParts } from "./dateRangeParsing";
import type { ProjectEntry, StructuredTextValue } from "./types";

const MAX_HEADER_LINE_LENGTH = 90;
const SENTENCE_END_RE = /[.!?]$/;
const TECH_STACK_RE = /\busing\s+([A-Za-z0-9.#+/\- ,]+?)\.?\s*$/i;

function looksLikeHeaderLine(block: SemanticContentBlock): boolean {
  const text = block.text.trim();
  return block.blockType !== "bullet" && text.length > 0 && text.length <= MAX_HEADER_LINE_LENGTH && !SENTENCE_END_RE.test(text);
}

function makeValue(value: string, sectionId: string, block: SemanticContentBlock, confidence: number): StructuredTextValue {
  return { value, confidence, extractionMethod: "pattern-rule", source: traceFromBlock(sectionId, block) };
}

type ProjectRange = { nameIndex: number; bodyIndices: number[] };

function segmentProjectRanges(blocks: SemanticContentBlock[]): ProjectRange[] {
  const ranges: ProjectRange[] = [];
  let i = 0;
  const n = blocks.length;
  while (i < n) {
    const nameIndex = i;
    let k = i + 1;
    while (k < n) {
      if (blocks[k].blockType === "bullet") {
        k++;
        continue;
      }
      if (looksLikeHeaderLine(blocks[k])) break;
      k++;
    }
    const bodyIndices: number[] = [];
    for (let j = i + 1; j < k; j++) bodyIndices.push(j);
    ranges.push({ nameIndex, bodyIndices });
    i = k;
  }
  return ranges;
}

function extractTechnologies(sectionId: string, blocks: SemanticContentBlock[]): StructuredTextValue[] {
  for (const block of blocks) {
    const match = block.text.match(TECH_STACK_RE);
    if (match) {
      return match[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => makeValue(s, sectionId, block, 0.7));
    }
  }
  return [];
}

export function extractProjectEntries(sectionId: string, bodyBlocks: SemanticContentBlock[]): ProjectEntry[] {
  const relevant = bodyBlocks.filter((b) => b.rawText.length > 0);
  if (relevant.length === 0) return [];
  const ranges = segmentProjectRanges(relevant);

  return ranges.map((range, index) => {
    const nameBlock = relevant[range.nameIndex];
    const bodyBlocksForEntry = range.bodyIndices.map((i) => relevant[i]);
    const reasonCodes: string[] = [];

    const dateParts = extractDateParts(nameBlock.text);
    const nameText = dateParts ? nameBlock.text.slice(0, nameBlock.text.indexOf(dateParts.dateRangeText)).trim().replace(/[,–—-]+$/, "").trim() : nameBlock.rawText;
    const name = nameText.length > 0 ? makeValue(nameText, sectionId, nameBlock, 0.7) : undefined;
    const dateRangeText = dateParts ? makeValue(dateParts.dateRangeText, sectionId, nameBlock, 0.7) : undefined;
    if (!name) reasonCodes.push("empty-project-name-after-date-strip");

    const bullets = bodyBlocksForEntry
      .filter((b) => b.blockType === "bullet")
      .map((b, bi) => ({ id: bulletId(entryId(sectionId, "project", index), bi), text: b.rawText, source: traceFromBlock(sectionId, b) }));
    const descriptionParagraphs = bodyBlocksForEntry.filter((b) => b.blockType !== "bullet").map((b) => makeValue(b.rawText, sectionId, b, 0.6));
    const technologies = extractTechnologies(sectionId, bodyBlocksForEntry);

    // Phase 5D.3A - see ExperienceEntry.content's own comment (types.ts).
    const content = bodyBlocksForEntry.map((b, ci) => ({
      id: `${entryId(sectionId, "project", index)}-content-${ci}`,
      kind: b.blockType === "bullet" ? ("bullet" as const) : ("paragraph" as const),
      text: b.rawText,
      source: traceFromBlock(sectionId, b),
    }));

    const allBlocks = [nameBlock, ...bodyBlocksForEntry];

    return {
      id: entryId(sectionId, "project", index),
      name,
      role: undefined,
      dateRangeText,
      technologies,
      bullets,
      descriptionParagraphs,
      content,
      rawHeaderText: nameBlock.rawText,
      source: mergeTraces(traceFromBlocks(sectionId, allBlocks)),
      isUncertain: name === undefined,
      reasonCodes,
    };
  });
}
