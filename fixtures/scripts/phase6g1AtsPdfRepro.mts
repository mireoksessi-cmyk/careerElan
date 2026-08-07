/*
  Phase 6G.1 Part A - reproduces the professional-ats canonical PDF
  content-preservation failure using REAL resume files run through the
  REAL parsing pipeline (analyzeDocument -> buildLosslessResumeDocument
  -> buildStructuredResume), not buildFixtureRuntime()'s synthetic
  shortcut. Uses the repo's own PII-free "bench" resume fixtures
  (fixtures/resumes/bench/*.pdf - already the established convention
  for "realistic, non-synthetic" content in this repo), not the
  operator's personal Desktop files.

  For each resume, calls buildProfessionalAtsHtmlPreview directly (the
  actual Phase 4 validator that buildProfessionalAtsPdf gates on) and
  prints the FULL, untruncated validation report - no PII in the
  fragments themselves since these are synthetic bench fixtures.

  Run: npx tsx fixtures/scripts/phase6g1AtsPdfRepro.mts
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeSharedBrowser } from "../../lib/documentPreservation/sharedBrowser";
import { buildProfessionalAtsHtmlPreview } from "../../lib/documentPreservation/professionalAtsHtml/buildProfessionalAtsHtmlPreview";
import { buildProfessionalAtsAssembly } from "../../lib/documentPreservation/professionalAtsAssembly/buildProfessionalAtsAssembly";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const RESUMES = [
  "resume-A-junior-ats.pdf",
  "resume-B-junior-canva.pdf",
  "resume-C-mid-ats.pdf",
  "resume-D-mid-canva.pdf",
  "resume-E-senior-ats.pdf",
  "resume-F-senior-canva.pdf",
];

async function main() {
  const { analyzeDocument } = await import("../../lib/documentPreservation/layoutAnalysis");
  const { buildLosslessResumeDocument } = await import("../../lib/documentPreservation/losslessSemantic/buildLosslessDocument");
  const { buildStructuredResume } = await import("../../lib/documentPreservation/resumeStructured/buildStructuredResume");

  for (const fileName of RESUMES) {
    const filePath = path.join(REPO_ROOT, "fixtures", "resumes", "bench", fileName);
    console.log(`\n=== ${fileName} ===`);
    if (!fs.existsSync(filePath)) {
      console.log("SKIP: file not found.");
      continue;
    }
    const buffer = fs.readFileSync(filePath);
    const layoutResult = await analyzeDocument("resume", "pdf", buffer);
    const document = buildLosslessResumeDocument(layoutResult, { fileName, fileType: "pdf" });
    const model = buildStructuredResume(document);
    console.log(`Parsed: experience=${model.professionalExperience.length}, education=${model.education.length}, structuredValidation.passed=${model.validation.passed}`);

    const assembly = buildProfessionalAtsAssembly(model);

    for (const paperSize of ["letter", "a4"] as const) {
      const preview = await buildProfessionalAtsHtmlPreview(assembly, paperSize);
      console.log(`  [${paperSize}] densityUsed=${preview.validation.densityUsed} pageCount=${preview.plan.pageCount} validation.passed=${preview.validation.passed}`);
      if (!preview.validation.passed) {
        console.log(`  [${paperSize}] FULL VALIDATION REPORT:`);
        console.log(JSON.stringify(preview.validation, null, 2));
      }
    }
  }

  await closeSharedBrowser();
}
main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
