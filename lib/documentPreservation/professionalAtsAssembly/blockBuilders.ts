/*
  TASK 5 - Block builders. Converts each Phase 2 entry/value into
  exactly one AssemblyBlock. Pure functions only - no content is
  rewritten, no new fact is invented; `payload` carries the Phase 2
  entry object itself (by reference) so nothing is re-derived or
  paraphrased. Source trace (sourceSectionIds/sourceBlockIds) is copied
  verbatim from the entry's own `.source`, mirroring Phase 1/2's own
  "never mint a new id, only copy" discipline.

  priority is the entry's own position within its Phase 2 array (0 =
  first) - Phase 3 never reorders entries by confidence or size.
  isOptional is always false: nothing in this phase may be treated as
  droppable (see AssemblyCompactionPolicy's own canDrop* = false
  contract) - the field exists in the type for a possible future
  renderer-level concept, not used to gate anything here.
*/
import type {
  ExperienceEntry,
  EducationEntry,
  CredentialEntry,
  ProjectEntry,
  AwardEntry,
  PublicationEntry,
  CustomResumeSection,
  SkillGroup,
  ResumeSummary,
} from "../resumeStructured/types";
import type { AssemblyBlock, AssemblyBlockKind } from "./types";
import { defaultBlockPolicy } from "./breakPolicy";
import { textUnit, sumTextUnits, HEADER_BASELINE_UNITS } from "./contentUnits";

/* estimatedContentUnits is intentionally left at 0 here - each build*
   function below overwrites it right after calling this helper, since
   the correct formula differs per entry type (see contentUnits.ts). */
function buildBlock(kind: AssemblyBlockKind, id: string, sourceEntryId: string | undefined, sourceSectionId: string, sourceBlockIds: string[], priority: number, isUncertain: boolean, payload: unknown, policyInput: Parameters<typeof defaultBlockPolicy>[1]): AssemblyBlock {
  const policy = defaultBlockPolicy(kind, policyInput);
  return {
    id,
    kind,
    sourceEntryId,
    sourceSectionIds: [sourceSectionId],
    sourceBlockIds,
    estimatedContentUnits: 0, // overwritten by each build* function below
    minVisibleContentUnits: HEADER_BASELINE_UNITS,
    breakPolicy: policy.breakPolicy,
    keepTogether: policy.keepTogether,
    canSplit: policy.canSplit,
    splitStrategy: policy.splitStrategy,
    priority,
    isOptional: false,
    isUncertain,
    payload,
  };
}

function experienceLikeUnits(bullets: { text: string }[], descriptionParagraphs: { value: string }[]): number {
  return HEADER_BASELINE_UNITS + sumTextUnits(bullets.map((b) => b.text)) + sumTextUnits(descriptionParagraphs.map((d) => d.value));
}

export function buildExperienceEntryBlock(entry: ExperienceEntry, priority: number): AssemblyBlock {
  const kind: AssemblyBlockKind = entry.isVolunteer ? "volunteer-entry" : "experience-entry";
  const block = buildBlock(
    kind,
    `assembly-${kind}-${entry.id}`,
    entry.id,
    entry.source.sourceSectionId,
    entry.source.sourceBlockIds,
    priority,
    entry.isUncertain,
    entry,
    { bulletCount: entry.bullets.length, paragraphCount: entry.descriptionParagraphs.length }
  );
  block.estimatedContentUnits = experienceLikeUnits(entry.bullets, entry.descriptionParagraphs);
  return block;
}

export function buildEducationEntryBlock(entry: EducationEntry, priority: number): AssemblyBlock {
  const detailCount = entry.honors.length + entry.details.length;
  const block = buildBlock("education-entry", `assembly-education-entry-${entry.id}`, entry.id, entry.source.sourceSectionId, entry.source.sourceBlockIds, priority, entry.isUncertain, entry, { detailCount });
  block.estimatedContentUnits = HEADER_BASELINE_UNITS + sumTextUnits(entry.honors.map((h) => h.value)) + sumTextUnits(entry.details.map((d) => d.value));
  return block;
}

