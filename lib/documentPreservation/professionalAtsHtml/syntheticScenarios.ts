/*
  TASK 10 - Hand-authored synthetic ProfessionalAtsAssemblyDocument
  scenarios for edge cases the 22 real fixtures don't naturally cover
  (very-long single entry requiring a multi-bullet split, an
  unsplittable oversized skill-group, volunteer-only, all-11-sections,
  custom-section-only, many-short-entries orphan-regression pressure).
  Built directly against Phase 3's own type contract, reusing its real
  defaultBlockPolicy() lookup (breakPolicy.ts) and section labels
  (sectionLabels.ts) rather than hand-guessing policy fields - these
  are still real Phase 3 documents, just skipping Phase 1/2 parsing of
  an actual file.
*/
import { defaultBlockPolicy } from "../professionalAtsAssembly/breakPolicy";
import { PROFESSIONAL_ATS_SECTION_LABELS } from "../professionalAtsAssembly/sectionLabels";
import type {
  AssemblyBlock,
  AssemblyBlockKind,
  ProfessionalAtsAssemblyDocument,
  ProfessionalAtsAssemblySection,
  ProfessionalAtsSectionKey,
} from "../professionalAtsAssembly/types";
import type { ResumeIdentity, ResumeSummary, SkillGroup, ExperienceEntry, CustomResumeSection, StructuredTextValue, StructuredBullet } from "../resumeStructured/types";

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

