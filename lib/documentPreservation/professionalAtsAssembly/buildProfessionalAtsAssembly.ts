/*
  Orchestrator tying visibilityPolicy + orderingPolicy + blockBuilders +
  densityPolicy together to produce one ProfessionalAtsAssemblyDocument
  from a Phase 2 ResumeStructuredModel. Mirrors Phase 1/2's own
  buildLosslessDocument.ts / buildStructuredResume.ts pattern: pure
  function, no side effects, no DB/network access, ends by running the
  validator.

  This function does NOT render HTML/CSS, does NOT compute real pixel
  heights or page counts, is not wired into Career Memory or Generate
  Package. See AGENTS.md / this phase's own spec section 1 for the full
  prohibited list - none of it appears anywhere in this module.
*/
import type { ResumeStructuredModel, StructuredTextValue } from "../resumeStructured/types";
import { mergeTraces } from "../resumeStructured/sourceTrace";
import type { ProfessionalAtsAssemblyDocument, ProfessionalAtsAssemblySection, ProfessionalAtsSectionKey, AssemblyVisibilityReason } from "./types";
import { PROFESSIONAL_ATS_SECTION_ORDER, PROFESSIONAL_ATS_SECTION_LABELS } from "./sectionLabels";
import { computeVisibleSectionOrder, computeHiddenSectionOrder, orderCustomSectionsBySourceOrder } from "./orderingPolicy";
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
} from "./visibilityPolicy";
import {
  buildIdentityBlock,
  buildSummaryBlock,
  buildSkillGroupBlock,
  buildExperienceEntryBlock,
  buildEducationEntryBlock,
  buildCredentialEntryBlock,
  buildProjectEntryBlock,
  buildAwardEntryBlock,
  buildPublicationEntryBlock,
  buildCustomSectionBlock,
} from "./blockBuilders";
import { PROFESSIONAL_ATS_COMPACTION_POLICY, getDefaultDensity } from "./densityPolicy";
import { validateAssembly } from "./assemblyValidator";

function isWhitespaceOnly(text: string): boolean {
  return text.length > 0 && text.trim().length === 0;
}

function isTextValueWhitespaceOnly(v: StructuredTextValue | undefined): boolean {
  return v !== undefined && isWhitespaceOnly(v.value);
}

function emptySection(key: ProfessionalAtsSectionKey, order: number, reason: AssemblyVisibilityReason): ProfessionalAtsAssemblySection {
  return {
    key,
    label: PROFESSIONAL_ATS_SECTION_LABELS[key],
    order,
    visible: false,
    visibilityReason: reason,
    blocks: [],
    keepHeadingWithFirstBlock: false,
    breakBefore: "allow",
    breakAfter: "allow",
    minBlocksToShow: 0,
    sourceSectionIds: [],
  };
}

