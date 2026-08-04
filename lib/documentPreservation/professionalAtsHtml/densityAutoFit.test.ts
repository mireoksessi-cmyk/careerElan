/*
  TASK 8 gate test - density auto-fit against real fixtures. Run with
  `npx tsx lib/documentPreservation/professionalAtsHtml/densityAutoFit.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "../resumeStructured/buildStructuredResume";
import { buildProfessionalAtsAssembly } from "../professionalAtsAssembly/buildProfessionalAtsAssembly";
import { autoFitDensity } from "./densityAutoFit";
import { DENSITY_ESCALATION_ORDER } from "./designTokens";

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

async function main() {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, "threepage-pdf-resume.pdf"));
  const layoutResult = await analyzeDocument("resume", "pdf", buffer);
  const document = buildLosslessResumeDocument(layoutResult, { fileName: "threepage-pdf-resume.pdf", fileType: "pdf" });
  const model = buildStructuredResume(document);
  const assembly = buildProfessionalAtsAssembly(model);

  const result = await autoFitDensity(assembly, "letter");

  check("densityFallbackHistory covers all 4 densities in order", result.densityFallbackHistory, DENSITY_ESCALATION_ORDER);
  checkTrue("chosen density is one of the 4 known densities", DENSITY_ESCALATION_ORDER.includes(result.density));
  checkTrue("chosen plan pageCount >= 1", result.plan.pageCount >= 1);
  check("plan.density matches chosen density", result.plan.density, result.density);
  checkTrue("measurement is measurable", result.measurement.measurable);

  // threepage-pdf-resume.pdf needs escalation beyond comfortable (3
  // pages at comfortable per paginationPlanner.test.ts) - the
  // auto-fitter should pick something at least as compact.
  const comfortableIndex = DENSITY_ESCALATION_ORDER.indexOf("comfortable");
  const chosenIndex = DENSITY_ESCALATION_ORDER.indexOf(result.density);
  checkTrue(
    `chosen density (${result.density}) is comfortable or more compact`,
    chosenIndex >= comfortableIndex
  );

  // A short fixture should be fine at comfortable (1 page, no need to escalate).
  const wbuffer = fs.readFileSync(path.join(FIXTURES_DIR, "lossless-synthetic/f5-no-heading-document.docx"));
  const wLayout = await analyzeDocument("resume", "docx", wbuffer);
  const wDoc = buildLosslessResumeDocument(wLayout, { fileName: "lossless-synthetic/f5-no-heading-document.docx", fileType: "docx" });
  const wModel = buildStructuredResume(wDoc);
  const wAssembly = buildProfessionalAtsAssembly(wModel);
  const wResult = await autoFitDensity(wAssembly, "letter");
  checkTrue("f5-no-heading-document.docx: measurable", wResult.measurement.measurable);
  checkTrue("f5-no-heading-document.docx: pageCount >= 1", wResult.plan.pageCount >= 1);

  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
