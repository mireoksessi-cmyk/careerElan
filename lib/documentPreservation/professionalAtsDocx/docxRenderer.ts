/*
  TASK 4 - Static DOCX renderer. Phase 3 AssemblyBlock payload text
  only, never rewritten - mirrors professionalAtsHtml/renderers.tsx's
  own per-kind field selection EXACTLY so Phase 5B never invents a
  different content policy than Phase 4/5A already established -
  renderers.tsx itself is not imported (React/JSX, not directly
  reusable for docx.js Paragraph/TextRun construction), but every
  field-selection decision below is a direct line-by-line port.

  Phase 5D.3A - experience/volunteer/project entries and custom
  sections render their own `content` array (renderOrderedContentSubItems)
  instead of a bullets-vs-descriptionParagraphs / paragraphs-vs-bullets
  precedence that silently dropped one array whenever an entry
  legitimately mixed both kinds - same fix, same reasoning as
  renderers.tsx's own header comment.

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
  MetricGrid,
  StructuredTextValue,
  EntryContentBlock,
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

/*
  Phase 5D.3A - same as renderHeaderBearingSubItems above, but takes
  each item's own kind instead of one flag applied to every item, so a
  mixed bullet+paragraph entry.content renders each sub-item as its own
  real bullet or plain paragraph (docx has no <ul>-style grouping
  requirement the way HTML does - each Paragraph carries its own
  `bullet` property independently, so there is no "run" concept to
  build here, unlike renderers.tsx's renderOrderedContentBlocks). Order
  is exactly `content`'s own order - never re-sorted, never XOR'd away.
*/
function renderOrderedContentSubItems(block: AssemblyBlock, ctx: BuildContext, content: EntryContentBlock[]) {
  content.forEach((c) => {
    if (!c.text.trim()) return;
    pushParagraph(ctx, block.id, block.sourceEntryId, [run(c.text, ctx, { bold: c.kind === "subheading" })], {
      spacingBeforeTwips: ctx.bulletGapTwips,
      keepLines: true,
      bullet: c.kind === "bullet",
    });
  });
}

function renderExperienceLike(block: AssemblyBlock, ctx: BuildContext, blockGapTwips: number) {
  const entry = block.payload as ExperienceEntry | ProjectEntry;
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
      keepNext: entry.content.length > 0,
    });
  }
  renderOrderedContentSubItems(block, ctx, entry.content);
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
  /* Phase 5D.3D - Generic Academic Composite Parsing. Mirrors
     renderers.tsx's own EducationView isMultiCredential branch exactly
     - identical rendering to before 5D.3D unless a genuine 2+
     credential/institution split occurred. */
  const credentials = entry.credentials.map((c) => c.value);
  const institutions = entry.institutions.map((i) => i.value);
  const fieldsOfStudy = entry.fieldsOfStudy.map((f) => f.value);
  const isMultiCredential = credentials.length >= 2 || institutions.length >= 2;

  let headerLineCount = 0;
  if (isMultiCredential) {
    if (institutions.length > 0) {
      pushParagraph(ctx, block.id, block.sourceEntryId, [run(institutions.join(" / "), ctx, { bold: true })], { spacingBeforeTwips: blockGapTwips, keepNext: true });
      headerLineCount++;
    }
    credentials.forEach((c, i) => {
      const text = fieldsOfStudy[i] ? `${c} — ${fieldsOfStudy[i]}` : c;
      pushParagraph(ctx, block.id, block.sourceEntryId, [run(text, ctx)], { spacingBeforeTwips: headerLineCount === 0 ? blockGapTwips : 0, keepNext: true });
      headerLineCount++;
    });
    if (headerLineCount > 0) ctx.entryHeadersWithKeepNext++;
  } else {
    const headerLine1: TextRun[] = [];
    if (credential || institution) {
      const text = [credential, institution].filter(Boolean).join(credential && institution ? ", " : "");
      headerLine1.push(run(text, ctx, { bold: true }));
    }
    if (headerLine1.length > 0) {
      pushParagraph(ctx, block.id, block.sourceEntryId, headerLine1, { spacingBeforeTwips: blockGapTwips, keepNext: true });
      ctx.entryHeadersWithKeepNext++;
      headerLineCount++;
    }
  }
  const meta = joinContact(isMultiCredential ? [location, dateRange, gpa ? `GPA: ${gpa}` : undefined] : [field, location, dateRange, gpa ? `GPA: ${gpa}` : undefined]);
  if (meta.length > 0) {
    pushParagraph(ctx, block.id, block.sourceEntryId, [run(meta, ctx)], {
      spacingBeforeTwips: headerLineCount > 0 ? 0 : blockGapTwips,
      keepNext: items.length > 0,
    });
  }
  /* Phase 5D.3B - Fallback requirement: every structured field this
     entry would normally render (headerLine1, meta, items) is empty -
     show rawHeaderText verbatim instead of nothing. Mirrors
     renderers.tsx's own RawHeaderFallback exactly. */
  if (headerLineCount === 0 && meta.length === 0 && items.length === 0) {
    renderRawHeaderFallback(block, ctx, blockGapTwips, entry.rawHeaderText);
  }
  renderHeaderBearingSubItems(block, ctx, items, true);
}

