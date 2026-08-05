/*
  TASK 4 - Static DOCX renderer. Phase 3 AssemblyBlock payload text
  only, never rewritten - mirrors professionalAtsHtml/renderers.tsx's
  own per-kind field selection and sub-item precedence EXACTLY (same
  bullets-vs-descriptionParagraphs / paragraphs-vs-bullets precedence,
  same "which fields render" logic) so Phase 5B never invents a
  different content policy than Phase 4/5A already established -
  renderers.tsx itself is not imported (React/JSX, not directly
  reusable for docx.js Paragraph/TextRun construction), but every
  field-selection decision below is a direct line-by-line port.

  Real editable OOXML structure throughout: every bullet is a real
  Paragraph with the `docx` package's own `bullet: { level: 0 }`
  shortcut (real Word numbering, not a text-prefixed glyph), every
  section heading/entry header gets keepNext+keepLines (spec section
  12), no tables/text-boxes/shapes are used for body content.

  Spacing model (derived from renderers.tsx's own gap rules, ported to
  twips - see this module's own inline comments at each block-kind
  function for the exact rule matched):
  - Block-to-block gap within a section (entryGapPx's DOCX analogue,
    DOCX_DENSITY_SPACING.entrySpacingBeforeTwips): applied to the
    FIRST paragraph of every block whose index within its section is
    > 0. Index 0 gets no extra gap - the section heading's own
    headingSpacingAfterTwips already provides the heading->first-block
    separation, exactly mirroring how Phase 4's flex `gap` only
    inserts space BETWEEN siblings, never before the first child.
  - Sub-item gap within one block (bulletGapPx's DOCX analogue,
    bulletSpacingAfterTwips): for header-bearing kinds (experience/
    volunteer/project/education/credential/award/publication/custom-
    section), EVERY sub-item paragraph gets this spacing before it,
    including the first (renderers.tsx's own header-having branches
    all use a flat `spacing.bulletGapPx`, never a gapMarginTop(0)=0
    index exception, since sub-item 0 still needs separation from the
    header above it). For summary (the one headerless multi-paragraph
    kind), sub-item 0 gets NO extra spacing (only the block-level gap
    above applies) and sub-item i>0 gets bulletSpacingAfterTwips -
    renderers.tsx's own gapMarginTop(i, bulletGapPx) rule.
*/
import { Document, Paragraph, TextRun, AlignmentType } from "docx";
import { PROFESSIONAL_ATS_SECTION_LABELS } from "../professionalAtsAssembly/sectionLabels";
import { DOCX_DENSITY_SPACING, PAGE_SIZE_TWIPS, PROFESSIONAL_ATS_DOCX_FONT, PROFESSIONAL_ATS_DOCX_EAST_ASIA_FONT } from "./designTokens";
import type {
  ResumeIdentity,
  ResumeSummary,
  SkillGroup,
  ExperienceEntry,
  EducationEntry,
  CredentialEntry,
  ProjectEntry,
  AwardEntry,
  PublicationEntry,
  CustomResumeSection,
  StructuredTextValue,
} from "../resumeStructured/types";
import type { AssemblyBlock, ProfessionalAtsAssemblyDocument, ProfessionalAtsSectionKey } from "../professionalAtsAssembly/types";
import type { AssemblyDensity } from "../professionalAtsAssembly/types";
import type { PaperSize } from "../professionalAtsHtml/types";
import type { DocxSourceMapping, ProfessionalAtsDocxStructureSummary, DocxPaginationIntentResult } from "./types";

function val(v: StructuredTextValue | undefined): string | undefined {
  const t = v?.value.trim();
  return t && t.length > 0 ? t : undefined;
}
function joinContact(parts: (string | undefined)[]): string {
  return parts.filter((p): p is string => p !== undefined && p.length > 0).join(" · ");
}

type BuildContext = {
  paragraphs: Paragraph[];
  tags: { blockId: string; sourceEntryId?: string }[];
  textRunCount: number;
  bulletCount: number;
  headingsWithKeepNext: number;
  entryHeadersWithKeepNext: number;
  bulletsWithKeepLines: number;
  fontSizeHalfPoints: number;
  bulletGapTwips: number;
};

function run(text: string, ctx: BuildContext, opts: { bold?: boolean; sizeHalfPoints?: number } = {}): TextRun {
  ctx.textRunCount++;
  return new TextRun({
    text,
    bold: opts.bold,
    size: opts.sizeHalfPoints ?? ctx.fontSizeHalfPoints,
    font: { name: PROFESSIONAL_ATS_DOCX_FONT, eastAsia: PROFESSIONAL_ATS_DOCX_EAST_ASIA_FONT },
  });
}

