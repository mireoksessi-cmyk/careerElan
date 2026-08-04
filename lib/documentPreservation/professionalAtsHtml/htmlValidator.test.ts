/*
  TASK 9 gate test - full pipeline (measure -> plan -> validate)
  against real fixtures. Run with
  `npx tsx lib/documentPreservation/professionalAtsHtml/htmlValidator.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "../resumeStructured/buildStructuredResume";
import { buildProfessionalAtsAssembly } from "../professionalAtsAssembly/buildProfessionalAtsAssembly";
import { autoFitDensity } from "./densityAutoFit";
import { validateProfessionalAtsHtml } from "./htmlValidator";

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

async function runFixture(file: string, format: "pdf" | "docx") {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, file));
  const layoutResult = await analyzeDocument("resume", format, buffer);
  const document = buildLosslessResumeDocument(layoutResult, { fileName: file, fileType: format });
  const model = buildStructuredResume(document);
  const assembly = buildProfessionalAtsAssembly(model);

  const fit = await autoFitDensity(assembly, "letter");
  const report = await validateProfessionalAtsHtml(assembly, fit.plan, fit.measurement, "letter", fit.density);

  if (!report.passed) {
    console.log(`  [${file}] validation report:`, JSON.stringify(report, null, 2));
  }

  check(`${file}: validation passed`, report.passed, true);
  check(`${file}: missingTextFragments empty`, report.missingTextFragments, []);
  check(`${file}: inventedTextFragments empty`, report.inventedTextFragments, []);
  check(`${file}: sectionOrderViolations empty`, report.sectionOrderViolations, []);
  check(`${file}: hiddenSectionDomCount is 0`, report.hiddenSectionDomCount, 0);
  check(`${file}: emptyHeadingCount is 0`, report.emptyHeadingCount, 0);
  check(`${file}: overflowPageIndices empty`, report.overflowPageIndices, []);
  check(`${file}: sectionHeadingOrphans empty`, report.sectionHeadingOrphans, []);
  check(`${file}: entryHeaderOrphans empty`, report.entryHeaderOrphans, []);
  check(`${file}: invalidSplitBoundaries empty`, report.invalidSplitBoundaries, []);
  check(`${file}: destructiveCompactionFlags empty`, report.destructiveCompactionFlags, []);
  checkTrue(`${file}: domOrderMatchesReadingOrder`, report.domOrderMatchesReadingOrder);
}

async function main() {
  await runFixture("threepage-pdf-resume.pdf", "pdf");
  await runFixture("bench/resume-B-junior-canva.pdf", "pdf");
  await runFixture("lossless-synthetic/f5-no-heading-document.docx", "docx");
  await runFixture("lossless-synthetic/f1-career-profile-awards-custom.docx", "docx");
  await runFixture("standard-pdf-resume.pdf", "pdf");
  await runFixture("regtest3-two-column-pdf.pdf", "pdf");

  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
