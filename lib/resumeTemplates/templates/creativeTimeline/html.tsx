/*
  Phase 6F - Template 4, Creative Timeline HTML renderer. Sidebar +
  vertical timeline (spec section 3). Same DOM-order-independent-of-
  visual-column technique as Modern Sidebar (CSS Grid named areas,
  two independent atomic-block pagination streams - see
  htmlPagination.ts). Timeline marker/line are pure CSS decoration on
  a wrapper element carrying aria-hidden/role=presentation
  (accessibility.ts's DECORATIVE_ARIA_PROPS) so they can never be
  mistaken for real text by a screen reader OR contribute a stray
  glyph to the PDF/DOCX text-extraction stream used by the parity
  engine's missing/invented-text checks.
*/
import React from "react";
import { normalizeResume, type NormalizedEducationEntry, type NormalizedExperienceEntry } from "../../shared/contentAdapters";
import { CREATIVE_TIMELINE_COLORS } from "../../shared/colorTokens";
import { CREATIVE_TIMELINE_FONTS, MIN_SAFE_FONT_SIZE_PT } from "../../shared/typography";
import { HTML_DENSITY_SPACING, type HtmlSpacingTokens } from "../../shared/spacing";
import { PAPER_DIMENSIONS } from "../../shared/paperSizes";
import { ContentItemsView } from "../../shared/ContentItemsView";
import { renderHtmlDocument } from "../../shared/documentShell";
import { measureFlowLayout, groupPlacementsByPage, type FlowBlockSpec } from "../../shared/htmlPagination";
import { resolveHtmlLang, photoPlaceholderAlt, DECORATIVE_ARIA_PROPS } from "../../shared/accessibility";
import { CREATIVE_TIMELINE_LABELS, isLanguageCustomSection, isSidebarExtraCustomSection } from "./sectionPolicy";
import { buildValidationReport } from "../../parity/validateOutput";
import { expectedFragmentsForResume } from "../../parity/textFragments";
import { extractVisibleTextFromHtml } from "../../shared/htmlText";
import type { TemplateHtmlResult, TemplateRenderContext } from "../../contracts/types";

type FlowItem = { id: string; sectionKey: string; node: React.ReactNode };
type Colors = typeof CREATIVE_TIMELINE_COLORS;

function TimelineMarker({ colors }: { colors: Colors }): React.ReactElement {
  return <span {...DECORATIVE_ARIA_PROPS} style={{ position: "absolute", left: "-17px", top: "3px", width: "9px", height: "9px", borderRadius: "50%", background: colors.accent, border: `2px solid ${colors.background}`, boxShadow: `0 0 0 1px ${colors.accent}` }} />;
}

function TimelineItem({ colors, children }: { colors: Colors; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ position: "relative", marginLeft: "18px", paddingLeft: "12px", borderLeft: `2px solid ${colors.border}`, marginBottom: "10px", paddingBottom: "2px" }}>
      <TimelineMarker colors={colors} />
      {children}
    </div>
  );
}

/*
  Phase 6I.6.17 - see executiveMinimal/html.tsx's identical fix and its
  own header comment for the full rationale, INCLUDING the margin-
  collapse correction: tokens.sectionGapPx is applied via paddingTop,
  not marginTop (skipped for the first rendered section), since a
  marginTop here would collapse through the unpadded <section>/
  <div data-flow-id> ancestor chain and go uncounted by
  measureFlowLayout's height measurement, overflowing the real
  rendered PDF onto an extra page. TimelineItem's own small
  marginBottom (the vertical rhythm between entries within ONE
  section) is left untouched, preserving the timeline's visual cadence
  within a section while still making section boundaries visibly
  larger than that within-section rhythm.
*/
function makeHeading(colors: Colors, tokens: HtmlSpacingTokens) {
  let firstSeen = false;
  return (label: string): React.ReactElement => {
    const paddingTop = firstSeen ? tokens.sectionGapPx : 0;
    firstSeen = true;
    return <h2 style={{ fontFamily: CREATIVE_TIMELINE_FONTS.heading, fontSize: "1em", letterSpacing: "0.03em", color: colors.accent, paddingTop, margin: `0 0 ${tokens.headingMarginBottomPx}px 0` }}>{label}</h2>;
  };
}

