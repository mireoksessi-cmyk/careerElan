/*
  Phase 6F - shared docx.js Paragraph builder for NormalizedContentItem[]
  (the same normalized shape ContentItemsView.tsx renders for HTML).
  Real native Word bullets via docx's own `bullet: { level }` shortcut
  (real numbering, never a text-prefixed glyph) and real `keepLines`
  hints - never an embedded/converted HTML blob.
*/
import { Paragraph, TextRun } from "docx";
import type { NormalizedContentItem } from "../shared/contentAdapters";

export type ContentParagraphBorder = { color: string; space: number; style: "single" | "dashed" | "dotted"; size: number };

export type RenderContentItemsOptions = {
  fontName: string;
  eastAsiaFont: string;
  sizeHalfPoints: number;
  spacingAfterTwips: number;
  depthIndentTwips: number;
  baseDepth?: number;
  /* Optional left border applied to every generated paragraph (e.g.
     Creative Timeline's vertical timeline line) - additive indent is
     applied on top of depth indent so the border never sits under the
     text it decorates. */
  leftBorder?: ContentParagraphBorder;
  extraLeftIndentTwips?: number;
};

export function renderContentItemsToParagraphs(items: NormalizedContentItem[], opts: RenderContentItemsOptions): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const baseDepth = opts.baseDepth ?? 0;
  const extraIndent = opts.extraLeftIndentTwips ?? 0;
  const border = opts.leftBorder ? { left: opts.leftBorder } : undefined;

  for (const item of items) {
    const run = new TextRun({ text: item.text, bold: item.kind === "subheading", size: opts.sizeHalfPoints, font: { name: opts.fontName, eastAsia: opts.eastAsiaFont } });
    if (item.kind === "bullet") {
      paragraphs.push(new Paragraph({ children: [run], bullet: { level: baseDepth }, spacing: { after: opts.spacingAfterTwips }, keepLines: true, indent: { left: extraIndent + opts.depthIndentTwips * (baseDepth + 1) }, border }));
    } else if (item.kind === "paragraph") {
      paragraphs.push(new Paragraph({ children: [run], spacing: { after: opts.spacingAfterTwips }, indent: { left: extraIndent + opts.depthIndentTwips * baseDepth }, border }));
    } else {
      paragraphs.push(new Paragraph({ children: [run], spacing: { after: Math.round(opts.spacingAfterTwips / 2) }, keepNext: true, indent: { left: extraIndent + opts.depthIndentTwips * baseDepth }, border }));
      paragraphs.push(...renderContentItemsToParagraphs(item.children, { ...opts, baseDepth: baseDepth + 1 }));
    }
  }

  return paragraphs;
}
