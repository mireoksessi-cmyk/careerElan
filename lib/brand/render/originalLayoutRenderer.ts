/*
  D안 Phase 1 - Original Layout Renderer. Draws a brand-new PDF (jsPDF,
  already installed - no new dependency) positioned at the ORIGINAL
  uploaded document's own real coordinates (OriginalVisualTree), instead
  of walking one of the 4 fixed CareerElan templates
  (pdfDocumentExport.ts, untouched by this Phase). Never edits/masks the
  literal original PDF file - this was investigated and rejected in an
  earlier design round (no PDF-content-stream-editing library is
  installed; see that round's own report) in favor of building a NEW
  document from real extracted geometry, the same technique
  pdfDocumentExport.ts already uses for its 4 fixed templates.

  Font fallback: unconditionally "helvetica" (jsPDF's only guaranteed
  built-in Latin font), matching pdfDocumentExport.ts's own established,
  disclosed limitation - no new font file is added here (forbidden this
  Phase - "새 라이브러리 설치 금지").

  Geometry units: OriginalVisualTree bounds are in whatever raw unit the
  source format's own analyzer produced (PDF: pdfjs-dist user-space
  points; DOCX: Playwright-measured CSS px) - never assumed to already
  be millimetres. Each page computes its own scale factor against a
  fixed A4 (210mm) target width, so both source unit systems map
  correctly without the Renderer needing to know which one it received.
*/
import jsPDF from "jspdf";
import type { OriginalVisualNode, OriginalVisualTree, DesignTokens } from "@/lib/documentPreservation/visualTree/types";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
/* Used only when a page's own real width is unknown (0/null) - treats
   the document as PDF-point-sized (595.28pt = 210mm), the majority
   real-world case for this Phase's supported formats. */
const DEFAULT_SOURCE_WIDTH = 595.28;
const LINE_HEIGHT_FACTOR = 1.35;

export type OriginalLayoutOverflowFinding = {
  nodeId: string;
  page: number;
  verdict: "overflow" | "page_bounds";
  overflowMm: number;
  detail: string;
};

export type OriginalLayoutRenderResult = {
  pdf: jsPDF;
  overflowFindings: OriginalLayoutOverflowFinding[];
};

export type RenderOriginalLayoutParams = {
  tree: OriginalVisualTree;
  designTokens: DesignTokens;
  nodeTexts: Record<string, string>;
};

function scaleForPage(pageNode: OriginalVisualNode): number {
  const sourceWidth = pageNode.bounds.width > 0 ? pageNode.bounds.width : DEFAULT_SOURCE_WIDTH;
  return A4_WIDTH_MM / sourceWidth;
}

function resolveFontSize(node: OriginalVisualNode, tokens: DesignTokens, scale: number): number {
  const raw = node.style.fontSize ?? tokens.extracted.defaultFontSize ?? tokens.fallback.defaultFontSize ?? 10;
  const scaled = raw * scale;
  // A visually-usable minimum/maximum regardless of source scale - real
  // documents occasionally report a near-zero or huge fontSize for a
  // single decorative glyph; clamping only affects rendering, never the
  // character budget the AI was given.
  return Math.min(24, Math.max(6, scaled));
}

function drawLeaf(
  pdf: jsPDF,
  node: OriginalVisualNode,
  text: string,
  scale: number,
  tokens: DesignTokens,
  overflowFindings: OriginalLayoutOverflowFinding[]
): void {
  const xMm = node.bounds.x * scale;
  const yMm = node.bounds.y * scale;
  const widthMm = Math.max(5, node.bounds.width * scale);
  const heightMm = Math.max(1, node.bounds.height * scale);
  const fontSizeMm = resolveFontSize(node, tokens, scale);
  const lineHeightMm = (fontSizeMm / 72) * 25.4 * LINE_HEIGHT_FACTOR;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(fontSizeMm);
  const color = tokens.extracted.bodyColor ?? tokens.fallback.bodyColor ?? "#000000";
  applyHexColor(pdf, color);

  const lines: string[] = pdf.splitTextToSize(text || "", widthMm);
  let cursorY = yMm + fontSizeMm * 0.35;
  for (const line of lines) {
    pdf.text(line, xMm, cursorY);
    cursorY += lineHeightMm;
  }

  const usedHeightMm = lines.length * lineHeightMm;
  if (usedHeightMm > heightMm + 0.5) {
    overflowFindings.push({
      nodeId: node.id,
      page: node.page,
      verdict: "overflow",
      overflowMm: usedHeightMm - heightMm,
      detail: `Node ${node.id} rendered content ${Math.round(usedHeightMm)}mm tall inside a ${Math.round(heightMm)}mm original box.`,
    });
  }
  if (yMm + usedHeightMm > A4_HEIGHT_MM) {
    overflowFindings.push({
      nodeId: node.id,
      page: node.page,
      verdict: "page_bounds",
      overflowMm: yMm + usedHeightMm - A4_HEIGHT_MM,
      detail: `Node ${node.id} extends past the page's own bottom edge.`,
    });
  }
}

