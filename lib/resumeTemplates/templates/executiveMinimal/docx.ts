/*
  Phase 6F - Template 3, Executive Minimal DOCX renderer. Real native
  OOXML via the `docx` npm package (Document/Paragraph/TextRun/real
  Word bullet numbering), never an HTML->DOCX conversion and never a
  PDF-as-image embed. Consumes the same shared NormalizedResume every
  other format for this template consumes.
*/
import { AlignmentType, Document, Packer, Paragraph, TextRun } from "docx";
import { normalizeResume, experienceHeaderFallbackText, educationHeaderFallbackText } from "../../shared/contentAdapters";
import { EXECUTIVE_MINIMAL_FONTS } from "../../shared/typography";
import { DOCX_DENSITY_SPACING } from "../../shared/spacing";
import { renderContentItemsToParagraphs } from "../../docx/renderContentItems";
import { PAGE_SIZE_TWIPS } from "../../../documentPreservation/professionalAtsDocx/designTokens";
import { EXECUTIVE_MINIMAL_SECTION_ORDER, EXECUTIVE_MINIMAL_SECTION_LABELS } from "./sectionPolicy";
import { computeSectionVisibility } from "../../shared/sectionAdapters";
import { extractDocx } from "../../parity/docxExtraction";
import { expectedFragmentsForResume } from "../../parity/textFragments";
import { buildValidationReport } from "../../parity/validateOutput";
import type { TemplateDocxResult, TemplateRenderContext } from "../../contracts/types";