function buildMainItems(normalized: ReturnType<typeof normalizeResume>, colors: Colors, tokens: HtmlSpacingTokens): { items: FlowItem[]; headingsInOrder: string[] } {
  const items: FlowItem[] = [];
  const headingsInOrder: string[] = [];
  const heading = makeHeading(colors, tokens);

  if (normalized.summary) {
    headingsInOrder.push(CREATIVE_TIMELINE_LABELS.summary);
    items.push({ id: "summary", sectionKey: "summary", node: (<section>{heading(CREATIVE_TIMELINE_LABELS.summary)}<p style={{ color: colors.text, margin: 0 }}>{normalized.summary}</p></section>) });
  }

  if (normalized.metricGrids.some((g) => g.entries.length > 0)) {
    const line = normalized.metricGrids.flatMap((g) => g.entries).map((e) => `${e.value} ${e.label}`).join("  ·  ");
    items.push({ id: "highlights", sectionKey: "custom", node: (<section><p style={{ color: colors.accent, fontWeight: 700, fontSize: "0.9em" }}>{line}</p></section>) });
  }

  const experienceGroups: Array<["experience" | "volunteer", NormalizedExperienceEntry[]]> = [
    ["experience", normalized.professionalExperience],
    ["volunteer", normalized.volunteerExperience],
  ];
  for (const [key, entries] of experienceGroups) {
    if (entries.length === 0) continue;
    headingsInOrder.push(CREATIVE_TIMELINE_LABELS[key]);
    entries.forEach((entry, i) => {
      const body = (
        <TimelineItem colors={colors}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 700, color: colors.heading }}>{entry.role}</span>
            <span style={{ color: colors.muted, fontSize: "0.85em" }}>{entry.dateRangeText}</span>
          </div>
          <div style={{ color: colors.accent, fontSize: "0.9em" }}>
            {entry.organization}
            {entry.location ? ` · ${entry.location}` : ""}
          </div>
          <ContentItemsView items={entry.items} textColor={colors.text} />
        </TimelineItem>
      );
      items.push({ id: `${key}-${entry.id}`, sectionKey: key, node: i === 0 ? (<section>{heading(CREATIVE_TIMELINE_LABELS[key])}{body}</section>) : body });
    });
  }

  if (normalized.education.length > 0) {
    headingsInOrder.push(CREATIVE_TIMELINE_LABELS.education);
    normalized.education.forEach((edu: NormalizedEducationEntry, i) => {
      const body = (
        <TimelineItem colors={colors}>
          <div style={{ fontWeight: 700, color: colors.heading }}>{edu.institution || edu.institutions.join(" / ")}</div>
          <div style={{ color: colors.text, fontSize: "0.9em" }}>{edu.credentials.join(", ") || edu.credential}</div>
          {edu.fieldsOfStudy.length > 0 && <div style={{ color: colors.muted, fontSize: "0.85em" }}>{edu.fieldsOfStudy.join(" & ")}</div>}
          <div style={{ color: colors.muted, fontSize: "0.85em" }}>{edu.dateRangeText}</div>
          {edu.gpa && <div style={{ color: colors.muted, fontSize: "0.85em" }}>GPA: {edu.gpa}</div>}
          {edu.honors.length > 0 && <div style={{ color: colors.muted, fontSize: "0.85em" }}>{edu.honors.join(", ")}</div>}
          {edu.details.map((d, di) => <div key={di} style={{ color: colors.muted, fontSize: "0.85em" }}>{d}</div>)}
        </TimelineItem>
      );
      items.push({ id: `edu-${edu.id}`, sectionKey: "education", node: i === 0 ? (<section>{heading(CREATIVE_TIMELINE_LABELS.education)}{body}</section>) : body });
    });
  }

  if (normalized.projects.length > 0) {
    headingsInOrder.push(CREATIVE_TIMELINE_LABELS.projects);
    normalized.projects.forEach((p, i) => {
      const body = (
        <div style={{ marginBottom: tokens.entryGapPx }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 700, color: colors.heading }}>{p.name}</span>
            <span style={{ color: colors.muted, fontSize: "0.85em" }}>{p.dateRangeText}</span>
          </div>
          {p.role && <div style={{ color: colors.accent, fontSize: "0.85em" }}>{p.role}</div>}
          <ContentItemsView items={p.items} textColor={colors.text} />
          {p.technologies.length > 0 && <div style={{ color: colors.muted, fontSize: "0.85em" }}>Technologies: {p.technologies.join(", ")}</div>}
        </div>
      );
      items.push({ id: `project-${p.id}`, sectionKey: "projects", node: i === 0 ? (<section>{heading(CREATIVE_TIMELINE_LABELS.projects)}{body}</section>) : body });
    });
  }

  if (normalized.credentials.length > 0) {
    headingsInOrder.push(CREATIVE_TIMELINE_LABELS.credentials);
    normalized.credentials.forEach((c, i) => {
      const body = (
        <div style={{ marginBottom: tokens.entryGapPx, color: colors.text, fontSize: "0.9em" }}>
          <strong>{c.name || c.names.join(", ")}</strong> {c.issuer ? `— ${c.issuer}` : ""} {c.issueDateText ? `(${c.issueDateText})` : ""} {c.expiryDateText ? `– ${c.expiryDateText}` : ""}
          {c.credentialId && <div style={{ color: colors.muted, fontSize: "0.85em" }}>Credential ID: {c.credentialId}</div>}
          {c.details.map((d, di) => <div key={di} style={{ color: colors.muted, fontSize: "0.85em" }}>{d}</div>)}
        </div>
      );
      items.push({ id: `cred-${c.id}`, sectionKey: "credentials", node: i === 0 ? (<section>{heading(CREATIVE_TIMELINE_LABELS.credentials)}{body}</section>) : body });
    });
  }

  if (normalized.awards.length > 0) {
    headingsInOrder.push(CREATIVE_TIMELINE_LABELS.awards);
    normalized.awards.forEach((a, i) => {
      const body = (
        <div style={{ marginBottom: tokens.entryGapPx, color: colors.text, fontSize: "0.9em" }}>
          <strong>{a.name || a.names.join(", ")}</strong> {a.issuer ? `— ${a.issuer}` : ""} {a.dateText ? `(${a.dateText})` : ""}
          {a.details.map((d, di) => <div key={di} style={{ color: colors.muted, fontSize: "0.85em" }}>{d}</div>)}
        </div>
      );
      items.push({ id: `award-${a.id}`, sectionKey: "awards", node: i === 0 ? (<section>{heading(CREATIVE_TIMELINE_LABELS.awards)}{body}</section>) : body });
    });
  }

  if (normalized.publications.length > 0) {
    headingsInOrder.push(CREATIVE_TIMELINE_LABELS.publications);
    normalized.publications.forEach((p, i) => {
      const body = (
        <div style={{ marginBottom: tokens.entryGapPx, color: colors.text, fontSize: "0.9em", wordBreak: "break-word" }}>
          <strong>{p.title || p.titles.join(", ")}</strong> {p.authors.length > 0 ? `— ${p.authors.join(", ")}` : ""} {p.publisherOrVenue ? `— ${p.publisherOrVenue}` : ""} {p.dateText ? `(${p.dateText})` : ""}
          {p.urlOrDoi && <div style={{ color: colors.accent, fontSize: "0.85em", wordBreak: "break-all" }}>{p.urlOrDoi}</div>}
          {p.details.map((d, di) => <div key={di} style={{ color: colors.muted, fontSize: "0.85em" }}>{d}</div>)}
        </div>
      );
      items.push({ id: `pub-${p.id}`, sectionKey: "publications", node: i === 0 ? (<section>{heading(CREATIVE_TIMELINE_LABELS.publications)}{body}</section>) : body });
    });
  }

  const restCustom = normalized.customSections.filter((s) => !isLanguageCustomSection(s) && !isSidebarExtraCustomSection(s));
  if (restCustom.length > 0) {
    headingsInOrder.push(CREATIVE_TIMELINE_LABELS.custom);
    restCustom.forEach((section, i) => {
      const body = (
        <div style={{ marginBottom: tokens.entryGapPx }}>
          <div style={{ fontWeight: 700, color: colors.heading }}>{section.heading}</div>
          <ContentItemsView items={section.items} textColor={colors.text} />
        </div>
      );
      items.push({ id: `custom-${section.id}`, sectionKey: "custom", node: i === 0 ? (<section>{heading(CREATIVE_TIMELINE_LABELS.custom)}{body}</section>) : body });
    });
  }

  return { items, headingsInOrder };
}

