/*
  TASK 7 - Structured Model Validator. Section 18 of the spec.
  Implements checks A-F as report fields; G (determinism) and H
  (overlay safety) are test-level concerns (see buildStructuredResume.
  test.ts and tailoredOverlay.test.ts) for the same reason Phase 1's own
  validator.ts documents - a single model instance cannot prove
  determinism or overlay behavior on its own.

  Gate rule (unchanged from Phase 1's own policy): missing
  section/block coverage, invented facts, or professional/volunteer
  mixing are automatic FAIL. A field or entry landing on undefined/
  isUncertain=true is explicitly NOT a failure.
*/
import type { LosslessResumeDocument, SemanticContentBlock } from "../losslessSemantic/types";
import { mergeTraces } from "./sourceTrace";
import type { ResumeStructuredModel, SourceTrace, StructuredTextValue } from "./types";

function collectAllDocumentBlocks(document: LosslessResumeDocument): SemanticContentBlock[] {
  return [...document.identityBlocks, ...document.sections.flatMap((s) => s.blocks), ...document.unassignedBlocks];
}

function collectAllTraces(model: ResumeStructuredModel): SourceTrace[] {
  const traces: SourceTrace[] = [];
  if (model.identity) {
    // A single Phase 1 block (e.g. one pipe-delimited "email | phone |
    // linkedin" contact line) legitimately produces several identity
    // fields that each trace back to that same block - not a coverage
    // duplicate. Merge all of identity's field traces into one before
    // counting, same rationale as the bullets exclusion above.
    const identityFieldTraces: SourceTrace[] = [];
    for (const v of Object.values(model.identity)) {
      if (Array.isArray(v)) v.forEach((tv: StructuredTextValue) => identityFieldTraces.push(tv.source));
      else if (v && typeof v === "object" && "source" in v) identityFieldTraces.push((v as StructuredTextValue).source);
    }
    if (identityFieldTraces.length > 0) traces.push(mergeTraces(...identityFieldTraces));
  }
  if (model.professionalSummary) traces.push(model.professionalSummary.source);
  for (const g of model.skillGroups) traces.push(g.source);

  // Deliberately NOT also pushing e.bullets[].source /
  // c.bullets[].source etc. here - a bullet's own trace is a subset of
  // its parent entry/section's already-merged trace (see
  // experienceExtractor.ts's mergeTraces(traceFromBlocks(sectionId,
  // allEntryBlocks)), which folds in every bullet block). Counting both
  // the parent AND each child bullet as separate top-level coverage
  // claims would flag every entry with bullets as a false "duplicate
  // block" - a real bug found via testing every real fixture. Bullet-
  // level fact-checking still happens separately in
  // collectAllBulletTexts() below; only block-coverage counting is
  // deduplicated to the parent level here.
  const experienceLike = [...model.professionalExperience, ...model.volunteerExperience];
  for (const e of experienceLike) traces.push(e.source);
  for (const e of model.education) traces.push(e.source);
  for (const c of model.credentials) traces.push(c.source);
  for (const p of model.projects) traces.push(p.source);
  for (const a of model.awards) traces.push(a.source);
  for (const p of model.publications) traces.push(p.source);
  for (const c of model.customSections) traces.push(c.source);
  // Phase 5D.2B - each MetricEntry's value/label pushed independently
  // (not merged via the grid's own aggregate `.source`) because the two
  // sides can legitimately trace back to two different Phase 1 sections
  // (see metricGridExtractor.ts) - merging them into one trace would
  // under-report section coverage for whichever side's section came
  // second in mergeTraces' own first-wins sourceSectionId rule.
  for (const g of model.metricGrids) {
    for (const e of g.entries) {
      traces.push(e.value.source);
      traces.push(e.label.source);
    }
  }
  return traces;
}

function collectAllBulletTexts(model: ResumeStructuredModel): { text: string; source: SourceTrace }[] {
  const bullets: { text: string; source: SourceTrace }[] = [];
  const experienceLike = [...model.professionalExperience, ...model.volunteerExperience];
  for (const e of experienceLike) e.bullets.forEach((b) => bullets.push(b));
  for (const p of model.projects) p.bullets.forEach((b) => bullets.push(b));
  for (const c of model.customSections) c.bullets.forEach((b) => bullets.push(b));
  return bullets;
}

