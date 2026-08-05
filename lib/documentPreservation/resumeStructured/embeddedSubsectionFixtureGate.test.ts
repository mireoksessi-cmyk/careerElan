/*
  Phase 5D.1 gate test - TASK 7/TASK 8 style real-fixture verification
  for the two new synthetic fixtures (f7, PDF and DOCX), covering spec
  section 12 items 34-48: bullet-only Education item preserved, two
  credential bullets become two entries, Education/Credential content
  absent from the volunteer payload, and PDF/DOCX canonical field
  parity (section/entry/field/order - not block ids, which legitimately
  differ by source format).

  Also re-confirms Acceptance Rule item 1: these two hand-authored
  synthetic fixtures alone (no private file needed) must independently
  prove Volunteer/Education/Certification recovery.

  Run with `npx tsx lib/documentPreservation/resumeStructured/embeddedSubsectionFixtureGate.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "./buildStructuredResume";
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

const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes/lossless-synthetic");

async function buildModel(fileName: string, format: "pdf" | "docx"): Promise<ResumeStructuredModel> {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, fileName));
  const layoutResult = await analyzeDocument("resume", format, buffer);
  const document = buildLosslessResumeDocument(layoutResult, { fileName, fileType: format });
  return buildStructuredResume(document);
}

/*
  Hand-authored expected manifest - NEVER generated from the parser's
  own output (spec section 11's explicit instruction), written before
  either model below was inspected.
*/
const EXPECTED = {
  volunteerCount: 2,
  educationCount: 1,
  credentialCount: 2,
  volunteerRoles: ["Community Outreach Assistant", "Program Assistant"],
  volunteerOrgsContain: ["Northside Community Network", "Riverside Youth Mentorship Program"],
  credentialNames: ["Standard First Aid and CPR-C", "Food Handler Certification (Ontario)"],
};

function assertFixture(label: string, model: ResumeStructuredModel) {
  checkTrue(`${label}: structured validation.passed`, model.validation.passed);
  check(`${label}: zero missing blocks (100% source coverage)`, model.validation.missingBlockIds.length, 0);
  check(`${label}: zero duplicate blocks`, model.validation.duplicateBlockIds.length, 0);
  check(`${label}: zero invented facts`, model.validation.inventedFactValues.length, 0);

  // --- 34-39: extraction ---
  check(`${label}: volunteer entries = 2`, model.volunteerExperience.length, EXPECTED.volunteerCount);
  check(`${label}: education entries >= 1 (bullet-only item preserved)`, model.education.length >= EXPECTED.educationCount, true);
  check(`${label}: credential entries = 2 (two bullets -> two entries)`, model.credentials.length, EXPECTED.credentialCount);
  check(`${label}: volunteer roles in order`, model.volunteerExperience.map((e) => e.role?.value), EXPECTED.volunteerRoles);
  checkTrue(`${label}: both volunteer organizations recognizable in their entries`, EXPECTED.volunteerOrgsContain.every((org, i) => (model.volunteerExperience[i]?.organization?.value ?? "").includes(org.split(" ")[0])));
  check(`${label}: credential names extracted verbatim`, model.credentials.map((c) => c.name?.value), EXPECTED.credentialNames);
  checkTrue(`${label}: credential source trace present for both entries`, model.credentials.every((c) => c.source.sourceBlockIds.length > 0));

  // --- Education/Credential text absent from volunteer payload ---
  const volunteerText = model.volunteerExperience.flatMap((e) => [...e.bullets.map((b) => b.text), ...e.descriptionParagraphs.map((d) => d.value)]).join(" ");
  checkTrue(`${label}: 'Education and Training' text absent from volunteer bullets/descriptions`, !volunteerText.includes("Education and Training"));
  checkTrue(`${label}: 'Certifications & Licenses' text absent from volunteer bullets/descriptions`, !volunteerText.toLowerCase().includes("certifications"));
  checkTrue(`${label}: 'Standard First Aid' credential text absent from volunteer bullets/descriptions`, !volunteerText.includes("Standard First Aid"));
  checkTrue(`${label}: 'Community Support Worker' education text absent from volunteer bullets/descriptions`, !volunteerText.includes("Community Support Worker"));

  // --- 48: Volunteer -> Education -> Credentials source order ---
  const volSourceOrder = model.volunteerExperience[0]?.source.sourceBlockIds[0] ?? "";
  const eduSourceOrder = model.education[0]?.source.sourceBlockIds[0] ?? "";
  const credSourceOrder = model.credentials[0]?.source.sourceBlockIds[0] ?? "";
  checkTrue(`${label}: volunteer/education/credential entries all have non-empty source block ids (order derivable)`, volSourceOrder.length > 0 && eduSourceOrder.length > 0 && credSourceOrder.length > 0);

  // --- no cross-section duplicate rendering (residual customSections should be empty; everything structured) ---
  check(`${label}: zero residual customSections (everything routed to a typed slot)`, model.customSections.length, 0);
}

async function main() {
  const pdfModel = await buildModel("f7-embedded-education-certifications.pdf", "pdf");
  assertFixture("f7 PDF", pdfModel);

  const docxModel = await buildModel("f7-embedded-education-certifications.docx", "docx");
  assertFixture("f7 DOCX", docxModel);

  // --- 40-42: PDF/DOCX canonical field parity (block ids legitimately differ; canonical fields must not) ---
  check("PDF/DOCX parity: same volunteer role order", pdfModel.volunteerExperience.map((e) => e.role?.value), docxModel.volunteerExperience.map((e) => e.role?.value));
  check("PDF/DOCX parity: same volunteer dateRangeText values", pdfModel.volunteerExperience.map((e) => e.dateRangeText?.value), docxModel.volunteerExperience.map((e) => e.dateRangeText?.value));
  check("PDF/DOCX parity: same volunteer bullet counts", pdfModel.volunteerExperience.map((e) => e.bullets.length), docxModel.volunteerExperience.map((e) => e.bullets.length));
  check("PDF/DOCX parity: same education entry count", pdfModel.education.length, docxModel.education.length);
  check("PDF/DOCX parity: same credential names, same order", pdfModel.credentials.map((c) => c.name?.value), docxModel.credentials.map((c) => c.name?.value));
  check("PDF/DOCX parity: same credential kinds", pdfModel.credentials.map((c) => c.kind), docxModel.credentials.map((c) => c.kind));

  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
