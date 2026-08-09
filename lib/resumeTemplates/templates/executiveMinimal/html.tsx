/*
  Phase 6F - Template 3, Executive Minimal HTML renderer. Single
  column, wide margins, strong name/title hierarchy, a metric-highlight
  band, hierarchical experience support - built entirely from the
  shared contentAdapters/sectionAdapters/colorTokens/typography/
  spacing/pagination layer, never re-parsing ResumeStructuredModel
  itself (spec section 4's "Template이 Canonical Runtime을 직접
  제각각 파싱하면 안 된다").
*/
import React from "react";
import { normalizeResume, type NormalizedExperienceEntry } from "../../shared/contentAdapters";
import { computeSectionVisibility, type SectionKey } from "../../shared/sectionAdapters";
import { EXECUTIVE_MINIMAL_COLORS } from "../../shared/colorTokens";
import { EXECUTIVE_MINIMAL_FONTS, MIN_SAFE_FONT_SIZE_PT } from "../../shared/typography";
import { HTML_DENSITY_SPACING, type HtmlSpacingTokens } from "../../shared/spacing";
import { PAPER_DIMENSIONS } from "../../shared/paperSizes";
import { ContentItemsView } from "../../shared/ContentItemsView";
import { renderHtmlDocument } from "../../shared/documentShell";
import { measureFlowLayout, groupPlacementsByPage, type FlowBlockSpec } from "../../shared/htmlPagination";
import { resolveHtmlLang } from "../../shared/accessibility";
import { EXECUTIVE_MINIMAL_SECTION_ORDER, EXECUTIVE_MINIMAL_SECTION_LABELS } from "./sectionPolicy";
import type { TemplateHtmlResult, TemplateRenderContext } from "../../contracts/types";
import { buildValidationReport } from "../../parity/validateOutput";
import { expectedFragmentsForResume } from "../../parity/textFragments";
import { extractVisibleTextFromHtml } from "../../shared/htmlText";

type FlowItem = { id: string; sectionKey: SectionKey; node: React.ReactNode };

function ExperienceEntryBlock({ entry, colors, entryGapPx }: { entry: NormalizedExperienceEntry; colors: typeof EXECUTIVE_MINIMAL_COLORS; entryGapPx: number }): React.ReactElement {
  return (
    <div style={{ marginBottom: entryGapPx }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontWeight: 700, color: colors.heading }}>
          {entry.role}
          {entry.role && entry.organization ? ", " : ""}
          {entry.organization}
        </span>
        <span style={{ color: colors.muted, fontSize: "0.9em" }}>{entry.dateRangeText}</span>
      </div>
      {entry.location && <div style={{ color: colors.muted, fontSize: "0.85em" }}>{entry.location}</div>}
      <ContentItemsView items={entry.items} textColor={colors.text} />
    </div>
  );
}

