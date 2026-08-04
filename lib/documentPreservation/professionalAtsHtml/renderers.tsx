/*
  TASK 3 - Static renderer. Pure presentational React components -
  Phase 3 AssemblyBlock payload text only, never rewritten. Every
  top-level rendered element carries `data-block-id`/`data-source-*`
  for Playwright measurement (measurement.ts) and QA debugging. Every
  splittable sub-item (bullet/paragraph/detail) carries `data-sub-index`
  so a page-boundary split can target it precisely.

  Sub-item definition per kind (mirrors breakPolicy.ts's own bullet-vs-
  paragraph precedence exactly, so measurement/pagination/rendering
  never disagree about what "item N" means for a given block):
  - experience/volunteer/project entries: bullets if any exist,
    otherwise descriptionParagraphs. (breakPolicy.ts checks
    bulletCount first, same precedence.)
  - education entries: honors followed by details, as one combined
    sequence (breakPolicy.ts's detailCount = honors+details).
  - credential/award entries: details.
  - publication entries: details.
  - custom sections: paragraphs if any exist, otherwise bullets
    (mirrors breakPolicy.ts's custom-section precedence).

  `isContinuation` (from a BlockPlacement) suppresses the block's own
  header re-render on a later page - the header/heading was already
  shown once, on the page where the block/section first appears; a
  continuation fragment shows only its own subRange items, never a
  repeated header (that would be duplicate text - see spec section 11).
*/
import React from "react";
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
import { PROFESSIONAL_ATS_SECTION_LABELS } from "../professionalAtsAssembly/sectionLabels";
import { DENSITY_SPACING, type DensitySpacingTokens } from "./designTokens";

type SubRange = { startIndex: number; endIndex: number };

/*
  Every renderer below defaults spacing to DENSITY_SPACING.comfortable
  when the caller (measurement.ts, the dev preview, or an existing
  TASK 3 test) doesn't pass one - keeps every pre-density-wiring call
  site valid without changes. entryGapPx (gap between sibling blocks in
  one section, applied in ProfessionalAtsFlatContent below) and
  bulletGapPx (gap between a block's own sub-items, applied per-item as
  marginTop so <ul> bullet markers are never blockified by a flex
  parent - see the "why not display:flex on <ul>" note at
  gapMarginTop()) are the two knobs actually wired to rendering.
  skillItemGapPx is intentionally NOT wired: skills render as one
  comma-joined text run (the safest ATS-parsing choice, matching
  textExtraction.ts's own flat-fragment design), which has no natural
  per-item gap to apply - the token stays declared for a future
  chip/pill skill layout, not silently dropped.
*/
const DEFAULT_SPACING = DENSITY_SPACING.comfortable;

function gapMarginTop(index: number, gapPx: number): number {
  return index === 0 ? 0 : gapPx;
}

function val(v: StructuredTextValue | undefined): string | undefined {
  const t = v?.value.trim();
  return t && t.length > 0 ? t : undefined;
}

function joinContact(parts: (string | undefined)[]): string {
  return parts.filter((p): p is string => p !== undefined && p.length > 0).join(" · ");
}

export function experienceLikeSubItemCount(entry: ExperienceEntry | ProjectEntry): number {
  return entry.bullets.length > 0 ? entry.bullets.length : entry.descriptionParagraphs.length;
}
export function educationSubItemCount(entry: EducationEntry): number {
  return entry.honors.length + entry.details.length;
}
export function detailsSubItemCount(entry: CredentialEntry | AwardEntry | PublicationEntry): number {
  return entry.details.length;
}
export function customSectionSubItemCount(section: CustomResumeSection): number {
  return section.paragraphs.length > 0 ? section.paragraphs.length : section.bullets.length;
}

function inRange(index: number, range?: SubRange): boolean {
  if (!range) return true;
  return index >= range.startIndex && index <= range.endIndex;
}

function IdentityView({ block }: { block: AssemblyBlock }) {
  const identity = block.payload as ResumeIdentity;
  const name = val(identity.fullName);
  const headline = val(identity.headline);
  const contact = joinContact([val(identity.email), val(identity.phone), val(identity.location), val(identity.linkedin), val(identity.portfolio)]);
  return (
    <div data-block-id={block.id} data-block-kind="identity">
      {name && <h1 style={{ margin: 0, fontSize: "1.7em" }}>{name}</h1>}
      {headline && <p style={{ margin: "2px 0 0" }}>{headline}</p>}
      {contact.length > 0 && <p style={{ margin: "2px 0 0" }}>{contact}</p>}
    </div>
  );
}

