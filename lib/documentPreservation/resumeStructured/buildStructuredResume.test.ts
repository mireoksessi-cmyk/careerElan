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
import type { LosslessResumeDocument, LosslessResumeSection, SemanticContentBlock } from "../losslessSemantic/types";

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

  /* ============================================================
     Fallback identity window. Phase 1 leaves identityBlocks empty
     whenever the name itself scored as the first heading, which is
     common - so these cover what the fallback then has to do with the
     leading sections it is left with. Built as documents rather than
     PDFs so the window logic is exercised directly, without depending
     on how any particular file happens to be scored.
     ============================================================ */
  let identityBlockCounter = 0;
  const identityBlock = (text: string): SemanticContentBlock => {
    const i = identityBlockCounter++;
    return { id: `idb-${i}`, sourceElementIds: [`ide-${i}`], text, rawText: text, pageIndex: 1, sourceOrder: i, blockType: "paragraph" };
  };
  const identitySection = (index: number, normalizedType: LosslessResumeSection["normalizedType"], heading: string | null, texts: string[]): LosslessResumeSection => ({
    id: `idsec-${index}`,
    originalHeading: heading,
    normalizedHeading: heading ? heading.toLowerCase() : null,
    normalizedType,
    displayHeading: heading,
    sourceOrder: index,
    startPageIndex: 1,
    endPageIndex: 1,
    blocks: texts.map(identityBlock),
    rawText: texts.join("\n"),
    isUncertain: normalizedType === "custom",
    reasonCodes: [],
    confidence: normalizedType === "custom" ? 0.3 : 0.9,
    classificationMethod: normalizedType === "custom" ? "fallback" : "dictionary",
  });
  const identityDocument = (sections: LosslessResumeSection[]): LosslessResumeDocument => ({
    schemaVersion: "1.0.0",
    source: { fileName: "identity-window.pdf", fileType: "pdf", pageCount: 1 },
    identityBlocks: [],
    sections,
    unassignedBlocks: [],
    validation: { passed: true, sourceElementCount: 0, representedElementCount: 0, missingElementIds: [], duplicateElementIds: [], missingTextSpans: [], inventedTextSpans: [], orderViolations: [], warnings: [] },
  });

  // A header split across two leading sections - name, then title with
  // the contact line. The contact is in the SECOND section.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "custom", null, ["ALEX CHEN"]),
      identitySection(1, "custom", null, ["SENIOR PRODUCT MANAGER", "Vancouver, BC | 604-555-0134 | alex.chen@mail.test"]),
      identitySection(2, "summary", "SUMMARY", ["SUMMARY", "Product leader with a decade of experience."]),
    ]));
    checkTrue("identity window: a header split across two leading sections still yields identity", model.identity !== undefined);
    check("identity window: the name is taken from the first leading section", model.identity?.fullName?.value, "ALEX CHEN");
    checkTrue("identity window: the contact from the second leading section is reached", (model.identity?.email?.value ?? "").includes("alex.chen@mail.test"));
    check("identity window: neither leading section is also emitted as custom content", model.customSections.length, 0);
    check("identity window: the first canonical section is untouched", model.professionalSummary !== undefined, true);
  }

  // The already-working shape: name and contact in ONE leading section.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "custom", null, ["DANA WHITFIELD", "Toronto, ON | 416-555-0199 | dana@mail.test"]),
      identitySection(1, "summary", "SUMMARY", ["SUMMARY", "Reliability engineer."]),
    ]));
    checkTrue("identity window: the single-section header still yields identity", model.identity !== undefined);
    check("identity window: single-section name unchanged", model.identity?.fullName?.value, "DANA WHITFIELD");
    check("identity window: single-section header is not duplicated as custom content", model.customSections.length, 0);
  }

  // No contact channel anywhere in the leading run - identity must NOT
  // be manufactured just because several unnamed sections lead.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "custom", null, ["PROMINENT LINE"]),
      identitySection(1, "custom", null, ["SECOND PROMINENT LINE"]),
      identitySection(2, "summary", "SUMMARY", ["SUMMARY", "Some summary text."]),
    ]));
    check("identity window: no contact signal means no invented identity", model.identity, undefined);
    check("identity window: and that leading material is preserved as custom sections instead", model.customSections.length, 2);
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
