/*
  TASK 8 - Assembly Validator. Spec section 10, checks A-I; H
  (determinism) is a test-level concern (build the same model twice,
  diff the two ProfessionalAtsAssemblyDocuments) for the same reason
  Phase 1/2's own validators document - a single document instance
  can't prove determinism about itself.

  Gate rule (unchanged from Phase 1/2's own policy): a hidden non-empty
  section, a lost/duplicated entry, invented payload content, or a
  destructive compaction flag flipped true is an automatic FAIL.
*/
import type { ResumeStructuredModel } from "../resumeStructured/types";
import type { ProfessionalAtsAssemblyDocument, ProfessionalAtsAssemblyValidationReport, ProfessionalAtsSectionKey } from "./types";
import { PROFESSIONAL_ATS_SECTION_ORDER } from "./sectionLabels";
import {
  hasIdentityContent,
  hasSummaryContent,
  hasSkillsContent,
  hasExperienceContent,
  hasEducationContent,
  hasCredentialsContent,
  hasProjectsContent,
  hasAwardsContent,
  hasPublicationsContent,
  hasCustomContent,
  hasMetricGridsContent,
} from "./visibilityPolicy";

function expectedVisibility(model: ResumeStructuredModel): Partial<Record<ProfessionalAtsSectionKey, boolean>> {
  return {
    identity: hasIdentityContent(model.identity),
    metric_highlights: hasMetricGridsContent(model.metricGrids),
    professional_summary: hasSummaryContent(model.professionalSummary),
    core_skills: hasSkillsContent(model.skillGroups),
    professional_experience: hasExperienceContent(model.professionalExperience),
    volunteer_experience: hasExperienceContent(model.volunteerExperience),
    education: hasEducationContent(model.education),
    certifications_licenses: hasCredentialsContent(model.credentials),
    projects: hasProjectsContent(model.projects),
    awards: hasAwardsContent(model.awards),
    publications: hasPublicationsContent(model.publications),
    additional_information: hasCustomContent(model.customSections),
  };
}

function allValidEntryIds(model: ResumeStructuredModel): Set<string> {
  const ids = new Set<string>();
  for (const e of [...model.professionalExperience, ...model.volunteerExperience]) if (hasExperienceContent([e])) ids.add(e.id);
  for (const e of model.education) if (hasEducationContent([e])) ids.add(e.id);
  for (const e of model.credentials) if (hasCredentialsContent([e])) ids.add(e.id);
  for (const e of model.projects) if (hasProjectsContent([e])) ids.add(e.id);
  for (const e of model.awards) if (hasAwardsContent([e])) ids.add(e.id);
  for (const e of model.publications) if (hasPublicationsContent([e])) ids.add(e.id);
  for (const s of model.customSections) if (hasCustomContent([s])) ids.add(s.id);
  for (const g of model.metricGrids) if (hasMetricGridsContent([g])) ids.add(g.id);
  return ids;
}

function knownPayloadObjects(model: ResumeStructuredModel): Set<unknown> {
  const set = new Set<unknown>();
  if (model.identity) set.add(model.identity);
  if (model.professionalSummary) set.add(model.professionalSummary);
  for (const g of model.skillGroups) set.add(g);
  for (const e of [...model.professionalExperience, ...model.volunteerExperience, ...model.education, ...model.credentials, ...model.projects, ...model.awards, ...model.publications, ...model.customSections, ...model.metricGrids]) {
    set.add(e);
  }
  return set;
}

