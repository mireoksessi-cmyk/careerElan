/*
  TASK 3 - Section visibility policy. Spec section 5: a section is
  visible only if it carries real, displayable content - an empty
  array, an all-whitespace string, or an entry whose every field is
  undefined/empty is NOT content. slotAvailability on ResumeStructuredModel
  is deliberately NOT trusted here (it only checks array length > 0,
  which misses e.g. a skillGroup with skills=[] or a CustomResumeSection
  with paragraphs=[]/bullets=[] - both real, observed shapes from
  Phase 2's own empty-section-fallback behavior, see
  buildStructuredResume.ts's `isEmpty(entries)` branch).

  Every hasXContent function is a pure predicate over Phase 2 data only
  - no Phase 3 policy decision (order, label, layout) belongs here.
*/
import type {
  ResumeStructuredModel,
  ResumeIdentity,
  ExperienceEntry,
  EducationEntry,
  CredentialEntry,
  ProjectEntry,
  AwardEntry,
  PublicationEntry,
  CustomResumeSection,
  MetricGrid,
  StructuredTextValue,
} from "../resumeStructured/types";

function hasText(v: StructuredTextValue | undefined): boolean {
  return v !== undefined && v.value.trim().length > 0;
}

export function hasIdentityContent(identity: ResumeIdentity | undefined): boolean {
  if (!identity) return false;
  return (
    hasText(identity.fullName) ||
    hasText(identity.headline) ||
    hasText(identity.email) ||
    hasText(identity.phone) ||
    hasText(identity.location) ||
    hasText(identity.linkedin) ||
    hasText(identity.portfolio) ||
    identity.otherContactLines.some(hasText)
  );
}

export function hasSummaryContent(summary: ResumeStructuredModel["professionalSummary"]): boolean {
  return summary !== undefined && summary.text.trim().length > 0;
}

export function hasSkillsContent(skillGroups: ResumeStructuredModel["skillGroups"]): boolean {
  return skillGroups.some((g) => g.skills.some((s) => s.trim().length > 0));
}

function hasExperienceEntryContent(e: ExperienceEntry): boolean {
  return (
    hasText(e.organization) ||
    hasText(e.role) ||
    hasText(e.location) ||
    hasText(e.dateRangeText) ||
    hasText(e.startDateText) ||
    hasText(e.endDateText) ||
    e.bullets.some((b) => b.text.trim().length > 0) ||
    e.descriptionParagraphs.some(hasText)
  );
}

export function hasExperienceContent(entries: ExperienceEntry[]): boolean {
  return entries.some(hasExperienceEntryContent);
}

function hasEducationEntryContent(e: EducationEntry): boolean {
  return (
    e.rawHeaderText.trim().length > 0 ||
    hasText(e.institution) ||
    hasText(e.credential) ||
    hasText(e.fieldOfStudy) ||
    hasText(e.location) ||
    hasText(e.dateRangeText) ||
    hasText(e.startDateText) ||
    hasText(e.endDateText) ||
    hasText(e.gpa) ||
    e.honors.some(hasText) ||
    e.details.some(hasText)
  );
}

export function hasEducationContent(entries: EducationEntry[]): boolean {
  return entries.some(hasEducationEntryContent);
}

function hasCredentialEntryContent(e: CredentialEntry): boolean {
  return (
    hasText(e.name) ||
    hasText(e.issuer) ||
    hasText(e.credentialId) ||
    hasText(e.issueDateText) ||
    hasText(e.expiryDateText) ||
    hasText(e.location) ||
    e.details.some(hasText)
  );
}

export function hasCredentialsContent(entries: CredentialEntry[]): boolean {
  return entries.some(hasCredentialEntryContent);
}

function hasProjectEntryContent(e: ProjectEntry): boolean {
  return (
    hasText(e.name) ||
    hasText(e.role) ||
    hasText(e.dateRangeText) ||
    e.technologies.some(hasText) ||
    e.bullets.some((b) => b.text.trim().length > 0) ||
    e.descriptionParagraphs.some(hasText)
  );
}

export function hasProjectsContent(entries: ProjectEntry[]): boolean {
  return entries.some(hasProjectEntryContent);
}

function hasAwardEntryContent(e: AwardEntry): boolean {
  return hasText(e.name) || hasText(e.issuer) || hasText(e.dateText) || e.details.some(hasText);
}

export function hasAwardsContent(entries: AwardEntry[]): boolean {
  return entries.some(hasAwardEntryContent);
}

function hasPublicationEntryContent(e: PublicationEntry): boolean {
  return hasText(e.title) || e.authors.some(hasText) || hasText(e.publisherOrVenue) || hasText(e.dateText) || hasText(e.urlOrDoi) || e.details.some(hasText);
}

export function hasPublicationsContent(entries: PublicationEntry[]): boolean {
  return entries.some(hasPublicationEntryContent);
}

/*
  A custom section's originalHeading/displayHeading alone is NOT
  content - only actual paragraphs/bullets count. Real-fixture evidence
  (bench/resume-B-junior-canva.pdf's empty "Professional Experience"
  section, routed to customSections by Phase 2's own empty-entry
  fallback) has a heading but paragraphs=[]/bullets=[] - this must
  resolve to false, not true.
*/
function hasCustomSectionContent(s: CustomResumeSection): boolean {
  return s.paragraphs.some(hasText) || s.bullets.some((b) => b.text.trim().length > 0);
}

export function hasCustomContent(sections: CustomResumeSection[]): boolean {
  return sections.some(hasCustomSectionContent);
}

/*
  Phase 5D.2B - a grid is visible only when it carries at least one
  entry with BOTH a non-blank value and a non-blank label - mirrors
  every other hasXContent predicate's "real, displayable content only"
  rule (metricGridExtractor.ts's own >=2-entries-per-grid gate already
  keeps a genuinely empty/singleton grid from ever reaching this point,
  but this stays a pure content check, independent of how the grid was
  produced).
*/
function hasMetricGridContent(g: MetricGrid): boolean {
  return g.entries.some((e) => e.value.value.trim().length > 0 && e.label.value.trim().length > 0);
}

export function hasMetricGridsContent(grids: MetricGrid[]): boolean {
  return grids.some(hasMetricGridContent);
}