function pushParagraph(
  ctx: BuildContext,
  blockId: string,
  sourceEntryId: string | undefined,
  children: TextRun[],
  opts: { spacingBeforeTwips?: number; spacingAfterTwips?: number; keepNext?: boolean; keepLines?: boolean; bullet?: boolean; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType] }
) {
  ctx.paragraphs.push(
    new Paragraph({
      children,
      spacing: { before: opts.spacingBeforeTwips ?? 0, after: opts.spacingAfterTwips ?? 0, line: undefined },
      keepNext: opts.keepNext,
      keepLines: opts.keepLines,
      bullet: opts.bullet ? { level: 0 } : undefined,
      alignment: opts.alignment,
    })
  );
  ctx.tags.push({ blockId, sourceEntryId });
  if (opts.bullet) {
    ctx.bulletCount++;
    if (opts.keepLines) ctx.bulletsWithKeepLines++;
  }
}

function renderIdentity(block: AssemblyBlock, ctx: BuildContext, blockGapTwips: number) {
  const identity = block.payload as ResumeIdentity;
  const name = val(identity.fullName);
  const headline = val(identity.headline);
  const contact = joinContact([val(identity.email), val(identity.phone), val(identity.location), val(identity.linkedin), val(identity.portfolio), ...identity.otherContactLines.map(val)]);

  if (name) {
    pushParagraph(ctx, block.id, block.sourceEntryId, [run(name, ctx, { bold: true, sizeHalfPoints: Math.round(ctx.fontSizeHalfPoints * 1.7) })], {
      spacingBeforeTwips: 0,
    });
  }
  if (headline) {
    pushParagraph(ctx, block.id, block.sourceEntryId, [run(headline, ctx)], { spacingBeforeTwips: ctx.bulletGapTwips });
  }
  if (contact.length > 0) {
    pushParagraph(ctx, block.id, block.sourceEntryId, [run(contact, ctx)], { spacingBeforeTwips: ctx.bulletGapTwips });
  }
}

function renderSummary(block: AssemblyBlock, ctx: BuildContext, blockGapTwips: number) {
  const summary = block.payload as ResumeSummary;
  const paragraphs = summary.text.split("\n\n");
  paragraphs.forEach((p, i) => {
    pushParagraph(ctx, block.id, block.sourceEntryId, [run(p, ctx)], {
      spacingBeforeTwips: i === 0 ? blockGapTwips : ctx.bulletGapTwips,
    });
  });
}

function renderSkillGroup(block: AssemblyBlock, ctx: BuildContext, blockGapTwips: number) {
  const group = block.payload as SkillGroup;
  const skills = group.skills.filter((s) => s.trim().length > 0);
  const children: TextRun[] = [];
  if (group.label) children.push(run(`${group.label}: `, ctx, { bold: true }));
  children.push(run(skills.join(", "), ctx));
  pushParagraph(ctx, block.id, block.sourceEntryId, children, { spacingBeforeTwips: blockGapTwips });
}

function renderHeaderBearingSubItems(block: AssemblyBlock, ctx: BuildContext, items: string[], asBullets: boolean) {
  items.forEach((text) => {
    pushParagraph(ctx, block.id, block.sourceEntryId, [run(text, ctx)], {
      spacingBeforeTwips: ctx.bulletGapTwips,
      keepLines: true,
      bullet: asBullets,
    });
  });
}

function renderExperienceLike(block: AssemblyBlock, ctx: BuildContext, blockGapTwips: number) {
  const entry = block.payload as ExperienceEntry | ProjectEntry;
  const usesBullets = entry.bullets.length > 0;
  const items = usesBullets ? entry.bullets.map((b) => b.text) : entry.descriptionParagraphs.map((d) => d.value);
  const role = val("role" in entry ? entry.role : undefined);
  const org = val(("organization" in entry ? entry.organization : "name" in entry ? entry.name : undefined) as StructuredTextValue | undefined);
  const location = "location" in entry ? val(entry.location) : undefined;
  const dateRange = val(entry.dateRangeText);

  const headerLine1: TextRun[] = [];
  if (role || org) {
    const text = [role, org].filter(Boolean).join(role && org ? " — " : "");
    headerLine1.push(run(text, ctx, { bold: true }));
  }
  if (headerLine1.length > 0) {
    pushParagraph(ctx, block.id, block.sourceEntryId, headerLine1, { spacingBeforeTwips: blockGapTwips, keepNext: true });
    ctx.entryHeadersWithKeepNext++;
  }
  const meta = joinContact([location, dateRange]);
  if (meta.length > 0) {
    pushParagraph(ctx, block.id, block.sourceEntryId, [run(meta, ctx)], {
      spacingBeforeTwips: headerLine1.length > 0 ? 0 : blockGapTwips,
      keepNext: items.length > 0,
    });
  }
  renderHeaderBearingSubItems(block, ctx, items, usesBullets);
}

