/*
  D안 Phase 1 - Design Token extraction. Kept as a standalone module
  (not merged into buildVisualTree.ts) per this Phase's own "Tree와
  분리" instruction - a Renderer can consume DesignTokens without ever
  touching OriginalVisualTree, and vice versa.

  Deliberately does NOT import any color/font constant from
  DocumentRenderer.tsx / pdfDocumentExport.ts / docxDocumentExport.ts -
  this Phase's own explicit instruction is not to integrate those three
  renderers' hardcoded palettes here. The `fallback` values below are a
  new, independent, neutral default set that only the new Original
  Layout Renderer (originalLayoutRenderer.ts) reads.
*/
import type { DocumentLayerModel } from "../contentBox/types";
import type { ElementMetadata, LayoutAnalysisResult } from "../layoutAnalysis/types";
import type { DesignTokens, DesignTokenValues } from "./types";

const FALLBACK: DesignTokenValues = {
  pageMargins: null,
  defaultFontFamily: "helvetica",
  defaultFontSize: 10,
  headingFontFamily: "helvetica",
  headingFontSize: 12,
  headingWeight: "bold",
  bodyColor: "#000000",
  primaryColor: "#000000",
  secondaryColor: "#444444",
  dividerThickness: 0.6,
  sectionGap: null,
  columnGap: null,
};

function mostCommon<T>(values: T[]): T | null {
  if (values.length === 0) return null;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const [v, count] of counts) {
    if (count > bestCount) {
      best = v;
      bestCount = count;
    }
  }
  return best;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function allElements(layoutResult: LayoutAnalysisResult): ElementMetadata[] {
  return layoutResult.pages.flatMap((p) => p.elements);
}

export function buildDesignTokens(
  model: DocumentLayerModel,
  layoutResult: LayoutAnalysisResult
): DesignTokens {
  const elements = allElements(layoutResult);
  const textElements = elements.filter((e) => e.type === "text" && e.text && e.text.trim().length > 0);

  const headingBoxes = model.boxes.filter((b) => b.role === "heading");
  const headingElements = headingBoxes.flatMap((b) => b.elements).filter((e) => e.type === "text");

  // Real extracted values only - never a guessed substitute for a field
  // the source format structurally cannot supply (PDF: fontWeight/color,
  // see pdfLayoutAnalyzer.ts's own disclosure). A field stays null here
  // exactly when no real element in this document ever reported it.
  const extracted: DesignTokenValues = {
    pageMargins: layoutResult.pages[0]?.inferredMargins
      ? {
          top: layoutResult.pages[0].inferredMargins.top,
          left: layoutResult.pages[0].inferredMargins.left,
          right: layoutResult.pages[0].inferredMargins.right,
          bottom: layoutResult.pages[0].inferredMargins.bottom,
        }
      : null,
    defaultFontFamily: mostCommon(textElements.map((e) => e.fontFamily).filter((v): v is string => !!v)),
    defaultFontSize: mostCommon(textElements.map((e) => e.fontSize).filter((v): v is number => !!v)),
    headingFontFamily: mostCommon(headingElements.map((e) => e.fontFamily).filter((v): v is string => !!v)),
    headingFontSize: mostCommon(headingElements.map((e) => e.fontSize).filter((v): v is number => !!v)),
    headingWeight: mostCommon(headingElements.map((e) => e.fontWeight).filter((v): v is string => !!v)),
    bodyColor: mostCommon(textElements.map((e) => e.color).filter((v): v is string => !!v)),
    primaryColor: mostCommon(headingElements.map((e) => e.color).filter((v): v is string => !!v)),
    // No real source anywhere in this pipeline for a distinct
    // "secondary" accent (DividerInfo carries no color field) - always
    // null from extraction, never invented.
    secondaryColor: null,
    dividerThickness: median(
      model.boxes.flatMap((b) => b.elements).map((e) => e.dividerInfo?.thicknessPx).filter((v): v is number => v != null)
    ),
    sectionGap: median(computeSectionGaps(model)),
    columnGap: median(computeColumnGaps(model)),
  };

  return { extracted, fallback: FALLBACK };
}

/*
  Vertical gap between the end of one editable box and the start of the
  next box of a DIFFERENT role, same page - a real, derivable measure of
  "how much whitespace this document puts between sections." Not a new
  extraction (reuses existing boundingBox values), just a new
  aggregation, per this Phase's own STEP2/STEP3 distinction.
*/
function computeSectionGaps(model: DocumentLayerModel): number[] {
  const byPage = new Map<number, typeof model.editableBoxes>();
  for (const box of model.editableBoxes) {
    if (!box.boundingBox) continue;
    const list = byPage.get(box.page) ?? [];
    list.push(box);
    byPage.set(box.page, list);
  }

  const gaps: number[] = [];
  for (const boxes of byPage.values()) {
    const sorted = [...boxes].sort((a, b) => (a.boundingBox!.y ?? 0) - (b.boundingBox!.y ?? 0));
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      if (current.role === next.role) continue;
      const gap = next.boundingBox!.y - (current.boundingBox!.y + current.boundingBox!.height);
      if (gap > 0 && gap < current.boundingBox!.height * 3) gaps.push(gap);
    }
  }
  return gaps;
}

function computeColumnGaps(model: DocumentLayerModel): number[] {
  const sidebarRegions = model.templateRegions.filter((r) => r.role === "sidebar");
  if (sidebarRegions.length === 0) return [];

  const gaps: number[] = [];
  for (const region of sidebarRegions) {
    const sidebarRightEdge = region.boundingBox.x + region.boundingBox.width;
    const mainBoxesSamePage = model.editableBoxes.filter(
      (b) => b.page === region.page && b.boundingBox && b.boundingBox.x >= sidebarRightEdge
    );
    for (const box of mainBoxesSamePage) {
      const gap = box.boundingBox!.x - sidebarRightEdge;
      if (gap > 0 && gap < region.boundingBox.width) gaps.push(gap);
    }
  }
  return gaps;
}
