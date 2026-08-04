/*
  Orchestrator tying every TASK 3-6 extractor together with Phase 1's
  LosslessResumeDocument to produce one ResumeStructuredModel. Mirrors
  Phase 1's own buildLosslessDocument.ts pattern: pure function, no
  side effects, no DB/network access, ends by running the validator.

  Section routing decision (spec section 2's "각 섹션 내부를 의미 있는
  entry와 field로 분해"): every Phase 1 section maps to exactly one
  Phase 2 destination - either a dedicated typed array/field, or (for
  types with no dedicated Phase 2 slot this round, e.g. training/
  professional_development/affiliations/languages/interests/references,
  and any genuinely "custom" section) customSections - never both,
  never neither. See identityExtractor.ts's own header comment for the
  one real exception: a Phase-1-mis-segmented "custom" section that is
  actually the person's name+contact block is routed to `identity`
  instead of customSections (a zero-loss reclassification, not a
  second copy).
*/
import type { LosslessResumeDocument, LosslessResumeSection, SemanticContentBlock } from "../losslessSemantic/types";
import { mergeTraces, traceFromBlock } from "./sourceTrace";
import { extractIdentity, hasIdentitySignal } from "./identityExtractor";
import { extractSummary } from "./summaryExtractor";
import { extractSkillGroups } from "./skillsExtractor";
import { extractExperienceEntries } from "./experienceExtractor";
import { extractEducationEntries } from "./educationExtractor";
import { extractCredentialEntries } from "./credentialExtractor";
import { extractProjectEntries } from "./projectExtractor";
import { extractAwardEntries } from "./awardExtractor";
import { extractPublicationEntries } from "./publicationExtractor";
import { adaptCustomSection } from "./customSectionAdapter";
import { validateStructuredResume } from "./structuredValidator";
import type { ResumeSlotKey, ResumeStructuredModel } from "./types";

function bodyBlocksOf(section: LosslessResumeSection): SemanticContentBlock[] {
  return section.blocks.filter((b) => b.blockType !== "heading");
}

/*
  Every extractor below is handed `body` (heading block excluded, so
  Phase 1's own heading text can never be mistaken for an entry-header
  line). That means the heading BLOCK's own coverage - required by
  structuredValidator.ts's block-coverage check, the same invariant
  Phase 1's own validator enforces one layer down - is never claimed by
  any extractor's own source trace. Merging it into the first produced
  item's trace (never inventing a value, only extending which block ids
  that one trace already covers) closes that gap without duplicating
  the heading's text anywhere.
*/
function mergeSectionHeadingIntoFirst<T extends { source: { sourceSectionId: string; sourceBlockIds: string[]; sourceElementIds: string[] } }>(
  section: LosslessResumeSection,
  items: T[]
): void {
  const heading = section.blocks[0];
  if (!heading || heading.blockType !== "heading" || items.length === 0) return;
  items[0].source = mergeTraces(items[0].source, traceFromBlock(section.id, heading));
}

/*
  A typed section can legitimately produce ZERO entries - real-fixture
  evidence: bench/resume-B-junior-canva.pdf's "Professional Experience"
  section has a heading and NO body blocks at all (Phase 1 gave it an
  empty body; not corrected this round per "Phase 1 결과를 입력 사실로
  사용한다"). When that happens, mergeSectionHeadingIntoFirst has no
  first item to attach the heading to, and the section would otherwise
  vanish from every coverage check with nothing representing it. Falling
  back to adaptCustomSection (same as any genuinely unclassifiable
  section) traces the whole section - including its lone heading block -
  without inventing a fake entry.
*/
function isEmpty(items: unknown[]): boolean {
  return items.length === 0;
}