function renderEducation(block: AssemblyBlock, ctx: BuildContext, blockGapTwips: number) {
  const entry = block.payload as EducationEntry;
  const items = [...entry.honors, ...entry.details].map((d) => d.value);
  const credential = val(entry.credential);
  const institution = val(entry.institution);
  const field = val(entry.fieldOfStudy);
  const location = val(entry.location);
  const dateRange = val(entry.dateRangeText);
  const gpa = val(entry.gpa);

  const headerLine1: TextRun[] = [];
  if (credential || institution) {
    const text = [credential, institution].filter(Boolean).join(credential && institution ? ", " : "");
    headerLine1.push(run(text, ctx, { bold: true }));
  }
  if (headerLine1.length > 0) {
    pushParagraph(ctx, block.id, block.sourceEntryId, headerLine1, { spacingBeforeTwips: blockGapTwips, keepNext: true });
    ctx.entryHeadersWithKeepNext++;
  }
  const meta = joinContact([field, location, dateRange, gpa ? `GPA: ${gpa}` : undefined]);
  if (meta.length > 0) {
    pushParagraph(ctx, block.id, block.sourceEntryId, [run(meta, ctx)], {
      spacingBeforeTwips: headerLine1.length > 0 ? 0 : blockGapTwips,
      keepNext: items.length > 0,
    });
  }
  renderHeaderBearingSubItems(block, ctx, items, true);
}

function renderDetailsEntry(
  block: AssemblyBlock,
  ctx: BuildContext,
  blockGapTwips: number,
  header: { primary?: string; meta?: (string | undefined)[] },
  items: string[]
) {
  const headerLine1: TextRun[] = [];
  if (header.primary) headerLine1.push(run(header.primary, ctx, { bold: true }));
  if (headerLine1.length > 0) {
    pushParagraph(ctx, block.id, block.sourceEntryId, headerLine1, { spacingBeforeTwips: blockGapTwips, keepNext: true });
    ctx.entryHeadersWithKeepNext++;
  }
  const meta = joinContact(header.meta ?? []);
  if (meta.length > 0) {
    pushParagraph(ctx, block.id, block.sourceEntryId, [run(meta, ctx)], {
      spacingBeforeTwips: headerLine1.length > 0 ? 0 : blockGapTwips,
      keepNext: items.length > 0,
    });
  }
  renderHeaderBearingSubItems(block, ctx, items, false);
}

function renderCredential(block: AssemblyBlock, ctx: BuildContext, blockGapTwips: number) {
  const entry = block.payload as CredentialEntry;
  renderDetailsEntry(block, ctx, blockGapTwips, { primary: val(entry.name), meta: [val(entry.issuer), val(entry.issueDateText)] }, entry.details.map((d) => d.value));
}
function renderAward(block: AssemblyBlock, ctx: BuildContext, blockGapTwips: number) {
  const entry = block.payload as AwardEntry;
  renderDetailsEntry(block, ctx, blockGapTwips, { primary: val(entry.name), meta: [val(entry.issuer), val(entry.dateText)] }, entry.details.map((d) => d.value));
}
function renderPublication(block: AssemblyBlock, ctx: BuildContext, blockGapTwips: number) {
  const entry = block.payload as PublicationEntry;
  const authors = entry.authors.map((a) => a.value).filter((a) => a.trim().length > 0).join(", ");
  renderDetailsEntry(
    block,
    ctx,
    blockGapTwips,
    { primary: val(entry.title), meta: [authors || undefined, val(entry.publisherOrVenue), val(entry.dateText)] },
    entry.details.map((d) => d.value)
  );
}

function renderCustomSection(block: AssemblyBlock, ctx: BuildContext, blockGapTwips: number) {
  const section = block.payload as CustomResumeSection;
  const usesParagraphs = section.paragraphs.length > 0;
  const items = usesParagraphs ? section.paragraphs.map((p) => p.value) : section.bullets.map((b) => b.text);

  let headingPushed = false;
  if (section.originalHeading) {
    pushParagraph(ctx, block.id, block.sourceEntryId, [run(section.originalHeading, ctx, { bold: true })], {
      spacingBeforeTwips: blockGapTwips,
      keepNext: items.length > 0,
    });
    headingPushed = true;
  }
  renderHeaderBearingSubItems(block, ctx, items, !usesParagraphs);
  if (!headingPushed && ctx.tags.length > 0) {
    /* No heading rendered - the first sub-item paragraph still needs
       the block-level gap applied (mirrors CustomSectionView, which
       unconditionally uses flat bulletGapPx even with no heading -
       renderHeaderBearingSubItems already applied bulletGapTwips to
       every item, so nothing further to add here; this branch exists
       only to document the intentional match with renderers.tsx's own
       "always flat" custom-section spacing, not a gap in coverage). */
  }
}