/*
  Phase 6I.6.17 - section-to-section separation was previously
  indistinguishable from within-section item separation (every entry's
  own small marginBottom, e.g. 4-10px, was the ONLY space between the
  last item of one section and the next section's heading - no extra
  gap was ever added before a heading). This is the reported "PROJECTS/
  EDUCATION/CERTIFICATIONS look like one continuous block" bug.
  tokens.sectionGapPx (materially larger than tokens.entryGapPx) is now
  applied as the heading's own paddingTop (NOT marginTop) - skipped
  for the first rendered section only, so the header block's own
  spacing isn't doubled up. paddingTop is required here, not margin:
  this h2 is always the first child of its <section>, which is always
  the first (and only, for i===0 items) child of the flow-item's own
  <div data-flow-id> wrapper - a block's own top margin on a first-in-
  chain descendant collapses THROUGH every unpadded/unbordered
  ancestor and escapes the wrapper div's own measured box entirely
  (standard CSS margin-collapsing), so measureFlowLayout's
  getBoundingClientRect() height query would silently miss that space.
  Confirmed by direct reproduction: marginTop here under-measured
  every subsequent page's content height, and the real Playwright PDF
  render overflowed onto an extra page beyond what the pagination plan
  predicted (executiveMinimal.test.ts's pdf.pageCount stayed 2 while
  the actual rendered PDF produced 3). padding never collapses and is
  always included in getBoundingClientRect(), so it can't reproduce
  this bug. Since a hidden section never contributes an item to
  `items` at all, a hidden section can never leave a "ghost" gap behind
  - the next VISIBLE section's heading always sits exactly sectionGapPx
  below whatever actually rendered before it.
*/
function buildFlowItems(normalized: ReturnType<typeof normalizeResume>, visible: SectionKey[], colors: typeof EXECUTIVE_MINIMAL_COLORS, tokens: HtmlSpacingTokens): { items: FlowItem[]; headingsInOrder: string[] } {
  const items: FlowItem[] = [];
  const headingsInOrder: string[] = [];
  let firstContentSectionSeen = false;

  const heading = (key: SectionKey) => {
    const label = key === "identity" ? "" : (EXECUTIVE_MINIMAL_SECTION_LABELS[key] ?? key);
    if (label) headingsInOrder.push(label);
    if (!label) return null;
    const paddingTop = firstContentSectionSeen ? tokens.sectionGapPx : 0;
    firstContentSectionSeen = true;
    return (
      <h2 style={{ fontFamily: EXECUTIVE_MINIMAL_FONTS.heading, fontSize: "1.05em", letterSpacing: "0.04em", color: colors.heading, borderBottom: `1px solid ${colors.border}`, paddingBottom: "3px", paddingTop, margin: `0 0 ${tokens.headingMarginBottomPx}px 0` }}>{label.toUpperCase()}</h2>
    );
  };

  for (const key of visible) {
    if (key === "identity") {
      items.push({
        id: "identity",
        sectionKey: key,
        node: (
          <header style={{ textAlign: "center", marginBottom: "14px" }}>
            <h1 style={{ fontFamily: EXECUTIVE_MINIMAL_FONTS.heading, fontSize: "1.8em", margin: 0, color: colors.heading }}>{normalized.identity.fullName}</h1>
            {normalized.identity.headline && <div style={{ color: colors.accent, fontWeight: 600, marginTop: "4px" }}>{normalized.identity.headline}</div>}
            <div style={{ color: colors.muted, fontSize: "0.9em", marginTop: "6px" }}>{[normalized.identity.location, normalized.identity.phone, normalized.identity.email, normalized.identity.linkedin, normalized.identity.portfolio].filter(Boolean).join(" · ")}</div>
            {normalized.identity.otherContactLines.map((line, i) => (
              <div key={i} style={{ color: colors.muted, fontSize: "0.85em" }}>
                {line}
              </div>
            ))}
          </header>
        ),
      });
      continue;
    }

    if (key === "metricHighlights") {
      const grid = normalized.metricGrids[0];
      if (!grid) continue;
      items.push({
        id: "metrics",
        sectionKey: key,
        node: (
          <section>
            {heading(key)}
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(grid.columns, 4)}, 1fr)`, gap: "12px", marginBottom: "10px" }}>
              {grid.entries.map((e) => (
                <div key={e.id} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "1.3em", fontWeight: 700, color: colors.accent }}>{e.value}</div>
                  <div style={{ fontSize: "0.75em", color: colors.muted, textTransform: "uppercase", letterSpacing: "0.03em" }}>{e.label}</div>
                </div>
              ))}
            </div>
          </section>
        ),
      });
      continue;
    }

    if (key === "summary") {
      if (!normalized.summary) continue;
      items.push({ id: "summary", sectionKey: key, node: (<section>{heading(key)}<p style={{ color: colors.text, margin: 0 }}>{normalized.summary}</p></section>) });
      continue;
    }

    if (key === "skills") {
      const groups = normalized.skillGroups.filter((g) => g.skills.length > 0);
      if (groups.length === 0) continue;
      items.push({
        id: "skills",
        sectionKey: key,
        node: (
          <section>
            {heading(key)}
            {groups.map((g, i) => (
              <div key={i} style={{ marginBottom: "4px" }}>
                {g.label && <span style={{ fontWeight: 600, color: colors.heading }}>{g.label}: </span>}
                <span style={{ color: colors.text }}>{g.skills.join(", ")}</span>
              </div>
            ))}
          </section>
        ),
      });
      continue;
    }

    if (key === "experience" || key === "volunteer") {
      const entries = key === "experience" ? normalized.professionalExperience : normalized.volunteerExperience;
      if (entries.length === 0) continue;
      entries.forEach((entry, i) => {
        items.push({
          id: `${key}-${entry.id}`,
          sectionKey: key,
          node: i === 0 ? (<section>{heading(key)}<ExperienceEntryBlock entry={entry} colors={colors} entryGapPx={tokens.entryGapPx} /></section>) : <ExperienceEntryBlock entry={entry} colors={colors} entryGapPx={tokens.entryGapPx} />,
        });
      });
      continue;
    }

    if (key === "projects") {
      if (normalized.projects.length === 0) continue;
      normalized.projects.forEach((p, i) => {
        const body = (
          <div style={{ marginBottom: tokens.entryGapPx }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, color: colors.heading }}>{p.name}</span>
              <span style={{ color: colors.muted, fontSize: "0.9em" }}>{p.dateRangeText}</span>
            </div>
            {p.role && <div style={{ color: colors.muted, fontSize: "0.85em" }}>{p.role}</div>}
            <ContentItemsView items={p.items} textColor={colors.text} />
            {p.technologies.length > 0 && <div style={{ color: colors.muted, fontSize: "0.85em" }}>Technologies: {p.technologies.join(", ")}</div>}
          </div>
        );
        items.push({ id: `project-${p.id}`, sectionKey: key, node: i === 0 ? (<section>{heading(key)}{body}</section>) : body });
      });
      continue;
    }

    if (key === "education") {
      if (normalized.education.length === 0) continue;
      normalized.education.forEach((edu, i) => {
        const body = (
          <div style={{ marginBottom: tokens.entryGapPx }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, color: colors.heading }}>{edu.institution || edu.institutions.join(" / ")}</span>
              <span style={{ color: colors.muted, fontSize: "0.9em" }}>{edu.dateRangeText}</span>
            </div>
            <div style={{ color: colors.text }}>{edu.credentials.join(", ") || edu.credential}</div>
            {edu.fieldsOfStudy.length > 0 && <div style={{ color: colors.muted, fontSize: "0.9em" }}>{edu.fieldsOfStudy.join(" & ")}</div>}
            {edu.gpa && <div style={{ color: colors.muted, fontSize: "0.85em" }}>GPA: {edu.gpa}</div>}
            {edu.honors.length > 0 && <div style={{ color: colors.muted, fontSize: "0.85em" }}>{edu.honors.join(", ")}</div>}
            {edu.details.map((d, di) => <div key={di} style={{ color: colors.muted, fontSize: "0.85em" }}>{d}</div>)}
          </div>
        );
        items.push({ id: `edu-${edu.id}`, sectionKey: key, node: i === 0 ? (<section>{heading(key)}{body}</section>) : body });
      });
      continue;
    }

    if (key === "credentials") {
      if (normalized.credentials.length === 0) continue;
      normalized.credentials.forEach((c, i) => {
        const body = (
          <div style={{ marginBottom: tokens.entryGapPx, color: colors.text }}>
            <span style={{ fontWeight: 600 }}>{c.name || c.names.join(", ")}</span>
            {c.issuer && <span style={{ color: colors.muted }}> — {c.issuer}</span>}
            {c.issueDateText && <span style={{ color: colors.muted }}> ({c.issueDateText})</span>}
            {c.expiryDateText && <span style={{ color: colors.muted }}> – {c.expiryDateText}</span>}
            {c.credentialId && <div style={{ color: colors.muted, fontSize: "0.85em" }}>Credential ID: {c.credentialId}</div>}
            {c.details.map((d, di) => <div key={di} style={{ color: colors.muted, fontSize: "0.85em" }}>{d}</div>)}
          </div>
        );
        items.push({ id: `cred-${c.id}`, sectionKey: key, node: i === 0 ? (<section>{heading(key)}{body}</section>) : body });
      });
      continue;
    }

    if (key === "awards") {
      if (normalized.awards.length === 0) continue;
      normalized.awards.forEach((a, i) => {
        const body = (
          <div style={{ marginBottom: tokens.entryGapPx, color: colors.text }}>
            <span style={{ fontWeight: 600 }}>{a.name || a.names.join(", ")}</span>
            {a.issuer && <span style={{ color: colors.muted }}> — {a.issuer}</span>}
            {a.dateText && <span style={{ color: colors.muted }}> ({a.dateText})</span>}
            {a.details.map((d, di) => <div key={di} style={{ color: colors.muted, fontSize: "0.85em" }}>{d}</div>)}
          </div>
        );
        items.push({ id: `award-${a.id}`, sectionKey: key, node: i === 0 ? (<section>{heading(key)}{body}</section>) : body });
      });
      continue;
    }

    if (key === "publications") {
      if (normalized.publications.length === 0) continue;
      normalized.publications.forEach((p, i) => {
        const body = (
          <div style={{ marginBottom: tokens.entryGapPx, color: colors.text, wordBreak: "break-word" }}>
            <span style={{ fontWeight: 600 }}>{p.title || p.titles.join(", ")}</span>
            {p.authors.length > 0 && <span style={{ color: colors.muted }}> — {p.authors.join(", ")}</span>}
            {p.publisherOrVenue && <span style={{ color: colors.muted }}> — {p.publisherOrVenue}</span>}
            {p.dateText && <span style={{ color: colors.muted }}> ({p.dateText})</span>}
            {p.urlOrDoi && <div style={{ color: colors.accent, fontSize: "0.85em", wordBreak: "break-all" }}>{p.urlOrDoi}</div>}
            {p.details.map((d, di) => <div key={di} style={{ color: colors.muted, fontSize: "0.85em" }}>{d}</div>)}
          </div>
        );
        items.push({ id: `pub-${p.id}`, sectionKey: key, node: i === 0 ? (<section>{heading(key)}{body}</section>) : body });
      });
      continue;
    }

    if (key === "custom") {
      if (normalized.customSections.length === 0) continue;
      normalized.customSections.forEach((section, i) => {
        const body = (
          <div style={{ marginBottom: tokens.entryGapPx }}>
            <div style={{ fontWeight: 700, color: colors.heading }}>{section.heading}</div>
            <ContentItemsView items={section.items} textColor={colors.text} />
          </div>
        );
        items.push({ id: `custom-${section.id}`, sectionKey: key, node: i === 0 ? (<section>{heading(key)}{body}</section>) : body });
      });
      continue;
    }
  }

  return { items, headingsInOrder };
}

function pageStyles(colors: typeof EXECUTIVE_MINIMAL_COLORS, widthPx: number, paddingPx: number): string {
  return `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ${EXECUTIVE_MINIMAL_FONTS.body}, ${EXECUTIVE_MINIMAL_FONTS.eastAsiaFallback}; background: ${colors.background}; color: ${colors.text}; font-size: ${MIN_SAFE_FONT_SIZE_PT + 0.5}pt; }
    .page { width: ${widthPx}px; padding: ${paddingPx}px; background: ${colors.background}; break-after: page; }
    .page:last-child { break-after: auto; }
    .flow-container { width: ${widthPx - paddingPx * 2}px; }
    h1, h2 { text-wrap: balance; }
  `;
}

export async function renderExecutiveMinimalHtml(context: TemplateRenderContext): Promise<TemplateHtmlResult> {
  /* react-dom/server imported dynamically, not at module top level - Next's App Router
     bundler flags a static top-level react-dom/server import reachable from a Route
     Handler as a build error (matches the existing, unmodified professionalAtsHtml/
     paginatedHtmlString.ts convention - see that file's own header comment). */
  const { renderToStaticMarkup } = await import("react-dom/server");
  const normalized = normalizeResume(context.resume);
  const colors = EXECUTIVE_MINIMAL_COLORS;
  const dims = PAPER_DIMENSIONS[context.paperSize];
  const tokens = HTML_DENSITY_SPACING[context.density];
  const contentWidth = dims.widthPx - tokens.pagePaddingPx * 2;

  const visible = computeSectionVisibility(EXECUTIVE_MINIMAL_SECTION_ORDER, normalized, context.sectionVisibility)
    .filter((d) => d.visible)
    .map((d) => d.key);
  const { items, headingsInOrder } = buildFlowItems(normalized, visible, colors, tokens);

  const styleText = pageStyles(colors, dims.widthPx, tokens.pagePaddingPx);

  /*
    Phase 6I.6.18 - flow-root is required on this wrapper (in BOTH the
    flat measurement body below and the final paginatedBody's own
    per-item wrapper further down), not a cosmetic choice: each entry
    body div's own trailing marginBottom (tokens.entryGapPx) is the
    LAST/ONLY child of this otherwise unpadded/unbordered div, so
    without a new block-formatting-context boundary that margin
    collapses THROUGH this wrapper and is invisible to
    measureFlowLayout's getBoundingClientRect() height query - the
    exact same collapse class 6I.6.17 already fixed for section
    headings' own top padding, now on the bottom edge of every entry.
    flow-root changes nothing about what actually renders (the
    collapsed-and-remerged margin between two sibling wrapper divs and
    the same margin contained within one flow-root wrapper produce an
    IDENTICAL total visual gap - verified by direct reproduction, see
    this phase's own root-cause report) - it only makes each wrapper's
    reported height match its true rendered footprint.
  */
  const flatBody = (
    <div className="flow-container">
      {items.map((item) => (
        <div key={item.id} data-flow-id={item.id} style={{ display: "flow-root" }}>
          {item.node}
        </div>
      ))}
    </div>
  );
  /*
    Phase 6I.6.18 - font-size (and the CJK fallback family) were
    previously OMITTED from this measurement-only stylesheet, so
    Playwright measured every entry at the browser's default font size
    (~16px/12pt) while the real page render below uses
    MIN_SAFE_FONT_SIZE_PT+0.5=10.5pt - a real, empirically-confirmed
    ~60% height over-measurement per entry (direct reproduction: a
    representative 3-bullet entry measured 180px unstyled vs 112px at
    10.5pt). This is THE root cause of the reported "excessive gap
    between same-section entries": the pagination planner believed
    entries were far taller than they truly render, so it pushed the
    next entry to a fresh page well before the current page was
    actually full - visible as a large blank region in a stacked
    multi-page preview. Must always mirror pageStyles()'s own
    font-size/font-family exactly, or this class of bug reappears.
  */
  const flatHtml = renderHtmlDocument({
    lang: resolveHtmlLang(context.locale),
    title: "measurement",
    styleText: `body{margin:0;font-family:${EXECUTIVE_MINIMAL_FONTS.body},${EXECUTIVE_MINIMAL_FONTS.eastAsiaFallback};font-size:${MIN_SAFE_FONT_SIZE_PT + 0.5}pt;} .flow-container{width:${contentWidth}px;}`,
    bodyHtml: renderToStaticMarkup(flatBody),
  });

  const specs: FlowBlockSpec[] = items.map((item) => ({ id: item.id, sectionKey: item.sectionKey, keepTogether: "whole-block", isFirstBlockInSection: false }));
  const usableHeightPx = dims.heightPx - tokens.pagePaddingPx * 2;
  const plan = await measureFlowLayout(flatHtml, specs, { usableHeightPx });
  const pages = groupPlacementsByPage(plan);
  const nodeById = new Map(items.map((item) => [item.id, item.node]));

  const paginatedBody = (
    <>
      {pages.map((pageIds, pageIndex) => (
        <div className="page" key={pageIndex}>
          {pageIds.map((id) => (
            <div key={id} style={{ display: "flow-root" }}>{nodeById.get(id)}</div>
          ))}
        </div>
      ))}
    </>
  );

  const html = renderHtmlDocument({ lang: resolveHtmlLang(context.locale), title: normalized.identity.fullName || "Resume", styleText, bodyHtml: renderToStaticMarkup(paginatedBody) });

  const expectedFragments = expectedFragmentsForResume(normalized);
  const validation = buildValidationReport({
    expectedFragments,
    extractedText: extractVisibleTextFromHtml(html),
    sectionHeadingsInOrder: headingsInOrder,
    identityFragments: [normalized.identity.fullName, normalized.identity.email].filter(Boolean),
    structuralPassed: true,
    structuralIssues: [],
  });

  return { templateId: "executive-minimal", format: "html", html, pageCount: plan.pageCount, paperSize: context.paperSize, density: context.density, validation };
}

export const EXECUTIVE_MINIMAL_INTERNAL = { buildFlowItems, pageStyles };