export function buildProfessionalAtsAssembly(model: ResumeStructuredModel): ProfessionalAtsAssemblyDocument {
  const visibility: Partial<Record<ProfessionalAtsSectionKey, boolean>> = {};
  const sections: Partial<Record<ProfessionalAtsSectionKey, ProfessionalAtsAssemblySection>> = {};

  const order = (key: ProfessionalAtsSectionKey) => PROFESSIONAL_ATS_SECTION_ORDER.indexOf(key);

  // --- identity ---
  {
    const key: ProfessionalAtsSectionKey = "identity";
    const visible = hasIdentityContent(model.identity);
    visibility[key] = visible;
    if (!visible) {
      sections[key] = emptySection(key, order(key), model.identity ? "whitespace-only" : "empty");
    } else {
      const fields: (StructuredTextValue | undefined)[] = [
        model.identity!.fullName, model.identity!.headline, model.identity!.email, model.identity!.phone,
        model.identity!.location, model.identity!.linkedin, model.identity!.portfolio, ...model.identity!.otherContactLines,
      ];
      const traces = fields.filter((f): f is StructuredTextValue => f !== undefined).map((f) => f.source);
      const merged = traces.length > 0 ? mergeTraces(...traces) : { sourceSectionId: "identity", sourceBlockIds: [], sourceElementIds: [] };
      const block = buildIdentityBlock(merged.sourceSectionId, merged.sourceBlockIds, model.identity);
      sections[key] = {
        key, label: PROFESSIONAL_ATS_SECTION_LABELS[key], order: order(key), visible: true, visibilityReason: "has-content",
        blocks: [block], keepHeadingWithFirstBlock: false, breakBefore: "allow", breakAfter: "allow", minBlocksToShow: 1,
        sourceSectionIds: [merged.sourceSectionId],
      };
    }
  }

  // --- professional_summary ---
  {
    const key: ProfessionalAtsSectionKey = "professional_summary";
    const visible = hasSummaryContent(model.professionalSummary);
    visibility[key] = visible;
    if (!visible) {
      const reason: AssemblyVisibilityReason = model.professionalSummary === undefined ? "empty" : isWhitespaceOnly(model.professionalSummary.text) ? "whitespace-only" : "empty";
      sections[key] = emptySection(key, order(key), reason);
    } else {
      const block = buildSummaryBlock(model.professionalSummary!);
      sections[key] = {
        key, label: PROFESSIONAL_ATS_SECTION_LABELS[key], order: order(key), visible: true, visibilityReason: "has-content",
        blocks: [block], keepHeadingWithFirstBlock: true, breakBefore: "allow", breakAfter: "allow", minBlocksToShow: 1,
        sourceSectionIds: [model.professionalSummary!.source.sourceSectionId],
      };
    }
  }

  // --- core_skills ---
  {
    const key: ProfessionalAtsSectionKey = "core_skills";
    const visible = hasSkillsContent(model.skillGroups);
    visibility[key] = visible;
    if (!visible) {
      sections[key] = emptySection(key, order(key), model.skillGroups.length === 0 ? "empty" : "no-valid-entries");
    } else {
      const blocks = model.skillGroups.filter((g) => g.skills.some((s) => s.trim().length > 0)).map((g, i) => buildSkillGroupBlock(g, i));
      sections[key] = {
        key, label: PROFESSIONAL_ATS_SECTION_LABELS[key], order: order(key), visible: true, visibilityReason: "has-content",
        blocks, keepHeadingWithFirstBlock: true, breakBefore: "allow", breakAfter: "allow", minBlocksToShow: 1,
        sourceSectionIds: [...new Set(blocks.flatMap((b) => b.sourceSectionIds))],
      };
    }
  }

  // --- professional_experience / volunteer_experience ---
  for (const [key, entries, isVolunteer] of [
    ["professional_experience", model.professionalExperience, false],
    ["volunteer_experience", model.volunteerExperience, true],
  ] as const) {
    const visible = hasExperienceContent(entries);
    visibility[key] = visible;
    if (!visible) {
      sections[key] = emptySection(key, order(key), entries.length === 0 ? "empty" : "no-valid-entries");
    } else {
      const validEntries = entries.filter((e) => hasExperienceContent([e]));
      const blocks = validEntries.map((e, i) => buildExperienceEntryBlock(e, i));
      sections[key] = {
        key, label: PROFESSIONAL_ATS_SECTION_LABELS[key], order: order(key), visible: true, visibilityReason: "has-content",
        blocks, keepHeadingWithFirstBlock: true, breakBefore: "allow", breakAfter: "allow", minBlocksToShow: 1,
        sourceSectionIds: [...new Set(blocks.flatMap((b) => b.sourceSectionIds))],
      };
    }
    void isVolunteer;
  }

  // --- education ---
  {
    const key: ProfessionalAtsSectionKey = "education";
    const visible = hasEducationContent(model.education);
    visibility[key] = visible;
    if (!visible) {
      sections[key] = emptySection(key, order(key), model.education.length === 0 ? "empty" : "no-valid-entries");
    } else {
      const validEntries = model.education.filter((e) => hasEducationContent([e]));
      const blocks = validEntries.map((e, i) => buildEducationEntryBlock(e, i));
      sections[key] = {
        key, label: PROFESSIONAL_ATS_SECTION_LABELS[key], order: order(key), visible: true, visibilityReason: "has-content",
        blocks, keepHeadingWithFirstBlock: true, breakBefore: "allow", breakAfter: "allow", minBlocksToShow: 1,
        sourceSectionIds: [...new Set(blocks.flatMap((b) => b.sourceSectionIds))],
      };
    }
  }

  // --- certifications_licenses (Phase 2 already merged certifications+licenses into `credentials`) ---
  {
    const key: ProfessionalAtsSectionKey = "certifications_licenses";
    const visible = hasCredentialsContent(model.credentials);
    visibility[key] = visible;
    if (!visible) {
      sections[key] = emptySection(key, order(key), model.credentials.length === 0 ? "empty" : "no-valid-entries");
    } else {
      const validEntries = model.credentials.filter((e) => hasCredentialsContent([e]));
      const blocks = validEntries.map((e, i) => buildCredentialEntryBlock(e, i));
      sections[key] = {
        key, label: PROFESSIONAL_ATS_SECTION_LABELS[key], order: order(key), visible: true, visibilityReason: "has-content",
        blocks, keepHeadingWithFirstBlock: true, breakBefore: "allow", breakAfter: "allow", minBlocksToShow: 1,
        sourceSectionIds: [...new Set(blocks.flatMap((b) => b.sourceSectionIds))],
      };
    }
  }

  // --- projects ---
  {
    const key: ProfessionalAtsSectionKey = "projects";
    const visible = hasProjectsContent(model.projects);
    visibility[key] = visible;
    if (!visible) {
      sections[key] = emptySection(key, order(key), model.projects.length === 0 ? "empty" : "no-valid-entries");
    } else {
      const validEntries = model.projects.filter((e) => hasProjectsContent([e]));
      const blocks = validEntries.map((e, i) => buildProjectEntryBlock(e, i));
      sections[key] = {
        key, label: PROFESSIONAL_ATS_SECTION_LABELS[key], order: order(key), visible: true, visibilityReason: "has-content",
        blocks, keepHeadingWithFirstBlock: true, breakBefore: "allow", breakAfter: "allow", minBlocksToShow: 1,
        sourceSectionIds: [...new Set(blocks.flatMap((b) => b.sourceSectionIds))],
      };
    }
  }

  // --- awards ---
  {
    const key: ProfessionalAtsSectionKey = "awards";
    const visible = hasAwardsContent(model.awards);
    visibility[key] = visible;
    if (!visible) {
      sections[key] = emptySection(key, order(key), model.awards.length === 0 ? "empty" : "no-valid-entries");
    } else {
      const validEntries = model.awards.filter((e) => hasAwardsContent([e]));
      const blocks = validEntries.map((e, i) => buildAwardEntryBlock(e, i));
      sections[key] = {
        key, label: PROFESSIONAL_ATS_SECTION_LABELS[key], order: order(key), visible: true, visibilityReason: "has-content",
        blocks, keepHeadingWithFirstBlock: true, breakBefore: "allow", breakAfter: "allow", minBlocksToShow: 1,
        sourceSectionIds: [...new Set(blocks.flatMap((b) => b.sourceSectionIds))],
      };
    }
  }

  // --- publications ---
  {
    const key: ProfessionalAtsSectionKey = "publications";
    const visible = hasPublicationsContent(model.publications);
    visibility[key] = visible;
    if (!visible) {
      sections[key] = emptySection(key, order(key), model.publications.length === 0 ? "empty" : "no-valid-entries");
    } else {
      const validEntries = model.publications.filter((e) => hasPublicationsContent([e]));
      const blocks = validEntries.map((e, i) => buildPublicationEntryBlock(e, i));
      sections[key] = {
        key, label: PROFESSIONAL_ATS_SECTION_LABELS[key], order: order(key), visible: true, visibilityReason: "has-content",
        blocks, keepHeadingWithFirstBlock: true, breakBefore: "allow", breakAfter: "allow", minBlocksToShow: 1,
        sourceSectionIds: [...new Set(blocks.flatMap((b) => b.sourceSectionIds))],
      };
    }
  }

  // --- additional_information (custom sections, sorted by sourceOrder) ---
  {
    const key: ProfessionalAtsSectionKey = "additional_information";
    const visible = hasCustomContent(model.customSections);
    visibility[key] = visible;
    if (!visible) {
      sections[key] = emptySection(key, order(key), model.customSections.length === 0 ? "empty" : "no-valid-entries");
    } else {
      const validSections = model.customSections.filter((s) => hasCustomContent([s]));
      const ordered = orderCustomSectionsBySourceOrder(validSections);
      const blocks = ordered.map((s, i) => buildCustomSectionBlock(s, i));
      sections[key] = {
        key, label: PROFESSIONAL_ATS_SECTION_LABELS[key], order: order(key), visible: true, visibilityReason: "has-content",
        blocks, keepHeadingWithFirstBlock: true, breakBefore: "allow", breakAfter: "allow", minBlocksToShow: 1,
        sourceSectionIds: [...new Set(blocks.flatMap((b) => b.sourceSectionIds))],
      };
    }
  }

  const visibleSectionKeys = computeVisibleSectionOrder(visibility);
  const hiddenSectionKeys = computeHiddenSectionOrder(visibility);

  const document: ProfessionalAtsAssemblyDocument = {
    schemaVersion: "1.0.0",
    templateId: "professional-ats-v1",
    sourceModelVersion: model.schemaVersion,
    sections: PROFESSIONAL_ATS_SECTION_ORDER.map((key) => sections[key]!),
    visibleSectionKeys,
    hiddenSectionKeys,
    defaultDensity: getDefaultDensity(),
    compactionPolicy: PROFESSIONAL_ATS_COMPACTION_POLICY,
    validation: {
      passed: false,
      visibleSectionKeys: [],
      hiddenSectionKeys: [],
      orderViolations: [],
      volunteerPlacementViolations: [],
      missingEntryIds: [],
      duplicateEntryIds: [],
      invalidHiddenSectionsWithBlocks: [],
      destructiveCompactionFlags: [],
      warnings: [],
    },
  };

  document.validation = validateAssembly(document, model);
  return document;
}
