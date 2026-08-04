/*
  TASK 3 - Block Adapter. Converts a LayoutAnalysisResult (Phase 2 -
  lib/documentPreservation/layoutAnalysis, reused as-is, not
  reimplemented) directly into this module's own SemanticContentBlock[],
  at LINE granularity.

  Reuse decision, corrected after a real test failure (see the final
  report's "Files Added/Modified" / risk-5 section for the evidence):
  this module does NOT consume ContentBox/generateContentBoxes
  (lib/documentPreservation/contentBox). That generator's own
  groupLinesIntoBlocks() already MERGES a section heading together with
  every paragraph/bullet under it into one ContentBox, and assigns that
  merged box's `role` directly to the section type (e.g. "summary"), not
  to a separate "heading" role - confirmed empirically against
  standard-pdf-resume.pdf, where role:"heading" never appears at all.
  That granularity is correct for the Document Preservation Engine's own
  purpose (regenerating a resume back into an existing template), but
  wrong for this module: TASK 4 needs to run its OWN heading-candidate
  SCORING per LINE (font-size deltas, spacing, alignment, etc.) to catch
  unknown/custom headings the existing role classifier's dictionary-only
  approach cannot - it cannot do that against an already-merged block.

  So: PDF gets its own line-grouping here (groupIntoLines below) -
  written fresh in this file rather than importing the existing
  groupIntoLines() from pdfContentBoxGenerator.ts, because that function
  is not exported and this round's safety rules forbid modifying ANY
  existing file (even an additive export) - see "절대 금지" in the
  round's own instructions. The ALGORITHM is intentionally the same
  technique (Y-then-X sort, same-line = vertical-center overlap ratio +
  horizontal-gap multiplier, tuned to the same real 2-column false-merge
  bug documented in that file) - reused conceptually, not copy-pasted,
  since the exact tolerance values are what make it safe against the
  same real 2-column fixtures this repo already has regression coverage
  for. DOCX needs no re-grouping: docxContentBoxGenerator.ts's own
  comment already establishes that Phase 2's DOCX elements are already
  one-per-block-level-HTML-tag (mammoth collapses <p>/<h1-6>/<li> into
  one "text" ElementMetadata each) - i.e. already line-equivalent - so
  DOCX elements are used 1:1, matching that established convention.

  Heading/section-boundary decisions are OUT of scope for this file on
  purpose - see sectionBoundaryDetector.ts (TASK 4). This file only
  determines the few structural block types it can decide with zero
  section-semantics knowledge: "bullet" (a real bullet-glyph prefix) and
  "unknown" (a non-text ContentBox-equivalent or fully empty line).
  Everything else starts as "paragraph" and may be promoted to
  "heading"/"entry-header" by TASK 4, which mutates blockType in place
  once it has real scoring evidence (see that file for why).
*/
import type { ElementMetadata, LayoutAnalysisResult, PageMetadata } from "../layoutAnalysis/types";
import type { SemanticBlockBBox, SemanticBlockStyle, SemanticBlockType, SemanticContentBlock } from "./types";
import { blockId, elementId } from "./ids";

const BULLET_PREFIX_RE = /^[•\-*◦▪·‣⁃]\s+/;

// Same tuning as pdfContentBoxGenerator.ts's own groupIntoLines (see
// this file's header comment for why these are not imported).
const SAME_LINE_OVERLAP_RATIO = 0.5;
const MAX_LINE_HORIZONTAL_GAP_MULTIPLIER = 2.5;

function normalizeWhitespace(text: string): string {
  return text.replace(/[ \t]+/g, " ").replace(/\r\n/g, "\n").trim();
}

function groupIntoLines(elements: ElementMetadata[]): ElementMetadata[][] {
  const sorted = [...elements].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));

  const lines: ElementMetadata[][] = [];

  for (const element of sorted) {
    const lastLine = lines[lines.length - 1];
    const elementHeight = element.height ?? element.fontSize ?? 1;

    if (lastLine) {
      const reference = lastLine[0];
      const referenceHeight = reference.height ?? reference.fontSize ?? 1;
      const shorterHeight = Math.min(elementHeight, referenceHeight);
      const verticalDistance = Math.abs((element.y ?? 0) - (reference.y ?? 0));

      const rightmostSoFar = Math.max(...lastLine.map((e) => (e.x ?? 0) + (e.width ?? 0)));
      const horizontalGap = (element.x ?? 0) - rightmostSoFar;

      if (
        verticalDistance <= shorterHeight * SAME_LINE_OVERLAP_RATIO &&
        Math.abs(horizontalGap) <= shorterHeight * MAX_LINE_HORIZONTAL_GAP_MULTIPLIER
      ) {
        lastLine.push(element);
        continue;
      }
    }

    lines.push([element]);
  }

  for (const line of lines) {
    line.sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
  }

  return lines;
}

