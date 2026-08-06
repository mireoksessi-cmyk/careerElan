/*
  TASK 11 - Phase-5C-specific synthetic ProfessionalAtsAssemblyDocument
  scenarios not covered by Phase 4's ALL_SYNTHETIC_SCENARIOS or Phase
  5B's ALL_MULTILINGUAL_SCENARIOS (both reused verbatim by
  syntheticStress.test.ts alongside these). These three specifically
  target the short-generic-token collision class of bug that motivated
  parityMatcher.ts's advancing-cursor design (the exact Phase 5B "ON"
  bug fixed in docxParityValidator.ts) - each scenario repeats a short
  (<=4 char) generic token across multiple entries so a matcher that
  searches from position 0 instead of an advancing cursor would falsely
  re-match an earlier entry's already-claimed occurrence and miss real
  order/duplicate defects. Built with the same hand-authoring pattern as
  Phase 5B's multilingualScenarios.ts - same real defaultBlockPolicy()
  and PROFESSIONAL_ATS_SECTION_LABELS lookups, read-only reuse.
*/
import { defaultBlockPolicy } from "../professionalAtsAssembly/breakPolicy";
import { PROFESSIONAL_ATS_SECTION_LABELS } from "../professionalAtsAssembly/sectionLabels";
import type { AssemblyBlock, AssemblyBlockKind, ProfessionalAtsAssemblyDocument, ProfessionalAtsAssemblySection, ProfessionalAtsSectionKey } from "../professionalAtsAssembly/types";
import type { ResumeIdentity, ExperienceEntry, StructuredTextValue, StructuredBullet } from "../resumeStructured/types";

const SECTION_ORDER: ProfessionalAtsSectionKey[] = [
  "identity",
  "professional_summary",
  "core_skills",
  "professional_experience",
  "volunteer_experience",
  "education",
  "certifications_licenses",
  "projects",
  "awards",
  "publications",
  "additional_information",
];

function trace(id: string) {
  return { sourceSectionId: id, sourceBlockIds: [id], sourceElementIds: [id] };
}

function tv(value: string, id: string): StructuredTextValue {
  return { value, confidence: 0.9, extractionMethod: "pattern-rule", source: trace(id) };
}

function bullet(text: string, id: string): StructuredBullet {
  return { id, text, source: trace(id) };
}

function block(id: string, kind: AssemblyBlockKind, payload: unknown, input: { bulletCount?: number; paragraphCount?: number; detailCount?: number } = {}): AssemblyBlock {
  const policy = defaultBlockPolicy(kind, input);
  return {
    id,
    kind,
    sourceEntryId: id,
    sourceSectionIds: [id],
    sourceBlockIds: [id],
    estimatedContentUnits: 10,
    minVisibleContentUnits: 2,
    ...policy,
    priority: 1,
    isOptional: false,
    isUncertain: false,
    payload,
  };
}

function identityBlock(identity: ResumeIdentity): AssemblyBlock {
  return block("synthetic-identity", "identity", identity);
}

function makeSection(key: ProfessionalAtsSectionKey, blocks: AssemblyBlock[]): ProfessionalAtsAssemblySection {
  return {
    key,
    label: PROFESSIONAL_ATS_SECTION_LABELS[key],
    order: SECTION_ORDER.indexOf(key),
    visible: blocks.length > 0,
    visibilityReason: blocks.length > 0 ? "has-content" : "empty",
    blocks,
    keepHeadingWithFirstBlock: true,
    breakBefore: "allow",
    breakAfter: "allow",
    minBlocksToShow: 1,
    sourceSectionIds: [key],
  };
}

function assembleDocument(sectionsByKey: Partial<Record<ProfessionalAtsSectionKey, AssemblyBlock[]>>): ProfessionalAtsAssemblyDocument {
  const sections = SECTION_ORDER.map((key) => makeSection(key, sectionsByKey[key] ?? []));
  const visibleSectionKeys = sections.filter((s) => s.visible).map((s) => s.key);
  const hiddenSectionKeys = sections.filter((s) => !s.visible).map((s) => s.key);
  return {
    schemaVersion: "1.0.0",
    templateId: "professional-ats-v1",
    sourceModelVersion: "synthetic-2.0.0",
    sections,
    visibleSectionKeys,
    hiddenSectionKeys,
    defaultDensity: "comfortable",
    compactionPolicy: {
      allowedDensities: ["comfortable", "balanced", "compact", "ultra-compact"],
      canReduceSectionSpacing: true,
      canReduceEntrySpacing: true,
      canReduceBulletSpacing: true,
      canTightenSkillLayout: true,
      canTrimContent: false,
      canDropSections: false,
      canDropEntries: false,
      canDropBullets: false,
    },
    validation: {
      passed: true,
      visibleSectionKeys,
      hiddenSectionKeys,
      orderViolations: [],
      volunteerPlacementViolations: [],
      missingEntryIds: [],
      duplicateEntryIds: [],
      invalidHiddenSectionsWithBlocks: [],
      destructiveCompactionFlags: [],
      warnings: [],
    },
  };
}

function experienceEntry(id: string, role: string, org: string, location: string, dateRangeText: string, bulletTexts: string[]): ExperienceEntry {
  return {
    id,
    organization: tv(org, id),
    role: tv(role, id),
    location: tv(location, id),
    dateRangeText: tv(dateRangeText, id),
    bullets: bulletTexts.map((t, i) => bullet(t, `${id}-b${i}`)),
    descriptionParagraphs: [],
    content: bulletTexts.map((t, i) => ({ id: `${id}-content-${i}`, kind: "bullet" as const, text: t, source: trace(id) })),
    hierarchicalContent: [],
    hasHierarchicalStructure: false,
    rawHeaderText: `${role} | ${org}`,
    source: trace(id),
    isVolunteer: false,
    isUncertain: false,
    reasonCodes: [],
  };
}

