/*
  Phase 6F - Template 4, Creative Timeline DOCX renderer. Real native
  OOXML: the same borderless 2-column Table pattern as Modern Sidebar
  for the sidebar/main split, and a per-paragraph LEFT BORDER (docx's
  own Paragraph `border.left`) on timeline entries to suggest the
  vertical timeline line - spec section 11's explicit instruction to
  prefer "editable table/border 기반" over Word drawings/shapes, which
  this satisfies without any embedded graphic object.
*/
import { AlignmentType, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType } from "docx";
import { normalizeResume, type NormalizedExperienceEntry, experienceHeaderFallbackText, educationHeaderFallbackText } from "../../shared/contentAdapters";
import { CREATIVE_TIMELINE_COLORS } from "../../shared/colorTokens";
import { CREATIVE_TIMELINE_FONTS } from "../../shared/typography";
import { DOCX_DENSITY_SPACING } from "../../shared/spacing";
import { renderContentItemsToParagraphs } from "../../docx/renderContentItems";
import { PAGE_SIZE_TWIPS } from "../../../documentPreservation/professionalAtsDocx/designTokens";
import { CREATIVE_TIMELINE_LABELS, isLanguageCustomSection, isSidebarExtraCustomSection } from "./sectionPolicy";
import { extractDocx } from "../../parity/docxExtraction";
import { expectedFragmentsForResume } from "../../parity/textFragments";
import { buildValidationReport } from "../../parity/validateOutput";
import type { TemplateDocxResult, TemplateRenderContext } from "../../contracts/types";

const TIMELINE_BORDER = { color: "D1603D", space: 6, style: "single" as const, size: 12 };

