/*
  Phase 6F - Template 2, Modern Sidebar HTML renderer. Visual 2-column
  layout (CSS Grid named areas) whose DOM order is INDEPENDENT of
  visual column placement, so the ATS reading-order requirement (spec
  section 3: identity -> summary -> experience -> education -> projects
  -> skills/languages) holds regardless of the sidebar sitting visually
  on the left. Two independent atomic-block pagination streams (main
  column, sidebar column - see htmlPagination.ts), combined per page.
*/
import React from "react";
import { normalizeResume, type NormalizedExperienceEntry, experienceHeaderFallbackText, educationHeaderFallbackText } from "../../shared/contentAdapters";
import { MODERN_SIDEBAR_COLORS } from "../../shared/colorTokens";
import { MODERN_SIDEBAR_FONTS, MIN_SAFE_FONT_SIZE_PT } from "../../shared/typography";
import { HTML_DENSITY_SPACING, type HtmlSpacingTokens } from "../../shared/spacing";
import { PAPER_DIMENSIONS } from "../../shared/paperSizes";
import { ContentItemsView } from "../../shared/ContentItemsView";
import { renderHtmlDocument } from "../../shared/documentShell";
import { measureFlowLayout, groupPlacementsByPage, type FlowBlockSpec } from "../../shared/htmlPagination";
import { resolveHtmlLang, photoPlaceholderAlt, DECORATIVE_ARIA_PROPS } from "../../shared/accessibility";
import { MODERN_SIDEBAR_MAIN_ORDER, MODERN_SIDEBAR_LABELS, isLanguageCustomSection } from "./sectionPolicy";
import { buildValidationReport } from "../../parity/validateOutput";
import { expectedFragmentsForResume } from "../../parity/textFragments";
import { extractVisibleTextFromHtml } from "../../shared/htmlText";
import type { TemplateHtmlResult, TemplateRenderContext } from "../../contracts/types";

type FlowItem = { id: string; sectionKey: string; node: React.ReactNode };
type Colors = typeof MODERN_SIDEBAR_COLORS;

function ExperienceBlock({ entry, colors, entryGapPx }: { entry: NormalizedExperienceEntry; colors: Colors; entryGapPx: number }): React.ReactElement {
  const rawFallback = experienceHeaderFallbackText(entry);
  if (rawFallback) {
    return (
      <div style={{ marginBottom: entryGapPx }}>
        <div style={{ fontWeight: 700, color: colors.heading }}>{rawFallback}</div>
        <ContentItemsView items={entry.items} textColor={colors.text} />
      </div>
    );
  }
  return (
    <div style={{ marginBottom: entryGapPx }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 700, color: colors.heading }}>{entry.role}</span>
        <span style={{ color: colors.muted, fontSize: "0.85em" }}>{entry.dateRangeText}</span>
      </div>
      <div style={{ color: colors.accent, fontSize: "0.9em" }}>
        {entry.organization}
        {entry.location ? ` · ${entry.location}` : ""}
      </div>
      <ContentItemsView items={entry.items} textColor={colors.text} />
    </div>
  );
}

/*
  Phase 6I.6.17 - see executiveMinimal/html.tsx's identical fix and its
  own header comment for the full rationale, INCLUDING the margin-
  collapse correction: tokens.sectionGapPx is applied via paddingTop,
  not marginTop (skipped for the first rendered main-column section),
  because this h2 is always the first child of a <section> that is
  itself the first child of the flow-item's <div data-flow-id> wrapper
  - a marginTop here would collapse through both unpadded ancestors
  and go uncounted by measureFlowLayout's getBoundingClientRect()
  height query, silently under-measuring the pagination plan and
  overflowing the real rendered PDF onto an extra page (confirmed by
  direct reproduction on executiveMinimal before this correction).
  padding never collapses, so it's always included in the measurement.
*/
function makeHeading(colors: Colors, tokens: HtmlSpacingTokens) {
  let firstSeen = false;
  return (label: string): React.ReactElement => {
    const paddingTop = firstSeen ? tokens.sectionGapPx : 0;
    firstSeen = true;
    return (
      <h2 style={{ fontFamily: MODERN_SIDEBAR_FONTS.heading, fontSize: "1em", letterSpacing: "0.03em", color: colors.accent, textTransform: "uppercase", paddingTop, margin: `0 0 ${tokens.headingMarginBottomPx}px 0` }}>{label}</h2>
    );
  };
}