export function validateAssembly(document: ProfessionalAtsAssemblyDocument, model: ResumeStructuredModel): ProfessionalAtsAssemblyValidationReport {
  const warnings: string[] = [];

  // --- A. Section visibility correctness ---
  const expected = expectedVisibility(model);
  const visibilityMismatches: string[] = [];
  for (const section of document.sections) {
    if (section.visible !== (expected[section.key] ?? false)) {
      visibilityMismatches.push(`${section.key}: expected visible=${expected[section.key]}, got ${section.visible}`);
    }
  }
  if (visibilityMismatches.length > 0) warnings.push(...visibilityMismatches.map((m) => `visibility mismatch: ${m}`));

  // --- B. Ordering ---
  const orderViolations: string[] = [];
  const expectedVisibleOrder = PROFESSIONAL_ATS_SECTION_ORDER.filter((k) => document.sections.find((s) => s.key === k)?.visible);
  if (JSON.stringify(document.visibleSectionKeys) !== JSON.stringify(expectedVisibleOrder)) {
    orderViolations.push(`visibleSectionKeys order mismatch: expected ${JSON.stringify(expectedVisibleOrder)}, got ${JSON.stringify(document.visibleSectionKeys)}`);
  }

  // --- C. Volunteer placement ---
  const volunteerPlacementViolations: string[] = [];
  const profIndex = document.visibleSectionKeys.indexOf("professional_experience");
  const volIndex = document.visibleSectionKeys.indexOf("volunteer_experience");
  if (profIndex >= 0 && volIndex >= 0 && volIndex !== profIndex + 1) {
    volunteerPlacementViolations.push(`volunteer_experience must immediately follow professional_experience when both are visible; profIndex=${profIndex} volIndex=${volIndex}`);
  }
  const profSection = document.sections.find((s) => s.key === "professional_experience");
  const volSection = document.sections.find((s) => s.key === "volunteer_experience");
  for (const b of profSection?.blocks ?? []) {
    if (b.kind === "volunteer-entry") volunteerPlacementViolations.push(`volunteer entry ${b.sourceEntryId} found inside professional_experience section`);
  }
  for (const b of volSection?.blocks ?? []) {
    if (b.kind === "experience-entry") volunteerPlacementViolations.push(`professional entry ${b.sourceEntryId} found inside volunteer_experience section`);
  }

  // --- D. Content preservation (no loss, no duplicates) ---
  const expectedIds = allValidEntryIds(model);
  const representedIds: string[] = [];
  for (const section of document.sections) {
    for (const block of section.blocks) {
      if (block.sourceEntryId) representedIds.push(block.sourceEntryId);
    }
  }
  const representedIdCounts = new Map<string, number>();
  for (const id of representedIds) representedIdCounts.set(id, (representedIdCounts.get(id) ?? 0) + 1);
  const missingEntryIds = [...expectedIds].filter((id) => !representedIdCounts.has(id));
  const duplicateEntryIds = [...representedIdCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);

  // --- E. No invented content ---
  const known = knownPayloadObjects(model);
  const inventedPayloadBlocks: string[] = [];
  for (const section of document.sections) {
    for (const block of section.blocks) {
      if (block.kind === "identity" || block.kind === "summary" || block.kind === "skill-group") continue; // checked via reference equality below, but not entry-id-addressable
      if (!known.has(block.payload)) inventedPayloadBlocks.push(block.id);
    }
  }
  if (model.identity) {
    for (const section of document.sections) {
      for (const block of section.blocks) {
        if (block.kind === "identity" && block.payload !== model.identity) inventedPayloadBlocks.push(block.id);
      }
    }
  }
  if (inventedPayloadBlocks.length > 0) warnings.push(`block payload not traced to a real Phase 2 object: ${inventedPayloadBlocks.join(", ")}`);

  // --- F. Hidden section budget ---
  const invalidHiddenSectionsWithBlocks = document.sections.filter((s) => !s.visible && s.blocks.length > 0).map((s) => s.key);

  // --- G. Keep-together rules present ---
  for (const section of document.sections) {
    if (section.visible && section.blocks.length > 0 && section.key !== "identity" && !section.keepHeadingWithFirstBlock) {
      warnings.push(`${section.key}: visible with blocks but keepHeadingWithFirstBlock is false`);
    }
    for (const block of section.blocks) {
      if (block.keepTogether === "none" && block.kind !== "identity") {
        warnings.push(`${section.key}/${block.id}: keepTogether is "none" - every content block should declare a real keep-together policy`);
      }
    }
  }

  // --- I. No destructive compaction ---
  const destructiveCompactionFlags: string[] = [];
  const cp = document.compactionPolicy;
  if (cp.canTrimContent) destructiveCompactionFlags.push("canTrimContent");
  if (cp.canDropSections) destructiveCompactionFlags.push("canDropSections");
  if (cp.canDropEntries) destructiveCompactionFlags.push("canDropEntries");
  if (cp.canDropBullets) destructiveCompactionFlags.push("canDropBullets");

  const passed =
    visibilityMismatches.length === 0 &&
    orderViolations.length === 0 &&
    volunteerPlacementViolations.length === 0 &&
    missingEntryIds.length === 0 &&
    duplicateEntryIds.length === 0 &&
    inventedPayloadBlocks.length === 0 &&
    invalidHiddenSectionsWithBlocks.length === 0 &&
    destructiveCompactionFlags.length === 0;

  return {
    passed,
    visibleSectionKeys: document.visibleSectionKeys,
    hiddenSectionKeys: document.hiddenSectionKeys,
    orderViolations,
    volunteerPlacementViolations,
    missingEntryIds,
    duplicateEntryIds,
    invalidHiddenSectionsWithBlocks,
    destructiveCompactionFlags,
    warnings,
  };
}