export async function renderCreativeTimelineDocx(context: TemplateRenderContext): Promise<TemplateDocxResult> {
  /*
    Structured languages are a lossless REGROUPING of the raw section they
    came from only when each of that section's own content blocks is
    claimed by exactly one entry. NormalizedResume drops block-level
    provenance, so the test runs here, against context.resume, and its
    result is applied by withholding the unsafe entries from `normalized`
    - every helper below then reaches the right conclusion through the
    logic it already has.

    Claimed zero times means the section holds a line no entry accounts
    for (a stray note, a partial extraction). Claimed more than once means
    several entries came from ONE line, i.e. the source wrote its
    languages inline and that line is already correctly paired prose.
    Either way the raw section is the faithful rendering, so the pairs
    stand down and it renders untouched.

    Only entries whose section would actually survive as a raw fallback
    are withheld: a language with no owning raw section has nothing to
    fall back to, so withholding it would lose content outright, and it
    is kept. Matching is provenance-only - no heading text, no language
    names, no reconstruction of leftover lines.
  */
  const unsafeLanguageSectionIds = ((model) => {
    const bySection = new Map<string, typeof model.languages>();
    for (const language of model.languages) {
      const existing = bySection.get(language.source.sourceSectionId);
      if (existing) existing.push(language);
      else bySection.set(language.source.sourceSectionId, [language]);
    }
    const unsafe = new Set<string>();
    for (const [sectionId, entries] of bySection) {
      const section = model.customSections.find((s) => s.source.sourceSectionId === sectionId);
      if (!section) continue;
      const claims = new Map<string, number>();
      for (const entry of entries) {
        for (const id of entry.source.sourceBlockIds) claims.set(id, (claims.get(id) ?? 0) + 1);
      }
      const required = new Set([
        ...section.paragraphs.flatMap((p) => p.source.sourceBlockIds),
        ...section.bullets.flatMap((b) => b.source.sourceBlockIds),
        ...section.content.flatMap((c) => c.source.sourceBlockIds),
      ]);
      if (required.size === 0 || ![...required].every((id) => claims.get(id) === 1)) unsafe.add(sectionId);
    }
    return unsafe;
  })(context.resume);
  const normalizedAll = normalizeResume(context.resume);
  const normalized = { ...normalizedAll, languages: (normalizedAll.languages ?? []).filter((l) => !unsafeLanguageSectionIds.has(l.sourceSectionId)) };
  const fonts = CREATIVE_TIMELINE_FONTS;
  const tokens = DOCX_DENSITY_SPACING[context.density];
  const page = PAGE_SIZE_TWIPS[context.paperSize];
  const colors = CREATIVE_TIMELINE_COLORS;

  const run = (text: string, opts: { bold?: boolean; size?: number; colorHex?: string } = {}) => new TextRun({ text, bold: opts.bold, size: opts.size ?? tokens.fontSizeHalfPoints, font: { name: fonts.docxBodyFont, eastAsia: fonts.docxEastAsiaFont }, color: opts.colorHex });
  const contentOpts = { fontName: fonts.docxBodyFont, eastAsiaFont: fonts.docxEastAsiaFont, sizeHalfPoints: tokens.fontSizeHalfPoints, spacingAfterTwips: tokens.bulletSpacingAfterTwips, depthIndentTwips: tokens.bulletIndentTwips };
  const sidebarTextHex = (colors.sidebarText ?? "#ffffff").replace("#", "");
  const sidebarFillHex = (colors.sidebarBackground ?? "#332742").replace("#", "");

  const heading = (label: string) => new Paragraph({ children: [run(label.toUpperCase(), { bold: true, size: tokens.fontSizeHalfPoints + 1 })], spacing: { before: tokens.sectionSpacingBeforeTwips, after: tokens.headingSpacingAfterTwips }, keepNext: true });

  const mainParagraphs: Paragraph[] = [];
  if (normalized.summary) {
    mainParagraphs.push(heading(CREATIVE_TIMELINE_LABELS.summary));
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
    mainParagraphs.push(heading(CREATIVE_TIMELINE_LABELS[key]));
    for (const entry of entries) {
      const rawFallback = experienceHeaderFallbackText(entry);
      if (rawFallback) {
        mainParagraphs.push(new Paragraph({ children: [run(rawFallback, { bold: true })], spacing: { before: tokens.entrySpacingBeforeTwips }, keepNext: true, border: { left: TIMELINE_BORDER }, indent: { left: 100 } }));
      } else {
        mainParagraphs.push(new Paragraph({ children: [run(entry.role, { bold: true }), run(entry.organization ? `  —  ${entry.organization}` : "")], spacing: { before: tokens.entrySpacingBeforeTwips }, keepNext: true, border: { left: TIMELINE_BORDER }, indent: { left: 100 } }));
        if (entry.location) mainParagraphs.push(new Paragraph({ children: [run(entry.location, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 }, border: { left: TIMELINE_BORDER }, indent: { left: 100 } }));
        if (entry.dateRangeText) mainParagraphs.push(new Paragraph({ children: [run(entry.dateRangeText, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 }, border: { left: TIMELINE_BORDER }, indent: { left: 100 } }));
      }
      mainParagraphs.push(...renderContentItemsToParagraphs(entry.items, { ...contentOpts, leftBorder: TIMELINE_BORDER, extraLeftIndentTwips: 100 }));
    }
  }

  if (normalized.education.length > 0) {
    mainParagraphs.push(heading(CREATIVE_TIMELINE_LABELS.education));
    for (const edu of normalized.education) {
      const eduFallback = educationHeaderFallbackText(edu);
      if (eduFallback) {
        mainParagraphs.push(new Paragraph({ children: [run(eduFallback, { bold: true })], spacing: { before: tokens.entrySpacingBeforeTwips }, keepNext: true, border: { left: TIMELINE_BORDER }, indent: { left: 100 } }));
        continue;
      }
      mainParagraphs.push(new Paragraph({ children: [run(edu.institution || edu.institutions.join(" / "), { bold: true })], spacing: { before: tokens.entrySpacingBeforeTwips }, keepNext: true, border: { left: TIMELINE_BORDER }, indent: { left: 100 } }));
      const creds = edu.credentials.join(", ") || edu.credential;
      mainParagraphs.push(new Paragraph({ children: [run([creds, edu.dateRangeText].filter(Boolean).join(" — "))], spacing: { after: 20 }, border: { left: TIMELINE_BORDER }, indent: { left: 100 } }));
      if (edu.fieldsOfStudy.length > 0) mainParagraphs.push(new Paragraph({ children: [run(edu.fieldsOfStudy.join(" & "), { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 }, border: { left: TIMELINE_BORDER }, indent: { left: 100 } }));
      if (edu.gpa) mainParagraphs.push(new Paragraph({ children: [run(`GPA: ${edu.gpa}`, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 }, border: { left: TIMELINE_BORDER }, indent: { left: 100 } }));
      if (edu.honors.length > 0) mainParagraphs.push(new Paragraph({ children: [run(edu.honors.join(", "), { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 40 }, border: { left: TIMELINE_BORDER }, indent: { left: 100 } }));
      for (const d of edu.details) mainParagraphs.push(new Paragraph({ children: [run(d, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 }, border: { left: TIMELINE_BORDER }, indent: { left: 100 } }));
    }
  }

  if (normalized.projects.length > 0) {
    mainParagraphs.push(heading(CREATIVE_TIMELINE_LABELS.projects));
    for (const p of normalized.projects) {
      mainParagraphs.push(new Paragraph({ children: [run(p.name, { bold: true }), run(p.dateRangeText ? `  —  ${p.dateRangeText}` : "")], spacing: { before: tokens.entrySpacingBeforeTwips }, keepNext: true }));
      if (p.role) mainParagraphs.push(new Paragraph({ children: [run(p.role, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
      mainParagraphs.push(...renderContentItemsToParagraphs(p.items, contentOpts));
      if (p.technologies.length > 0) mainParagraphs.push(new Paragraph({ children: [run(`Technologies: ${p.technologies.join(", ")}`, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
    }
  }
  if (normalized.credentials.length > 0) {
    mainParagraphs.push(heading(CREATIVE_TIMELINE_LABELS.credentials));
    for (const c of normalized.credentials) {
      mainParagraphs.push(new Paragraph({ children: [run([c.name || c.names.join(", "), c.issuer, c.issueDateText, c.expiryDateText].filter(Boolean).join(" — "))], spacing: { after: 40 } }));
      if (c.credentialId) mainParagraphs.push(new Paragraph({ children: [run(`Credential ID: ${c.credentialId}`, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
      for (const d of c.details) mainParagraphs.push(new Paragraph({ children: [run(d, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
    }
  }
  if (normalized.awards.length > 0) {
    mainParagraphs.push(heading(CREATIVE_TIMELINE_LABELS.awards));
    for (const a of normalized.awards) {
      mainParagraphs.push(new Paragraph({ children: [run([a.name || a.names.join(", "), a.issuer, a.dateText].filter(Boolean).join(" — "))], spacing: { after: 40 } }));
      for (const d of a.details) mainParagraphs.push(new Paragraph({ children: [run(d, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
    }
  }
  if (normalized.publications.length > 0) {
    mainParagraphs.push(heading(CREATIVE_TIMELINE_LABELS.publications));
    for (const p of normalized.publications) {
      mainParagraphs.push(new Paragraph({ children: [run([p.title || p.titles.join(", "), p.authors.join(", "), p.publisherOrVenue, p.dateText].filter(Boolean).join(" — "))], spacing: { after: 20 } }));
      if (p.urlOrDoi) mainParagraphs.push(new Paragraph({ children: [run(p.urlOrDoi, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 40 } }));
      for (const d of p.details) mainParagraphs.push(new Paragraph({ children: [run(d, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
    }
  }
  /*
    A raw Languages section reaches the main column through this partition,
    which has only ever asked whether the HEADING says "language". That
    misses a section titled in the document's own words ("Idiomas del
    Candidato"): the sidebar correctly skips it, the main column keeps it,
    and the reader sees the pairs once and the raw lines again. Provenance
    decides it here instead - normalized.languages has already been
    narrowed to the sections whose pairs are a lossless regrouping, so a
    section listed there is genuinely represented and must not be drawn a
    second time. The heading regex stays only for the sidebar/main
    placement it has always governed; it is no longer what suppression
    rests on. Unsafe, partial, inline and empty coverage all leave
    normalized.languages without that section, so the raw copy stays.
  */
  const languageRepresentedSectionIds = new Set((normalized.languages ?? []).map((l) => l.sourceSectionId));
  const isRepresentedByStructuredLanguages = (s: { sourceSectionId?: string }) =>
    s.sourceSectionId !== undefined && languageRepresentedSectionIds.has(s.sourceSectionId);
  const restCustom = normalized.customSections.filter((s) => !isLanguageCustomSection(s) && !isSidebarExtraCustomSection(s) && !isRepresentedByStructuredLanguages(s));
  if (restCustom.length > 0) {
    mainParagraphs.push(heading(CREATIVE_TIMELINE_LABELS.custom));
    for (const section of restCustom) {
      mainParagraphs.push(new Paragraph({ children: [run(section.heading, { bold: true })], spacing: { before: 40 }, keepNext: true }));
      mainParagraphs.push(...renderContentItemsToParagraphs(section.items, contentOpts));
    }
  }

  const sidebarParagraphs: Paragraph[] = [new Paragraph({ children: [run(normalized.identity.fullName, { bold: true, size: tokens.fontSizeHalfPoints + 6, colorHex: sidebarTextHex })], spacing: { after: 40 } })];
  if (normalized.identity.headline) sidebarParagraphs.push(new Paragraph({ children: [run(normalized.identity.headline, { colorHex: sidebarTextHex })], spacing: { after: 80 } }));
  sidebarParagraphs.push(new Paragraph({ children: [run(CREATIVE_TIMELINE_LABELS.contact.toUpperCase(), { bold: true, size: tokens.fontSizeHalfPoints - 1, colorHex: sidebarTextHex })], spacing: { before: 100, after: 40 } }));
  for (const line of [normalized.identity.email, normalized.identity.phone, normalized.identity.location, normalized.identity.linkedin, normalized.identity.portfolio, ...normalized.identity.otherContactLines].filter(Boolean)) {
    sidebarParagraphs.push(new Paragraph({ children: [run(line, { size: tokens.fontSizeHalfPoints - 2, colorHex: sidebarTextHex })], spacing: { after: 20 } }));
  }
  const skillGroups = normalized.skillGroups.filter((g) => g.skills.length > 0);
  if (skillGroups.length > 0) {
    sidebarParagraphs.push(new Paragraph({ children: [run(CREATIVE_TIMELINE_LABELS.skills.toUpperCase(), { bold: true, size: tokens.fontSizeHalfPoints - 1, colorHex: sidebarTextHex })], spacing: { before: 160, after: 60 } }));
    for (const g of skillGroups) {
      const label = g.label ? `${g.label}: ` : "";
      sidebarParagraphs.push(new Paragraph({ children: [run(label, { bold: true, size: tokens.fontSizeHalfPoints - 2, colorHex: sidebarTextHex }), run(g.skills.join(", "), { size: tokens.fontSizeHalfPoints - 2, colorHex: sidebarTextHex })], spacing: { after: 40 } }));
    }
  }
  /*
    Structured languages are already paired (name + proficiency); the same
    source section is also kept as a raw custom section whose lines are
    unpaired, so rendering both shows Languages twice in this sidebar -
    once correctly and once as detached lines. The raw one is dropped only
    when its sourceSectionId is one the pairs came from, never by heading
    text, so an unrelated "Programming Languages" section survives. With
    the suppressed section's own heading is carried onto the paired block,
    so the candidate's wording is never swapped for a generic label. With
    no structured languages nothing is suppressed and the raw fallback
    renders exactly as before.
  */
  const structuredLanguages = normalized.languages ?? [];
  const representedSectionIds = new Set(structuredLanguages.map((l) => l.sourceSectionId));
  const supersededSections = normalized.customSections.filter(
    (section) => section.sourceSectionId !== undefined && representedSectionIds.has(section.sourceSectionId)
  );
  const languagesHeading = supersededSections[0]?.heading ?? CREATIVE_TIMELINE_LABELS.languages;
  if (structuredLanguages.length > 0) {
    sidebarParagraphs.push(new Paragraph({ children: [run(languagesHeading.toUpperCase(), { bold: true, size: tokens.fontSizeHalfPoints - 1, colorHex: sidebarTextHex })], spacing: { before: 160, after: 60 } }));
    for (const language of structuredLanguages) {
      const line = language.proficiency ? `${language.name} — ${language.proficiency}` : language.name;
      sidebarParagraphs.push(new Paragraph({ children: [run(line, { size: tokens.fontSizeHalfPoints - 2, colorHex: sidebarTextHex })], spacing: { after: 40 } }));
    }
  }
  const languageSections = normalized.customSections
    .filter(isLanguageCustomSection)
    .filter((section) => section.sourceSectionId === undefined || !representedSectionIds.has(section.sourceSectionId));
  for (const section of languageSections) {
    sidebarParagraphs.push(new Paragraph({ children: [run(section.heading.toUpperCase(), { bold: true, size: tokens.fontSizeHalfPoints - 1, colorHex: sidebarTextHex })], spacing: { before: 160, after: 60 } }));
    sidebarParagraphs.push(...renderContentItemsToParagraphs(section.items, { ...contentOpts, sizeHalfPoints: tokens.fontSizeHalfPoints - 2 }));
  }
  const extraSections = normalized.customSections.filter(isSidebarExtraCustomSection);
  for (const section of extraSections) {
    sidebarParagraphs.push(new Paragraph({ children: [run(section.heading.toUpperCase(), { bold: true, size: tokens.fontSizeHalfPoints - 1, colorHex: sidebarTextHex })], spacing: { before: 160, after: 60 } }));
    sidebarParagraphs.push(...renderContentItemsToParagraphs(section.items, { ...contentOpts, sizeHalfPoints: tokens.fontSizeHalfPoints - 2 }));
  }

  const sidebarWidthTwips = Math.round(page.widthTwips * 0.32);
  const mainWidthTwips = page.widthTwips - sidebarWidthTwips - tokens.pageMarginTwips * 2;

  const noBorder = { style: "none" as const, size: 0, color: "auto" };
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [sidebarWidthTwips, mainWidthTwips],
    rows: [
      new TableRow({
        children: [
          new TableCell({ width: { size: sidebarWidthTwips, type: WidthType.DXA }, shading: { fill: sidebarFillHex }, verticalAlign: VerticalAlign.TOP, margins: { top: 200, bottom: 200, left: 160, right: 160 }, children: sidebarParagraphs, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder } }),
          new TableCell({ width: { size: mainWidthTwips, type: WidthType.DXA }, verticalAlign: VerticalAlign.TOP, margins: { top: 200, bottom: 200, left: 200, right: 0 }, children: mainParagraphs, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder } }),
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
    templateId: "creative-timeline",
    format: "docx",
    bytes: Buffer.from(bytes),
    paperSize: context.paperSize,
    density: context.density,
    isEditableNativeDocx: extraction.parseableZip && extraction.requiredPartsPresent,
    validation,
  };
}