function buildMainItems(normalized: ReturnType<typeof normalizeResume>, colors: Colors, tokens: HtmlSpacingTokens): { items: FlowItem[]; headingsInOrder: string[] } {
  const items: FlowItem[] = [];
  const headingsInOrder: string[] = [];
  const heading = makeHeading(colors, tokens);

  if (normalized.summary) {
    headingsInOrder.push(MODERN_SIDEBAR_LABELS.summary);
    items.push({ id: "summary", sectionKey: "summary", node: (<section>{heading(MODERN_SIDEBAR_LABELS.summary)}<p style={{ color: colors.text, margin: 0 }}>{normalized.summary}</p></section>) });
  }

  if (normalized.metricGrids.some((g) => g.entries.length > 0)) {
    const line = normalized.metricGrids.flatMap((g) => g.entries).map((e) => `${e.value} ${e.label}`).join("  ·  ");
    items.push({ id: "highlights", sectionKey: "custom", node: (<section><p style={{ color: colors.accent, fontWeight: 700, fontSize: "0.9em" }}>{line}</p></section>) });
  }

  const experienceLike: Array<["experience" | "volunteer", NormalizedExperienceEntry[]]> = [
    ["experience", normalized.professionalExperience],
    ["volunteer", normalized.volunteerExperience],
  ];
  for (const [key, entries] of experienceLike) {
    if (entries.length === 0) continue;
    headingsInOrder.push(MODERN_SIDEBAR_LABELS[key]);
    entries.forEach((entry, i) => {
      items.push({ id: `${key}-${entry.id}`, sectionKey: key, node: i === 0 ? (<section>{heading(MODERN_SIDEBAR_LABELS[key])}<ExperienceBlock entry={entry} colors={colors} entryGapPx={tokens.entryGapPx} /></section>) : <ExperienceBlock entry={entry} colors={colors} entryGapPx={tokens.entryGapPx} /> });
    });
  }

  if (normalized.projects.length > 0) {
    headingsInOrder.push(MODERN_SIDEBAR_LABELS.projects);
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
      items.push({ id: `project-${p.id}`, sectionKey: "projects", node: i === 0 ? (<section>{heading(MODERN_SIDEBAR_LABELS.projects)}{body}</section>) : body });
    });
  }

  if (normalized.education.length > 0) {
    headingsInOrder.push(MODERN_SIDEBAR_LABELS.education);
    normalized.education.forEach((edu, i) => {
      const eduFallback = educationHeaderFallbackText(edu);
      const body = (
        <div style={{ marginBottom: tokens.entryGapPx }}>
          {eduFallback && <div style={{ fontWeight: 700, color: colors.heading }}>{eduFallback}</div>}
          <div style={{ fontWeight: 700, color: colors.heading }}>{edu.institution || edu.institutions.join(" / ")}</div>
          <div style={{ color: colors.text, fontSize: "0.9em" }}>{edu.credentials.join(", ") || edu.credential}</div>
          {edu.fieldsOfStudy.length > 0 && <div style={{ color: colors.muted, fontSize: "0.85em" }}>{edu.fieldsOfStudy.join(" & ")}</div>}
          <div style={{ color: colors.muted, fontSize: "0.85em" }}>{[edu.dateQualifierText, edu.dateRangeText].filter(Boolean).join(" ")}</div>
          {edu.location && <div style={{ color: colors.muted, fontSize: "0.85em" }}>{edu.location}</div>}
          {edu.gpa && <div style={{ color: colors.muted, fontSize: "0.85em" }}>GPA: {edu.gpa}</div>}
          {edu.honors.length > 0 && <div style={{ color: colors.muted, fontSize: "0.85em" }}>{edu.honors.join(", ")}</div>}
          {edu.details.map((d, di) => <div key={di} style={{ color: colors.muted, fontSize: "0.85em" }}>{d}</div>)}
        </div>
      );
      items.push({ id: `edu-${edu.id}`, sectionKey: "education", node: i === 0 ? (<section>{heading(MODERN_SIDEBAR_LABELS.education)}{body}</section>) : body });
    });
  }

  if (normalized.credentials.length > 0) {
    headingsInOrder.push(MODERN_SIDEBAR_LABELS.credentials);
    normalized.credentials.forEach((c, i) => {
      const body = (
        <div style={{ marginBottom: tokens.entryGapPx, color: colors.text, fontSize: "0.9em" }}>
          <strong>{c.name || c.names.join(", ")}</strong> {c.issuer ? `— ${c.issuer}` : ""} {c.issueDateText ? `(${c.issueDateText})` : ""} {c.expiryDateText ? `– ${c.expiryDateText}` : ""}
          {c.credentialId && <div style={{ color: colors.muted, fontSize: "0.85em" }}>Credential ID: {c.credentialId}</div>}
          {c.details.map((d, di) => <div key={di} style={{ color: colors.muted, fontSize: "0.85em" }}>{d}</div>)}
        </div>
      );
      items.push({ id: `cred-${c.id}`, sectionKey: "credentials", node: i === 0 ? (<section>{heading(MODERN_SIDEBAR_LABELS.credentials)}{body}</section>) : body });
    });
  }

  if (normalized.awards.length > 0) {
    headingsInOrder.push(MODERN_SIDEBAR_LABELS.awards);
    normalized.awards.forEach((a, i) => {
      const body = (
        <div style={{ marginBottom: tokens.entryGapPx, color: colors.text, fontSize: "0.9em" }}>
          <strong>{a.name || a.names.join(", ")}</strong> {a.issuer ? `— ${a.issuer}` : ""} {a.dateText ? `(${a.dateText})` : ""}
          {a.details.map((d, di) => <div key={di} style={{ color: colors.muted, fontSize: "0.85em" }}>{d}</div>)}
        </div>
      );
      items.push({ id: `award-${a.id}`, sectionKey: "awards", node: i === 0 ? (<section>{heading(MODERN_SIDEBAR_LABELS.awards)}{body}</section>) : body });
    });
  }

  if (normalized.publications.length > 0) {
    headingsInOrder.push(MODERN_SIDEBAR_LABELS.publications);
    normalized.publications.forEach((p, i) => {
      const body = (
        <div style={{ marginBottom: tokens.entryGapPx, color: colors.text, fontSize: "0.9em", wordBreak: "break-word" }}>
          <strong>{p.title || p.titles.join(", ")}</strong> {p.authors.length > 0 ? `— ${p.authors.join(", ")}` : ""} {p.publisherOrVenue ? `— ${p.publisherOrVenue}` : ""} {p.dateText ? `(${p.dateText})` : ""}
          {p.urlOrDoi && <div style={{ color: colors.accent, fontSize: "0.85em", wordBreak: "break-all" }}>{p.urlOrDoi}</div>}
          {p.details.map((d, di) => <div key={di} style={{ color: colors.muted, fontSize: "0.85em" }}>{d}</div>)}
        </div>
      );
      items.push({ id: `pub-${p.id}`, sectionKey: "publications", node: i === 0 ? (<section>{heading(MODERN_SIDEBAR_LABELS.publications)}{body}</section>) : body });
    });
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
  const nonLanguageCustom = normalized.customSections.filter((s) => !isLanguageCustomSection(s) && !isRepresentedByStructuredLanguages(s));
  if (nonLanguageCustom.length > 0) {
    headingsInOrder.push(MODERN_SIDEBAR_LABELS.custom);
    nonLanguageCustom.forEach((section, i) => {
      const body = (
        <div style={{ marginBottom: tokens.entryGapPx }}>
          <div style={{ fontWeight: 700, color: colors.heading }}>{section.heading}</div>
          <ContentItemsView items={section.items} textColor={colors.text} />
        </div>
      );
      items.push({ id: `custom-${section.id}`, sectionKey: "custom", node: i === 0 ? (<section>{heading(MODERN_SIDEBAR_LABELS.custom)}{body}</section>) : body });
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
    headingsInOrder.push(MODERN_SIDEBAR_LABELS.skills);
    items.push({
      id: "skills",
      sectionKey: "skills",
      node: (
        <div>
          {sidebarHeading(MODERN_SIDEBAR_LABELS.skills)}
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

  /*
    Structured languages arrive already paired (name + proficiency). The
    same source section is ALSO preserved as a raw custom section whose
    lines are unpaired, so rendering both would show Languages twice. The
    raw one is skipped only when its sourceSectionId is one the structured
    entries came from - never by heading text, so an unrelated section such
    as "Programming Languages" is left alone. With no structured languages
    the raw section still renders exactly as before.
  */
  const structuredLanguages = normalized.languages ?? [];
  const representedSectionIds = new Set(structuredLanguages.map((l) => l.sourceSectionId));
  const languageSections = normalized.customSections
    .filter(isLanguageCustomSection)
    .filter((section) => section.sourceSectionId === undefined || !representedSectionIds.has(section.sourceSectionId));

  /*
    The heading belongs to the document, not to this template: when a real
    raw section produced these pairs, its own wording is what a reader
    recognises ("Langues", "Language Proficiency"), and substituting the
    fixed label silently rewrites it - and makes it missing text, since
    parity expects every custom section's heading. The owning section is
    found by provenance, never by heading text. The template label stays
    as the fallback for pairs with no owning raw section.
  */
  const supersededSections = normalized.customSections.filter(
    (section) => section.sourceSectionId !== undefined && representedSectionIds.has(section.sourceSectionId)
  );
  const languagesHeading = supersededSections[0]?.heading ?? MODERN_SIDEBAR_LABELS.languages;

  if (structuredLanguages.length > 0) {
    headingsInOrder.push(languagesHeading);
    items.push({
      id: "languages",
      sectionKey: "languages",
      node: (
        <div style={{ color: colors.sidebarText, fontSize: "0.85em" }}>
          {sidebarHeading(languagesHeading)}
          {structuredLanguages.map((language, i) => (
            <div key={i} style={{ marginBottom: "2px" }}>
              {language.proficiency ? `${language.name} — ${language.proficiency}` : language.name}
            </div>
          ))}
        </div>
      ),
    });
  }

  if (languageSections.length > 0) {
    languageSections.forEach((section) => {
      headingsInOrder.push(section.heading);
      items.push({
        id: `lang-${section.id}`,
        sectionKey: "languages",
        node: (
          <div style={{ color: colors.sidebarText, fontSize: "0.85em" }}>
            {sidebarHeading(section.heading)}
            <ContentItemsView items={section.items} textColor={colors.sidebarText ?? colors.text} />
          </div>
        ),
      });
    });
  }

  return { items, headingsInOrder };
}

function IdentityMasthead({ normalized, colors, photoOption }: { normalized: ReturnType<typeof normalizeResume>; colors: Colors; photoOption: TemplateRenderContext["photoOption"] }): React.ReactElement {
  return (
    <div>
      {photoOption === "placeholder" && (
        <div aria-label={photoPlaceholderAlt(normalized.identity.fullName)} style={{ width: "72px", height: "72px", borderRadius: "50%", background: colors.accent, margin: "0 0 10px 0" }} {...DECORATIVE_ARIA_PROPS} />
      )}
      <h1 style={{ color: colors.sidebarText, fontFamily: MODERN_SIDEBAR_FONTS.heading, fontSize: "1.35em", margin: 0 }}>{normalized.identity.fullName}</h1>
      {normalized.identity.headline && <div style={{ color: colors.sidebarText, opacity: 0.85, marginTop: "4px" }}>{normalized.identity.headline}</div>}
      <div style={{ color: colors.sidebarText, opacity: 0.8, fontSize: "0.8em", marginTop: "8px", lineHeight: 1.6 }}>
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
    body { margin: 0; font-family: ${MODERN_SIDEBAR_FONTS.body}, ${MODERN_SIDEBAR_FONTS.eastAsiaFallback}; font-size: ${MIN_SAFE_FONT_SIZE_PT + 0.5}pt; }
    .page { width: ${widthPx}px; display: grid; grid-template-columns: ${sidebarPx}px 1fr; grid-template-areas: "identity main" "sidebar main"; break-after: page; background: ${colors.background}; }
    .page:last-child { break-after: auto; }
    .identity-area { grid-area: identity; background: ${colors.sidebarBackground}; padding: ${paddingPx}px ${paddingPx * 0.7}px ${paddingPx * 0.3}px; }
    .sidebar-area { grid-area: sidebar; background: ${colors.sidebarBackground}; padding: 0 ${paddingPx * 0.7}px ${paddingPx}px; min-height: 40px; }
    .main-area { grid-area: main; padding: ${paddingPx}px; }
    h1, h2, h3 { text-wrap: balance; }
  `;
}

export async function renderModernSidebarHtml(context: TemplateRenderContext): Promise<TemplateHtmlResult> {
  /* react-dom/server imported dynamically, not at module top level - see
     executiveMinimal/html.tsx's identical fix and the existing, unmodified
     professionalAtsHtml/paginatedHtmlString.ts convention this matches. */
  const { renderToStaticMarkup } = await import("react-dom/server");
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
  const colors = MODERN_SIDEBAR_COLORS;
  const dims = PAPER_DIMENSIONS[context.paperSize];
  const tokens = HTML_DENSITY_SPACING[context.density];
  const sidebarPx = Math.round((dims.widthPx * tokens.sidebarWidthPercent) / 100);
  const mainWidthPx = dims.widthPx - sidebarPx - tokens.pagePaddingPx * 2;
  const sidebarInnerPx = sidebarPx - Math.round(tokens.pagePaddingPx * 0.7 * 2);

  const { items: mainItems, headingsInOrder: mainHeadings } = buildMainItems(normalized, colors, tokens);
  const { items: sidebarItems, headingsInOrder: sidebarHeadings } = buildSidebarItems(normalized, colors);

  const styleText = pageStyles(colors, dims.widthPx, sidebarPx, tokens.pagePaddingPx);
  /*
    Phase 6I.6.18 - font-size (and the CJK fallback family) previously
    omitted here, so Playwright measured every entry at the browser's
    default font size (~16px/12pt) instead of pageStyles()'s real
    ${MIN_SAFE_FONT_SIZE_PT + 0.5}pt - a confirmed ~60% height over-
    measurement per entry, and THE root cause of the reported
    "excessive gap between same-section entries" (see this phase's own
    root-cause report). Must always mirror pageStyles() exactly.
  */
  const measureStyle = `body{margin:0;font-family:${MODERN_SIDEBAR_FONTS.body},${MODERN_SIDEBAR_FONTS.eastAsiaFallback};font-size:${MIN_SAFE_FONT_SIZE_PT + 0.5}pt;}`;

  /*
    Phase 6I.6.18 - display:flow-root on each flow-item wrapper (both
    here in the flat measurement body and on the final paginatedBody's
    own per-item wrapper below) contains that item's own trailing
    marginBottom (tokens.entryGapPx) instead of letting it collapse
    THROUGH this otherwise unpadded/unbordered div and escape
    measureFlowLayout's getBoundingClientRect() height query - same
    collapse class 6I.6.17 fixed for section headings' top padding,
    now on the bottom edge of every entry. Changes nothing about what
    actually renders (verified by direct reproduction).
  */
  const flatMain = <div style={{ width: mainWidthPx }}>{mainItems.map((item) => <div key={item.id} data-flow-id={item.id} style={{ display: "flow-root" }}>{item.node}</div>)}</div>;
  const flatSidebar = <div style={{ width: sidebarInnerPx }}>{sidebarItems.map((item) => <div key={item.id} data-flow-id={item.id} style={{ display: "flow-root" }}>{item.node}</div>)}</div>;

  const usableHeightPx = dims.heightPx - tokens.pagePaddingPx * 2;
  const identityMastheadHeightEstimatePx = 190;

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
          <div className="main-area">{mainByPage[pageIndex]?.map((id) => <div key={id} style={{ display: "flow-root" }}>{mainNodeById.get(id)}</div>)}</div>
          <div className="sidebar-area">{sidebarByPage[pageIndex]?.map((id) => <div key={id} style={{ display: "flow-root" }}>{sidebarNodeById.get(id)}</div>)}</div>
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

  return { templateId: "modern-sidebar", format: "html", html, pageCount, paperSize: context.paperSize, density: context.density, validation };
}

export const MODERN_SIDEBAR_INTERNAL = { buildMainItems, buildSidebarItems };
