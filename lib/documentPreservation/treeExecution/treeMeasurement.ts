/*
  D안 Phase 1 - Tree Measurement. Deliberately does NOT reuse
  layoutMeasurement.ts/browserMeasurement.ts - those measure a REAL
  headless-browser DOM render of the React A4DocumentPreview component
  (per this Phase's own explicit "React A4DocumentPreview 측정기를
  재사용하지 않는다" instruction), which this Phase's jsPDF-based
  Renderer never produces. Uses the SAME line-wrap primitive the
  Renderer itself uses (jsPDF's own splitTextToSize) so a "fits" result
  here is guaranteed consistent with what originalLayoutRenderer.ts
  would actually draw - a throwaway jsPDF instance is used purely for
  its synchronous, deterministic text-measurement methods, never for
  drawing (no .text()/.addPage() calls), so this is cheap to call
  repeatedly from the Leaf Retry loop (treeRetry.ts).
*/
import jsPDF from "jspdf";
import type { OriginalVisualNode, OriginalVisualTree, DesignTokens } from "../visualTree/types";
import type { OverflowFinding, OverflowReport } from "../executionEngine/types";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const DEFAULT_SOURCE_WIDTH = 595.28;
const LINE_HEIGHT_FACTOR = 1.35;

function scaleForPage(pageNode: OriginalVisualNode): number {
  const sourceWidth = pageNode.bounds.width > 0 ? pageNode.bounds.width : DEFAULT_SOURCE_WIDTH;
  return A4_WIDTH_MM / sourceWidth;
}

function collectLeafAndTableNodes(tree: OriginalVisualTree): { node: OriginalVisualNode; scale: number }[] {
  const results: { node: OriginalVisualNode; scale: number }[] = [];
  const pageNodes = tree.root.children.filter((n) => n.role === "page");
  for (const pageNode of pageNodes) {
    const scale = scaleForPage(pageNode);
    const walk = (node: OriginalVisualNode) => {
      if (node.role === "text_leaf" || node.role === "table") {
        results.push({ node, scale });
        return;
      }
      for (const child of node.children) walk(child);
    };
    walk(pageNode);
  }
  return results;
}

/*
  Mirrors originalLayoutRenderer.ts's own drawLeaf() geometry math
  exactly (same scale/fontSize/line-height formulas) - kept as a
  parallel, self-contained implementation rather than a shared import,
  per this Phase's own file-count budget; both were written from the
  same design so they agree on what "fits" means.
*/
export function measureTree(
  tree: OriginalVisualTree,
  designTokens: DesignTokens,
  nodeTexts: Record<string, string>
): OverflowReport {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  pdf.setFont("helvetica", "normal");

  const findings: OverflowFinding[] = [];

  for (const { node, scale } of collectLeafAndTableNodes(tree)) {
    const text = nodeTexts[node.id] ?? "";
    if (!text.trim()) continue;

    const widthMm = Math.max(5, node.bounds.width * scale);
    const heightMm = Math.max(1, node.bounds.height * scale);
    const fontSizeMm = Math.min(
      24,
      Math.max(6, (node.style.fontSize ?? designTokens.extracted.defaultFontSize ?? designTokens.fallback.defaultFontSize ?? 10) * scale)
    );
    pdf.setFontSize(fontSizeMm);

    const lines: string[] = pdf.splitTextToSize(text, widthMm);
    const lineHeightMm = (fontSizeMm / 72) * 25.4 * LINE_HEIGHT_FACTOR;
    const usedHeightMm = lines.length * lineHeightMm;
    const yMm = node.bounds.y * scale;

    if (usedHeightMm > heightMm + 0.5) {
      findings.push({
        contentBoxId: node.id,
        page: node.page,
        verdict: "vertical_overflow",
        detail: `Node ${node.id}: ${Math.round(usedHeightMm)}mm of wrapped text vs a ${Math.round(heightMm)}mm original box.`,
      });
    }
    if (yMm + usedHeightMm > A4_HEIGHT_MM) {
      findings.push({
        contentBoxId: node.id,
        page: node.page,
        verdict: "clipping",
        detail: `Node ${node.id} extends past the page's own bottom edge.`,
      });
    }
  }

  return { hasOverflow: findings.length > 0, findings };
}