function applyHexColor(pdf: jsPDF, hex: string): void {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) {
    pdf.setTextColor(0, 0, 0);
    return;
  }
  const value = match[1];
  pdf.setTextColor(parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16));
}

function drawDivider(pdf: jsPDF, node: OriginalVisualNode, scale: number): void {
  const xMm = node.bounds.x * scale;
  const yMm = node.bounds.y * scale;
  const widthMm = node.bounds.width * scale;
  const heightMm = node.bounds.height * scale;
  pdf.setDrawColor(180, 180, 180);
  pdf.setLineWidth(Math.max(0.1, (node.divider?.thicknessPx ?? 1) * scale));
  if (node.divider?.orientation === "vertical" || widthMm < heightMm) {
    pdf.line(xMm, yMm, xMm, yMm + heightMm);
  } else {
    pdf.line(xMm, yMm, xMm + widthMm, yMm);
  }
}

function drawImagePlaceholder(pdf: jsPDF, node: OriginalVisualNode, scale: number): void {
  const xMm = node.bounds.x * scale;
  const yMm = node.bounds.y * scale;
  const widthMm = Math.max(1, node.bounds.width * scale);
  const heightMm = Math.max(1, node.bounds.height * scale);
  pdf.setDrawColor(210, 210, 210);
  pdf.setLineWidth(0.2);
  pdf.rect(xMm, yMm, widthMm, heightMm);
}

function drawTable(
  pdf: jsPDF,
  node: OriginalVisualNode,
  text: string | undefined,
  scale: number,
  tokens: DesignTokens,
  overflowFindings: OriginalLayoutOverflowFinding[]
): void {
  const xMm = node.bounds.x * scale;
  const yMm = node.bounds.y * scale;
  const widthMm = Math.max(5, node.bounds.width * scale);
  const heightMm = Math.max(5, node.bounds.height * scale);
  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.2);
  pdf.rect(xMm, yMm, widthMm, heightMm);

  const columnCount = Math.max(1, node.table?.columnCount ?? 1);
  for (let c = 1; c < columnCount; c++) {
    const colX = xMm + (widthMm / columnCount) * c;
    pdf.line(colX, yMm, colX, yMm + heightMm);
  }

  // Table content this Phase supports is "simple" (per this Phase's own
  // scope): the assigned text is written as wrapped body copy inside the
  // table's own bounds, not parsed back into individual rows/cells - a
  // full spreadsheet layout engine is explicitly out of scope.
  if (text) {
    drawLeaf(pdf, { ...node, role: "text_leaf" }, text, scale, tokens, overflowFindings);
  }
}

function renderChildren(
  pdf: jsPDF,
  node: OriginalVisualNode,
  scale: number,
  tokens: DesignTokens,
  nodeTexts: Record<string, string>,
  overflowFindings: OriginalLayoutOverflowFinding[]
): void {
  for (const child of node.children) {
    switch (child.role) {
      case "text_leaf":
        drawLeaf(pdf, child, nodeTexts[child.id] ?? "", scale, tokens, overflowFindings);
        break;
      case "divider":
        drawDivider(pdf, child, scale);
        break;
      case "image_placeholder":
        drawImagePlaceholder(pdf, child, scale);
        break;
      case "table":
        drawTable(pdf, child, nodeTexts[child.id], scale, tokens, overflowFindings);
        break;
      default:
        renderChildren(pdf, child, scale, tokens, nodeTexts, overflowFindings);
    }
  }
}

export function renderOriginalLayoutPdf(params: RenderOriginalLayoutParams): OriginalLayoutRenderResult {
  const { tree, designTokens, nodeTexts } = params;
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  pdf.setFont("helvetica");
  const overflowFindings: OriginalLayoutOverflowFinding[] = [];

  const pageNodes = tree.root.children.filter((n) => n.role === "page");
  pageNodes.forEach((pageNode, index) => {
    if (index > 0) pdf.addPage();
    const scale = scaleForPage(pageNode);
    renderChildren(pdf, pageNode, scale, designTokens, nodeTexts, overflowFindings);
  });

  return { pdf, overflowFindings };
}

export async function buildOriginalLayoutPdfBlob(params: RenderOriginalLayoutParams): Promise<Blob> {
  return renderOriginalLayoutPdf(params).pdf.output("blob");
}