function SummaryView({ block, subRange, isContinuation, spacing = DEFAULT_SPACING }: { block: AssemblyBlock; subRange?: SubRange; isContinuation: boolean; spacing?: DensitySpacingTokens }) {
  const summary = block.payload as ResumeSummary;
  const paragraphs = summary.text.split("\n\n");
  return (
    <div data-block-id={block.id} data-block-kind="summary">
      {paragraphs.map((p, i) => inRange(i, subRange) && !(isContinuation && i < (subRange?.startIndex ?? 0)) && (
        <p key={i} data-sub-index={i} style={{ margin: 0, marginTop: gapMarginTop(i, spacing.bulletGapPx) }}>
          {p}
        </p>
      ))}
    </div>
  );
}

function SkillGroupView({ block }: { block: AssemblyBlock }) {
  const group = block.payload as SkillGroup;
  const skills = group.skills.filter((s) => s.trim().length > 0);
  return (
    <div data-block-id={block.id} data-block-kind="skill-group">
      {group.label && <strong>{group.label}: </strong>}
      <span>{skills.join(", ")}</span>
    </div>
  );
}

function ExperienceLikeView({ block, subRange, isContinuation, spacing = DEFAULT_SPACING }: { block: AssemblyBlock; subRange?: SubRange; isContinuation: boolean; spacing?: DensitySpacingTokens }) {
  const entry = block.payload as ExperienceEntry | ProjectEntry;
  const usesBullets = entry.bullets.length > 0;
  const items = usesBullets ? entry.bullets.map((b) => b.text) : entry.descriptionParagraphs.map((d) => d.value);
  const role = val(("role" in entry ? entry.role : undefined));
  const org = val(("organization" in entry ? entry.organization : "name" in entry ? entry.name : undefined) as StructuredTextValue | undefined);
  const location = "location" in entry ? val(entry.location) : undefined;
  const dateRange = val(entry.dateRangeText);
  return (
    <div data-block-id={block.id} data-block-kind={block.kind} data-source-entry-id={block.sourceEntryId}>
      {!isContinuation && (
        <div data-block-header>
          {(role || org) && (
            <strong>
              {role}
              {role && org ? " — " : ""}
              {org}
            </strong>
          )}
          {(location || dateRange) && <div>{joinContact([location, dateRange])}</div>}
        </div>
      )}
      {items.length > 0 && (
        usesBullets ? (
          <ul style={{ margin: 0, marginTop: isContinuation ? 0 : spacing.bulletGapPx }}>
            {items.map((text, i) => inRange(i, subRange) && <li key={i} data-sub-index={i} style={{ marginTop: gapMarginTop(i, spacing.bulletGapPx) }}>{text}</li>)}
          </ul>
        ) : (
          <>
            {items.map((text, i) => inRange(i, subRange) && (
              <p key={i} data-sub-index={i} style={{ margin: 0, marginTop: isContinuation ? gapMarginTop(i, spacing.bulletGapPx) : spacing.bulletGapPx }}>
                {text}
              </p>
            ))}
          </>
        )
      )}
    </div>
  );
}

function EducationView({ block, subRange, isContinuation, spacing = DEFAULT_SPACING }: { block: AssemblyBlock; subRange?: SubRange; isContinuation: boolean; spacing?: DensitySpacingTokens }) {
  const entry = block.payload as EducationEntry;
  const items = [...entry.honors, ...entry.details].map((d) => d.value);
  const credential = val(entry.credential);
  const institution = val(entry.institution);
  const field = val(entry.fieldOfStudy);
  const location = val(entry.location);
  const dateRange = val(entry.dateRangeText);
  const gpa = val(entry.gpa);
  return (
    <div data-block-id={block.id} data-block-kind="education-entry" data-source-entry-id={block.sourceEntryId}>
      {!isContinuation && (
        <div data-block-header>
          {(credential || institution) && (
            <strong>
              {credential}
              {credential && institution ? ", " : ""}
              {institution}
            </strong>
          )}
          {(field || location || dateRange || gpa) && <div>{joinContact([field, location, dateRange, gpa ? `GPA: ${gpa}` : undefined])}</div>}
        </div>
      )}
      {items.length > 0 && (
        <ul style={{ margin: 0, marginTop: isContinuation ? 0 : spacing.bulletGapPx }}>
          {items.map((text, i) => inRange(i, subRange) && <li key={i} data-sub-index={i} style={{ marginTop: gapMarginTop(i, spacing.bulletGapPx) }}>{text}</li>)}
        </ul>
      )}
    </div>
  );
}

