/*
  TASK 6 gate - real PDF text preservation, missing/invented/duplicate
  checks against Phase 4's own PaginationPlan. Run with
  `npx tsx lib/documentPreservation/professionalAtsPdf/pdfTextPreservationValidator.test.ts`.
*/
import { closeSharedBrowser } from "../sharedBrowser";
import { loadFixtureThroughPhase4 } from "./testFixtureHelper";
import { renderProfessionalAtsPdf } from "./pdfRenderer";
import { extractPdfPageText } from "./pdfTextExtraction";
import { validatePdfTextPreservation } from "./pdfTextPreservationValidator";

let pass = 0;
let fail = 0;
function checkTrue(label: string, actual: boolean) {
  console.log(actual ? "PASS" : "FAIL", label);
  if (actual) pass++;
  else fail++;
}
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

async function testFixture(fixture: string, paperSize: "letter" | "a4") {
  const { assembly, preview } = await loadFixtureThroughPhase4(fixture, paperSize);
  if (!preview.validation.passed) {
    checkTrue(`${fixture}/${paperSize}: Phase 4 HTML validation passed (precondition)`, false);
    return;
  }

  const bytes = await renderProfessionalAtsPdf(assembly, preview.plan, paperSize, preview.plan.density);
  const pdfPages = await extractPdfPageText(bytes);
  const text = validatePdfTextPreservation(assembly, preview.plan, pdfPages);

  check(`${fixture}/${paperSize}: missingFragments empty`, text.missingFragments, []);
  check(`${fixture}/${paperSize}: inventedFragments empty`, text.inventedFragments, []);
  check(`${fixture}/${paperSize}: duplicateEntryIds empty`, text.duplicateEntryIds, []);
  check(`${fixture}/${paperSize}: foundFragmentCount equals expectedFragmentCount`, text.foundFragmentCount, text.expectedFragmentCount);
  checkTrue(`${fixture}/${paperSize}: expectedFragmentCount > 0`, text.expectedFragmentCount > 0);
}

async function main() {
  await testFixture("standard-pdf-resume.pdf", "letter");
  await testFixture("threepage-pdf-resume.pdf", "letter");
  await testFixture("regtest3-two-column-pdf.pdf", "a4");
  await testFixture("generated-sidebar-professional.pdf", "letter");
  await testFixture("generated-table-resume.pdf", "a4");
  await testFixture("lossless-synthetic/f6-docx-table-skills.docx", "letter");
  await testFixture("regtest1-regulated-nurse-resume.docx", "letter");

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