function lineBounds(line: ElementMetadata[]): SemanticBlockBBox | undefined {
  const xs = line.map((e) => e.x);
  const ys = line.map((e) => e.y);
  if (xs.some((x) => x === null) || ys.some((y) => y === null)) return undefined;

  const left = Math.min(...(xs as number[]));
  const top = Math.min(...(ys as number[]));
  const right = Math.max(...line.map((e) => (e.x ?? 0) + (e.width ?? 0)));
  const bottom = Math.max(...line.map((e) => (e.y ?? 0) + (e.height ?? e.fontSize ?? 1)));

  return { x: left, y: top, width: right - left, height: bottom - top };
}

function lineText(line: ElementMetadata[]): string {
  return line
    .map((e) => e.text ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function styleFromElement(element: ElementMetadata | undefined): SemanticBlockStyle | undefined {
  if (!element) return undefined;
  const style: SemanticBlockStyle = {};
  if (element.fontSize !== null) style.fontSize = element.fontSize;
  if (element.fontWeight !== null) style.fontWeight = element.fontWeight;
  if (element.fontFamily !== null) style.fontFamily = element.fontFamily;
  // italic/underline/alignment are not fields ElementMetadata carries
  // (see layoutAnalysis/types.ts) - left unset rather than guessed.
  return Object.keys(style).length > 0 ? style : undefined;
}

function classifyBlockType(rawText: string, elementType: ElementMetadata["type"]): SemanticBlockType {
  if (elementType !== "text") return "unknown";
  if (rawText.length === 0) return "unknown";
  if (BULLET_PREFIX_RE.test(rawText)) return "bullet";
  return "paragraph";
}

export function buildElementIdentityMap(layoutResult: LayoutAnalysisResult): WeakMap<ElementMetadata, string> {
  const map = new WeakMap<ElementMetadata, string>();
  for (const page of layoutResult.pages) {
    page.elements.forEach((element, index) => {
      map.set(element, elementId(page.pageNumber, index));
    });
  }
  return map;
}

function resolveIds(elements: ElementMetadata[], identityMap: WeakMap<ElementMetadata, string>): string[] {
  return elements.map((element) => {
    const id = identityMap.get(element);
    if (!id) {
      throw new Error(
        "blockAdapter: element not found in identity map - " +
          "the identity map must be built from the SAME LayoutAnalysisResult.pages the line came from."
      );
    }
    return id;
  });
}

function adaptPage(
  page: PageMetadata,
  identityMap: WeakMap<ElementMetadata, string>
): SemanticContentBlock[] {
  const textElements = page.elements.filter((e) => e.type === "text");
  const nonTextElements = page.elements.filter((e) => e.type !== "text");

  const lines = groupIntoLines(textElements);

  const textBlocks: SemanticContentBlock[] = lines.map((line, index) => {
    const rawText = lineText(line);
    return {
      id: blockId(page.pageNumber, index),
      sourceElementIds: resolveIds(line, identityMap),
      text: normalizeWhitespace(rawText),
      rawText,
      pageIndex: page.pageNumber,
      sourceOrder: index,
      bbox: lineBounds(line),
      style: styleFromElement(line[0]),
      blockType: classifyBlockType(rawText, "text"),
    };
  });

  const nonTextBlocks: SemanticContentBlock[] = nonTextElements.map((element, index) => {
    const rawText = element.text ?? "";
    const sourceOrder = textBlocks.length + index;
    return {
      id: blockId(page.pageNumber, sourceOrder),
      sourceElementIds: resolveIds([element], identityMap),
      text: normalizeWhitespace(rawText),
      rawText,
      pageIndex: page.pageNumber,
      sourceOrder,
      bbox:
        element.x !== null && element.y !== null && element.width !== null && element.height !== null
          ? { x: element.x, y: element.y, width: element.width, height: element.height }
          : undefined,
      style: styleFromElement(element),
      blockType: classifyBlockType(rawText, element.type),
    };
  });

  return [...textBlocks, ...nonTextBlocks];
}

export type BlockAdapterResult = {
  blocks: SemanticContentBlock[];
  identityMap: WeakMap<ElementMetadata, string>;
};

export function adaptLayoutToBlocks(layoutResult: LayoutAnalysisResult): BlockAdapterResult {
  const identityMap = buildElementIdentityMap(layoutResult);
  const blocks = layoutResult.pages.flatMap((page) => adaptPage(page, identityMap));
  return { blocks, identityMap };
}
