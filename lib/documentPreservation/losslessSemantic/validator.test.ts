/*
  TASK 6 gate test - full pipeline assembly (blockAdapter ->
  sectionBoundaryDetector -> classifier -> validator) against real
  fixtures, verifying all six section-11 requirements this validator
  actually covers (A-E as report fields, F as a repeat-run equality
  check at the test level). Run with
  `npx tsx lib/documentPreservation/losslessSemantic/validator.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "./buildLosslessDocument";

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

async function runFixture(label: string, fileName: string, sourceFormat: "pdf" | "docx") {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, fileName));
  const layoutResult = await analyzeDocument("resume", sourceFormat, buffer);
  const doc = buildLosslessResumeDocument(layoutResult, { fileName, fileType: sourceFormat });

  checkTrue(`${label}: validation.passed is true`, doc.validation.passed);
  check(`${label}: zero missing elements`, doc.validation.missingElementIds.length, 0);
  check(`${label}: zero duplicate elements`, doc.validation.duplicateElementIds.length, 0);
  check(`${label}: zero missing text spans`, doc.validation.missingTextSpans.length, 0);
  check(`${label}: zero invented text spans`, doc.validation.inventedTextSpans.length, 0);
  check(`${label}: zero order violations`, doc.validation.orderViolations.length, 0);
  check(`${label}: representedElementCount == sourceElementCount`, doc.validation.representedElementCount, doc.validation.sourceElementCount);
  checkTrue(`${label}: at least one section produced`, doc.sections.length >= 1);
  checkTrue(
    `${label}: every custom section has isUncertain=true`,
    doc.sections.every((s) => (s.normalizedType === "custom") === s.isUncertain)
  );
  checkTrue(
    `${label}: displayHeading is verbatim originalHeading for every section`,
    doc.sections.every((s) => s.displayHeading === s.originalHeading)
  );

  return { layoutResult, doc };
}

async function main() {
  await runFixture("standard-pdf-resume.pdf", "standard-pdf-resume.pdf", "pdf");
  await runFixture("word-docx-resume.docx", "word-docx-resume.docx", "docx");
  await runFixture("regtest3-two-column-pdf.pdf", "regtest3-two-column-pdf.pdf", "pdf");
  await runFixture("canva-pdf-resume.pdf", "canva-pdf-resume.pdf", "pdf");
  await runFixture("generated-table-resume.pdf", "generated-table-resume.pdf", "pdf");
  const { layoutResult, doc } = await runFixture(
    "resume-E-senior-ats.pdf",
    path.join("bench", "resume-E-senior-ats.pdf"),
    "pdf"
  );

  // --- F. Determinism (test-level, not a report field) ---
  const doc2 = buildLosslessResumeDocument(layoutResult, { fileName: "resume-E-senior-ats.pdf", fileType: "pdf" });
  check("determinism: repeat build on same layoutResult yields identical section id sequence", doc.sections.map((s) => s.id), doc2.sections.map((s) => s.id));
  check("determinism: repeat build yields identical normalizedType sequence", doc.sections.map((s) => s.normalizedType), doc2.sections.map((s) => s.normalizedType));
  check("determinism: repeat build yields byte-identical validation report", doc.validation, doc2.validation);

  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