/* Scenario A: same short location token ("ON", 2 chars) repeated
   across three experience entries and one education entry - the exact
   province-abbreviation shape that caused the Phase 5B docxParityValidator
   naive-indexOf collision bug. */
export function repeatedShortLocationToken(): ProfessionalAtsAssemblyDocument {
  const identity: ResumeIdentity = {
    fullName: tv("Jordan Lee", "identity"),
    email: tv("jordan.lee@example.com", "identity"),
    phone: tv("(555) 010-6060", "identity"),
    location: tv("ON", "identity"),
    otherContactLines: [],
  };
  const exp1 = experienceEntry("synthetic-tok-exp1", "Analyst", "Acme Corp", "ON", "2018 - 2019", ["Automated a manual reconciliation process."]);
  const exp2 = experienceEntry("synthetic-tok-exp2", "Senior Analyst", "Beacon Ltd", "ON", "2019 - 2021", ["Led migration to a new reporting stack."]);
  const exp3 = experienceEntry("synthetic-tok-exp3", "Manager", "Crestview Inc", "ON", "2021 - Present", ["Built a cross-functional planning cadence."]);
  return assembleDocument({
    identity: [identityBlock(identity)],
    professional_experience: [
      block("synthetic-tok-exp1", "experience-entry", exp1, { bulletCount: 1 }),
      block("synthetic-tok-exp2", "experience-entry", exp2, { bulletCount: 1 }),
      block("synthetic-tok-exp3", "experience-entry", exp3, { bulletCount: 1 }),
    ],
  });
}

/* Scenario B: same year ("2024") repeated across three entries whose
   date ranges only differ by month, plus a fourth entry with a bare
   "2024" single-year date - a matcher anchored on date text alone
   (rather than the full organization+role+date tier) would falsely
   collide these four occurrences. */
export function repeatedYearToken(): ProfessionalAtsAssemblyDocument {
  const identity: ResumeIdentity = {
    fullName: tv("Sam Rivera", "identity"),
    email: tv("sam.rivera@example.com", "identity"),
    phone: tv("(555) 010-7070", "identity"),
    location: tv("Remote", "identity"),
    otherContactLines: [],
  };
  const exp1 = experienceEntry("synthetic-yr-exp1", "Contractor", "Delta Studio", "Remote", "Jan 2024 - Mar 2024", ["Delivered a three-month platform audit."]);
  const exp2 = experienceEntry("synthetic-yr-exp2", "Consultant", "Everest Group", "Remote", "Apr 2024 - Jun 2024", ["Advised on a vendor migration."]);
  const exp3 = experienceEntry("synthetic-yr-exp3", "Advisor", "Foxglove Partners", "Remote", "Jul 2024 - Sep 2024", ["Ran quarterly strategy workshops."]);
  const exp4 = experienceEntry("synthetic-yr-exp4", "Fellow", "Granite Labs", "Remote", "2024", ["Completed a one-year applied research fellowship."]);
  return assembleDocument({
    identity: [identityBlock(identity)],
    professional_experience: [
      block("synthetic-yr-exp1", "experience-entry", exp1, { bulletCount: 1 }),
      block("synthetic-yr-exp2", "experience-entry", exp2, { bulletCount: 1 }),
      block("synthetic-yr-exp3", "experience-entry", exp3, { bulletCount: 1 }),
      block("synthetic-yr-exp4", "experience-entry", exp4, { bulletCount: 1 }),
    ],
  });
}

/* Scenario C: same company, multiple roles - three promotions at one
   employer ("Nova Systems") with the organization field byte-identical
   across all three entries, differing only in role/date/bullets. This
   exercises the entry-anchor tier fallback: Tier 1 (org+role+date)
   still disambiguates each entry since role/date differ, but a naive
   organization-only search would collide all three. */
export function sameCompanyMultipleRoles(): ProfessionalAtsAssemblyDocument {
  const identity: ResumeIdentity = {
    fullName: tv("Casey Nguyen", "identity"),
    email: tv("casey.nguyen@example.com", "identity"),
    phone: tv("(555) 010-8080", "identity"),
    location: tv("Vancouver, BC", "identity"),
    otherContactLines: [],
  };
  const exp1 = experienceEntry("synthetic-role-exp1", "Associate Engineer", "Nova Systems", "Vancouver, BC", "2017 - 2019", ["Shipped the initial mobile client."]);
  const exp2 = experienceEntry("synthetic-role-exp2", "Engineer", "Nova Systems", "Vancouver, BC", "2019 - 2022", ["Owned the payments integration."]);
  const exp3 = experienceEntry("synthetic-role-exp3", "Senior Engineer", "Nova Systems", "Vancouver, BC", "2022 - Present", ["Mentored two associate engineers."]);
  return assembleDocument({
    identity: [identityBlock(identity)],
    professional_experience: [
      block("synthetic-role-exp1", "experience-entry", exp1, { bulletCount: 1 }),
      block("synthetic-role-exp2", "experience-entry", exp2, { bulletCount: 1 }),
      block("synthetic-role-exp3", "experience-entry", exp3, { bulletCount: 1 }),
    ],
  });
}

export const ALL_PARITY_MULTILINGUAL_SCENARIOS: { name: string; build: () => ProfessionalAtsAssemblyDocument }[] = [
  { name: "repeated-short-location-token", build: repeatedShortLocationToken },
  { name: "repeated-year-token", build: repeatedYearToken },
  { name: "same-company-multiple-roles", build: sameCompanyMultipleRoles },
];