function renderRawHeaderFallback(block: AssemblyBlock, ctx: BuildContext, blockGapTwips: number, rawHeaderText: string) {
  const lines = rawHeaderText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  lines.forEach((line, i) => {
    pushParagraph(ctx, block.id, block.sourceEntryId, [run(line, ctx, { bold: i === 0 })], {
      spacingBeforeTwips: i === 0 ? blockGapTwips : 0,
      keepNext: i === 0 && lines.length > 1,
    });
  });
  if (lines.length > 0) ctx.entryHeadersWithKeepNext++;
}

function renderDetailsEntry(
  block: AssemblyBlock,
  ctx: BuildContext,
  blockGapTwips: number,
  header: { primary?: string; primaryLines?: string[]; meta?: (string | undefined)[] },
  items: string[],
  rawHeaderText: string
) {
  /* Phase 5D.3D - "Multiple certificates/licenses/awards on one
     composite line". primaryLines (2+) renders each as its own bold
     paragraph; otherwise identical to the pre-5D.3D single `primary`
     line. */
  const primaryLines = header.primaryLines && header.primaryLines.length >= 2 ? header.primaryLines : header.primary ? [header.primary] : [];
  let headerLineCount = 0;
  primaryLines.forEach((text, i) => {
    pushParagraph(ctx, block.id, block.sourceEntryId, [run(text, ctx, { bold: true })], { spacingBeforeTwips: headerLineCount === 0 ? blockGapTwips : 0, keepNext: true });
    headerLineCount++;
  });
  if (headerLineCount > 0) ctx.entryHeadersWithKeepNext++;
  const meta = joinContact(header.meta ?? []);
  if (meta.length > 0) {
    pushParagraph(ctx, block.id, block.sourceEntryId, [run(meta, ctx)], {
      spacingBeforeTwips: headerLineCount > 0 ? 0 : blockGapTwips,
      keepNext: items.length > 0,
    });
  }
  /* Phase 5D.3B - see renderEducation's own comment above. */
  if (headerLineCount === 0 && meta.length === 0 && items.length === 0) {
    renderRawHeaderFallback(block, ctx, blockGapTwips, rawHeaderText);
  }
  renderHeaderBearingSubItems(block, ctx, items, false);
}

function renderCredential(block: AssemblyBlock, ctx: BuildContext, blockGapTwips: number) {
  const entry = block.payload as CredentialEntry;
  const date = val(entry.issueDateText);
  const expiry = val(entry.expiryDateText);
  const dateRange = expiry ? [date, expiry].filter((d): d is string => !!d).join(" - ") : date;
  renderDetailsEntry(
    block,
    ctx,
    blockGapTwips,
    { primary: val(entry.name), primaryLines: entry.names.map((n) => n.value), meta: [val(entry.issuer), val(entry.location), dateRange, val(entry.credentialId)] },
    entry.details.map((d) => d.value),
    entry.rawHeaderText
  );
}
function renderAward(block: AssemblyBlock, ctx: BuildContext, blockGapTwips: number) {
  const entry = block.payload as AwardEntry;
  renderDetailsEntry(
    block,
    ctx,
    blockGapTwips,
    { primary: val(entry.name), primaryLines: entry.names.map((n) => n.value), meta: [val(entry.issuer), val(entry.dateText)] },
    entry.details.map((d) => d.value),
    entry.rawHeaderText
  );
}
function renderPublication(block: AssemblyBlock, ctx: BuildContext, blockGapTwips: number) {
  const entry = block.payload as PublicationEntry;
  const authors = entry.authors.map((a) => a.value).filter((a) => a.trim().length > 0).join(", ");
  renderDetailsEntry(
    block,
    ctx,
    blockGapTwips,
    { primary: val(entry.title), meta: [authors || undefined, val(entry.publisherOrVenue), val(entry.dateText)] },
    entry.details.map((d) => d.value),
    entry.rawHeaderText
  );
}

function renderCustomSection(block: AssemblyBlock, ctx: BuildContext, blockGapTwips: number) {
  const section = block.payload as CustomResumeSection;

  if (section.originalHeading) {
    pushParagraph(ctx, block.id, block.sourceEntryId, [run(section.originalHeading, ctx, { bold: true })], {
      spacingBeforeTwips: blockGapTwips,
      keepNext: section.content.length > 0,
    });
  }
  renderOrderedContentSubItems(block, ctx, section.content);
}

/*
  Phase 5D.2B - one bold value paragraph + one plain label paragraph
  per MetricEntry, keepNext-linked so Word never breaks a pair across a
  page. DOCX has no natural side-by-side column primitive this renderer
  otherwise uses (every other block here is a linear paragraph flow),
  so entries render as a vertical stack of pairs in the SAME order
  detectMetricGrids found them - preserves the Value<->Label meaning and
  order (spec's actual requirement) rather than chasing a pixel-identical
  multi-column layout across formats.
*/
function renderMetricGrid(block: AssemblyBlock, ctx: BuildContext, blockGapTwips: number) {
  const grid = block.payload as MetricGrid;
  grid.entries.forEach((entry, i) => {
    pushParagraph(ctx, block.id, block.sourceEntryId, [run(entry.value.value, ctx, { bold: true })], {
      spacingBeforeTwips: i === 0 ? blockGapTwips : ctx.bulletGapTwips,
      keepNext: true,
    });
    pushParagraph(ctx, block.id, block.sourceEntryId, [run(entry.label.value, ctx)], {
      spacingBeforeTwips: 0,
      keepLines: true,
    });
  });
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
    case "metric-grid":
      return renderMetricGrid(block, ctx, blockGapTwips);
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