function CredentialView({ block, subRange, isContinuation, spacing = DEFAULT_SPACING }: { block: AssemblyBlock; subRange?: SubRange; isContinuation: boolean; spacing?: DensitySpacingTokens }) {
  const entry = block.payload as CredentialEntry;
  const items = entry.details.map((d) => d.value);
  const name = val(entry.name);
  const issuer = val(entry.issuer);
  const date = val(entry.issueDateText);
  return (
    <div data-block-id={block.id} data-block-kind="credential-entry" data-source-entry-id={block.sourceEntryId}>
      {!isContinuation && (
        <div data-block-header>
          {name && <strong>{name}</strong>}
          {(issuer || date) && <div>{joinContact([issuer, date])}</div>}
        </div>
      )}
      {items.map((text, i) => inRange(i, subRange) && (
        <p key={i} data-sub-index={i} style={{ margin: 0, marginTop: isContinuation ? gapMarginTop(i, spacing.bulletGapPx) : spacing.bulletGapPx }}>
          {text}
        </p>
      ))}
    </div>
  );
}

function AwardView({ block, subRange, isContinuation, spacing = DEFAULT_SPACING }: { block: AssemblyBlock; subRange?: SubRange; isContinuation: boolean; spacing?: DensitySpacingTokens }) {
  const entry = block.payload as AwardEntry;
  const items = entry.details.map((d) => d.value);
  const name = val(entry.name);
  const issuer = val(entry.issuer);
  const date = val(entry.dateText);
  return (
    <div data-block-id={block.id} data-block-kind="award-entry" data-source-entry-id={block.sourceEntryId}>
      {!isContinuation && (
        <div data-block-header>
          {name && <strong>{name}</strong>}
          {(issuer || date) && <div>{joinContact([issuer, date])}</div>}
        </div>
      )}
      {items.map((text, i) => inRange(i, subRange) && (
        <p key={i} data-sub-index={i} style={{ margin: 0, marginTop: isContinuation ? gapMarginTop(i, spacing.bulletGapPx) : spacing.bulletGapPx }}>
          {text}
        </p>
      ))}
    </div>
  );
}

function PublicationView({ block, subRange, isContinuation, spacing = DEFAULT_SPACING }: { block: AssemblyBlock; subRange?: SubRange; isContinuation: boolean; spacing?: DensitySpacingTokens }) {
  const entry = block.payload as PublicationEntry;
  const items = entry.details.map((d) => d.value);
  const title = val(entry.title);
  const venue = val(entry.publisherOrVenue);
  const date = val(entry.dateText);
  const authors = entry.authors.map((a) => a.value).filter((a) => a.trim().length > 0).join(", ");
  return (
    <div data-block-id={block.id} data-block-kind="publication-entry" data-source-entry-id={block.sourceEntryId}>
      {!isContinuation && (
        <div data-block-header>
          {title && <strong>{title}</strong>}
          {(authors || venue || date) && <div>{joinContact([authors || undefined, venue, date])}</div>}
        </div>
      )}
      {items.map((text, i) => inRange(i, subRange) && (
        <p key={i} data-sub-index={i} style={{ margin: 0, marginTop: isContinuation ? gapMarginTop(i, spacing.bulletGapPx) : spacing.bulletGapPx }}>
          {text}
        </p>
      ))}
    </div>
  );
}

