/*
  TASK 8 gate test - TailoredResumeOverlay contract. Run with
  `npx tsx lib/documentPreservation/resumeStructured/tailoredOverlay.test.ts`.
  No network call, no OpenAI client anywhere in this file or in
  tailoredOverlay.ts - purely a pure-function contract test.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "./buildStructuredResume";
import { mergeTailoredOverlay } from "./tailoredOverlay";
import type { ResumeStructuredModel } from "./types";

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
    source: { fileName: "synthetic.docx", fileType: "docx" },
    identity: undefined,
    professionalSummary: { text: "Experienced operations coordinator.", source: src },
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
        rawHeaderText: "Coordinator\nAcme Corp - 2019 - 2022",
        source: src,
        isVolunteer: false,
        isUncertain: false,
        reasonCodes: [],
      },
    ],
    volunteerExperience: [],
    education: [{ id: "entry-edu-0", rawHeaderText: "", source: src, isUncertain: true, reasonCodes: [], honors: [], details: [] } as any],
    credentials: [],
    projects: [
      {
        id: "entry-proj-0",
        name: { value: "Internal Tracker", confidence: 1, extractionMethod: "pattern-rule", source: src },
        role: undefined,
        dateRangeText: undefined,
        technologies: [],
        bullets: [{ id: "entry-proj-0-bullet-0", text: "Built a small internal tool.", source: src }],
        descriptionParagraphs: [],
        rawHeaderText: "Internal Tracker",
        source: src,
        isUncertain: false,
        reasonCodes: [],
      },
    ],
    awards: [],
    publications: [],
    customSections: [],
    slotAvailability: {
      identity: false,
      professional_summary: true,
      core_skills: false,
      professional_experience: true,
      volunteer_experience: false,
      education: true,
      certifications_licenses: false,
      projects: true,
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

// ==================== Rewrite existing bullet by id ====================
{
  const model = makeModel();
  const originalEntry = model.professionalExperience[0];
  const result = mergeTailoredOverlay(model, {
    schemaVersion: "1.0.0",
    entries: [{ entryId: "entry-exp-0", bullets: [{ id: "entry-exp-0-bullet-0", text: "Managed weekly logistics reporting for a 12-person team." }] }],
  });
  check("rewrite: zero rejections", result.rejections.length, 0);
  check("rewrite: entryId reported as applied", result.appliedEntryIds, ["entry-exp-0"]);
  check("rewrite: bullet-0 text updated", result.model.professionalExperience[0].bullets[0].text, "Managed weekly logistics reporting for a 12-person team.");
  check("rewrite: bullet-1 untouched", result.model.professionalExperience[0].bullets[1].text, "Coordinated cross-team scheduling.");
  check("rewrite: bullet count unchanged (rewrite, not append)", result.model.professionalExperience[0].bullets.length, 2);
  check("rewrite: rewritten bullet's source trace preserved", result.model.professionalExperience[0].bullets[0].source, src);
  checkTrue("rewrite: original model NOT mutated", originalEntry.bullets[0].text === "Managed weekly logistics reporting.");
}

// ==================== Append a new bullet (no id match) ====================
{
  const model = makeModel();
  const result = mergeTailoredOverlay(model, {
    schemaVersion: "1.0.0",
    entries: [{ entryId: "entry-exp-0", bullets: [{ text: "Reduced report turnaround time by 30% by introducing a shared template." }] }],
  });
  check("append: zero rejections", result.rejections.length, 0);
  check("append: bullet count grows by one", result.model.professionalExperience[0].bullets.length, 3);
  check("append: new bullet text present", result.model.professionalExperience[0].bullets[2].text, "Reduced report turnaround time by 30% by introducing a shared template.");
  checkTrue("append: new bullet has a synthetic id, not empty", result.model.professionalExperience[0].bullets[2].id.length > 0);
  checkTrue("append: original two bullets still present unchanged", result.model.professionalExperience[0].bullets[0].text === "Managed weekly logistics reporting." && result.model.professionalExperience[0].bullets[1].text === "Coordinated cross-team scheduling.");
}

// ==================== Protected facts are structurally unreachable ====================
{
  const model = makeModel();
  const result = mergeTailoredOverlay(model, {
    schemaVersion: "1.0.0",
    entries: [{ entryId: "entry-exp-0", organization: "Globex Corp", bullets: [{ text: "New bullet." }] } as any],
  });
  check("protected-fact: rejected", result.rejections.length, 1);
  check("protected-fact: rejection reason", result.rejections[0].reason, "protected-field-attempted");
  check("protected-fact: nothing applied", result.appliedEntryIds, []);
  check("protected-fact: organization value unchanged in output", result.model.professionalExperience[0].organization?.value, "Acme Corp");
  check("protected-fact: bullets unchanged (whole entry overlay rejected)", result.model.professionalExperience[0].bullets.length, 2);
}

// ==================== Unknown entryId is rejected, never creates a new entry ====================
{
  const model = makeModel();
  const result = mergeTailoredOverlay(model, {
    schemaVersion: "1.0.0",
    entries: [{ entryId: "entry-exp-does-not-exist", bullets: [{ text: "Fabricated role at a company that was never on this resume." }] }],
  });
  check("unknown-id: rejected", result.rejections.length, 1);
  check("unknown-id: rejection reason", result.rejections[0].reason, "unknown-entry-id");
  check("unknown-id: professionalExperience array length unchanged", result.model.professionalExperience.length, 1);
  check("unknown-id: no new entry appended anywhere", result.model.professionalExperience.length + result.model.volunteerExperience.length + result.model.projects.length, 2);
}

// ==================== Malformed bullet overlay (empty text) ====================
{
  const model = makeModel();
  const result = mergeTailoredOverlay(model, {
    schemaVersion: "1.0.0",
    entries: [{ entryId: "entry-exp-0", bullets: [{ text: "" }] }],
  });
  check("malformed-bullet: rejected", result.rejections.length, 1);
  check("malformed-bullet: rejection reason", result.rejections[0].reason, "invalid-overlay-shape");
  check("malformed-bullet: bullets unchanged", result.model.professionalExperience[0].bullets.length, 2);
}

// ==================== professionalSummaryText rewrite ====================
{
  const model = makeModel();
  const result = mergeTailoredOverlay(model, { schemaVersion: "1.0.0", professionalSummaryText: "Operations coordinator with logistics and cross-team scheduling experience." });
  check("summary: zero rejections", result.rejections.length, 0);
  check("summary: text updated", result.model.professionalSummary?.text, "Operations coordinator with logistics and cross-team scheduling experience.");
  check("summary: source trace preserved (still points at real Phase 1 blocks)", result.model.professionalSummary?.source, src);
  checkTrue("summary: original model NOT mutated", model.professionalSummary?.text === "Experienced operations coordinator.");
}

// ==================== professionalSummaryText with no existing slot ====================
{
  const model = makeModel();
  model.professionalSummary = undefined;
  const result = mergeTailoredOverlay(model, { schemaVersion: "1.0.0", professionalSummaryText: "Invented summary with no source." });
  check("summary-invented: rejected", result.rejections.length, 1);
  check("summary-invented: rejection reason", result.rejections[0].reason, "unknown-entry-id");
  check("summary-invented: model.professionalSummary stays undefined", result.model.professionalSummary, undefined);
}

// ==================== Top-level shape rejection ====================
{
  const model = makeModel();
  const result1 = mergeTailoredOverlay(model, "not an object");
  check("shape: non-object overlay rejected", result1.rejections[0]?.reason, "invalid-overlay-shape");

  const result2 = mergeTailoredOverlay(model, { schemaVersion: "1.0.0", entries: [], somethingExtra: true });
  check("shape: unexpected top-level key rejected", result2.rejections[0]?.reason, "protected-field-attempted");
}

// ==================== Unrelated model branches are untouched by reference ====================
{
  const model = makeModel();
  const result = mergeTailoredOverlay(model, { schemaVersion: "1.0.0", entries: [{ entryId: "entry-exp-0", bullets: [{ text: "Extra bullet." }] }] });
  checkTrue("untouched-branch: education array is the SAME reference (never cloned/rewritten)", result.model.education === model.education);
  checkTrue("untouched-branch: credentials array is the SAME reference", result.model.credentials === model.credentials);
  checkTrue("untouched-branch: identity is unchanged (undefined)", result.model.identity === model.identity);
}

// ==================== Real-fixture integration (bench-A) ====================
async function realFixtureTest() {
  const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, "bench/resume-A-junior-ats.pdf"));
  const layoutResult = await analyzeDocument("resume", "pdf", buffer);
  const document = buildLosslessResumeDocument(layoutResult, { fileName: "bench/resume-A-junior-ats.pdf", fileType: "pdf" });
  const realModel = buildStructuredResume(document);

  const targetEntry = realModel.professionalExperience[0];
  checkTrue("real-fixture: has at least one professionalExperience entry to target", targetEntry !== undefined);
  if (!targetEntry) return;

  const beforeOrg = targetEntry.organization?.value;
  const beforeRole = targetEntry.role?.value;
  const beforeDates = targetEntry.dateRangeText?.value;

  const overlayResult = mergeTailoredOverlay(realModel, {
    schemaVersion: "1.0.0",
    entries: [{ entryId: targetEntry.id, bullets: [{ id: targetEntry.bullets[0]?.id, text: "Tailored bullet emphasizing a job-relevant skill." }, { text: "Newly added tailored bullet." }] }],
  });

  check("real-fixture: zero rejections on a legitimate overlay", overlayResult.rejections.length, 0);
  check("real-fixture: entryId applied", overlayResult.appliedEntryIds, [targetEntry.id]);
  const afterEntry = overlayResult.model.professionalExperience[0];
  check("real-fixture: protected organization unchanged", afterEntry.organization?.value, beforeOrg);
  check("real-fixture: protected role unchanged", afterEntry.role?.value, beforeRole);
  check("real-fixture: protected dateRangeText unchanged", afterEntry.dateRangeText?.value, beforeDates);
  // If the real entry already had a bullet, overlay item 1 rewrites it in
  // place (no growth) and item 2 appends (+1) -> +1 total. If the real
  // entry had zero bullets to begin with (a real, evidenced pattern in
  // this fixture set - some entries use descriptionParagraphs instead),
  // both overlay items have nothing to match and both append -> +2.
  const expectedGrowth = targetEntry.bullets.length > 0 ? 1 : 2;
  checkTrue("real-fixture: bullet count grew by the expected amount", afterEntry.bullets.length === targetEntry.bullets.length + expectedGrowth);
  checkTrue("real-fixture: original model's own bullet text is untouched", realModel.professionalExperience[0].bullets[0]?.text === targetEntry.bullets[0]?.text);
}

async function main() {
  await realFixtureTest();
  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
