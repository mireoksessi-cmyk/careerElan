/*
  Phase 6A.2 Implementation gate test - Overlay Runtime. Run with
  `npx tsx lib/careerMemory/runtime/overlayRuntime.test.ts`. Exercises
  resolveTailoredResume/validateOverlay/applyOverlay/removeOverlay
  purely against in-memory objects - tailoredOverlay.ts itself is
  imported unmodified, never re-implemented here.
*/
import { resolveTailoredResume, validateOverlay, applyOverlay, removeOverlay } from "./overlayRuntime";
import { createCanonicalRuntime, createRuntimeVersion } from "./factory";
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";
import type { CanonicalResumeRuntime } from "./types";

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

const src = { sourceSectionId: "s1", sourceBlockIds: ["b1"], sourceElementIds: ["e1"] };

function makeModel(): ResumeStructuredModel {
  return {
    schemaVersion: "1.0.0",
    source: { fileName: "synthetic.pdf", fileType: "pdf" },
    identity: undefined,
    professionalSummary: { text: "Operations coordinator.", source: src },
    skillGroups: [],
    professionalExperience: [
      {
        id: "entry-exp-0",
        organization: { value: "Acme Corp", confidence: 1, extractionMethod: "pattern-rule", source: src },
        role: { value: "Coordinator", confidence: 1, extractionMethod: "pattern-rule", source: src },
        location: undefined,
        startDateText: undefined,
        endDateText: undefined,
        dateRangeText: { value: "2019 - 2022", confidence: 1, extractionMethod: "pattern-rule", source: src },
        bullets: [
          { id: "entry-exp-0-bullet-0", text: "Managed weekly logistics reporting.", source: src },
          { id: "entry-exp-0-bullet-1", text: "Coordinated cross-team scheduling.", source: src },
        ],
        descriptionParagraphs: [],
        content: [
          { id: "entry-exp-0-content-0", kind: "bullet", text: "Managed weekly logistics reporting.", source: src },
          { id: "entry-exp-0-content-1", kind: "bullet", text: "Coordinated cross-team scheduling.", source: src },
        ],
        hierarchicalContent: [],
        hasHierarchicalStructure: false,
        rawHeaderText: "Coordinator\nAcme Corp - 2019 - 2022",
        source: src,
        isVolunteer: false,
        isUncertain: false,
        reasonCodes: [],
      },
    ],
    volunteerExperience: [],
    education: [],
    credentials: [],
    projects: [],
    awards: [],
    publications: [],
    languages: [],
    customSections: [],
    metricGrids: [],
    slotAvailability: {
      identity: false,
      professional_summary: true,
      core_skills: false,
      professional_experience: true,
      volunteer_experience: false,
      education: false,
      certifications_licenses: false,
      projects: false,
      awards: false,
      publications: false,
      additional_information: false,
    },
    validation: {
      passed: true,
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
}

function makeRuntime(): CanonicalResumeRuntime {
  const version = createRuntimeVersion({ id: "v-1", reason: "initial", createdAt: "2026-01-01T00:00:00.000Z" });
  return createCanonicalRuntime({ resume: makeModel(), version });
}

// ==================== resolveTailoredResume: no overlays applied ====================
{
  const runtime = makeRuntime();
  const resolved = resolveTailoredResume(runtime);
  checkTrue("resolve-empty: with empty history, returns the SAME reference as runtime.resume", resolved === runtime.resume);
}

// ==================== validateOverlay: dry-run, never mutates ====================
{
  const runtime = makeRuntime();
  const result = validateOverlay(runtime, { schemaVersion: "1.0.0", entries: [{ entryId: "entry-exp-0", bullets: [{ id: "entry-exp-0-bullet-0", text: "Rewritten for validation only." }] }] });
  check("validate-dry-run: reports valid for a legitimate overlay", result.valid, true);
  check("validate-dry-run: zero rejections", result.rejections, []);
  check("validate-dry-run: history NOT grown by a dry-run validate call", runtime.overlayState.history.length, 0);
}
{
  const runtime = makeRuntime();
  const result = validateOverlay(runtime, { schemaVersion: "1.0.0", entries: [{ entryId: "does-not-exist", bullets: [{ text: "x" }] }] });
  check("validate-dry-run: reports invalid for an unknown entryId", result.valid, false);
  check("validate-dry-run: rejection reason surfaced", result.rejections[0]?.reason, "unknown-entry-id");
}

// ==================== applyOverlay: successful rewrite ====================
{
  const runtime = makeRuntime();
  const { runtime: next, appliedEntryIds, rejections } = applyOverlay(runtime, {
    schemaVersion: "1.0.0",
    entries: [{ entryId: "entry-exp-0", bullets: [{ id: "entry-exp-0-bullet-0", text: "Managed weekly logistics reporting for a 12-person team." }] }],
  });
  check("apply-rewrite: zero rejections", rejections, []);
  check("apply-rewrite: entryId reported as applied", appliedEntryIds, ["entry-exp-0"]);
  check("apply-rewrite: history grows to 1", next.overlayState.history.length, 1);
  checkTrue("apply-rewrite: runtime.resume (canonical) is STILL the pristine, unmodified original", next.resume === runtime.resume);
  check("apply-rewrite: canonical bullet text is untouched", next.resume.professionalExperience[0].bullets[0].text, "Managed weekly logistics reporting.");
  check("apply-rewrite: tailored VIEW reflects the rewrite", resolveTailoredResume(next).professionalExperience[0].bullets[0].text, "Managed weekly logistics reporting for a 12-person team.");
}

// ==================== applyOverlay: rejection is still recorded in history ====================
{
  const runtime = makeRuntime();
  const { runtime: next, appliedEntryIds, rejections } = applyOverlay(runtime, { schemaVersion: "1.0.0", entries: [{ entryId: "ghost-entry", bullets: [{ text: "Invented." }] }] });
  check("apply-rejected: one rejection reported", rejections.length, 1);
  check("apply-rejected: nothing applied", appliedEntryIds, []);
  check("apply-rejected: history STILL grows (records the attempt)", next.overlayState.history.length, 1);
  check("apply-rejected: tailored view is unchanged from canonical (nothing to apply)", resolveTailoredResume(next).professionalExperience[0].bullets.length, 2);
}

// ==================== applyOverlay: two overlays fold cumulatively in order ====================
{
  const runtime = makeRuntime();
  const step1 = applyOverlay(runtime, { schemaVersion: "1.0.0", entries: [{ entryId: "entry-exp-0", bullets: [{ id: "entry-exp-0-bullet-0", text: "First tailoring pass." }] }] });
  const step2 = applyOverlay(step1.runtime, { schemaVersion: "1.0.0", entries: [{ entryId: "entry-exp-0", bullets: [{ text: "Newly appended bullet from second pass." }] }] });
  check("apply-cumulative: history has 2 records", step2.runtime.overlayState.history.length, 2);
  const resolved = resolveTailoredResume(step2.runtime);
  check("apply-cumulative: first overlay's rewrite is visible", resolved.professionalExperience[0].bullets[0].text, "First tailoring pass.");
  check("apply-cumulative: second overlay's append is visible", resolved.professionalExperience[0].bullets[2].text, "Newly appended bullet from second pass.");
  check("apply-cumulative: bullet count grew by exactly 1 (one append, one rewrite)", resolved.professionalExperience[0].bullets.length, 3);
  checkTrue("apply-cumulative: canonical resume is STILL untouched after two applies", step2.runtime.resume === runtime.resume);
}

// ==================== removeOverlay: removes one record and re-folds the rest ====================
{
  const runtime = makeRuntime();
  const step1 = applyOverlay(runtime, { schemaVersion: "1.0.0", entries: [{ entryId: "entry-exp-0", bullets: [{ id: "entry-exp-0-bullet-0", text: "First tailoring pass." }] }] });
  const step2 = applyOverlay(step1.runtime, { schemaVersion: "1.0.0", professionalSummaryText: "Second tailoring pass summary." });
  const removed = removeOverlay(step2.runtime, 0);
  check("remove: history shrinks to 1", removed.overlayState.history.length, 1);
  const resolved = resolveTailoredResume(removed);
  check("remove: first overlay's bullet rewrite is GONE", resolved.professionalExperience[0].bullets[0].text, "Managed weekly logistics reporting.");
  check("remove: second overlay's summary rewrite is STILL applied", resolved.professionalSummary?.text, "Second tailoring pass summary.");
}
{
  const runtime = makeRuntime();
  const step1 = applyOverlay(runtime, { schemaVersion: "1.0.0", professionalSummaryText: "Only overlay applied." });
  const removed = removeOverlay(step1.runtime, 0);
  check("remove-last: history empty after removing the only record", removed.overlayState.history.length, 0);
  checkTrue("remove-last: tailored view now equals the pristine canonical again", resolveTailoredResume(removed).professionalSummary?.text === runtime.resume.professionalSummary?.text);
}

// ==================== removeOverlay: out-of-range index is a safe no-op ====================
{
  const runtime = makeRuntime();
  const step1 = applyOverlay(runtime, { schemaVersion: "1.0.0", professionalSummaryText: "Applied once." });
  const untouchedHigh = removeOverlay(step1.runtime, 99);
  checkTrue("remove-out-of-range-high: returns the SAME runtime reference unchanged", untouchedHigh === step1.runtime);
  const untouchedNegative = removeOverlay(step1.runtime, -1);
  checkTrue("remove-out-of-range-negative: returns the SAME runtime reference unchanged", untouchedNegative === step1.runtime);
}

// ==================== removeOverlay never mutates the runtime it was given ====================
{
  const runtime = makeRuntime();
  const step1 = applyOverlay(runtime, { schemaVersion: "1.0.0", professionalSummaryText: "Applied once." });
  const before = JSON.stringify(step1.runtime);
  removeOverlay(step1.runtime, 0);
  checkTrue("remove: never mutates the runtime object passed to it", JSON.stringify(step1.runtime) === before);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