function buildSidebarItems(normalized: ReturnType<typeof normalizeResume>, colors: Colors): { items: FlowItem[]; headingsInOrder: string[] } {
  const items: FlowItem[] = [];
  const headingsInOrder: string[] = [];
  const sidebarHeading = (label: string) => <h3 style={{ color: colors.sidebarText, fontSize: "0.85em", letterSpacing: "0.05em", textTransform: "uppercase", opacity: 0.85, margin: "14px 0 6px 0" }}>{label}</h3>;

  const skillGroups = normalized.skillGroups.filter((g) => g.skills.length > 0);
  if (skillGroups.length > 0) {
    headingsInOrder.push(CREATIVE_TIMELINE_LABELS.skills);
    items.push({
      id: "skills",
      sectionKey: "skills",
      node: (
        <div>
          {sidebarHeading(CREATIVE_TIMELINE_LABELS.skills)}
          {skillGroups.map((g, i) => (
            <div key={i} style={{ color: colors.sidebarText, fontSize: "0.85em", marginBottom: "4px" }}>
              {g.label && <div style={{ fontWeight: 600, opacity: 0.9 }}>{g.label}</div>}
              <div>{g.skills.join(", ")}</div>
            </div>
          ))}
        </div>
      ),
    });
  }

  const languageSections = normalized.customSections.filter(isLanguageCustomSection);
  if (languageSections.length > 0) {
    languageSections.forEach((section) => {
      headingsInOrder.push(section.heading);
      items.push({ id: `lang-${section.id}`, sectionKey: "languages", node: (<div style={{ color: colors.sidebarText, fontSize: "0.85em" }}>{sidebarHeading(section.heading)}<ContentItemsView items={section.items} textColor={colors.sidebarText ?? colors.text} /></div>) });
    });
  }

  const extraSections = normalized.customSections.filter(isSidebarExtraCustomSection);
  extraSections.forEach((section, i) => {
    headingsInOrder.push(section.heading);
    items.push({ id: `extra-${section.id}`, sectionKey: "custom", node: (<div style={{ color: colors.sidebarText, fontSize: "0.85em" }}>{sidebarHeading(section.heading)}<ContentItemsView items={section.items} textColor={colors.sidebarText ?? colors.text} /></div>) });
  });

  return { items, headingsInOrder };
}

