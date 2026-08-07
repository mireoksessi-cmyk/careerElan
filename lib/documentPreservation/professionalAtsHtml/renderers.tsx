/*
  TASK 3 - Static renderer. Pure presentational React components -
  Phase 3 AssemblyBlock payload text only, never rewritten. Every
  top-level rendered element carries `data-block-id`/`data-source-*`
  for Playwright measurement (measurement.ts) and QA debugging. Every
  splittable sub-item (bullet/paragraph/detail) carries `data-sub-index`
  so a page-boundary split can target it precisely.

  Sub-item definition per kind (mirrors breakPolicy.ts's own counts
  exactly, so measurement/pagination/rendering never disagree about
  what "item N" means for a given block):
  - experience/volunteer/project entries, and custom sections: the
    entry/section's own `content` array (Phase 5D.3A) - every body
    block (bullet/paragraph/subheading) in original source order, one
    sub-item per element, GLOBAL content-array index used for both
    data-sub-index and margin math (renderOrderedContentBlocks below).
    This replaced an older "bullets if any exist, else
    descriptionParagraphs" rule that silently dropped an entire array
    whenever an entry legitimately mixed bullets and paragraphs (Phase
    5D.3 UAT's Prior Experience / Government-Funded Projects findings)
    - bullets/descriptionParagraphs/paragraphs still exist on these
    types for other consumers (contentUnits.ts, breakPolicy.ts) but are
    no longer read here.
  - education entries: honors followed by details, as one combined
    sequence (breakPolicy.ts's detailCount = honors+details).
  - credential/award entries: details.
  - publication entries: details.

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
  MetricGrid,
  StructuredTextValue,
  EntryContentBlock,
  HierarchicalContentNode,
} from "../resumeStructured/types";
import type { AssemblyBlock, ProfessionalAtsAssemblyDocument, ProfessionalAtsSectionKey } from "../professionalAtsAssembly/types";
import { PROFESSIONAL_ATS_SECTION_LABELS } from "../professionalAtsAssembly/sectionLabels";
import { resolveMultiFieldOfStudyDisplay } from "./textExtraction";
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

/*
  Phase 5D.3B - Generic Single-Line Header Recovery Hardening's own
  explicit Fallback requirement: if EVERY structured field this block
  would normally render is empty, show the entry's own rawHeaderText
  verbatim instead of nothing - "정보를 숨기지 않는다". This is a
  last-resort safety net, not the primary fix (educationExtractor.ts/
  credentialExtractor.ts/awardExtractor.ts's own date-anchor-strip
  logic already recovers real header text generically in the vast
  majority of shapes) - it only fires when structured extraction truly
  found nothing at all to work with.
*/
function RawHeaderFallback({ rawHeaderText }: { rawHeaderText: string }) {
  const lines = rawHeaderText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  return (
    <div data-raw-header-fallback>
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}

export function experienceLikeSubItemCount(entry: ExperienceEntry | ProjectEntry): number {
  return entry.content.length;
}
export function educationSubItemCount(entry: EducationEntry): number {
  return entry.honors.length + entry.details.length;
}
export function detailsSubItemCount(entry: CredentialEntry | AwardEntry | PublicationEntry): number {
  return entry.details.length;
}
export function customSectionSubItemCount(section: CustomResumeSection): number {
  return section.content.length;
}

function inRange(index: number, range?: SubRange): boolean {
  if (!range) return true;
  return index >= range.startIndex && index <= range.endIndex;
}

/*
  Phase 5D.3A - shared ordered-content renderer for ExperienceLikeView
  and CustomSectionView. Walks `content` once, grouping consecutive
  same-kind ("bullet" vs everything else) items into runs so bullets
  still render inside a single valid <ul> - never re-sorted, never
  XOR'd away, exact original order preserved end to end.

  Margin math reproduces the pre-existing (pure-bullets-only or
  pure-paragraphs-only) visual output byte-for-byte: the very first
  rendered item overall gets 0 top-margin when isContinuation (else
  spacing.bulletGapPx), and every subsequent item - whether the next
  <li> in the same <ul> or the first item of the next run - gets
  spacing.bulletGapPx. data-sub-index is always the block's GLOBAL
  index in `content` (never a per-run local index) so pagination
  (measurement.ts's real DOM query, paginationPlanner.ts's subRange)
  keeps working unchanged - see this file's own header comment.
*/
function renderOrderedContentBlocks(content: EntryContentBlock[], subRange: SubRange | undefined, isContinuation: boolean, spacing: DensitySpacingTokens): React.ReactNode[] {
  type Run = { isBullet: boolean; items: { block: EntryContentBlock; index: number }[] };
  const runs: Run[] = [];
  content.forEach((block, index) => {
    const isBullet = block.kind === "bullet";
    const last = runs[runs.length - 1];
    if (last && last.isBullet === isBullet) last.items.push({ block, index });
    else runs.push({ isBullet, items: [{ block, index }] });
  });

  const rendered: React.ReactNode[] = [];
  let visibleSeen = 0;
  for (const run of runs) {
    const visibleItems = run.items.filter(({ index }) => inRange(index, subRange));
    if (visibleItems.length === 0) continue;
    const isFirstOverall = visibleSeen === 0;
    if (run.isBullet) {
      rendered.push(
        <ul key={`ul-${visibleItems[0].index}`} style={{ margin: 0, marginTop: isFirstOverall && isContinuation ? 0 : spacing.bulletGapPx }}>
          {visibleItems.map(({ block, index }, localIdx) => (
            <li key={index} data-sub-index={index} style={{ marginTop: gapMarginTop(localIdx, spacing.bulletGapPx) }}>
              {block.text}
            </li>
          ))}
        </ul>
      );
    } else {
      visibleItems.forEach(({ block, index }, localIdx) => {
        const isFirstRendered = isFirstOverall && localIdx === 0;
        rendered.push(
          <p
            key={index}
            data-sub-index={index}
            style={{
              margin: 0,
              marginTop: isFirstRendered && isContinuation ? 0 : spacing.bulletGapPx,
              fontWeight: block.kind === "subheading" ? 600 : undefined,
            }}
          >
            {block.text}
          </p>
        );
      });
    }
    visibleSeen += visibleItems.length;
  }
  return rendered;
}

/*
  Phase 5D.7 TASK C - hierarchical counterpart to renderOrderedContentBlocks
  above. Renders ExperienceEntry.hierarchicalContent (a parallel tree view
  over the SAME content[] blocks - see hierarchicalGrouping.ts's own header
  comment) instead of the flat content[] array, used only when
  entry.hasHierarchicalStructure is true. Every node's `id` is identical to
  its corresponding content[] block's `id` (built from the same source
  blocks in the same order), so `indexMap` recovers the original global
  content[] index for data-sub-index/subRange - pagination and measurement
  keep working exactly as they do for the flat path, unchanged. Runs same
  bullet-grouping-into-<ul> logic as renderOrderedContentBlocks, recursing
  into a subheading node's children with one extra indent step per depth.
*/
function buildContentIndexMap(content: EntryContentBlock[]): Map<string, number> {
  const map = new Map<string, number>();
  content.forEach((b, i) => map.set(b.id, i));
  return map;
}

const HIERARCHY_INDENT_PX = 16;

function renderHierarchicalNodes(
  nodes: HierarchicalContentNode[],
  indexMap: Map<string, number>,
  subRange: SubRange | undefined,
  isContinuation: boolean,
  spacing: DensitySpacingTokens,
  depth: number,
  seenRef: { count: number }
): React.ReactNode[] {
  type Run = { isBullet: boolean; items: { node: HierarchicalContentNode; index: number }[] };
  const runs: Run[] = [];
  nodes.forEach((node) => {
    const index = indexMap.get(node.id) ?? -1;
    if (!inRange(index, subRange)) return;
    const isBullet = node.kind === "bullet";
    const last = runs[runs.length - 1];
    if (last && last.isBullet === isBullet) last.items.push({ node, index });
    else runs.push({ isBullet, items: [{ node, index }] });
  });

  const rendered: React.ReactNode[] = [];
  const indentPx = depth * HIERARCHY_INDENT_PX;

  for (const run of runs) {
    if (run.isBullet) {
      const isFirstOverall = seenRef.count === 0;
      rendered.push(
        <ul key={`ul-${run.items[0].index}`} style={{ margin: 0, marginLeft: indentPx, marginTop: isFirstOverall && isContinuation ? 0 : spacing.bulletGapPx }}>
          {run.items.map(({ node, index }, localIdx) => (
            <li key={index} data-sub-index={index} style={{ marginTop: gapMarginTop(localIdx, spacing.bulletGapPx) }}>
              {node.text}
            </li>
          ))}
        </ul>
      );
      seenRef.count += run.items.length;
      run.items.forEach(({ node }) => {
        if (node.children.length > 0) rendered.push(...renderHierarchicalNodes(node.children, indexMap, subRange, isContinuation, spacing, depth + 1, seenRef));
      });
    } else {
      run.items.forEach(({ node, index }, localIdx) => {
        const isFirstRendered = seenRef.count === 0 && localIdx === 0;
        rendered.push(
          <p
            key={index}
            data-sub-index={index}
            data-hierarchy-depth={depth}
            style={{
              margin: 0,
              marginLeft: indentPx,
              marginTop: isFirstRendered && isContinuation ? 0 : spacing.bulletGapPx,
              fontWeight: node.kind === "subheading" ? 600 : undefined,
            }}
          >
            {node.text}
          </p>
        );
        seenRef.count += 1;
        if (node.children.length > 0) {
          rendered.push(...renderHierarchicalNodes(node.children, indexMap, subRange, isContinuation, spacing, depth + 1, seenRef));
        }
      });
    }
  }

  /*
    Phase 6F.1 - real-resume hardening found a genuine content-loss bug
    here: the `nodes.forEach` filter above (`if (!inRange...) return`)
    decides BOTH "does this node get its own row on this page" AND,
    implicitly, "do we ever recurse into this node's children" - the
    two are conflated because a node whose own index fails inRange()
    never reaches the runs/rendering loop above, so its children (which
    can have their OWN, later indices legitimately in range) are never
    visited at all. Confirmed via direct reproduction: a hierarchical
    experience entry split so that a later page's subRange covers only
    a deeply-nested bullet (its ancestor subheading's row already
    rendered on an earlier page fragment, so the ancestor's own index
    is out of THIS page's subRange) silently rendered zero content for
    that bullet, even though a full unsliced render proves the bullet
    exists. Fix: separately walk every node whose OWN row was NOT
    rendered above and still recurse into its children - an ancestor
    being off-page never implies its descendants are off-page too.
  */
  for (const node of nodes) {
    const index = indexMap.get(node.id) ?? -1;
    if (inRange(index, subRange)) continue; // already handled via the runs loop above
    if (node.children.length > 0) {
      rendered.push(...renderHierarchicalNodes(node.children, indexMap, subRange, isContinuation, spacing, depth + 1, seenRef));
    }
  }

  return rendered;
}

function IdentityView({ block }: { block: AssemblyBlock }) {
  const identity = block.payload as ResumeIdentity;
  const name = val(identity.fullName);
  const headline = val(identity.headline);
  const contact = joinContact([
    val(identity.email),
    val(identity.phone),
    val(identity.location),
    val(identity.linkedin),
    val(identity.portfolio),
    ...identity.otherContactLines.map(val),
  ]);
  return (
    <div data-block-id={block.id} data-block-kind="identity">
      {name && <h1 style={{ margin: 0, fontSize: "1.7em" }}>{name}</h1>}
      {headline && <p style={{ margin: "2px 0 0" }}>{headline}</p>}
      {contact.length > 0 && (
        <p className="ats-identity-contact" style={{ margin: "2px 0 0" }}>
          {contact}
        </p>
      )}
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
      {"hasHierarchicalStructure" in entry && entry.hasHierarchicalStructure && entry.hierarchicalContent.length > 0
        ? renderHierarchicalNodes(entry.hierarchicalContent, buildContentIndexMap(entry.content), subRange, isContinuation, spacing, 0, { count: 0 })
        : renderOrderedContentBlocks(entry.content, subRange, isContinuation, spacing)}
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
  /* Phase 5D.3D - Generic Academic Composite Parsing. entry.credentials/
     institutions[0] always equals entry.credential/institution (see
     educationExtractor.ts's own comment), so isMultiCredential is
     false and this renders IDENTICALLY to before 5D.3D for every
     existing single-degree entry - only a genuine Double Degree/Joint
     Program (2+ credentials or institutions) takes the new branch. */
  const credentials = entry.credentials.map((c) => c.value);
  const institutions = entry.institutions.map((i) => i.value);
  const fieldsOfStudy = entry.fieldsOfStudy.map((f) => f.value);
  const isMultiCredential = credentials.length >= 2 || institutions.length >= 2;
  /* Phase 5D.6E TASK A - a double major/minor/concentration under a
     SINGLE credential+institution (fieldsOfStudy.length >= 2 but
     isMultiCredential false) never took the multi-credential branch
     below, so only field (fieldsOfStudy[0]) ever rendered - see
     resolveMultiFieldOfStudyDisplay's own comment for the real bug
     this fixes (r07's "Political Science"). undefined here (0-1
     fieldsOfStudy) falls through to the existing singular `field`. */
  const multiFieldDisplay = resolveMultiFieldOfStudyDisplay(entry);
  const fieldDisplay = multiFieldDisplay ?? field;
  const hasAnyStructuredField = credential || institution || fieldDisplay || location || dateRange || gpa || items.length > 0;
  return (
    <div data-block-id={block.id} data-block-kind="education-entry" data-source-entry-id={block.sourceEntryId}>
      {!isContinuation && (
        <div data-block-header>
          {isMultiCredential ? (
            <>
              {institutions.length > 0 && <strong>{institutions.join(" / ")}</strong>}
              {credentials.map((c, i) => (
                <div key={i} data-multi-credential-index={i}>{fieldsOfStudy[i] ? `${c} — ${fieldsOfStudy[i]}` : c}</div>
              ))}
              {(location || dateRange || gpa) && <div>{joinContact([location, dateRange, gpa ? `GPA: ${gpa}` : undefined])}</div>}
            </>
          ) : (
            <>
              {(credential || institution) && (
                <strong>
                  {credential}
                  {credential && institution ? ", " : ""}
                  {institution}
                </strong>
              )}
              {(fieldDisplay || location || dateRange || gpa) && <div>{joinContact([fieldDisplay, location, dateRange, gpa ? `GPA: ${gpa}` : undefined])}</div>}
            </>
          )}
          {!hasAnyStructuredField && <RawHeaderFallback rawHeaderText={entry.rawHeaderText} />}
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
  const expiry = val(entry.expiryDateText);
  const credentialId = val(entry.credentialId);
  const location = val(entry.location);
  const dateRange = expiry ? [date, expiry].filter((d): d is string => !!d).join(" - ") : date;
  const hasAnyStructuredField = name || issuer || date || expiry || credentialId || location || items.length > 0;
  /* Phase 5D.3D - "Multiple certificates/licenses on one line". names[0]
     always equals name (see credentialExtractor.ts's own comment), so
     this renders IDENTICALLY to before 5D.3D unless a genuine 2+
     credential split occurred. */
  const names = entry.names.map((n) => n.value);
  const isMultiName = names.length >= 2;
  return (
    <div data-block-id={block.id} data-block-kind="credential-entry" data-source-entry-id={block.sourceEntryId}>
      {!isContinuation && (
        <div data-block-header>
          {isMultiName ? names.map((n, i) => <div key={i} data-multi-name-index={i}><strong>{n}</strong></div>) : name && <strong>{name}</strong>}
          {(issuer || dateRange || location) && <div>{joinContact([issuer, location, dateRange])}</div>}
          {credentialId && <div>{credentialId}</div>}
          {!hasAnyStructuredField && <RawHeaderFallback rawHeaderText={entry.rawHeaderText} />}
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
  const hasAnyStructuredField = name || issuer || date || items.length > 0;
  /* Phase 5D.3D - "Multiple awards on one composite line". */
  const names = entry.names.map((n) => n.value);
  const isMultiName = names.length >= 2;
  return (
    <div data-block-id={block.id} data-block-kind="award-entry" data-source-entry-id={block.sourceEntryId}>
      {!isContinuation && (
        <div data-block-header>
          {isMultiName ? names.map((n, i) => <div key={i} data-multi-name-index={i}><strong>{n}</strong></div>) : name && <strong>{name}</strong>}
          {(issuer || date) && <div>{joinContact([issuer, date])}</div>}
          {!hasAnyStructuredField && <RawHeaderFallback rawHeaderText={entry.rawHeaderText} />}
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
  const hasAnyStructuredField = title || authors || venue || date || items.length > 0;
  return (
    <div data-block-id={block.id} data-block-kind="publication-entry" data-source-entry-id={block.sourceEntryId}>
      {!isContinuation && (
        <div data-block-header>
          {title && <strong>{title}</strong>}
          {(authors || venue || date) && <div>{joinContact([authors || undefined, venue, date])}</div>}
          {!hasAnyStructuredField && <RawHeaderFallback rawHeaderText={entry.rawHeaderText} />}
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
  return (
    <div data-block-id={block.id} data-block-kind="custom-section" data-source-entry-id={block.sourceEntryId}>
      {!isContinuation && section.originalHeading && <h3 style={{ margin: 0 }}>{section.originalHeading}</h3>}
      {renderOrderedContentBlocks(section.content, subRange, isContinuation, spacing)}
    </div>
  );
}

/*
  Phase 5D.2B - one Value/Label pair per column, wrapped so a 4-column
  KPI band still reads correctly if the paper is too narrow (same
  general-layout reasoning as ExperienceLikeView - never a fixed pixel
  width tied to any one resume's own column count). Never splittable
  (breakPolicy.ts's own "whole-block" policy for this kind) - subRange/
  isContinuation are accepted for signature consistency with every
  other block view but have no effect here, mirroring IdentityView/
  SkillGroupView's own treatment of non-splittable kinds.
*/
function MetricGridView({ block, spacing = DEFAULT_SPACING }: { block: AssemblyBlock; spacing?: DensitySpacingTokens }) {
  const grid = block.payload as MetricGrid;
  return (
    <div data-block-id={block.id} data-block-kind="metric-grid" data-source-entry-id={block.sourceEntryId} style={{ display: "flex", flexWrap: "wrap", gap: spacing.entryGapPx }}>
      {grid.entries.map((entry) => (
        <div key={entry.id} data-sub-index={entry.id} style={{ display: "flex", flexDirection: "column" }}>
          <strong style={{ fontSize: "1.15em" }}>{entry.value.value}</strong>
          {/* No CSS text-transform here (unlike SectionHeadingView's
              already-canonically-uppercase labels) - a metric label's
              case comes straight from the source document and must
              render verbatim; text-transform would visually uppercase
              it but leave the DOM text node (and therefore the PDF's
              exported glyphs) mismatched against the canonical parity
              manifest for any label that isn't already all-caps in the
              source (real-fixture evidence bug, caught by f11's
              deliberately mixed-case labels). */}
          <span style={{ fontSize: "0.75em", letterSpacing: "0.03em" }}>{entry.label.value}</span>
        </div>
      ))}
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
    case "metric-grid":
      return <MetricGridView block={block} spacing={spacing} />;
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
