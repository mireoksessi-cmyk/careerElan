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
import { normalizeBulletPresentation } from "./bulletPresentation";
import { splitEmbeddedCanonicalSubsections } from "./embeddedSubsectionSplitter";
import { detectMetricGrids } from "./metricGridExtractor";
import { validateStructuredResume } from "./structuredValidator";
import { RESUME_STRUCTURED_SCHEMA_VERSION, type CustomResumeSection, type ResumeSlotKey, type ResumeStructuredModel, type SourceTrace } from "./types";

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

/*
  Phase 5D.1 - variant of mergeSectionHeadingIntoFirst for an EMBEDDED
  heading (e.g. "Education and Training" found partway through a
  Volunteer Experience section's body), which is never section.blocks[0]
  and so cannot use that function's own lookup. Same rule: only ever
  extends which block ids an already-produced item's trace covers,
  never invents a value.
*/
function mergeHeadingBlockIntoFirst<T extends { source: SourceTrace }>(
  sectionId: string,
  headingBlock: SemanticContentBlock | null,
  items: T[]
): void {
  if (!headingBlock || items.length === 0) return;
  items[0].source = mergeTraces(items[0].source, traceFromBlock(sectionId, headingBlock));
}

/*
  Phase 5D.1 - an embedded Education/Credentials subsection whose own
  extractor produced zero entries (heading found, but nothing after it
  the extractor could turn into an entry) must not silently vanish -
  same "structuring failed, preserve don't delete" rule
  adaptCustomSection already implements for a whole top-level section.
  Reused here via a minimal synthetic LosslessResumeSection so the
  paragraph/bullet split and source trace stay identical to every other
  residual-preservation path, instead of re-implementing that logic.
  headingBlock's blockType is overridden to "heading" ONLY within this
  synthetic object (never mutates the real block) so adaptCustomSection
  correctly excludes it from paragraphs/bullets while still tracing it -
  the embedded heading's own blockType in the real document is
  "paragraph" (Phase 1 never marks it "heading"), which is accurate for
  Phase 1's own purposes but would otherwise print the heading text a
  second time as a body paragraph here.
*/
function buildEmbeddedResidualSubsection(
  sectionId: string,
  virtualId: string,
  sourceOrder: number,
  headingBlock: SemanticContentBlock | null,
  blocks: SemanticContentBlock[]
): CustomResumeSection {
  const allBlocks = headingBlock ? [{ ...headingBlock, blockType: "heading" as const }, ...blocks] : blocks;
  const pageIndices = allBlocks.map((b) => b.pageIndex);
  // `id: sectionId` (the REAL parent section, never the virtual
  // subsection id) is what makes adaptCustomSection's own internal
  // traceFromBlock(s)/traceFromBlocks calls stamp every trace with the
  // correct sourceSectionId - required for structuredValidator.ts's
  // section-coverage (check A) and missing-custom-section (check F)
  // checks, both keyed on real Phase 1 section ids. The synthetic
  // CustomResumeSection this produces would otherwise get the SAME
  // `${sectionId}-custom` id as any other embedded residual for this
  // same section (or a whole-section fallback) - overridden to the
  // caller's own deterministic, unique virtualId below instead.
  const synthetic: LosslessResumeSection = {
    id: sectionId,
    originalHeading: headingBlock?.rawText ?? null,
    normalizedHeading: null,
    normalizedType: "custom",
    displayHeading: headingBlock?.rawText ?? null,
    sourceOrder,
    startPageIndex: pageIndices.length > 0 ? Math.min(...pageIndices) : 0,
    endPageIndex: pageIndices.length > 0 ? Math.max(...pageIndices) : 0,
    confidence: 0,
    classificationMethod: "fallback",
    reasonCodes: ["embedded-subsection-extraction-empty-residual-fallback"],
    blocks: allBlocks,
    rawText: allBlocks.map((b) => b.rawText).join("\n"),
    isUncertain: true,
  };
  const result = adaptCustomSection(synthetic);
  return { ...result, id: virtualId };
}