export function buildStructuredResume(document: LosslessResumeDocument): ResumeStructuredModel {
  const model: ResumeStructuredModel = {
    schemaVersion: "1.0.0",
    source: document.source,
    identity: undefined,
    professionalSummary: undefined,
    skillGroups: [],
    professionalExperience: [],
    volunteerExperience: [],
    education: [],
    credentials: [],
    projects: [],
    awards: [],
    publications: [],
    customSections: [],
    slotAvailability: {
      identity: false,
      professional_summary: false,
      core_skills: false,
      professional_experience: false,
      volunteer_experience: false,
      education: false,
      certifications_licenses: false,
      projects: false,
      awards: false,
      publications: false,
      additional_information: false,
    },
    validation: {
      passed: false,
      sourceSectionCount: 0,
      representedSectionCount: 0,
      missingSectionIds: [],
      sourceBlockCount: 0,
      representedBlockCount: 0,
      missingBlockIds: [],
      duplicateBlockIds: [],
      inventedFactValues: [],
      volunteerMixedIntoProfessional: [],
      missingCustomSections: [],
      warnings: [],
    },
  };

  let identitySourceSectionId: string | null = null;
  if (document.identityBlocks.length > 0) {
    model.identity = extractIdentity("identity", document.identityBlocks);
  } else {
    const first = document.sections[0];
    if (first && first.normalizedType === "custom" && hasIdentitySignal(first.blocks)) {
      model.identity = extractIdentity(first.id, first.blocks);
      identitySourceSectionId = first.id;
    }
  }

  let summaryConsumed = false;

  for (const section of document.sections) {
    if (section.id === identitySourceSectionId) continue;
    const body = bodyBlocksOf(section);

    switch (section.normalizedType) {
      case "summary":
      case "objective":
        if (!summaryConsumed) {
          model.professionalSummary = extractSummary(section);
          summaryConsumed = true;
        } else {
          model.customSections.push(adaptCustomSection(section));
        }
        break;
      case "skills": {
        const groups = extractSkillGroups(section.id, body);
        if (isEmpty(groups)) { model.customSections.push(adaptCustomSection(section)); break; }
        mergeSectionHeadingIntoFirst(section, groups);
        model.skillGroups.push(...groups);
        break;
      }
      case "experience": {
        const entries = extractExperienceEntries(section.id, body, false);
        if (isEmpty(entries)) { model.customSections.push(adaptCustomSection(section)); break; }
        mergeSectionHeadingIntoFirst(section, entries);
        model.professionalExperience.push(...entries);
        break;
      }
      case "volunteering": {
        const entries = extractExperienceEntries(section.id, body, true);
        if (isEmpty(entries)) { model.customSections.push(adaptCustomSection(section)); break; }
        mergeSectionHeadingIntoFirst(section, entries);
        model.volunteerExperience.push(...entries);
        break;
      }
      case "education": {
        const entries = extractEducationEntries(section.id, body);
        if (isEmpty(entries)) { model.customSections.push(adaptCustomSection(section)); break; }
        mergeSectionHeadingIntoFirst(section, entries);
        model.education.push(...entries);
        break;
      }
      case "certifications":
      case "licenses": {
        const entries = extractCredentialEntries(section.id, body);
        if (isEmpty(entries)) { model.customSections.push(adaptCustomSection(section)); break; }
        mergeSectionHeadingIntoFirst(section, entries);
        model.credentials.push(...entries);
        break;
      }
      case "projects": {
        const entries = extractProjectEntries(section.id, body);
        if (isEmpty(entries)) { model.customSections.push(adaptCustomSection(section)); break; }
        mergeSectionHeadingIntoFirst(section, entries);
        model.projects.push(...entries);
        break;
      }
      case "awards": {
        const entries = extractAwardEntries(section.id, body);
        if (isEmpty(entries)) { model.customSections.push(adaptCustomSection(section)); break; }
        mergeSectionHeadingIntoFirst(section, entries);
        model.awards.push(...entries);
        break;
      }
      case "publications": {
        const entries = extractPublicationEntries(section.id, body);
        if (isEmpty(entries)) { model.customSections.push(adaptCustomSection(section)); break; }
        mergeSectionHeadingIntoFirst(section, entries);
        model.publications.push(...entries);
        break;
      }
      default:
        // training, professional_development, affiliations, languages,
        // interests, references, custom - no dedicated Phase 2 slot
        // this round (spec section 16/17); preserved whole, never
        // dropped, never force-classified into a wrong known slot.
        model.customSections.push(adaptCustomSection(section));
    }
  }

  if (document.unassignedBlocks.length > 0) {
    model.customSections.push({
      id: "unassigned-residual",
      originalHeading: null,
      displayHeading: null,
      paragraphs: document.unassignedBlocks
        .filter((b) => b.blockType !== "bullet")
        .map((b) => ({ value: b.rawText, confidence: 1, extractionMethod: "fallback" as const, source: { sourceSectionId: "unassigned", sourceBlockIds: [b.id], sourceElementIds: b.sourceElementIds } })),
      bullets: document.unassignedBlocks
        .filter((b) => b.blockType === "bullet")
        .map((b, i) => ({ id: `unassigned-residual-bullet-${i}`, text: b.rawText, source: { sourceSectionId: "unassigned", sourceBlockIds: [b.id], sourceElementIds: b.sourceElementIds } })),
      sourceOrder: document.sections.length,
      source: {
        sourceSectionId: "unassigned",
        sourceBlockIds: document.unassignedBlocks.map((b) => b.id),
        sourceElementIds: document.unassignedBlocks.flatMap((b) => b.sourceElementIds),
      },
    });
  }

  const slots: Record<ResumeSlotKey, boolean> = {
    identity: model.identity !== undefined,
    professional_summary: model.professionalSummary !== undefined,
    core_skills: model.skillGroups.length > 0,
    professional_experience: model.professionalExperience.length > 0,
    volunteer_experience: model.volunteerExperience.length > 0,
    education: model.education.length > 0,
    certifications_licenses: model.credentials.length > 0,
    projects: model.projects.length > 0,
    awards: model.awards.length > 0,
    publications: model.publications.length > 0,
    additional_information: model.customSections.length > 0,
  };
  model.slotAvailability = slots;

  model.validation = validateStructuredResume(model, document);
  return model;
}
