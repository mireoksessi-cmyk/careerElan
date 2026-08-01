import jsPDF from "jspdf";
import type { SectionKey } from "../types";
import { SECTION_HEADING_LABELS } from "../sectionLabels";
import { buildDocumentIRFromText } from "../buildDocumentIR";
import { buildRenderDocument, type ContentBlock, type RenderDocument, type RenderSection } from "./blocks";
import { normalizeResumeTemplateId, type ResumeTemplateId } from "./templateId";

/*
  DocumentIR-based PDF export - one exportPdfFromText() entry point,
  dispatching to a per-template layout function. All four layouts share
  the same page size/margins as the original flat-text exportPdf() in
  lib/exportDocument.ts (A4, Helvetica, 15mm margin, same character
  normalization) so files stay visually consistent, but each walks
  RenderDocument (blocks.ts) with different placement rules instead of
  a single splitTextToSize() call over the whole string:
  - classic: single column, bold headings, hanging-indent bullets.
  - professional: 2-column - Skills/Languages/Certifications in a left
    sidebar, everything else in the main column, matching the React
    Professional layout's structure.
  - creative: full-width colored header band, then single column body.
  - modern: single column with a colored vertical rule beside every
    heading instead of an underline.

  Known limitation (documented, not silently dropped): the Professional
  sidebar is drawn once, top-to-bottom, without its own page-break
  logic - real resumes keep Skills/Languages/Certifications short enough
  that this doesn't overflow a page in practice. The main column has
  full multi-page support. See the migration's final report.
*/

const MARGIN_LEFT_MM = 15;
const PAGE_TOP_MM = 15;
const PAGE_BOTTOM_MM = 280;
const LINE_HEIGHT_MM = 5;
const FULL_WIDTH_MM = 180;

const SIDEBAR_KEYS: SectionKey[] = ["skills", "languages", "certifications"];

const ACCENT_RGB: Record<ResumeTemplateId, [number, number, number]> = {
  classic: [15, 23, 42],
  professional: [30, 58, 138],
  creative: [109, 40, 217],
  modern: [15, 118, 110],
};

function normalizeForPdf(text: string): string {
  return text
    .replace(/[‐-‒–—―－]/g, "-")
    .replace(/[•▪◦]/g, "-")
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/\t/g, " ");
}

/*
  A single vertical text cursor confined to one x/width region of the
  page. Multiple columns can share the same jsPDF document by calling
  pdf.setPage() before writing - see writeMainColumn() below.
*/
class Column {
  private pdf: jsPDF;
  private xMm: number;
  private widthMm: number;
  y: number;
  private onOverflow: (() => void) | null;

  constructor(pdf: jsPDF, xMm: number, widthMm: number, startY = PAGE_TOP_MM, onOverflow: (() => void) | null = null) {
    this.pdf = pdf;
    this.xMm = xMm;
    this.widthMm = widthMm;
    this.y = startY;
    this.onOverflow = onOverflow;
  }

  private ensureRoom() {
    if (this.y > PAGE_BOTTOM_MM) {
      if (this.onOverflow) {
        this.onOverflow();
      } else {
        this.pdf.addPage();
        this.y = PAGE_TOP_MM;
      }
    }
  }

  writeLines(text: string, opts: { bold?: boolean; size?: number; color?: [number, number, number] } = {}) {
    this.pdf.setFont("helvetica", opts.bold ? "bold" : "normal");
    this.pdf.setFontSize(opts.size || 10);
    if (opts.color) this.pdf.setTextColor(opts.color[0], opts.color[1], opts.color[2]);
    else this.pdf.setTextColor(20, 20, 20);

    const lines: string[] = this.pdf.splitTextToSize(normalizeForPdf(text), this.widthMm);
    for (const line of lines) {
      this.ensureRoom();
      this.pdf.text(line, this.xMm, this.y);
      this.y += LINE_HEIGHT_MM;
    }
  }

  spacer(mm = LINE_HEIGHT_MM / 2) {
    this.ensureRoom();
    this.y += mm;
  }
}

function writeContentBlock(col: Column, block: ContentBlock, indentMm = 0) {
  switch (block.type) {
    case "paragraph":
      if (block.text) col.writeLines(block.text);
      return;
    case "bulletList":
      for (const item of block.items) col.writeLines(`- ${item}`);
      return;
    case "entryHeader": {
      const title = [block.title, block.dates].filter(Boolean).join("  |  ");
      if (title) col.writeLines(title, { bold: true });
      if (block.subtitle) col.writeLines(block.subtitle);
      return;
    }
  }
}

function writeSectionHeading(col: Column, key: SectionKey, accent: [number, number, number]) {
  col.writeLines(SECTION_HEADING_LABELS[key], { bold: true, color: accent });
}

/* ---------- classic ---------- */

function renderClassicPdf(pdf: jsPDF, doc: RenderDocument) {
  const col = new Column(pdf, MARGIN_LEFT_MM, FULL_WIDTH_MM);

  if (doc.name) col.writeLines(doc.name, { bold: true, size: 14 });
  for (const line of doc.contactLines) col.writeLines(line);

  for (const section of doc.sections) {
    col.spacer();
    writeSectionHeading(col, section.key, ACCENT_RGB.classic);
    for (const block of section.blocks) writeContentBlock(col, block);
  }
}

/* ---------- modern: same flow as classic, colored heading text ---------- */