function collectAllStructuredTextValues(model: ResumeStructuredModel): StructuredTextValue[] {
  const values: StructuredTextValue[] = [];
  const pushIfValue = (v: unknown) => {
    if (v && typeof v === "object" && "value" in v && "source" in v) values.push(v as StructuredTextValue);
  };

  if (model.identity) {
    for (const v of Object.values(model.identity)) {
      if (Array.isArray(v)) v.forEach(pushIfValue);
      else pushIfValue(v);
    }
  }
  for (const g of model.skillGroups) {
    // skills[] are plain strings, not StructuredTextValue - group-level
    // source trace already covers them structurally.
    void g;
  }
  const experienceLike = [...model.professionalExperience, ...model.volunteerExperience];
  for (const e of experienceLike) {
    [e.organization, e.role, e.location, e.startDateText, e.endDateText, e.dateRangeText].forEach(pushIfValue);
    e.descriptionParagraphs.forEach(pushIfValue);
  }
  for (const e of model.education) {
    [e.institution, e.credential, e.fieldOfStudy, e.location, e.startDateText, e.endDateText, e.dateRangeText, e.gpa].forEach(pushIfValue);
    e.honors.forEach(pushIfValue);
    e.details.forEach(pushIfValue);
  }
  for (const c of model.credentials) {
    [c.name, c.issuer, c.credentialId, c.issueDateText, c.expiryDateText, c.location].forEach(pushIfValue);
    c.details.forEach(pushIfValue);
  }
  for (const p of model.projects) {
    [p.name, p.role, p.dateRangeText].forEach(pushIfValue);
    p.technologies.forEach(pushIfValue);
    p.descriptionParagraphs.forEach(pushIfValue);
  }
  for (const a of model.awards) {
    [a.name, a.issuer, a.dateText].forEach(pushIfValue);
    a.details.forEach(pushIfValue);
  }
  for (const p of model.publications) {
    [p.title, p.publisherOrVenue, p.dateText, p.urlOrDoi].forEach(pushIfValue);
    p.authors.forEach(pushIfValue);
    p.details.forEach(pushIfValue);
  }
  for (const c of model.customSections) {
    c.paragraphs.forEach(pushIfValue);
  }
  for (const g of model.metricGrids) {
    for (const e of g.entries) {
      pushIfValue(e.value);
      pushIfValue(e.label);
    }
  }
  return values;
}

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function validateStructuredResume(model: ResumeStructuredModel, document: LosslessResumeDocument): ResumeStructuredModel["validation"] {
  const warnings: string[] = [];

  // --- A. Section coverage ---
  const sourceSectionIds = new Set(document.sections.map((s) => s.id));
  const allTraces = collectAllTraces(model);
  const representedSectionIds = new Set(allTraces.map((t) => t.sourceSectionId).filter((id) => sourceSectionIds.has(id)));
  const missingSectionIds = [...sourceSectionIds].filter((id) => !representedSectionIds.has(id));

  // --- B. Block coverage ---
  const allDocBlocks = collectAllDocumentBlocks(document);
  // A block with zero text content (Phase 1 still mints an id/placeholder
  // for it - see blockAdapter.ts's "rawText.length === 0 -> unknown"
  // fallback, e.g. a blank DOCX paragraph) carries nothing that could be
  // lost, so no structured field can meaningfully "represent" it. Real
  // fixture evidence: word-docx-resume.docx has exactly such a stray
  // empty block inside its Skills section. Requiring it to be referenced
  // anyway would force an extractor to either invent a placeholder value
  // or silently claim an unrelated block - both worse than simply not
  // counting it as required coverage. `allBlockIds` (all ids, including
  // empty ones) is kept separately so a genuine reference TO an empty
  // block is still recognized as known, not flagged as "unknown".
  const allBlockIds = new Set(allDocBlocks.map((b) => b.id));
  const sourceBlockIds = new Set(allDocBlocks.filter((b) => b.rawText.length > 0).map((b) => b.id));
  const blockReferenceCounts = new Map<string, number>();
  for (const trace of allTraces) {
    for (const id of trace.sourceBlockIds) {
      blockReferenceCounts.set(id, (blockReferenceCounts.get(id) ?? 0) + 1);
    }
  }
  const missingBlockIds = [...sourceBlockIds].filter((id) => !blockReferenceCounts.has(id));
  const duplicateBlockIds = [...blockReferenceCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  const unknownReferencedBlockIds = [...blockReferenceCounts.keys()].filter((id) => !allBlockIds.has(id));
  if (unknownReferencedBlockIds.length > 0) {
    warnings.push(`structured field references block id(s) not present in the Phase 1 document: ${unknownReferencedBlockIds.join(", ")}`);
  }
  const representedBlockCount = [...blockReferenceCounts.keys()].filter((id) => sourceBlockIds.has(id)).length;

  // --- C. Fact preservation - no invented text ---
  const blockById = new Map<string, SemanticContentBlock>();
  for (const b of allDocBlocks) blockById.set(b.id, b);
  const inventedFactValues: string[] = [];
  for (const tv of collectAllStructuredTextValues(model)) {
    const sourceText = tv.source.sourceBlockIds
      .map((id) => blockById.get(id)?.rawText ?? "")
      .join(" ");
    if (!normalizeForCompare(sourceText).includes(normalizeForCompare(tv.value))) {
      inventedFactValues.push(`"${tv.value}" (method=${tv.extractionMethod}) not found in its own source block text`);
    }
  }

  // --- E. Volunteer separation ---
  const professionalBlockIds = new Set(model.professionalExperience.flatMap((e) => e.source.sourceBlockIds));
  const volunteerBlockIds = model.volunteerExperience.flatMap((e) => e.source.sourceBlockIds);
  const volunteerMixedIntoProfessional = volunteerBlockIds.filter((id) => professionalBlockIds.has(id));
  const wrongFlagEntries = [...model.professionalExperience, ...model.volunteerExperience].filter(
    (e) => (e.isVolunteer && model.professionalExperience.includes(e)) || (!e.isVolunteer && model.volunteerExperience.includes(e))
  );
  if (wrongFlagEntries.length > 0) {
    warnings.push(`${wrongFlagEntries.length} experience entr(ies) have isVolunteer inconsistent with the array they were placed in`);
  }

  // --- F. Custom preservation ---
  const customSourceSectionIds = new Set(model.customSections.map((c) => c.source.sourceSectionId));
  const knownTypedSectionIds = new Set(
    [
      ...model.professionalExperience,
      ...model.volunteerExperience,
      ...model.education,
      ...model.credentials,
      ...model.projects,
      ...model.awards,
      ...model.publications,
    ].map((e) => e.source.sourceSectionId)
  );
  if (model.professionalSummary) knownTypedSectionIds.add(model.professionalSummary.source.sourceSectionId);
  for (const g of model.skillGroups) knownTypedSectionIds.add(g.source.sourceSectionId);

  const identityConsumedSectionIds = new Set<string>();
  if (model.identity) {
    for (const v of Object.values(model.identity)) {
      const values = Array.isArray(v) ? v : v ? [v] : [];
      for (const tv of values) if (tv && typeof tv === "object" && "source" in tv) identityConsumedSectionIds.add((tv as StructuredTextValue).source.sourceSectionId);
    }
  }

  // A section needing the customSections fallback (not routed to any
  // dedicated typed array, and not the one section identity legitimately
  // consumed) must have a real CustomResumeSection entry for it - not
  // just "represented somewhere," which check A/B already cover more
  // generally.
  const missingCustomSections = document.sections
    .filter((s) => !knownTypedSectionIds.has(s.id) && !identityConsumedSectionIds.has(s.id))
    .filter((s) => !customSourceSectionIds.has(s.id))
    .map((s) => s.id);

  const passed =
    missingSectionIds.length === 0 &&
    missingBlockIds.length === 0 &&
    duplicateBlockIds.length === 0 &&
    inventedFactValues.length === 0 &&
    volunteerMixedIntoProfessional.length === 0 &&
    missingCustomSections.length === 0;

  return {
    passed,
    sourceSectionCount: sourceSectionIds.size,
    representedSectionCount: representedSectionIds.size,
    missingSectionIds,
    sourceBlockCount: sourceBlockIds.size,
    representedBlockCount,
    missingBlockIds,
    duplicateBlockIds,
    inventedFactValues,
    volunteerMixedIntoProfessional,
    missingCustomSections,
    warnings,
  };
}
