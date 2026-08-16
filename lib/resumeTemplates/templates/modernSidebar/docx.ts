/*
  Phase 6F - Template 2, Modern Sidebar DOCX renderer. Real native
  OOXML via a single borderless 2-column `docx` Table (spec section 11:
  "sidebar 템플릿은 안정적인 Word table layout 허용") - never an
  HTML/PDF conversion. Sidebar cell carries a shaded fill to echo the
  HTML/PDF sidebar background.
*/
import { AlignmentType, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType } from "docx";
import { normalizeResume, type NormalizedExperienceEntry, experienceHeaderFallbackText, educationHeaderFallbackText } from "../../shared/contentAdapters";
import { MODERN_SIDEBAR_COLORS } from "../../shared/colorTokens";
import { MODERN_SIDEBAR_FONTS } from "../../shared/typography";
import { DOCX_DENSITY_SPACING } from "../../shared/spacing";
import { renderContentItemsToParagraphs } from "../../docx/renderContentItems";
import { PAGE_SIZE_TWIPS } from "../../../documentPreservation/professionalAtsDocx/designTokens";
import { MODERN_SIDEBAR_LABELS, isLanguageCustomSection } from "./sectionPolicy";
import { extractDocx } from "../../parity/docxExtraction";
import { expectedFragmentsForResume } from "../../parity/textFragments";
import { buildValidationReport } from "../../parity/validateOutput";
import type { TemplateDocxResult, TemplateRenderContext } from "../../contracts/types";

