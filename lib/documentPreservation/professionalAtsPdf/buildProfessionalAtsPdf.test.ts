/*
  Orchestrator gate test. Run with
  `npx tsx lib/documentPreservation/professionalAtsPdf/buildProfessionalAtsPdf.test.ts`.
*/
import { closeSharedBrowser } from "../sharedBrowser";
import { loadFixtureThroughPhase4 } from "./testFixtureHelper";
import { buildProfessionalAtsPdf } from "./buildProfessionalAtsPdf";

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

async function main() {
  const { assembly } = await loadFixtureThroughPhase4("standard-pdf-resume.pdf", "letter");
  const result = await buildProfessionalAtsPdf(assembly, "letter");

  check("templateId", result.templateId, "professional-ats-v1");
  check("paperSize", result.paperSize, "letter");
  checkTrue("density is one of the 4 valid densities", ["comfortable", "balanced", "compact", "ultra-compact"].includes(result.density));
  checkTrue("fileName ends with .pdf", result.fileName.endsWith(".pdf"));
  checkTrue("byteLength matches bytes.length", result.byteLength === result.bytes.byteLength);
  checkTrue("byteLength > 0", result.byteLength > 0);
  checkTrue("sha256 is 64 hex chars", /^[0-9a-f]{64}$/.test(result.sha256));
  checkTrue("pageCount >= 1", result.pageCount >= 1);
  checkTrue("sourcePagePlan has pageCount entries", result.sourcePagePlan.length === result.pageCount);
  checkTrue("validation.passed", result.validation.passed);
  check("validation.structural.pageCount matches top-level pageCount", result.validation.structural.pageCount, result.pageCount);
  check("validation.parity.htmlPageCount equals pdfPageCount", result.validation.parity.htmlPageCount, result.validation.parity.pdfPageCount);
  check("validation.parity.sourceCoveragePercent is 100", result.validation.parity.sourceCoveragePercent, 100);

  const secondRun = await buildProfessionalAtsPdf(assembly, "letter");
  check("determinism: pageCount identical across runs", secondRun.pageCount, result.pageCount);
  check("determinism: extracted text validation identical across runs", secondRun.validation.text, result.validation.text);
  check("determinism: fileName identical across runs", secondRun.fileName, result.fileName);
  checkTrue("bytes are NOT expected to be byte-identical (Chromium timestamps) - documented, not asserted equal", true);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
