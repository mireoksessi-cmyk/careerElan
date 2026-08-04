/*
  Orchestrator gate test - full ProfessionalAtsHtmlPreviewDocument
  contract against real fixtures. Run with
  `npx tsx lib/documentPreservation/professionalAtsHtml/buildProfessionalAtsHtmlPreview.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "../resumeStructured/buildStructuredResume";
import { buildProfessionalAtsAssembly } from "../professionalAtsAssembly/buildProfessionalAtsAssembly";
import { buildProfessionalAtsHtmlPreview } from "./buildProfessionalAtsHtmlPreview";
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

  const preview = await buildProfessionalAtsHtmlPreview(assembly, "letter");

  check("schemaVersion is 1.0.0", preview.schemaVersion, "1.0.0");
  check("templateId is professional-ats-v1", preview.templateId, "professional-ats-v1");
  check("sourceModelVersion matches assembly.schemaVersion", preview.sourceModelVersion, assembly.schemaVersion);
  check("paperSize is letter", preview.paperSize, "letter");
  checkTrue("densityFallbackHistory covers all 4 densities", JSON.stringify(preview.densityFallbackHistory) === JSON.stringify(DENSITY_ESCALATION_ORDER));
  checkTrue("plan.pageCount >= 1", preview.plan.pageCount >= 1);
  checkTrue("measurement is measurable", preview.measurement.measurable);
  check("measurement.pages length matches plan.pageCount", preview.measurement.pages.length, preview.plan.pageCount);
  checkTrue("validation passed", preview.validation.passed);
  check("validation.densityUsed matches plan.density", preview.validation.densityUsed, preview.plan.density);

  // A4 should also produce a fully valid preview document.
  const previewA4 = await buildProfessionalAtsHtmlPreview(assembly, "a4");
  check("A4: paperSize is a4", previewA4.paperSize, "a4");
  checkTrue("A4: validation passed", previewA4.validation.passed);

  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