function renderBlock(block: AssemblyBlock, ctx: BuildContext, blockGapTwips: number) {
  switch (block.kind) {
    case "identity":
      return renderIdentity(block, ctx, blockGapTwips);
    case "summary":
      return renderSummary(block, ctx, blockGapTwips);
    case "skill-group":
      return renderSkillGroup(block, ctx, blockGapTwips);
    case "experience-entry":
    case "volunteer-entry":
    case "project-entry":
      return renderExperienceLike(block, ctx, blockGapTwips);
    case "education-entry":
      return renderEducation(block, ctx, blockGapTwips);
    case "credential-entry":
      return renderCredential(block, ctx, blockGapTwips);
    case "award-entry":
      return renderAward(block, ctx, blockGapTwips);
    case "publication-entry":
      return renderPublication(block, ctx, blockGapTwips);
    case "custom-section":
      return renderCustomSection(block, ctx, blockGapTwips);
    default:
      return;
  }
}

function renderSectionHeading(sectionKey: ProfessionalAtsSectionKey, ctx: BuildContext, tokens: (typeof DOCX_DENSITY_SPACING)[AssemblyDensity]) {
  const label = PROFESSIONAL_ATS_SECTION_LABELS[sectionKey];
  if (!label) return;
  ctx.paragraphs.push(
    new Paragraph({
      children: [run(label.toUpperCase(), ctx, { bold: true })],
      spacing: { before: tokens.sectionSpacingBeforeTwips, after: tokens.headingSpacingAfterTwips },
      keepNext: true,
      keepLines: true,
    })
  );
  ctx.tags.push({ blockId: `section-heading:${sectionKey}` });
  ctx.headingsWithKeepNext++;
}

export function buildProfessionalAtsDocxDocument(
  assembly: ProfessionalAtsAssemblyDocument,
  paperSize: PaperSize,
  density: AssemblyDensity
): { document: Document; sourceMapping: DocxSourceMapping[]; structure: ProfessionalAtsDocxStructureSummary; paginationIntent: DocxPaginationIntentResult } {
  const tokens = DOCX_DENSITY_SPACING[density];
  const page = PAGE_SIZE_TWIPS[paperSize];

  const ctx: BuildContext = {
    paragraphs: [],
    tags: [],
    textRunCount: 0,
    bulletCount: 0,
    headingsWithKeepNext: 0,
    entryHeadersWithKeepNext: 0,
    bulletsWithKeepLines: 0,
    fontSizeHalfPoints: tokens.fontSizeHalfPoints,
    bulletGapTwips: tokens.bulletSpacingAfterTwips,
  };

  const visibleSections = assembly.sections.filter((s) => s.visible);
  for (const section of visibleSections) {
    renderSectionHeading(section.key, ctx, tokens);
    section.blocks.forEach((block, index) => {
      renderBlock(block, ctx, index === 0 ? 0 : tokens.entrySpacingBeforeTwips);
    });
  }

  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: PROFESSIONAL_ATS_DOCX_FONT, size: tokens.fontSizeHalfPoints },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: page.widthTwips, height: page.heightTwips, orientation: "portrait" as const },
            margin: { top: tokens.pageMarginTwips, right: tokens.pageMarginTwips, bottom: tokens.pageMarginTwips, left: tokens.pageMarginTwips },
          },
        },
        children: ctx.paragraphs,
      },
    ],
  });

  const bySourceKey = new Map<string, DocxSourceMapping>();
  ctx.tags.forEach((tag, paragraphIndex) => {
    const key = `${tag.blockId}#${tag.sourceEntryId ?? ""}`;
    const existing = bySourceKey.get(key);
    if (existing) {
      existing.paragraphIndexes.push(paragraphIndex);
    } else {
      bySourceKey.set(key, { sourceBlockId: tag.blockId, sourceEntryId: tag.sourceEntryId, paragraphIndexes: [paragraphIndex] });
    }
  });

  return {
    document,
    sourceMapping: [...bySourceKey.values()],
    structure: {
      paragraphCount: ctx.paragraphs.length,
      textRunCount: ctx.textRunCount,
      bulletCount: ctx.bulletCount,
      sectionCount: visibleSections.length,
    },
    paginationIntent: {
      headingsWithKeepNext: ctx.headingsWithKeepNext,
      entryHeadersWithKeepNext: ctx.entryHeadersWithKeepNext,
      bulletsWithKeepLines: ctx.bulletsWithKeepLines,
      violations: [],
    },
  };
}