function CustomSectionView({ block, subRange, isContinuation, spacing = DEFAULT_SPACING }: { block: AssemblyBlock; subRange?: SubRange; isContinuation: boolean; spacing?: DensitySpacingTokens }) {
  const section = block.payload as CustomResumeSection;
  const usesParagraphs = section.paragraphs.length > 0;
  const items = usesParagraphs ? section.paragraphs.map((p) => p.value) : section.bullets.map((b) => b.text);
  return (
    <div data-block-id={block.id} data-block-kind="custom-section" data-source-entry-id={block.sourceEntryId}>
      {!isContinuation && section.originalHeading && <h3 style={{ margin: 0 }}>{section.originalHeading}</h3>}
      {usesParagraphs
        ? items.map((text, i) => inRange(i, subRange) && (
            <p key={i} data-sub-index={i} style={{ margin: 0, marginTop: isContinuation ? gapMarginTop(i, spacing.bulletGapPx) : spacing.bulletGapPx }}>
              {text}
            </p>
          ))
        : items.length > 0 && (
            <ul style={{ margin: 0, marginTop: isContinuation ? 0 : spacing.bulletGapPx }}>
              {items.map((text, i) => inRange(i, subRange) && <li key={i} data-sub-index={i} style={{ marginTop: gapMarginTop(i, spacing.bulletGapPx) }}>{text}</li>)}
            </ul>
          )}
    </div>
  );
}

export function AssemblyBlockView({
  block,
  subRange,
  isContinuation = false,
  spacing = DEFAULT_SPACING,
}: {
  block: AssemblyBlock;
  subRange?: SubRange;
  isContinuation?: boolean;
  spacing?: DensitySpacingTokens;
}) {
  switch (block.kind) {
    case "identity":
      return <IdentityView block={block} />;
    case "summary":
      return <SummaryView block={block} subRange={subRange} isContinuation={isContinuation} spacing={spacing} />;
    case "skill-group":
      return <SkillGroupView block={block} />;
    case "experience-entry":
    case "volunteer-entry":
    case "project-entry":
      return <ExperienceLikeView block={block} subRange={subRange} isContinuation={isContinuation} spacing={spacing} />;
    case "education-entry":
      return <EducationView block={block} subRange={subRange} isContinuation={isContinuation} spacing={spacing} />;
    case "credential-entry":
      return <CredentialView block={block} subRange={subRange} isContinuation={isContinuation} spacing={spacing} />;
    case "award-entry":
      return <AwardView block={block} subRange={subRange} isContinuation={isContinuation} spacing={spacing} />;
    case "publication-entry":
      return <PublicationView block={block} subRange={subRange} isContinuation={isContinuation} spacing={spacing} />;
    case "custom-section":
      return <CustomSectionView block={block} subRange={subRange} isContinuation={isContinuation} spacing={spacing} />;
    default:
      return null;
  }
}

export function SectionHeadingView({ sectionKey, spacing = DEFAULT_SPACING }: { sectionKey: ProfessionalAtsSectionKey; spacing?: DensitySpacingTokens }) {
  const label = PROFESSIONAL_ATS_SECTION_LABELS[sectionKey];
  if (!label) return null;
  return (
    <h2 data-section-heading={sectionKey} style={{ margin: 0, marginBottom: spacing.headingMarginBottomPx, textTransform: "uppercase" }}>
      {label}
    </h2>
  );
}

/*
  Flat, unpaginated render of every visible section/block in document
  order - used for both the "single scroll" preview mode and the flat
  measurement pass (measurement.ts). No page containers here - the
  caller (PreviewClient.tsx, measurement.ts) supplies the paper-sized
  container and applies sectionGapPx between top-level <section>s;
  entryGapPx (gap between sibling blocks inside one section) is applied
  here since it's a within-this-component concern.
*/
export function ProfessionalAtsFlatContent({ assembly, spacing = DEFAULT_SPACING }: { assembly: ProfessionalAtsAssemblyDocument; spacing?: DensitySpacingTokens }) {
  return (
    <>
      {assembly.sections
        .filter((s) => s.visible)
        .map((section) => (
          <section key={section.key} data-section-key={section.key}>
            <SectionHeadingView sectionKey={section.key} spacing={spacing} />
            <div style={{ display: "flex", flexDirection: "column", gap: spacing.entryGapPx }}>
              {section.blocks.map((block) => (
                <AssemblyBlockView key={block.id} block={block} spacing={spacing} />
              ))}
            </div>
          </section>
        ))}
    </>
  );
}
