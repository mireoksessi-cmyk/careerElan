/*
  Metric-grid / identity source-block ownership gate.

  WHY THIS FILE EXISTS
    Two owners inside buildStructuredResume can reach for the same Phase 1
    block. detectMetricGrids claims a KPI band's cells and filters them out
    of their sections so nothing downstream sees them twice; the identity
    fallback claims the leading run of sections Phase 1 could not name. On
    a resume whose header run contains a KPI band those two sets overlap,
    and the block is then referenced by both identity and a MetricEntry -
    which structuredValidator counts as a duplicate and the canonical
    import refuses outright with STRUCTURE_BLOCK_DUPLICATE, before any
    template is ever chosen.

    Neither existing gate can see it. metricGridExtractor.test.ts tests the
    detector alone and never builds a structured model, so both owners
    never exist at once. buildStructuredResume.test.ts builds real models
    but only from documents whose Phase 1 identityBlocks are populated or
    whose header carries no KPI band, so the fallback and the grid never
    contend. The collision needs both conditions together, and no
    committed fixture has both.

  WHAT IT ASSERTS
    That a metric-grid cell has exactly ONE structured owner, and that the
    owner is the grid rather than identity. The document below is built to
    be the smallest thing that puts the two owners in contention: no
    identityBlocks, a real header, a KPI band inside the leading unnamed
    run, and a canonical section closing that run.

    It deliberately does NOT assert anything about sections left empty by
    grid consumption. A section whose blocks a grid took still flows
    through adaptCustomSection as an empty-blocks section - that is the
    existing documented behaviour for every metric grid in the corpus
    (f10-metric-cards-3col and f11-metric-score-panel-stacked both emit
    such sections today and pass), and it is a separate question from who
    owns the blocks.

    reconstructWrappedLines runs here because the canonical import runs it
    (canonicalResumeImportService.ts, between the lossless gate and the
    structured build), and a gate that skipped it would not be testing the
    path the failure was reported on.

  All values below are synthetic. No resume, name, or contact detail from
  any real document appears in this file.

  Run with `npx tsx lib/documentPreservation/resumeStructured/metricGridIdentityOwnershipGate.test.ts`.
*/
import { reconstructWrappedLines } from "../losslessSemantic/wrappedLineReconstruction";
import { buildStructuredResume } from "./buildStructuredResume";
import type { LosslessResumeDocument, LosslessResumeSection, SemanticContentBlock } from "../losslessSemantic/types";
import type { ResumeStructuredModel, SourceTrace, StructuredTextValue } from "./types";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}

let blockCounter = 0;
function block(text: string, x: number, y: number, width: number, fontSize: number, blockType: SemanticContentBlock["blockType"] = "paragraph"): SemanticContentBlock {
  const id = `blk-${blockCounter++}`;
  return {
    id,
    sourceElementIds: [id],
    text,
    rawText: text,
    pageIndex: 0,
    sourceOrder: blockCounter,
    bbox: { x, y, width, height: fontSize },
    style: { fontSize },
    blockType,
  };
}
function section(id: string, heading: string | null, normalizedType: LosslessResumeSection["normalizedType"], blocks: SemanticContentBlock[]): LosslessResumeSection {
  return {
    id,
    originalHeading: heading,
    normalizedHeading: heading ? heading.toLowerCase() : null,
    normalizedType,
    displayHeading: heading,
    sourceOrder: Number(id.replace(/\D/g, "")),
    startPageIndex: 0,
    endPageIndex: 0,
    confidence: normalizedType === "custom" ? 0.3 : 0.9,
    classificationMethod: normalizedType === "custom" ? "fallback" : "dictionary",
    reasonCodes: [],
    blocks,
    rawText: blocks.map((b) => b.rawText).join("\n"),
    isUncertain: normalizedType === "custom",
  };
}

/*
  A header run Phase 1 could not name, then a KPI band, then the
  document's first canonical section. The band is two rows: four values
  on one baseline, their four labels on the next, in the same four
  columns - the geometry detectMetricGrids pairs on.
*/
const CONTACT_LINE = "Sample City, ST | 555-0100 | sample.person@example.test";
const VALUES = ["$412M+", "$26.8M (FY2029E)", "Mar 2024", "3 → 11"];
const LABELS = ["ORDER BACKLOG TOTAL", "NEW BUSINESS REVENUE", "PUBLIC LISTING ACHIEVED", "TEAM SIZE GROWTH"];
const COLUMN_X = [56, 186, 336, 466];

const headerSection = section("sec-0", "Sample Person", "custom", [
  block("Sample Person", 56, 40, 120, 24, "heading"),
  block("Target Role: Example Executive", 56, 66, 180, 12),
  block(CONTACT_LINE, 56, 82, 300, 10),
]);
const valueRow = VALUES.map((text, i) => block(text, COLUMN_X[i], 160, 60, 12.5, i === 0 ? "heading" : "paragraph"));
const labelRow = LABELS.map((text, i) => block(text, COLUMN_X[i], 178, 100, 7));
const metricSection = section("sec-1", VALUES[0], "custom", [...valueRow, ...labelRow]);
const summarySection = section("sec-2", "Summary", "summary", [
  block("Summary", 56, 210, 80, 12, "heading"),
  block("Sample summary sentence describing the candidate's background.", 56, 226, 400, 10),
]);

