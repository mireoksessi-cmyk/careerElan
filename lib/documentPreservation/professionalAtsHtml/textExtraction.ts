/*
  TASK 3 - Pure text-extraction helpers shared by renderers.tsx (what
  text does a block actually render?) and textPreservationValidator.ts
  (does the final HTML contain exactly that text, nothing missing,
  nothing invented?). Single source of truth so the renderer and its
  own validator can never silently drift apart.

  Every function here returns the EXACT payload text - no rewriting,
  no truncation, no keyword injection. Contact line joining and
  "Label: value" composition are the only "generated" text this module
  produces, and both are pure, allowed-by-policy formatting per spec
  section 7 (never invented facts, only safe joining of already-real
  values).
*/
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
  HierarchicalContentNode,
} from "../resumeStructured/types";

function nonEmpty(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/*
  Phase 5D.3B - mirrors renderers.tsx's own RawHeaderFallback exactly:
  when an Education/Credential/Award/Publication entry's structured
  fields AND body items are ALL empty, the renderer falls back to
  showing rawHeaderText verbatim rather than nothing - so the "expected
  text" ground truth here must expect that same fallback text, or the
  validator would flag correctly-rendered fallback output as "invented
  text" that isn't in its own fragment list.
*/
function rawHeaderFallbackFragments(rawHeaderText: string): string[] {
  return rawHeaderText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

export function extractIdentityFragments(identity: ResumeIdentity): string[] {
  const fragments: string[] = [];
  const name = nonEmpty(identity.fullName?.value);
  if (name) fragments.push(name);
  const headline = nonEmpty(identity.headline?.value);
  if (headline) fragments.push(headline);
  for (const field of [identity.email, identity.phone, identity.location, identity.linkedin, identity.portfolio, ...identity.otherContactLines]) {
    const v = nonEmpty(field?.value);
    if (v) fragments.push(v);
  }
  return fragments;
}

export function extractSummaryFragments(summary: ResumeSummary): string[] {
  return summary.text.split("\n\n").map((p) => nonEmpty(p)).filter((p): p is string => p !== undefined);
}

export function extractSkillGroupFragments(group: SkillGroup): string[] {
  const fragments: string[] = [];
  const label = nonEmpty(group.label);
  if (label) fragments.push(label);
  for (const skill of group.skills) {
    const v = nonEmpty(skill);
    if (v) fragments.push(v);
  }
  return fragments;
}

/*
  Phase 6G.1 - recursively collects every node's own .text (subheading
  labels included, not just leaf bullets/paragraphs) - mirrors
  renderers.tsx's renderHierarchicalNodes exactly, which renders EVERY
  node's text (in a <p> for subheading/paragraph, in a <li> for bullet)
  plus each node's own children. Real bug found via Phase 6G.1's
  buildFixtureRuntime() PDF repro: a subheading node's own label text
  (e.g. a "Program"/"Initiative" grouping heading) was genuinely
  rendered but never counted as expected, so the validator flagged
  correctly-rendered content as "invented".
*/
function collectHierarchicalTextFragments(nodes: HierarchicalContentNode[]): string[] {
  const fragments: string[] = [];
  for (const node of nodes) {
    const v = nonEmpty(node.text);
    if (v) fragments.push(v);
    if (node.children.length > 0) fragments.push(...collectHierarchicalTextFragments(node.children));
  }
  return fragments;
}

export function extractExperienceEntryFragments(entry: ExperienceEntry): string[] {
  const fragments: string[] = [];
  for (const f of [entry.organization, entry.role, entry.location, entry.dateRangeText]) {
    const v = nonEmpty(f?.value);
    if (v) fragments.push(v);
  }
  /*
    Phase 5D.3A / Phase 6G.1 - mirrors renderers.tsx's ExperienceLikeView
    exactly: entry.hierarchicalContent when hasHierarchicalStructure is
    true and non-empty (a real, richer tree the renderer actually
    displays instead of entry.content in that case - see
    renderHierarchicalNodes), else every block in entry.content, in
    original order. Originally this always read entry.content
    regardless of hasHierarchicalStructure, silently under-expecting
    (missing bullets nested only under the hierarchical tree) or over-
    expecting (bullets that hierarchicalContent legitimately omits)
    whenever the two representations diverged even slightly.
  */
  if (entry.hasHierarchicalStructure && entry.hierarchicalContent.length > 0) {
    fragments.push(...collectHierarchicalTextFragments(entry.hierarchicalContent));
  } else {
    for (const c of entry.content) {
      const v = nonEmpty(c.text);
      if (v) fragments.push(v);
    }
  }
  return fragments;
}

export function extractEducationEntryFragments(entry: EducationEntry): string[] {
  const fragments: string[] = [];
  /* Phase 5D.3D - iterate the full institutions[]/credentials[]/
     fieldsOfStudy[] arrays (Double Degree/Double Major/Joint Program),
     not just the singular institution/credential/fieldOfStudy fields
     (always array[0] by construction) - otherwise a 2nd+ degree/
     institution/major is never checked for missing-fragment presence,
     so a future bug that drops it from the rendered output would go
     undetected. */
  for (const f of [...entry.institutions, ...entry.credentials, ...entry.fieldsOfStudy, entry.location, entry.dateRangeText, entry.gpa]) {
    const v = nonEmpty(f?.value);
    if (v) fragments.push(v);
  }
  for (const h of entry.honors) {
    const v = nonEmpty(h.value);
    if (v) fragments.push(v);
  }
  for (const d of entry.details) {
    const v = nonEmpty(d.value);
    if (v) fragments.push(v);
  }
  if (fragments.length === 0) fragments.push(...rawHeaderFallbackFragments(entry.rawHeaderText));
  return fragments;
}

/*
  Phase 5D.6E TASK A - Generic Academic Field Preservation. When an
  education entry has 2+ fieldsOfStudy values (double major/minor/
  concentration) under a SINGLE credential/institution, renderers.tsx's
  EducationView single-credential branch (and docxRenderer.ts's
  equivalent) only ever displayed entry.fieldOfStudy (index 0 by
  construction) - every fieldOfStudy value past the first was silently
  dropped from render, since the "multi" branch only activates on
  credentials.length>=2 or institutions.length>=2, not on fieldsOfStudy
  count. Real bug, found via r07's own "Political Science" missing-
  fragment failure (a "Bachelor of Arts" in "Economics / Political
  Science" from one institution - 1 credential, 1 institution, 2
  fieldsOfStudy). This resolves the DISPLAY text for that case
  generically:
    1. Prefer the entry's own rawHeaderText verbatim line that already
       contains every fieldsOfStudy value as a substring - this uses
       the EXACT original delimiter (comma, slash, "and", whatever the
       source actually had) with zero invention, per spec section 2.2's
       "원본에 존재한 delimiter 정보가 있으면 보존" rule.
    2. If no single rawHeaderText line contains all values (fields
       genuinely split across lines, or a normalization mismatch), fall
       back to a generic " / " join - the same join character this
       module's own institutions.join(" / ") convention already uses
       for exactly this "multiple structured values, no better join
       signal" situation, so it stays internally consistent with the
       existing renderer rather than inventing a second convention.
  Returns undefined when fieldsOfStudy has 0-1 values - callers fall
  back to their own singular entry.fieldOfStudy in that case, so every
  existing single-major entry's render path is completely untouched.
*/
export function resolveMultiFieldOfStudyDisplay(entry: EducationEntry): string | undefined {
  const values = entry.fieldsOfStudy.map((f) => f.value).filter((v) => v.trim().length > 0);
  if (values.length < 2) return undefined;
  const lines = entry.rawHeaderText.split("\n").map((l) => l.trim());
  const verbatimLine = lines.find((line) => values.every((v) => line.includes(v)));
  return verbatimLine ?? values.join(" / ");
}

export function extractCredentialEntryFragments(entry: CredentialEntry): string[] {
  const fragments: string[] = [];
  /* Phase 5D.3D - iterate names[]/issuers[] - see
     extractEducationEntryFragments's own comment. */
  for (const f of [...entry.names, ...entry.issuers, entry.credentialId, entry.issueDateText, entry.expiryDateText, entry.location]) {
    const v = nonEmpty(f?.value);
    if (v) fragments.push(v);
  }
  for (const d of entry.details) {
    const v = nonEmpty(d.value);
    if (v) fragments.push(v);
  }
  if (fragments.length === 0) fragments.push(...rawHeaderFallbackFragments(entry.rawHeaderText));
  return fragments;
}

export function extractProjectEntryFragments(entry: ProjectEntry): string[] {
  const fragments: string[] = [];
  for (const f of [entry.name, entry.role, entry.dateRangeText]) {
    const v = nonEmpty(f?.value);
    if (v) fragments.push(v);
  }
  for (const t of entry.technologies) {
    const v = nonEmpty(t.value);
    if (v) fragments.push(v);
  }
  // Phase 5D.3A - see extractExperienceEntryFragments's own comment.
  // ProjectEntry has no hierarchicalContent (unlike ExperienceEntry) -
  // entry.content is always the renderer's own source here.
  for (const c of entry.content) {
    const v = nonEmpty(c.text);
    if (v) fragments.push(v);
  }
  return fragments;
}

export function extractAwardEntryFragments(entry: AwardEntry): string[] {
  const fragments: string[] = [];
  /* Phase 5D.3D - iterate names[] - see
     extractEducationEntryFragments's own comment. */
  for (const f of [...entry.names, entry.issuer, entry.dateText]) {
    const v = nonEmpty(f?.value);
    if (v) fragments.push(v);
  }
  for (const d of entry.details) {
    const v = nonEmpty(d.value);
    if (v) fragments.push(v);
  }
  if (fragments.length === 0) fragments.push(...rawHeaderFallbackFragments(entry.rawHeaderText));
  return fragments;
}

export function extractPublicationEntryFragments(entry: PublicationEntry): string[] {
  const fragments: string[] = [];
  /* Phase 5D.3D - iterate titles[] - see
     extractEducationEntryFragments's own comment. */
  for (const f of [...entry.titles, entry.publisherOrVenue, entry.dateText, entry.urlOrDoi]) {
    const v = nonEmpty(f?.value);
    if (v) fragments.push(v);
  }
  for (const a of entry.authors) {
    const v = nonEmpty(a.value);
    if (v) fragments.push(v);
  }
  for (const d of entry.details) {
    const v = nonEmpty(d.value);
    if (v) fragments.push(v);
  }
  if (fragments.length === 0) fragments.push(...rawHeaderFallbackFragments(entry.rawHeaderText));
  return fragments;
}

export function extractCustomSectionFragments(section: CustomResumeSection): string[] {
  const fragments: string[] = [];
  const heading = nonEmpty(section.originalHeading ?? undefined);
  if (heading) fragments.push(heading);
  // Phase 5D.3A - see extractExperienceEntryFragments's own comment.
  for (const c of section.content) {
    const v = nonEmpty(c.text);
    if (v) fragments.push(v);
  }
  return fragments;
}

/*
  Phase 5D.2B - mirrors renderers.tsx's MetricGridView exactly: every
  entry contributes its value text and its label text, in entry order -
  the same Value/Label pair the renderer draws, nothing paraphrased.
*/
export function extractMetricGridFragments(grid: MetricGrid): string[] {
  const fragments: string[] = [];
  for (const entry of grid.entries) {
    const value = nonEmpty(entry.value.value);
    if (value) fragments.push(value);
    const label = nonEmpty(entry.label.value);
    if (label) fragments.push(label);
  }
  return fragments;
}

export function extractPayloadFragments(kind: string, payload: unknown): string[] {
  switch (kind) {
    case "identity":
      return extractIdentityFragments(payload as ResumeIdentity);
    case "summary":
      return extractSummaryFragments(payload as ResumeSummary);
    case "skill-group":
      return extractSkillGroupFragments(payload as SkillGroup);
    case "experience-entry":
    case "volunteer-entry":
      return extractExperienceEntryFragments(payload as ExperienceEntry);
    case "education-entry":
      return extractEducationEntryFragments(payload as EducationEntry);
    case "credential-entry":
      return extractCredentialEntryFragments(payload as CredentialEntry);
    case "project-entry":
      return extractProjectEntryFragments(payload as ProjectEntry);
    case "award-entry":
      return extractAwardEntryFragments(payload as AwardEntry);
    case "publication-entry":
      return extractPublicationEntryFragments(payload as PublicationEntry);
    case "custom-section":
      return extractCustomSectionFragments(payload as CustomResumeSection);
    case "metric-grid":
      return extractMetricGridFragments(payload as MetricGrid);
    default:
      return [];
  }
}
