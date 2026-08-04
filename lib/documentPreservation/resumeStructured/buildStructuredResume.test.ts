/*
  TASK 7 gate test - full pipeline assembly (Phase 1 -> Phase 2
  structured model) + structuredValidator against real fixtures. Run
  with `npx tsx lib/documentPreservation/resumeStructured/buildStructuredResume.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "./buildStructuredResume";

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

const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");

/*
  expectIdentity defaults to true. Two fixtures (generated-table-resume.pdf,
  lossless-synthetic/f5-no-heading-document.docx) genuinely carry no
  identity-shaped block anywhere in Phase 1's own output - the first has
  no name/contact line at all (starts directly at "Professional
  Experience"), the second mentions the person's name only inside
  flowing narrative prose, never as a separable block. Asserting
  identity !== undefined for those is a test bug, not a real extraction
  gap - hasIdentitySignal() correctly finds no email/phone signal and
  Phase 1's own identityBlocks is empty, so there is nothing to extract
  without inventing it.
*/
async function runFixture(fileName: string, format: "pdf" | "docx", opts: { expectIdentity?: boolean } = {}) {
  const { expectIdentity = true } = opts;
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, fileName));
  const layoutResult = await analyzeDocument("resume", format, buffer);
  const document = buildLosslessResumeDocument(layoutResult, { fileName, fileType: format });
  const model = buildStructuredResume(document);

  checkTrue(`${fileName}: structured validation.passed`, model.validation.passed);
  check(`${fileName}: zero missing sections`, model.validation.missingSectionIds.length, 0);
  check(`${fileName}: zero missing blocks`, model.validation.missingBlockIds.length, 0);
  check(`${fileName}: zero duplicate blocks`, model.validation.duplicateBlockIds.length, 0);
  check(`${fileName}: zero invented facts`, model.validation.inventedFactValues.length, 0);
  check(`${fileName}: zero volunteer/professional mixing`, model.validation.volunteerMixedIntoProfessional.length, 0);
  check(`${fileName}: zero missing custom sections`, model.validation.missingCustomSections.length, 0);
  check(`${fileName}: identity resolved`, model.identity !== undefined, expectIdentity);

  return { document, model };
}

async function main() {
  const { model: benchAModel } = await runFixture("bench/resume-A-junior-ats.pdf", "pdf");
  checkTrue("bench-A: professionalExperience populated", benchAModel.professionalExperience.length > 0);
  checkTrue("bench-A: volunteerExperience populated separately", benchAModel.volunteerExperience.length > 0);
  checkTrue(
    "bench-A: slotAvailability correctly reflects populated slots",
    benchAModel.slotAvailability.professional_experience === true && benchAModel.slotAvailability.volunteer_experience === true
  );
  check("bench-A: no empty slot falsely marked available (publications absent)", benchAModel.slotAvailability.publications, false);

  await runFixture("bench/resume-C-mid-ats.pdf", "pdf");
  await runFixture("threepage-pdf-resume.pdf", "pdf");
  await runFixture("regtest1-regulated-nurse-resume.docx", "docx");
  await runFixture("google-docs-resume.docx", "docx");
  await runFixture("word-docx-resume.docx", "docx");
  await runFixture("generated-table-resume.pdf", "pdf", { expectIdentity: false });
  const { model: f1Model } = await runFixture("lossless-synthetic/f1-career-profile-awards-custom.docx", "docx");
  checkTrue("f1: awards populated", f1Model.awards.length > 0);
  checkTrue("f1: unknown custom heading preserved in customSections", f1Model.customSections.some((c) => c.originalHeading === "Speaking & Media Appearances"));

  const { model: f5Model } = await runFixture("lossless-synthetic/f5-no-heading-document.docx", "docx", { expectIdentity: false });
  checkTrue("f5 (no-heading document): still produces a valid model with the content preserved as custom", f5Model.customSections.length >= 1 || f5Model.identity !== undefined);

  // --- determinism (test-level, per Phase 1's own convention) ---
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, "bench/resume-C-mid-ats.pdf"));
  const layoutResult = await analyzeDocument("resume", "pdf", buffer);
  const doc = buildLosslessResumeDocument(layoutResult, { fileName: "bench/resume-C-mid-ats.pdf", fileType: "pdf" });
  const model1 = buildStructuredResume(doc);
  const model2 = buildStructuredResume(doc);
  check("determinism: repeat build yields identical professionalExperience entry ids", model1.professionalExperience.map((e) => e.id), model2.professionalExperience.map((e) => e.id));
  check("determinism: repeat build yields byte-identical validation report", model1.validation, model2.validation);

  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