const document: LosslessResumeDocument = {
  schemaVersion: "1.0.0",
  source: { fileName: "metric-grid-identity-ownership.pdf", fileType: "pdf", pageCount: 1 },
  /* Empty on purpose: this is exactly the case that arms the fallback. */
  identityBlocks: [],
  sections: [headerSection, metricSection, summarySection],
  unassignedBlocks: [],
  validation: {
    passed: true,
    sourceElementCount: 0,
    representedElementCount: 0,
    missingElementIds: [],
    duplicateElementIds: [],
    missingTextSpans: [],
    inventedTextSpans: [],
    orderViolations: [],
    warnings: [],
  },
};

/*
  The validator's own top-level owner set, labelled so a duplicated block
  can be attributed rather than only counted. Identity is grouped per
  source section and entries contribute their own trace, never their
  bullets' - the same shape structuredValidator.collectAllTraces uses.
*/
function ownersByBlockId(model: ResumeStructuredModel): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  const claim = (owner: string, trace: SourceTrace | undefined) => {
    if (!trace) return;
    for (const id of trace.sourceBlockIds) {
      const list = owners.get(id) ?? [];
      if (!list.includes(owner)) list.push(owner);
      owners.set(id, list);
    }
  };
  if (model.identity) {
    for (const field of Object.values(model.identity)) {
      const values: StructuredTextValue[] = Array.isArray(field) ? field : field && typeof field === "object" && "source" in field ? [field as StructuredTextValue] : [];
      for (const value of values) claim("identity", value.source);
    }
  }
  claim("professionalSummary", model.professionalSummary?.source);
  for (const group of model.skillGroups) claim("skillGroups", group.source);
  for (const entry of [...model.professionalExperience, ...model.volunteerExperience]) claim("experience", entry.source);
  for (const entry of model.education) claim("education", entry.source);
  for (const entry of model.credentials) claim("credentials", entry.source);
  for (const entry of model.projects) claim("projects", entry.source);
  for (const entry of model.awards) claim("awards", entry.source);
  for (const entry of model.publications) claim("publications", entry.source);
  for (const custom of model.customSections) claim("customSections", custom.source);
  for (const grid of model.metricGrids) {
    for (const entry of grid.entries) {
      claim("metricGrid", entry.value.source);
      claim("metricGrid", entry.label.source);
    }
  }
  return owners;
}

function main() {
  /* The production order: reconstruct, then build. */
  const reconstructed = reconstructWrappedLines(document);
  const model = buildStructuredResume(reconstructed);

  /* --- the defect itself --- */
  check("no source block is represented more than once", model.validation.duplicateBlockIds, []);
  check("the model validates", model.validation.passed, true);

  /* --- the grid survived --- */
  check("the KPI band is recovered as one grid", model.metricGrids.length, 1);
  check("every column is paired", model.metricGrids[0]?.entries.length, VALUES.length);
  check(
    "each pair keeps its own value and label",
    model.metricGrids[0]?.entries.map((entry) => [entry.value.value, entry.label.value]),
    VALUES.map((value, i) => [value, LABELS[i]])
  );

  /* --- ownership: exactly one owner, and it is the grid --- */
  const owners = ownersByBlockId(model);
  const gridBlockIds = [...valueRow, ...labelRow].map((b) => b.id);
  const multiplyOwned = gridBlockIds.filter((id) => (owners.get(id) ?? []).length > 1);
  check("no metric-grid block has more than one structured owner", multiplyOwned, []);
  check(
    "every metric-grid block is owned by the grid alone",
    gridBlockIds.filter((id) => JSON.stringify(owners.get(id) ?? []) !== JSON.stringify(["metricGrid"])),
    []
  );

  /* --- identity did not swallow the band --- */
  const identityTexts = [
    ...(model.identity?.otherContactLines ?? []).map((value) => value.value),
    model.identity?.fullName?.value,
    model.identity?.headline?.value,
    model.identity?.email?.value,
    model.identity?.phone?.value,
    model.identity?.location?.value,
  ].filter((text): text is string => typeof text === "string");
  check("no KPI value is reported as identity text", VALUES.filter((value) => identityTexts.includes(value)), []);
  check("no KPI label is reported as identity text", LABELS.filter((label) => identityTexts.includes(label)), []);

  /* --- the real header is still read, so the fix did not just disable identity --- */
  check("the name is still recovered", model.identity?.fullName?.value, "Sample Person");
  check("the headline is still recovered", model.identity?.headline?.value, "Target Role: Example Executive");
  checkTrue("the contact line is still reached", identityTexts.some((text) => text.includes("sample.person@example.test")));

  /* --- nothing lost, nothing invented --- */
  check("no source block goes unrepresented", model.validation.missingBlockIds, []);
  check("no source section goes unrepresented", model.validation.missingSectionIds, []);
  check("no fact is invented", model.validation.inventedFactValues, []);
  check("the canonical section below the run is untouched", model.professionalSummary !== undefined, true);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