function renderModernPdf(pdf: jsPDF, doc: RenderDocument) {
  const col = new Column(pdf, MARGIN_LEFT_MM, FULL_WIDTH_MM);

  if (doc.name) col.writeLines(doc.name, { bold: true, size: 14 });
  for (const line of doc.contactLines) col.writeLines(line, { size: 9 });

  pdf.setDrawColor(...ACCENT_RGB.modern);
  pdf.setLineWidth(0.8);
  pdf.line(MARGIN_LEFT_MM, col.y, MARGIN_LEFT_MM + FULL_WIDTH_MM, col.y);
  col.y += 4;

  for (const section of doc.sections) {
    col.spacer();
    writeSectionHeading(col, section.key, ACCENT_RGB.modern);
    for (const block of section.blocks) writeContentBlock(col, block);
  }
}

/* ---------- creative: colored header band, single column body ---------- */

function renderCreativePdf(pdf: jsPDF, doc: RenderDocument) {
  const [r, g, b] = ACCENT_RGB.creative;
  const headerHeight = 15 + (doc.name ? 8 : 0) + doc.contactLines.length * 5 + 8;

  pdf.setFillColor(r, g, b);
  pdf.rect(0, 0, 210, headerHeight, "F");

  const headerCol = new Column(pdf, MARGIN_LEFT_MM, FULL_WIDTH_MM, 15);
  if (doc.name) headerCol.writeLines(doc.name, { bold: true, size: 16, color: [255, 255, 255] });
  for (const line of doc.contactLines) headerCol.writeLines(line, { color: [255, 255, 255] });

  const bodyCol = new Column(pdf, MARGIN_LEFT_MM, FULL_WIDTH_MM, headerHeight + 8);
  for (const section of doc.sections) {
    bodyCol.spacer();
    writeSectionHeading(bodyCol, section.key, ACCENT_RGB.creative);
    for (const block of section.blocks) writeContentBlock(bodyCol, block);
  }
}

/* ---------- professional: sidebar (Skills/Languages/Certifications) + main column ---------- */

function renderProfessionalPdf(pdf: jsPDF, doc: RenderDocument) {
  const [r, g, b] = ACCENT_RGB.professional;
  const headerCol = new Column(pdf, MARGIN_LEFT_MM, FULL_WIDTH_MM, PAGE_TOP_MM);
  if (doc.name) headerCol.writeLines(doc.name, { bold: true, size: 16, color: [r, g, b] });
  if (doc.contactLines.length > 0) headerCol.writeLines(doc.contactLines.join("  |  "), { size: 9 });
  headerCol.spacer();

  pdf.setDrawColor(r, g, b);
  pdf.setLineWidth(0.6);
  pdf.line(MARGIN_LEFT_MM, headerCol.y, MARGIN_LEFT_MM + FULL_WIDTH_MM, headerCol.y);

  const bodyTop = headerCol.y + 6;
  const sidebarWidth = 55;
  const gap = 10;
  const mainX = MARGIN_LEFT_MM + sidebarWidth + gap;
  const mainWidth = FULL_WIDTH_MM - sidebarWidth - gap;

  const sidebarSections = doc.sections.filter((s) => SIDEBAR_KEYS.includes(s.key));
  const mainSections = doc.sections.filter((s) => !SIDEBAR_KEYS.includes(s.key));

  /*
    Sidebar is drawn without its own page-break handling - see the file
    doc comment. It always starts on the same page as the header.
  */
  const sidebarCol = new Column(pdf, MARGIN_LEFT_MM, sidebarWidth, bodyTop, () => {});
  for (const section of sidebarSections) {
    sidebarCol.spacer();
    writeSectionHeading(sidebarCol, section.key, ACCENT_RGB.professional);
    for (const block of section.blocks) writeContentBlock(sidebarCol, block);
  }

  const mainCol = new Column(pdf, mainX, mainWidth, bodyTop);
  for (const section of mainSections) {
    mainCol.spacer();
    writeSectionHeading(mainCol, section.key, ACCENT_RGB.professional);
    for (const block of section.blocks) writeContentBlock(mainCol, block);
  }
}

const PDF_RENDERERS: Record<ResumeTemplateId, (pdf: jsPDF, doc: RenderDocument) => void> = {
  classic: renderClassicPdf,
  professional: renderProfessionalPdf,
  creative: renderCreativePdf,
  modern: renderModernPdf,
};

/*
  Preview/Download parity - factored out so both the download-file path
  (exportPdfFromText, unchanged below) and the Preview tab (paste-job/
  page.tsx) build the PDF through the exact same render call, never two
  slightly-diverging code paths. Returns the jsPDF document's own Blob
  (pdf.output("blob")) rather than triggering a save-as-file prompt - the
  caller decides what to do with the bytes (object URL for an iframe,
  or a synthetic <a download> click for the actual download).
*/
function renderPdf(text: string, templateId?: string | null): jsPDF {
  const ir = buildDocumentIRFromText(text);
  const doc = buildRenderDocument(ir);
  const resolvedId = normalizeResumeTemplateId(templateId);

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  pdf.setFont("helvetica");
  pdf.setFontSize(10);

  PDF_RENDERERS[resolvedId](pdf, doc);

  return pdf;
}

export async function buildPdfBlob(text: string, templateId?: string | null): Promise<Blob> {
  return renderPdf(text, templateId).output("blob");
}

export async function exportPdfFromText(text: string, fileName: string, templateId?: string | null) {
  renderPdf(text, templateId).save(`${fileName}.pdf`);
}
