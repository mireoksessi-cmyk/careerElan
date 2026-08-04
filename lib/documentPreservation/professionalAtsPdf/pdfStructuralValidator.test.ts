/*
  TASK 5 gate - real PDF structural validation, including the highest-
  risk check: does break-after:page CSS actually produce a PDF page
  count matching Phase 4's own plan.pageCount? Run with
  `npx tsx lib/documentPreservation/professionalAtsPdf/pdfStructuralValidator.test.ts`.
*/
import { closeSharedBrowser } from "../sharedBrowser";
import { loadFixtureThroughPhase4 } from "./testFixtureHelper";
import { renderProfessionalAtsPdf } from "./pdfRenderer";
import { validatePdfStructure, EXPECTED_MEDIABOX_PT } from "./pdfStructuralValidator";

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
  checkTrue(`${fixture}/${paperSize}: Phase 4 HTML validation passed (precondition)`, preview.validation.passed);
  if (!preview.validation.passed) return;

  const bytes = await renderProfessionalAtsPdf(assembly, preview.plan, paperSize, preview.plan.density);
  const structural = await validatePdfStructure(bytes);

  checkTrue(`${fixture}/${paperSize}: valid header`, structural.validHeader);
  checkTrue(`${fixture}/${paperSize}: parseable`, structural.parseable);
  checkTrue(`${fixture}/${paperSize}: not encrypted`, !structural.encrypted);
  checkTrue(`${fixture}/${paperSize}: pageCount >= 1`, structural.pageCount >= 1);
  check(`${fixture}/${paperSize}: PDF pageCount matches Phase 4 plan.pageCount`, structural.pageCount, preview.plan.pageCount);
  check(`${fixture}/${paperSize}: no blank pages`, structural.blankPages, []);

  const expected = EXPECTED_MEDIABOX_PT[paperSize];
  for (const box of structural.mediaBoxes) {
    checkTrue(
      `${fixture}/${paperSize}: page ${box.pageIndex} width close to expected (${box.widthPt.toFixed(2)} vs ${expected.widthPt.toFixed(2)})`,
      Math.abs(box.widthPt - expected.widthPt) < 2
    );
    checkTrue(
      `${fixture}/${paperSize}: page ${box.pageIndex} height close to expected (${box.heightPt.toFixed(2)} vs ${expected.heightPt.toFixed(2)})`,
      Math.abs(box.heightPt - expected.heightPt) < 2
    );
  }
  checkTrue(`${fixture}/${paperSize}: all pages same size`, new Set(structural.mediaBoxes.map((b) => `${b.widthPt}x${b.heightPt}`)).size === 1);
}

async function main() {
  await testFixture("standard-pdf-resume.pdf", "letter");
  await testFixture("standard-pdf-resume.pdf", "a4");
  await testFixture("threepage-pdf-resume.pdf", "letter");
  await testFixture("regtest3-two-column-pdf.pdf", "a4");
  await testFixture("generated-sidebar-professional.pdf", "letter");

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
