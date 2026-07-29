import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";
import { saveAs } from "file-saver";
import type { SectionKey } from "../types";
import { SECTION_HEADING_LABELS } from "../sectionLabels";
import { buildDocumentIRFromText } from "../buildDocumentIR";
import { buildRenderDocument, type ContentBlock, type RenderDocument } from "./blocks";
import { normalizeResumeTemplateId, type ResumeTemplateId } from "./templateId";

/*
  DocumentIR-based DOCX export - one exportDocxFromText() entry point,
  dispatching to a per-template layout function that walks the same
  RenderDocument (blocks.ts) the PDF exporter uses. Word/docx.js can't
  reproduce Preview's CSS pixel-for-pixel, so each template maps to a
  structural equivalent instead:
  - classic: single column of plain paragraphs (unchanged from before).
  - professional: a borderless 2-column Table - left cell for
    Skills/Languages/Certifications, right cell for everything else.
  - creative: the header paragraph gets a colored shading fill (a
    colored band, matching the colored header band in Preview/PDF).
  - modern: every section heading gets a colored left border rule
    instead of an underline.
*/

const ACCENT_HEX: Record<ResumeTemplateId, string> = {
  classic: "0F172A",
  professional: "1E3A8A",
  creative: "6D28D9",
  modern: "0F766E",
};

const SIDEBAR_KEYS: SectionKey[] = ["skills", "languages", "certifications"];

function blockToParagraphs(block: ContentBlock): Paragraph[] {
  switch (block.type) {
    case "paragraph":
      return block.text.split(/\r?\n/).map((line) => new Paragraph({ text: line }));
    case "bulletList":
      return block.items.map((item) => new Paragraph({ text: `- ${item}` }));
    case "entryHeader": {
      const paragraphs: Paragraph[] = [];
      const title = [block.title, block.dates].filter(Boolean).join("  |  ");
      if (title) paragraphs.push(new Paragraph({ children: [new TextRun({ text: title, bold: true })] }));
      if (block.subtitle) paragraphs.push(new Paragraph({ text: block.subtitle }));
      return paragraphs;
    }
  }
}

function headingParagraph(key: SectionKey, colorHex: string, opts: { border?: boolean } = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: SECTION_HEADING_LABELS[key], bold: true, color: colorHex })],
    spacing: { before: 160, after: 60 },
    border: opts.border
      ? { left: { style: BorderStyle.SINGLE, size: 24, color: colorHex, space: 4 } }
      : undefined,
  });
}

/* ---------- classic ---------- */

function classicDocxSections(doc: RenderDocument): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  if (doc.name) paragraphs.push(new Paragraph({ children: [new TextRun({ text: doc.name, bold: true, size: 32 })] }));
  for (const line of doc.contactLines) paragraphs.push(new Paragraph({ text: line }));

  for (const section of doc.sections) {
    paragraphs.push(headingParagraph(section.key, ACCENT_HEX.classic));
    for (const block of section.blocks) paragraphs.push(...blockToParagraphs(block));
  }
  return paragraphs;
}

/* ---------- modern: colored left-border headings ---------- */

function modernDocxSections(doc: RenderDocument): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  if (doc.name) paragraphs.push(new Paragraph({ children: [new TextRun({ text: doc.name, bold: true, size: 30 })] }));
  for (const line of doc.contactLines) paragraphs.push(new Paragraph({ children: [new TextRun({ text: line, size: 18 })] }));

  for (const section of doc.sections) {
    paragraphs.push(headingParagraph(section.key, ACCENT_HEX.modern, { border: true }));
    for (const block of section.blocks) paragraphs.push(...blockToParagraphs(block));
  }
  return paragraphs;
}

/* ---------- creative: shaded header band ---------- */

function creativeDocxSections(doc: RenderDocument): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  if (doc.name) {
    paragraphs.push(
      new Paragraph({
        shading: { fill: ACCENT_HEX.creative },
        spacing: { after: 40 },
        children: [new TextRun({ text: doc.name, bold: true, size: 34, color: "FFFFFF" })],
      })
    );
  }
  for (const line of doc.contactLines) {
    paragraphs.push(
      new Paragraph({
        shading: { fill: ACCENT_HEX.creative },
        children: [new TextRun({ text: line, color: "FFFFFF" })],
      })
    );
  }
  paragraphs.push(new Paragraph({ text: "" }));

  for (const section of doc.sections) {
    paragraphs.push(headingParagraph(section.key, ACCENT_HEX.creative));
    for (const block of section.blocks) paragraphs.push(...blockToParagraphs(block));
  }
  return paragraphs;
}

/* ---------- professional: borderless 2-column table ---------- */

function professionalDocxSections(doc: RenderDocument): (Paragraph | Table)[] {
  const body: (Paragraph | Table)[] = [];

  if (doc.name) body.push(new Paragraph({ children: [new TextRun({ text: doc.name, bold: true, size: 34, color: ACCENT_HEX.professional })] }));
  if (doc.contactLines.length > 0) body.push(new Paragraph({ text: doc.contactLines.join("  |  ") }));
  body.push(
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT_HEX.professional, space: 4 } },
      text: "",
    })
  );

  const sidebarSections = doc.sections.filter((s) => SIDEBAR_KEYS.includes(s.key));
  const mainSections = doc.sections.filter((s) => !SIDEBAR_KEYS.includes(s.key));

  const sidebarParagraphs: Paragraph[] = [];
  for (const section of sidebarSections) {
    sidebarParagraphs.push(headingParagraph(section.key, ACCENT_HEX.professional));
    for (const block of section.blocks) sidebarParagraphs.push(...blockToParagraphs(block));
  }
  if (sidebarParagraphs.length === 0) sidebarParagraphs.push(new Paragraph({ text: "" }));

  const mainParagraphs: Paragraph[] = [];
  for (const section of mainSections) {
    mainParagraphs.push(headingParagraph(section.key, ACCENT_HEX.professional));
    for (const block of section.blocks) mainParagraphs.push(...blockToParagraphs(block));
  }
  if (mainParagraphs.length === 0) mainParagraphs.push(new Paragraph({ text: "" }));

  body.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 32, type: WidthType.PERCENTAGE },
              children: sidebarParagraphs,
            }),
            new TableCell({
              width: { size: 68, type: WidthType.PERCENTAGE },
              children: mainParagraphs,
            }),
          ],
        }),
      ],
    })
  );

  return body;
}

const DOCX_RENDERERS: Record<ResumeTemplateId, (doc: RenderDocument) => (Paragraph | Table)[]> = {
  classic: classicDocxSections,
  professional: professionalDocxSections,
  creative: creativeDocxSections,
  modern: modernDocxSections,
};

export async function exportDocxFromText(text: string, fileName: string, templateId?: string | null) {
  const ir = buildDocumentIRFromText(text);
  const doc = buildRenderDocument(ir);
  const resolvedId = normalizeResumeTemplateId(templateId);

  const children = DOCX_RENDERERS[resolvedId](doc);

  const document = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(document);
  saveAs(blob, `${fileName}.docx`);
}