function makeIdentity(): AssemblyBlock {
  const identity: ResumeIdentity = {
    fullName: tv("Jordan Rivera", "identity"),
    email: tv("jordan.rivera@example.com", "identity"),
    phone: tv("(555) 010-2020", "identity"),
    location: tv("Halifax, NS", "identity"),
    otherContactLines: [],
  };
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

function experienceEntry(id: string, role: string, org: string, bulletTexts: string[]): ExperienceEntry {
  return {
    id,
    organization: tv(org, id),
    role: tv(role, id),
    location: tv("Remote", id),
    dateRangeText: tv("2019 - Present", id),
    bullets: bulletTexts.map((t, i) => bullet(t, `${id}-b${i}`)),
    descriptionParagraphs: [],
    rawHeaderText: `${role} | ${org}`,
    source: trace(id),
    isVolunteer: false,
    isUncertain: false,
    reasonCodes: [],
  };
}

/* Scenario 1: one experience entry with 40 bullets - must split across
   multiple pages regardless of density. */
export function veryLongSingleEntry(): ProfessionalAtsAssemblyDocument {
  // 100 bullets comfortably exceeds one full page even at ultra-compact
  // density (~20px/bullet x 100 = ~2000px vs. ~1008px usable height) -
  // a real forced multi-page split, not just a close call.
  const bullets = Array.from({ length: 100 }, (_, i) => `Delivered measurable outcome number ${i + 1} through cross-functional collaboration and process improvement initiatives.`);
  const entry = experienceEntry("synthetic-exp-long", "Senior Program Manager", "Atlantic Ventures Inc.", bullets);
  return assembleDocument({
    identity: [makeIdentity()],
    professional_experience: [block("synthetic-exp-long", "experience-entry", entry, { bulletCount: bullets.length })],
  });
}

/* Scenario 2: one skill-group with a very large number of skills - a
   single unsplittable ("whole-block") entry, exercising the "content
   never dropped even if it forces extra page height" path. */
export function veryLongSkillGroup(): ProfessionalAtsAssemblyDocument {
  const skills = Array.from({ length: 120 }, (_, i) => `Skill Competency ${i + 1}`);
  const group: SkillGroup = { label: "Core Competencies", skills, source: trace("synthetic-skills") };
  return assembleDocument({
    identity: [makeIdentity()],
    core_skills: [block("synthetic-skills", "skill-group", group)],
  });
}

/* Scenario 3: volunteer experience present, professional experience
   entirely absent - volunteer_experience must still occupy its own
   fixed slot position, professional_experience must be hidden. */
export function volunteerOnly(): ProfessionalAtsAssemblyDocument {
  const entry = experienceEntry("synthetic-vol-0", "Community Coordinator", "Harbourfront Food Bank", [
    "Organized weekly volunteer shifts for a team of 12.",
    "Coordinated donation logistics with 5 local partner organizations.",
  ]);
  const volunteerBlock: AssemblyBlock = { ...block("synthetic-vol-0", "volunteer-entry", { ...entry, isVolunteer: true }, { bulletCount: 2 }) };
  return assembleDocument({
    identity: [makeIdentity()],
    volunteer_experience: [volunteerBlock],
  });
}

/* Scenario 4: every one of the 11 fixed section slots has at least
   one visible block - the strongest single check that fixed order is
   respected end to end. */
export function allElevenSections(): ProfessionalAtsAssemblyDocument {
  const summary: ResumeSummary = { text: "Versatile operations leader with a decade of cross-industry experience.", source: trace("synthetic-summary") };
  const skills: SkillGroup = { label: "Skills", skills: ["Leadership", "Analytics", "Process design"], source: trace("synthetic-skills-all") };
  const exp = experienceEntry("synthetic-all-exp", "Director of Operations", "Maritime Holdings", ["Led a 40-person operations team.", "Reduced costs by 18%."]);
  const vol = experienceEntry("synthetic-all-vol", "Board Member", "Local Arts Council", ["Advised on annual budget planning."]);
  vol.isVolunteer = true;

  return assembleDocument({
    identity: [makeIdentity()],
    professional_summary: [block("synthetic-all-summary", "summary", summary)],
    core_skills: [block("synthetic-all-skills", "skill-group", skills)],
    professional_experience: [block("synthetic-all-exp", "experience-entry", exp, { bulletCount: 2 })],
    volunteer_experience: [block("synthetic-all-vol", "volunteer-entry", vol, { bulletCount: 1 })],
    education: [
      block(
        "synthetic-all-edu",
        "education-entry",
        {
          id: "synthetic-all-edu",
          institution: tv("Dalhousie University", "synthetic-all-edu"),
          credential: tv("Bachelor of Commerce", "synthetic-all-edu"),
          honors: [],
          details: [],
          rawHeaderText: "Bachelor of Commerce, Dalhousie University",
          source: trace("synthetic-all-edu"),
          isUncertain: false,
          reasonCodes: [],
        },
        {}
      ),
    ],
    certifications_licenses: [
      block(
        "synthetic-all-cred",
        "credential-entry",
        {
          id: "synthetic-all-cred",
          name: tv("Project Management Professional (PMP)", "synthetic-all-cred"),
          issuer: tv("PMI", "synthetic-all-cred"),
          details: [],
          kind: "certification",
          rawHeaderText: "PMP, PMI",
          source: trace("synthetic-all-cred"),
          isUncertain: false,
          reasonCodes: [],
        },
        {}
      ),
    ],
    projects: [
      block(
        "synthetic-all-proj",
        "project-entry",
        {
          id: "synthetic-all-proj",
          name: tv("Warehouse Automation Rollout", "synthetic-all-proj"),
          technologies: [],
          bullets: [bullet("Reduced fulfillment errors by 30%.", "synthetic-all-proj-b0")],
          descriptionParagraphs: [],
          rawHeaderText: "Warehouse Automation Rollout",
          source: trace("synthetic-all-proj"),
          isUncertain: false,
          reasonCodes: [],
        },
        { bulletCount: 1 }
      ),
    ],
    awards: [
      block(
        "synthetic-all-award",
        "award-entry",
        {
          id: "synthetic-all-award",
          name: tv("Operational Excellence Award", "synthetic-all-award"),
          issuer: tv("Maritime Holdings", "synthetic-all-award"),
          details: [],
          rawHeaderText: "Operational Excellence Award",
          source: trace("synthetic-all-award"),
          isUncertain: false,
          reasonCodes: [],
        },
        {}
      ),
    ],
    publications: [
      block(
        "synthetic-all-pub",
        "publication-entry",
        {
          id: "synthetic-all-pub",
          title: tv("Lean Practices in Regional Logistics", "synthetic-all-pub"),
          authors: [],
          details: [],
          rawHeaderText: "Lean Practices in Regional Logistics",
          source: trace("synthetic-all-pub"),
          isUncertain: false,
          reasonCodes: [],
        },
        {}
      ),
    ],
    additional_information: [
      block(
        "synthetic-all-custom",
        "custom-section",
        {
          id: "synthetic-all-custom",
          originalHeading: "Languages",
          displayHeading: "Languages",
          paragraphs: [tv("English (native), French (professional working proficiency).", "synthetic-all-custom")],
          bullets: [],
          sourceOrder: 0,
          source: trace("synthetic-all-custom"),
        } satisfies CustomResumeSection,
        { paragraphCount: 1 }
      ),
    ],
  });
}

/* Scenario 5: identity plus exactly one custom section, nothing else -
   the minimal non-empty document. */
export function customSectionOnly(): ProfessionalAtsAssemblyDocument {
  const custom: CustomResumeSection = {
    id: "synthetic-custom-only",
    originalHeading: "Interests",
    displayHeading: "Interests",
    paragraphs: [],
    bullets: [bullet("Long-distance cycling.", "synthetic-custom-only-b0"), bullet("Amateur astronomy.", "synthetic-custom-only-b1")],
    sourceOrder: 0,
    source: trace("synthetic-custom-only"),
  };
  return assembleDocument({
    identity: [makeIdentity()],
    additional_information: [block("synthetic-custom-only", "custom-section", custom, { bulletCount: 2 })],
  });
}

/* Scenario 6: many short experience entries - orphan-regression
   pressure. With enough entries, at least one section heading is
   likely to naturally land near a real page boundary; the validator's
   sectionHeadingOrphans / entryHeaderOrphans checks must stay empty
   regardless of exactly where that boundary falls. */
export function manyShortEntries(): ProfessionalAtsAssemblyDocument {
  // 30 entries (header + 1 bullet each, ~36px/entry at ultra-compact)
  // comfortably exceeds one page (~1008px usable) even at the most
  // compact density, forcing a real multi-page split.
  const blocks = Array.from({ length: 30 }, (_, i) =>
    block(`synthetic-short-${i}`, "experience-entry", experienceEntry(`synthetic-short-${i}`, `Role Title ${i + 1}`, `Company ${i + 1} Inc.`, [`Accomplished result ${i + 1}.`]), {
      bulletCount: 1,
    })
  );
  return assembleDocument({
    identity: [makeIdentity()],
    professional_experience: blocks,
  });
}

export const ALL_SYNTHETIC_SCENARIOS: { name: string; build: () => ProfessionalAtsAssemblyDocument }[] = [
  { name: "very-long-single-entry", build: veryLongSingleEntry },
  { name: "very-long-skill-group", build: veryLongSkillGroup },
  { name: "volunteer-only", build: volunteerOnly },
  { name: "all-eleven-sections", build: allElevenSections },
  { name: "custom-section-only", build: customSectionOnly },
  { name: "many-short-entries", build: manyShortEntries },
];