export function buildCredentialEntryBlock(entry: CredentialEntry, priority: number): AssemblyBlock {
  const block = buildBlock("credential-entry", `assembly-credential-entry-${entry.id}`, entry.id, entry.source.sourceSectionId, entry.source.sourceBlockIds, priority, entry.isUncertain, entry, { detailCount: entry.details.length });
  block.estimatedContentUnits = HEADER_BASELINE_UNITS + sumTextUnits(entry.details.map((d) => d.value));
  return block;
}

export function buildProjectEntryBlock(entry: ProjectEntry, priority: number): AssemblyBlock {
  const block = buildBlock("project-entry", `assembly-project-entry-${entry.id}`, entry.id, entry.source.sourceSectionId, entry.source.sourceBlockIds, priority, entry.isUncertain, entry, { bulletCount: entry.bullets.length, paragraphCount: entry.descriptionParagraphs.length });
  block.estimatedContentUnits = experienceLikeUnits(entry.bullets, entry.descriptionParagraphs);
  return block;
}

export function buildAwardEntryBlock(entry: AwardEntry, priority: number): AssemblyBlock {
  const block = buildBlock("award-entry", `assembly-award-entry-${entry.id}`, entry.id, entry.source.sourceSectionId, entry.source.sourceBlockIds, priority, entry.isUncertain, entry, { detailCount: entry.details.length });
  block.estimatedContentUnits = HEADER_BASELINE_UNITS + sumTextUnits(entry.details.map((d) => d.value));
  return block;
}

export function buildPublicationEntryBlock(entry: PublicationEntry, priority: number): AssemblyBlock {
  const block = buildBlock("publication-entry", `assembly-publication-entry-${entry.id}`, entry.id, entry.source.sourceSectionId, entry.source.sourceBlockIds, priority, entry.isUncertain, entry, { detailCount: entry.details.length });
  block.estimatedContentUnits = HEADER_BASELINE_UNITS + sumTextUnits(entry.authors.map((a) => a.value)) + sumTextUnits(entry.details.map((d) => d.value));
  return block;
}

export function buildCustomSectionBlock(section: CustomResumeSection, priority: number): AssemblyBlock {
  const block = buildBlock("custom-section", `assembly-custom-section-${section.id}`, section.id, section.source.sourceSectionId, section.source.sourceBlockIds, priority, false, section, { paragraphCount: section.paragraphs.length, bulletCount: section.bullets.length });
  block.estimatedContentUnits = HEADER_BASELINE_UNITS + sumTextUnits(section.paragraphs.map((p) => p.value)) + sumTextUnits(section.bullets.map((b) => b.text));
  return block;
}

export function buildSkillGroupBlock(group: SkillGroup, priority: number): AssemblyBlock {
  const block = buildBlock("skill-group", `assembly-skill-group-${priority}-${group.source.sourceSectionId}`, undefined, group.source.sourceSectionId, group.source.sourceBlockIds, priority, false, group, {});
  block.estimatedContentUnits = HEADER_BASELINE_UNITS + textUnit(group.skills.join(", "));
  return block;
}

export function buildSummaryBlock(summary: ResumeSummary): AssemblyBlock {
  const paragraphs = summary.text.split("\n\n");
  const block = buildBlock("summary", `assembly-summary-${summary.source.sourceSectionId}`, undefined, summary.source.sourceSectionId, summary.source.sourceBlockIds, 0, false, summary, { paragraphCount: paragraphs.length });
  block.estimatedContentUnits = sumTextUnits(paragraphs);
  return block;
}

export function buildIdentityBlock(sourceSectionId: string, sourceBlockIds: string[], payload: unknown): AssemblyBlock {
  const block = buildBlock("identity", `assembly-identity-${sourceSectionId}`, undefined, sourceSectionId, sourceBlockIds, 0, false, payload, {});
  block.estimatedContentUnits = HEADER_BASELINE_UNITS;
  return block;
}