export function buildStructuredResume(document: LosslessResumeDocument): ResumeStructuredModel {
  const model: ResumeStructuredModel = {
    schemaVersion: RESUME_STRUCTURED_SCHEMA_VERSION,
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
    metricGrids: [],
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

  const identitySourceSectionIds = new Set<string>();
  if (document.identityBlocks.length > 0) {
    model.identity = extractIdentity("identity", document.identityBlocks);
  } else {
    /*
      Phase 1 hands over identityBlocks only when something precedes the
      first heading it detected - and a resume's name is built to be the
      most prominent line on the page, so it very often scores as that
      first heading itself and leaves the list empty. The fallback below
      is what recovers identity in that case.

      It used to read section[0] alone, which works while the name and
      the contact line stay together in one leading section. It breaks
      on the equally ordinary header that stacks a professional title
      between them: name, title and contact then land in TWO leading
      sections, and the contact - the only thing hasIdentitySignal can
      key on - sits in the second one, unreachable. Identity came back
      undefined and the whole resume was refused as unrenderable.

      So the window is the leading run of sections Phase 1 could not
      name - it ends at the first section that carries a real canonical
      type, which is the document's own first true section boundary. No
      new evidence is introduced: the boundary is Phase 1's existing
      classification, and hasIdentitySignal still has to find an actual
      contact channel in the collected blocks, so a leading run of plain
      prose cannot promote itself into an identity. Every collected
      section is recorded, because each one must be skipped below or its
      text would render twice - once as identity, once as its own custom
      section.
    */
    const leadingUnnamedSections = [];
    for (const section of document.sections) {
      if (section.normalizedType !== "custom") break;
      leadingUnnamedSections.push(section);
    }
    const identityCandidateBlocks = leadingUnnamedSections.flatMap((section) => section.blocks);
    if (leadingUnnamedSections.length > 0 && hasIdentitySignal(identityCandidateBlocks)) {
      model.identity = extractIdentity(leadingUnnamedSections[0].id, identityCandidateBlocks);
      for (const section of leadingUnnamedSections) identitySourceSectionIds.add(section.id);
    }
  }

  let summaryConsumed = false;

  /*
    Phase 5D.2B - detected once, over EVERY section's blocks in their
    original Phase 1 form (never re-sorted, sourceOrder untouched), so a
    KPI/metric grid can be recovered even when Phase 1's own
    section-boundary logic (unchanged, out of scope this round) split
    the grid's value row and label row into two different sections - see
    metricGridExtractor.ts's own header comment for the real-fixture
    evidence this handles. Each consumed block is then filtered OUT of
    its own section's `blocks` before that section reaches any other
    extractor below, so nothing is ever represented twice (once as a
    MetricEntry, again as ordinary custom-section text). A section left
    with zero blocks after filtering still flows through its normal
    switch branch below - typically `adaptCustomSection` on an
    empty-blocks section - which is what keeps section-level coverage
    (structuredValidator.ts checks A/F) satisfied without inventing or
    duplicating anything.
  */
  const { grids: metricGrids, consumedBlockIds } = detectMetricGrids(document.sections);
  model.metricGrids = metricGrids;
  const sections = consumedBlockIds.size > 0 ? document.sections.map((s) => ({ ...s, blocks: s.blocks.filter((b) => !consumedBlockIds.has(b.id)) })) : document.sections;

  for (const section of sections) {
    if (identitySourceSectionIds.has(section.id)) continue;
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
      case "experience":
      case "volunteering": {
        const isVolunteer = section.normalizedType === "volunteering";
        /*
          Phase 5D.1 - a real private entry-level resume put
          "Education and Training" and "Certifications & Licenses" as
          plain paragraph lines INSIDE its Volunteer Experience
          section's body (Phase 1 correctly kept the section boundary
          at "Volunteer Experience" - see Phase 5D.0's audit). Splitting
          `body` into runs BEFORE handing anything to
          extractExperienceEntries is what keeps that embedded content
          out of the primary experience/volunteer entries' bullets in
          the first place - routing it to educationExtractor/
          credentialExtractor after the fact would be too late, since
          extractExperienceEntries would already have folded it into
          whichever entry was still "open". When no embedded heading
          exists anywhere in `body` (the overwhelmingly common case),
          this produces exactly one "primary" subsection covering the
          whole body, so behavior for every existing fixture is
          unchanged.
        */
        const subsections = splitEmbeddedCanonicalSubsections(body);
        if (isEmpty(subsections)) {
          // Real-fixture evidence, unchanged from before this round:
          // bench/resume-B-junior-canva.pdf's "Professional Experience"
          // section has a heading and NO body blocks at all. An empty
          // `body` produces zero subsections (splitEmbeddedCanonical
          // Subsections' own filter drops the empty leading-primary
          // placeholder), so this section-level fallback - identical to
          // every other typed-section case below - is still required to
          // keep the heading block itself covered.
          model.customSections.push(adaptCustomSection(section));
          break;
        }
        let firstProducedHost: { source: SourceTrace }[] | null = null;

        subsections.forEach((sub, index) => {
          if (sub.type === "primary") {
            const entries = extractExperienceEntries(section.id, sub.blocks, isVolunteer);
            if (isEmpty(entries)) {
              // Unreachable in practice (segmentEntryRanges always
              // returns >=1 range for a non-empty block list, and a
              // "primary" run's headingBlock is always null, which per
              // the splitter's own filter means its blocks are never
              // empty) - kept as a fail-safe residual path rather than
              // silently dropping coverage if that invariant ever
              // changes.
              if (sub.blocks.length > 0 || sub.headingBlock) {
                model.customSections.push(buildEmbeddedResidualSubsection(section.id, `${section.id}-embedded-${index}`, section.sourceOrder, sub.headingBlock, sub.blocks));
              }
              return;
            }
            mergeHeadingBlockIntoFirst(section.id, sub.headingBlock, entries);
            if (!firstProducedHost) firstProducedHost = entries;
            (isVolunteer ? model.volunteerExperience : model.professionalExperience).push(...entries);
          } else if (sub.type === "education") {
            const entries = extractEducationEntries(section.id, sub.blocks);
            if (isEmpty(entries)) {
              model.customSections.push(buildEmbeddedResidualSubsection(section.id, `${section.id}-embedded-${index}`, section.sourceOrder, sub.headingBlock, sub.blocks));
              return;
            }
            mergeHeadingBlockIntoFirst(section.id, sub.headingBlock, entries);
            if (!firstProducedHost) firstProducedHost = entries;
            model.education.push(...entries);
          } else {
            const entries = extractCredentialEntries(section.id, sub.blocks);
            if (isEmpty(entries)) {
              model.customSections.push(buildEmbeddedResidualSubsection(section.id, `${section.id}-embedded-${index}`, section.sourceOrder, sub.headingBlock, sub.blocks));
              return;
            }
            mergeHeadingBlockIntoFirst(section.id, sub.headingBlock, entries);
            if (!firstProducedHost) firstProducedHost = entries;
            model.credentials.push(...entries);
          }
        });

        if (firstProducedHost) mergeSectionHeadingIntoFirst(section, firstProducedHost);
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
        .map((b) => ({
          value: normalizeBulletPresentation(b.rawText, { blockType: b.blockType }).displayText,
          confidence: 1,
          extractionMethod: "fallback" as const,
          source: { sourceSectionId: "unassigned", sourceBlockIds: [b.id], sourceElementIds: b.sourceElementIds },
        })),
      bullets: document.unassignedBlocks
        .filter((b) => b.blockType === "bullet")
        .map((b, i) => ({
          id: `unassigned-residual-bullet-${i}`,
          text: normalizeBulletPresentation(b.rawText, { blockType: b.blockType }).displayText,
          source: { sourceSectionId: "unassigned", sourceBlockIds: [b.id], sourceElementIds: b.sourceElementIds },
        })),
      content: document.unassignedBlocks.map((b, i) => ({
        id: `unassigned-residual-content-${i}`,
        kind: b.blockType === "bullet" ? ("bullet" as const) : ("paragraph" as const),
        text: normalizeBulletPresentation(b.rawText, { blockType: b.blockType }).displayText,
        source: { sourceSectionId: "unassigned", sourceBlockIds: [b.id], sourceElementIds: b.sourceElementIds },
      })),
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