export async function renderModernSidebarDocx(context: TemplateRenderContext): Promise<TemplateDocxResult> {
  const normalized = normalizeResume(context.resume);
  const fonts = MODERN_SIDEBAR_FONTS;
  const tokens = DOCX_DENSITY_SPACING[context.density];
  const page = PAGE_SIZE_TWIPS[context.paperSize];
  const colors = MODERN_SIDEBAR_COLORS;

  const run = (text: string, opts: { bold?: boolean; size?: number; colorHex?: string } = {}) => new TextRun({ text, bold: opts.bold, size: opts.size ?? tokens.fontSizeHalfPoints, font: { name: fonts.docxBodyFont, eastAsia: fonts.docxEastAsiaFont }, color: opts.colorHex });
  const contentOpts = { fontName: fonts.docxBodyFont, eastAsiaFont: fonts.docxEastAsiaFont, sizeHalfPoints: tokens.fontSizeHalfPoints, spacingAfterTwips: tokens.bulletSpacingAfterTwips, depthIndentTwips: tokens.bulletIndentTwips };
  const sidebarTextHex = (colors.sidebarText ?? "#ffffff").replace("#", "");
  const sidebarFillHex = (colors.sidebarBackground ?? "#333333").replace("#", "");

  const heading = (label: string) => new Paragraph({ children: [run(label.toUpperCase(), { bold: true, size: tokens.fontSizeHalfPoints + 1 })], spacing: { before: tokens.sectionSpacingBeforeTwips, after: tokens.headingSpacingAfterTwips }, keepNext: true });

  const mainParagraphs: Paragraph[] = [];
  if (normalized.summary) {
    mainParagraphs.push(heading(MODERN_SIDEBAR_LABELS.summary));
    mainParagraphs.push(new Paragraph({ children: [run(normalized.summary)], spacing: { after: tokens.entrySpacingBeforeTwips } }));
  }
  if (normalized.metricGrids.some((g) => g.entries.length > 0)) {
    const line = normalized.metricGrids.flatMap((g) => g.entries).map((e) => `${e.value} ${e.label}`).join("   |   ");
    mainParagraphs.push(new Paragraph({ children: [run(line, { bold: true })], alignment: AlignmentType.CENTER, spacing: { after: tokens.entrySpacingBeforeTwips } }));
  }
  const experienceGroups: Array<["experience" | "volunteer", NormalizedExperienceEntry[]]> = [
    ["experience", normalized.professionalExperience],
    ["volunteer", normalized.volunteerExperience],
  ];
  for (const [key, entries] of experienceGroups) {
    if (entries.length === 0) continue;
    mainParagraphs.push(heading(MODERN_SIDEBAR_LABELS[key]));
    for (const entry of entries) {
      const rawFallback = experienceHeaderFallbackText(entry);
      if (rawFallback) {
        mainParagraphs.push(new Paragraph({ children: [run(rawFallback, { bold: true })], spacing: { before: tokens.entrySpacingBeforeTwips }, keepNext: true }));
      } else {
        mainParagraphs.push(new Paragraph({ children: [run(entry.role, { bold: true }), run(entry.organization ? `  —  ${entry.organization}` : "")], spacing: { before: tokens.entrySpacingBeforeTwips }, keepNext: true }));
        if (entry.location) mainParagraphs.push(new Paragraph({ children: [run(entry.location, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
        if (entry.dateRangeText) mainParagraphs.push(new Paragraph({ children: [run(entry.dateRangeText, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
      }
      mainParagraphs.push(...renderContentItemsToParagraphs(entry.items, contentOpts));
    }
  }
  if (normalized.projects.length > 0) {
    mainParagraphs.push(heading(MODERN_SIDEBAR_LABELS.projects));
    for (const p of normalized.projects) {
      mainParagraphs.push(new Paragraph({ children: [run(p.name, { bold: true }), run(p.dateRangeText ? `  —  ${p.dateRangeText}` : "")], spacing: { before: tokens.entrySpacingBeforeTwips }, keepNext: true }));
      if (p.role) mainParagraphs.push(new Paragraph({ children: [run(p.role, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
      mainParagraphs.push(...renderContentItemsToParagraphs(p.items, contentOpts));
      if (p.technologies.length > 0) mainParagraphs.push(new Paragraph({ children: [run(`Technologies: ${p.technologies.join(", ")}`, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
    }
  }
  if (normalized.education.length > 0) {
    mainParagraphs.push(heading(MODERN_SIDEBAR_LABELS.education));
    for (const edu of normalized.education) {
      const eduFallback = educationHeaderFallbackText(edu);
      if (eduFallback) {
        mainParagraphs.push(new Paragraph({ children: [run(eduFallback, { bold: true })], spacing: { before: tokens.entrySpacingBeforeTwips }, keepNext: true }));
        continue;
      }
      mainParagraphs.push(new Paragraph({ children: [run(edu.institution || edu.institutions.join(" / "), { bold: true })], spacing: { before: tokens.entrySpacingBeforeTwips }, keepNext: true }));
      const creds = edu.credentials.join(", ") || edu.credential;
      mainParagraphs.push(new Paragraph({ children: [run([creds, edu.dateRangeText].filter(Boolean).join(" — "))], spacing: { after: 20 } }));
      if (edu.fieldsOfStudy.length > 0) mainParagraphs.push(new Paragraph({ children: [run(edu.fieldsOfStudy.join(" & "), { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
      if (edu.gpa) mainParagraphs.push(new Paragraph({ children: [run(`GPA: ${edu.gpa}`, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
      if (edu.honors.length > 0) mainParagraphs.push(new Paragraph({ children: [run(edu.honors.join(", "), { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 40 } }));
      for (const d of edu.details) mainParagraphs.push(new Paragraph({ children: [run(d, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
    }
  }
  if (normalized.credentials.length > 0) {
    mainParagraphs.push(heading(MODERN_SIDEBAR_LABELS.credentials));
    for (const c of normalized.credentials) {
      mainParagraphs.push(new Paragraph({ children: [run([c.name || c.names.join(", "), c.issuer, c.issueDateText, c.expiryDateText].filter(Boolean).join(" — "))], spacing: { after: 40 } }));
      if (c.credentialId) mainParagraphs.push(new Paragraph({ children: [run(`Credential ID: ${c.credentialId}`, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
      for (const d of c.details) mainParagraphs.push(new Paragraph({ children: [run(d, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
    }
  }
  if (normalized.awards.length > 0) {
    mainParagraphs.push(heading(MODERN_SIDEBAR_LABELS.awards));
    for (const a of normalized.awards) {
      mainParagraphs.push(new Paragraph({ children: [run([a.name || a.names.join(", "), a.issuer, a.dateText].filter(Boolean).join(" — "))], spacing: { after: 40 } }));
      for (const d of a.details) mainParagraphs.push(new Paragraph({ children: [run(d, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
    }
  }
  if (normalized.publications.length > 0) {
    mainParagraphs.push(heading(MODERN_SIDEBAR_LABELS.publications));
    for (const p of normalized.publications) {
      mainParagraphs.push(new Paragraph({ children: [run([p.title || p.titles.join(", "), p.authors.join(", "), p.publisherOrVenue, p.dateText].filter(Boolean).join(" — "))], spacing: { after: 20 } }));
      if (p.urlOrDoi) mainParagraphs.push(new Paragraph({ children: [run(p.urlOrDoi, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 40 } }));
      for (const d of p.details) mainParagraphs.push(new Paragraph({ children: [run(d, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
    }
  }
  const nonLanguageCustom = normalized.customSections.filter((s) => !isLanguageCustomSection(s));
  if (nonLanguageCustom.length > 0) {
    mainParagraphs.push(heading(MODERN_SIDEBAR_LABELS.custom));
    for (const section of nonLanguageCustom) {
      mainParagraphs.push(new Paragraph({ children: [run(section.heading, { bold: true })], spacing: { before: 40 }, keepNext: true }));
      mainParagraphs.push(...renderContentItemsToParagraphs(section.items, contentOpts));
    }
  }

  const sidebarParagraphs: Paragraph[] = [
    new Paragraph({ children: [run(normalized.identity.fullName, { bold: true, size: tokens.fontSizeHalfPoints + 6, colorHex: sidebarTextHex })], spacing: { after: 40 } }),
  ];
  if (normalized.identity.headline) sidebarParagraphs.push(new Paragraph({ children: [run(normalized.identity.headline, { colorHex: sidebarTextHex })], spacing: { after: 80 } }));
  for (const line of [normalized.identity.email, normalized.identity.phone, normalized.identity.location, normalized.identity.linkedin, normalized.identity.portfolio, ...normalized.identity.otherContactLines].filter(Boolean)) {
    sidebarParagraphs.push(new Paragraph({ children: [run(line, { size: tokens.fontSizeHalfPoints - 2, colorHex: sidebarTextHex })], spacing: { after: 20 } }));
  }
  const skillGroups = normalized.skillGroups.filter((g) => g.skills.length > 0);
  if (skillGroups.length > 0) {
    sidebarParagraphs.push(new Paragraph({ children: [run(MODERN_SIDEBAR_LABELS.skills.toUpperCase(), { bold: true, size: tokens.fontSizeHalfPoints - 1, colorHex: sidebarTextHex })], spacing: { before: 160, after: 60 } }));
    for (const g of skillGroups) {
      const label = g.label ? `${g.label}: ` : "";
      sidebarParagraphs.push(new Paragraph({ children: [run(label, { bold: true, size: tokens.fontSizeHalfPoints - 2, colorHex: sidebarTextHex }), run(g.skills.join(", "), { size: tokens.fontSizeHalfPoints - 2, colorHex: sidebarTextHex })], spacing: { after: 40 } }));
    }
  }
  const languageSections = normalized.customSections.filter(isLanguageCustomSection);
  for (const section of languageSections) {
    sidebarParagraphs.push(new Paragraph({ children: [run(section.heading.toUpperCase(), { bold: true, size: tokens.fontSizeHalfPoints - 1, colorHex: sidebarTextHex })], spacing: { before: 160, after: 60 } }));
    sidebarParagraphs.push(...renderContentItemsToParagraphs(section.items, { ...contentOpts, sizeHalfPoints: tokens.fontSizeHalfPoints - 2 }));
  }

  const sidebarWidthTwips = Math.round(page.widthTwips * 0.32);
  const mainWidthTwips = page.widthTwips - sidebarWidthTwips - tokens.pageMarginTwips * 2;

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [sidebarWidthTwips, mainWidthTwips],
    rows: [
      new TableRow({
        children: [
          new TableCell({ width: { size: sidebarWidthTwips, type: WidthType.DXA }, shading: { fill: sidebarFillHex }, verticalAlign: VerticalAlign.TOP, margins: { top: 200, bottom: 200, left: 160, right: 160 }, children: sidebarParagraphs, borders: { top: { style: "none", size: 0, color: "auto" }, bottom: { style: "none", size: 0, color: "auto" }, left: { style: "none", size: 0, color: "auto" }, right: { style: "none", size: 0, color: "auto" } } }),
          new TableCell({ width: { size: mainWidthTwips, type: WidthType.DXA }, verticalAlign: VerticalAlign.TOP, margins: { top: 200, bottom: 200, left: 200, right: 0 }, children: mainParagraphs, borders: { top: { style: "none", size: 0, color: "auto" }, bottom: { style: "none", size: 0, color: "auto" }, left: { style: "none", size: 0, color: "auto" }, right: { style: "none", size: 0, color: "auto" } } }),
        ],
      }),
    ],
  });

  const document = new Document({
    styles: { default: { document: { run: { font: fonts.docxBodyFont, size: tokens.fontSizeHalfPoints } } } },
    sections: [{ properties: { page: { size: { width: page.widthTwips, height: page.heightTwips, orientation: "portrait" as const }, margin: { top: tokens.pageMarginTwips, right: tokens.pageMarginTwips, bottom: tokens.pageMarginTwips, left: tokens.pageMarginTwips } } }, children: [table] }],
  });

  const buffer = await Packer.toBuffer(document);
  const bytes = new Uint8Array(buffer);
  const extraction = await extractDocx(bytes);

  const expectedFragments = expectedFragmentsForResume(normalized);
  const validation = buildValidationReport({
    expectedFragments,
    extractedText: extraction.text,
    sectionHeadingsInOrder: [],
    identityFragments: [normalized.identity.fullName, normalized.identity.email].filter(Boolean),
    structuralPassed: extraction.validZipHeader && extraction.parseableZip && extraction.requiredPartsPresent && extraction.macroFree,
    structuralIssues: extraction.missingParts.map((p) => ({ code: "missing-part", message: p })),
  });

  return {
    templateId: "modern-sidebar",
    format: "docx",
    bytes: Buffer.from(bytes),
    paperSize: context.paperSize,
    density: context.density,
    isEditableNativeDocx: extraction.parseableZip && extraction.requiredPartsPresent,
    validation,
  };
}