export async function renderExecutiveMinimalDocx(context: TemplateRenderContext): Promise<TemplateDocxResult> {
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
  const fonts = EXECUTIVE_MINIMAL_FONTS;
  const tokens = DOCX_DENSITY_SPACING[context.density];
  const page = PAGE_SIZE_TWIPS[context.paperSize];

  const paragraphs: Paragraph[] = [];
  const run = (text: string, opts: { bold?: boolean; size?: number; color?: string } = {}) => new TextRun({ text, bold: opts.bold, size: opts.size ?? tokens.fontSizeHalfPoints, font: { name: fonts.docxBodyFont, eastAsia: fonts.docxEastAsiaFont }, color: opts.color });
  const contentItemOpts = { fontName: fonts.docxBodyFont, eastAsiaFont: fonts.docxEastAsiaFont, sizeHalfPoints: tokens.fontSizeHalfPoints, spacingAfterTwips: tokens.bulletSpacingAfterTwips, depthIndentTwips: tokens.bulletIndentTwips };

  const heading = (label: string) => {
    paragraphs.push(new Paragraph({ children: [run(label.toUpperCase(), { bold: true, size: tokens.fontSizeHalfPoints + 1 })], spacing: { before: tokens.sectionSpacingBeforeTwips, after: tokens.headingSpacingAfterTwips }, keepNext: true, border: { bottom: { color: "999999", space: 2, style: "single", size: 4 } } }));
  };

  const visible = computeSectionVisibility(EXECUTIVE_MINIMAL_SECTION_ORDER, normalized, context.sectionVisibility)
    .filter((d) => d.visible)
    .map((d) => d.key);

  for (const key of visible) {
    if (key === "identity") {
      paragraphs.push(new Paragraph({ children: [run(normalized.identity.fullName, { bold: true, size: tokens.fontSizeHalfPoints + 8 })], alignment: AlignmentType.CENTER, spacing: { after: 40 } }));
      if (normalized.identity.headline) paragraphs.push(new Paragraph({ children: [run(normalized.identity.headline, { bold: true })], alignment: AlignmentType.CENTER, spacing: { after: 40 } }));
      const contactLine = [normalized.identity.location, normalized.identity.phone, normalized.identity.email, normalized.identity.linkedin, normalized.identity.portfolio].filter(Boolean).join(" · ");
      if (contactLine) paragraphs.push(new Paragraph({ children: [run(contactLine)], alignment: AlignmentType.CENTER, spacing: { after: tokens.sectionSpacingBeforeTwips } }));
      for (const line of normalized.identity.otherContactLines) paragraphs.push(new Paragraph({ children: [run(line)], alignment: AlignmentType.CENTER, spacing: { after: 40 } }));
      continue;
    }
    if (key === "metricHighlights") {
      const grid = normalized.metricGrids[0];
      if (!grid) continue;
      heading(EXECUTIVE_MINIMAL_SECTION_LABELS.metricHighlights ?? "Highlights");
      const line = grid.entries.map((e) => `${e.value} ${e.label}`).join("   |   ");
      paragraphs.push(new Paragraph({ children: [run(line, { bold: true })], alignment: AlignmentType.CENTER, spacing: { after: tokens.entrySpacingBeforeTwips } }));
      continue;
    }
    if (key === "summary") {
      if (!normalized.summary) continue;
      heading(EXECUTIVE_MINIMAL_SECTION_LABELS.summary ?? "Executive Summary");
      paragraphs.push(new Paragraph({ children: [run(normalized.summary)], spacing: { after: tokens.entrySpacingBeforeTwips } }));
      continue;
    }
    if (key === "skills") {
      const groups = normalized.skillGroups.filter((g) => g.skills.length > 0);
      if (groups.length === 0) continue;
      heading(EXECUTIVE_MINIMAL_SECTION_LABELS.skills ?? "Core Competencies");
      for (const g of groups) {
        const label = g.label ? `${g.label}: ` : "";
        paragraphs.push(new Paragraph({ children: [run(label, { bold: true }), run(g.skills.join(", "))], spacing: { after: 40 } }));
      }
      continue;
    }
    if (key === "experience" || key === "volunteer") {
      const entries = key === "experience" ? normalized.professionalExperience : normalized.volunteerExperience;
      if (entries.length === 0) continue;
      heading(EXECUTIVE_MINIMAL_SECTION_LABELS[key] ?? key);
      for (const entry of entries) {
        const rawFallback = experienceHeaderFallbackText(entry);
        if (rawFallback) {
          /* rawHeaderText already embeds any date/location text verbatim,
             so the separately-extracted date is suppressed to avoid
             showing it twice. */
          paragraphs.push(new Paragraph({ children: [run(rawFallback, { bold: true })], spacing: { before: tokens.entrySpacingBeforeTwips }, keepNext: true }));
        } else {
          const headerText = [entry.role, entry.organization].filter(Boolean).join(", ");
          paragraphs.push(new Paragraph({ children: [run(headerText, { bold: true }), run(entry.dateRangeText ? `   —   ${entry.dateRangeText}` : "")], spacing: { before: tokens.entrySpacingBeforeTwips }, keepNext: true }));
        }
        if (!rawFallback && entry.location) paragraphs.push(new Paragraph({ children: [run(entry.location, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
        paragraphs.push(...renderContentItemsToParagraphs(entry.items, contentItemOpts));
      }
      continue;
    }
    if (key === "projects") {
      if (normalized.projects.length === 0) continue;
      heading(EXECUTIVE_MINIMAL_SECTION_LABELS.projects ?? "Selected Initiatives");
      for (const p of normalized.projects) {
        paragraphs.push(new Paragraph({ children: [run(p.name, { bold: true }), run(p.dateRangeText ? `   —   ${p.dateRangeText}` : "")], spacing: { before: tokens.entrySpacingBeforeTwips }, keepNext: true }));
        if (p.role) paragraphs.push(new Paragraph({ children: [run(p.role, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
        paragraphs.push(...renderContentItemsToParagraphs(p.items, contentItemOpts));
        if (p.technologies.length > 0) paragraphs.push(new Paragraph({ children: [run(`Technologies: ${p.technologies.join(", ")}`, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
      }
      continue;
    }
    if (key === "education") {
      if (normalized.education.length === 0) continue;
      heading(EXECUTIVE_MINIMAL_SECTION_LABELS.education ?? "Education");
      for (const edu of normalized.education) {
        const eduFallback = educationHeaderFallbackText(edu);
        if (eduFallback) {
          paragraphs.push(new Paragraph({ children: [run(eduFallback, { bold: true })], spacing: { before: tokens.entrySpacingBeforeTwips }, keepNext: true }));
          continue;
        }
        paragraphs.push(new Paragraph({ children: [run(edu.institution || edu.institutions.join(" / "), { bold: true }), run(edu.dateRangeText ? `   —   ${edu.dateRangeText}` : "")], spacing: { before: tokens.entrySpacingBeforeTwips }, keepNext: true }));
        const creds = edu.credentials.join(", ") || edu.credential;
        if (creds) paragraphs.push(new Paragraph({ children: [run(creds)], spacing: { after: 20 } }));
        if (edu.fieldsOfStudy.length > 0) paragraphs.push(new Paragraph({ children: [run(edu.fieldsOfStudy.join(" & "), { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
        if (edu.gpa) paragraphs.push(new Paragraph({ children: [run(`GPA: ${edu.gpa}`, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
        if (edu.honors.length > 0) paragraphs.push(new Paragraph({ children: [run(edu.honors.join(", "), { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
        for (const d of edu.details) paragraphs.push(new Paragraph({ children: [run(d, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
      }
      continue;
    }
    if (key === "credentials") {
      if (normalized.credentials.length === 0) continue;
      heading(EXECUTIVE_MINIMAL_SECTION_LABELS.credentials ?? "Credentials");
      for (const c of normalized.credentials) {
        const line = [c.name || c.names.join(", "), c.issuer, c.issueDateText, c.expiryDateText].filter(Boolean).join(" — ");
        paragraphs.push(new Paragraph({ children: [run(line)], spacing: { after: 40 } }));
        if (c.credentialId) paragraphs.push(new Paragraph({ children: [run(`Credential ID: ${c.credentialId}`, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
        for (const d of c.details) paragraphs.push(new Paragraph({ children: [run(d, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
      }
      continue;
    }
    if (key === "awards") {
      if (normalized.awards.length === 0) continue;
      heading(EXECUTIVE_MINIMAL_SECTION_LABELS.awards ?? "Awards & Recognition");
      for (const a of normalized.awards) {
        const line = [a.name || a.names.join(", "), a.issuer, a.dateText].filter(Boolean).join(" — ");
        paragraphs.push(new Paragraph({ children: [run(line)], spacing: { after: 40 } }));
        for (const d of a.details) paragraphs.push(new Paragraph({ children: [run(d, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
      }
      continue;
    }
    if (key === "publications") {
      if (normalized.publications.length === 0) continue;
      heading(EXECUTIVE_MINIMAL_SECTION_LABELS.publications ?? "Publications");
      for (const p of normalized.publications) {
        const line = [p.title || p.titles.join(", "), p.authors.join(", "), p.publisherOrVenue, p.dateText].filter(Boolean).join(" — ");
        paragraphs.push(new Paragraph({ children: [run(line)], spacing: { after: 20 } }));
        if (p.urlOrDoi) paragraphs.push(new Paragraph({ children: [run(p.urlOrDoi, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 40 } }));
        for (const d of p.details) paragraphs.push(new Paragraph({ children: [run(d, { size: tokens.fontSizeHalfPoints - 2 })], spacing: { after: 20 } }));
      }
      continue;
    }
    if (key === "custom") {
      /*
        Structured languages are already paired (name + proficiency); the
        same source section is also kept as a raw custom section whose
        lines are unpaired, so rendering both shows Languages twice - once
        correctly and once as detached lines. The raw one is dropped only
        when its sourceSectionId is one the pairs came from, never by
        heading text, so an unrelated "Programming Languages" section
        survives. The suppressed section's own heading is carried onto the
        paired block, so the candidate's wording is never swapped for a
        generic label. With no structured languages nothing is suppressed
        and the raw fallback renders exactly as before.
      */
      const structuredLanguages = normalized.languages ?? [];
      const representedSectionIds = new Set(structuredLanguages.map((l) => l.sourceSectionId));
      const supersededSections = normalized.customSections.filter(
        (section) => section.sourceSectionId !== undefined && representedSectionIds.has(section.sourceSectionId)
      );
      const languagesHeading = supersededSections[0]?.heading ?? "Languages";
      if (structuredLanguages.length > 0) {
        heading(languagesHeading);
        for (const language of structuredLanguages) {
          const line = language.proficiency ? `${language.name} — ${language.proficiency}` : language.name;
          paragraphs.push(new Paragraph({ children: [run(line)], spacing: { after: 40 } }));
        }
      }
      for (const section of normalized.customSections) {
        if (section.sourceSectionId !== undefined && representedSectionIds.has(section.sourceSectionId)) continue;
        heading(section.heading);
        paragraphs.push(...renderContentItemsToParagraphs(section.items, contentItemOpts));
      }
      continue;
    }
  }

  const document = new Document({
    styles: { default: { document: { run: { font: fonts.docxBodyFont, size: tokens.fontSizeHalfPoints } } } },
    sections: [{ properties: { page: { size: { width: page.widthTwips, height: page.heightTwips, orientation: "portrait" as const }, margin: { top: tokens.pageMarginTwips, right: tokens.pageMarginTwips, bottom: tokens.pageMarginTwips, left: tokens.pageMarginTwips } } }, children: paragraphs }],
  });

  const buffer = await Packer.toBuffer(document);
  const bytes = new Uint8Array(buffer);
  const extraction = await extractDocx(bytes);

  const expectedFragments = expectedFragmentsForResume(normalized);
  const headingsInOrder = EXECUTIVE_MINIMAL_SECTION_ORDER.filter((k) => k !== "identity")
    .map((k) => EXECUTIVE_MINIMAL_SECTION_LABELS[k])
    .filter((label): label is string => Boolean(label))
    .filter((label) => extraction.text.toLowerCase().includes(label.toLowerCase()));

  const validation = buildValidationReport({
    expectedFragments,
    extractedText: extraction.text,
    sectionHeadingsInOrder: headingsInOrder,
    identityFragments: [normalized.identity.fullName, normalized.identity.email].filter(Boolean),
    structuralPassed: extraction.validZipHeader && extraction.parseableZip && extraction.requiredPartsPresent && extraction.macroFree,
    structuralIssues: extraction.missingParts.map((p) => ({ code: "missing-part", message: p })),
  });

  return {
    templateId: "executive-minimal",
    format: "docx",
    bytes: Buffer.from(bytes),
    paperSize: context.paperSize,
    density: context.density,
    isEditableNativeDocx: extraction.parseableZip && extraction.requiredPartsPresent,
    validation,
  };
}