function IdentityMasthead({ normalized, colors, photoOption }: { normalized: ReturnType<typeof normalizeResume>; colors: Colors; photoOption: TemplateRenderContext["photoOption"] }): React.ReactElement {
  return (
    <div>
      {photoOption === "placeholder" && <div aria-label={photoPlaceholderAlt(normalized.identity.fullName)} style={{ width: "72px", height: "72px", borderRadius: "50%", background: colors.accent, margin: "0 0 10px 0" }} {...DECORATIVE_ARIA_PROPS} />}
      <h1 style={{ color: colors.sidebarText, fontFamily: CREATIVE_TIMELINE_FONTS.heading, fontSize: "1.35em", margin: 0 }}>{normalized.identity.fullName}</h1>
      {normalized.identity.headline && <div style={{ color: colors.sidebarText, opacity: 0.85, marginTop: "4px" }}>{normalized.identity.headline}</div>}
      <h3 style={{ color: colors.sidebarText, fontSize: "0.8em", letterSpacing: "0.05em", textTransform: "uppercase", opacity: 0.8, margin: "12px 0 4px 0" }}>{CREATIVE_TIMELINE_LABELS.contact}</h3>
      <div style={{ color: colors.sidebarText, opacity: 0.85, fontSize: "0.8em", lineHeight: 1.6 }}>
        {[normalized.identity.email, normalized.identity.phone, normalized.identity.location, normalized.identity.linkedin, normalized.identity.portfolio].filter(Boolean).map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        {normalized.identity.otherContactLines.map((line, i) => (
          <div key={`extra-${i}`}>{line}</div>
        ))}
      </div>
    </div>
  );
}

function pageStyles(colors: Colors, widthPx: number, sidebarPx: number, paddingPx: number): string {
  return `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ${CREATIVE_TIMELINE_FONTS.body}, ${CREATIVE_TIMELINE_FONTS.eastAsiaFallback}; font-size: ${MIN_SAFE_FONT_SIZE_PT + 0.5}pt; }
    .page { width: ${widthPx}px; display: grid; grid-template-columns: ${sidebarPx}px 1fr; grid-template-areas: "identity main" "sidebar main"; break-after: page; background: ${colors.background}; }
    .page:last-child { break-after: auto; }
    .identity-area { grid-area: identity; background: ${colors.sidebarBackground}; padding: ${paddingPx}px ${paddingPx * 0.7}px ${paddingPx * 0.3}px; }
    .sidebar-area { grid-area: sidebar; background: ${colors.sidebarBackground}; padding: 0 ${paddingPx * 0.7}px ${paddingPx}px; min-height: 40px; }
    .main-area { grid-area: main; padding: ${paddingPx}px; }
    h1, h2, h3 { text-wrap: balance; }
  `;
}

export async function renderCreativeTimelineHtml(context: TemplateRenderContext): Promise<TemplateHtmlResult> {
  /* react-dom/server imported dynamically, not at module top level - see
     executiveMinimal/html.tsx's identical fix and the existing, unmodified
     professionalAtsHtml/paginatedHtmlString.ts convention this matches. */
  const { renderToStaticMarkup } = await import("react-dom/server");
  const normalized = normalizeResume(context.resume);
  const colors = CREATIVE_TIMELINE_COLORS;
  const dims = PAPER_DIMENSIONS[context.paperSize];
  const tokens = HTML_DENSITY_SPACING[context.density];
  const sidebarPx = Math.round((dims.widthPx * tokens.sidebarWidthPercent) / 100);
  const mainWidthPx = dims.widthPx - sidebarPx - tokens.pagePaddingPx * 2;
  const sidebarInnerPx = sidebarPx - Math.round(tokens.pagePaddingPx * 0.7 * 2);

  const { items: mainItems, headingsInOrder: mainHeadings } = buildMainItems(normalized, colors, tokens);
  const { items: sidebarItems, headingsInOrder: sidebarHeadings } = buildSidebarItems(normalized, colors);

  const styleText = pageStyles(colors, dims.widthPx, sidebarPx, tokens.pagePaddingPx);
  const measureStyle = `body{margin:0;font-family:${CREATIVE_TIMELINE_FONTS.body};}`;

  const flatMain = <div style={{ width: mainWidthPx }}>{mainItems.map((item) => <div key={item.id} data-flow-id={item.id}>{item.node}</div>)}</div>;
  const flatSidebar = <div style={{ width: sidebarInnerPx }}>{sidebarItems.map((item) => <div key={item.id} data-flow-id={item.id}>{item.node}</div>)}</div>;

  const usableHeightPx = dims.heightPx - tokens.pagePaddingPx * 2;
  const identityMastheadHeightEstimatePx = 220;

  const mainPlan = mainItems.length
    ? await measureFlowLayout(renderHtmlDocument({ lang: "en", title: "m", styleText: measureStyle, bodyHtml: renderToStaticMarkup(flatMain) }), mainItems.map<FlowBlockSpec>((i) => ({ id: i.id, sectionKey: i.sectionKey, keepTogether: "whole-block", isFirstBlockInSection: false })), { usableHeightPx })
    : { pageCount: 1, placements: [] };
  const sidebarPlan = sidebarItems.length
    ? await measureFlowLayout(renderHtmlDocument({ lang: "en", title: "s", styleText: measureStyle, bodyHtml: renderToStaticMarkup(flatSidebar) }), sidebarItems.map<FlowBlockSpec>((i) => ({ id: i.id, sectionKey: i.sectionKey, keepTogether: "whole-block", isFirstBlockInSection: false })), { usableHeightPx: usableHeightPx - identityMastheadHeightEstimatePx })
    : { pageCount: 1, placements: [] };

  const pageCount = Math.max(mainPlan.pageCount, sidebarPlan.pageCount, 1);
  const mainByPage = groupPlacementsByPage({ pageCount, placements: mainPlan.placements });
  const sidebarByPage = groupPlacementsByPage({ pageCount, placements: sidebarPlan.placements });
  const mainNodeById = new Map(mainItems.map((i) => [i.id, i.node]));
  const sidebarNodeById = new Map(sidebarItems.map((i) => [i.id, i.node]));

  const paginatedBody = (
    <>
      {Array.from({ length: pageCount }, (_, pageIndex) => (
        <div className="page" key={pageIndex}>
          <div className="identity-area">{pageIndex === 0 && <IdentityMasthead normalized={normalized} colors={colors} photoOption={context.photoOption} />}</div>
          <div className="main-area">{mainByPage[pageIndex]?.map((id) => <div key={id}>{mainNodeById.get(id)}</div>)}</div>
          <div className="sidebar-area">{sidebarByPage[pageIndex]?.map((id) => <div key={id}>{sidebarNodeById.get(id)}</div>)}</div>
        </div>
      ))}
    </>
  );

  const html = renderHtmlDocument({ lang: resolveHtmlLang(context.locale), title: normalized.identity.fullName || "Resume", styleText, bodyHtml: renderToStaticMarkup(paginatedBody) });

  const expectedFragments = expectedFragmentsForResume(normalized);
  const validation = buildValidationReport({
    expectedFragments,
    extractedText: extractVisibleTextFromHtml(html),
    sectionHeadingsInOrder: [...mainHeadings, ...sidebarHeadings],
    independentOrderedSequences: [mainHeadings, sidebarHeadings],
    identityFragments: [normalized.identity.fullName, normalized.identity.email].filter(Boolean),
    structuralPassed: true,
    structuralIssues: [],
  });

  return { templateId: "creative-timeline", format: "html", html, pageCount, paperSize: context.paperSize, density: context.density, validation };
}

export const CREATIVE_TIMELINE_INTERNAL = { buildMainItems, buildSidebarItems };
