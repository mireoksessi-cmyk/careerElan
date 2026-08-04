/*
  TASK 10 - Full Fixture Gate. Runs buildProfessionalAtsAssembly against
  all 22 Phase 1/2 fixtures (16 real + 6 synthetic) and reports a
  fixture-by-fixture pass/fail matrix based on assemblyValidator's own
  report. Run with
  `npx tsx lib/documentPreservation/professionalAtsAssembly/fixtureGate.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "../resumeStructured/buildStructuredResume";
import { buildProfessionalAtsAssembly } from "./buildProfessionalAtsAssembly";

const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");

const FIXTURES: { file: string; format: "pdf" | "docx" }[] = [
  { file: "bench/resume-A-junior-ats.pdf", format: "pdf" },
  { file: "bench/resume-B-junior-canva.pdf", format: "pdf" },
  { file: "bench/resume-C-mid-ats.pdf", format: "pdf" },
  { file: "bench/resume-D-mid-canva.pdf", format: "pdf" },
  { file: "bench/resume-E-senior-ats.pdf", format: "pdf" },
  { file: "bench/resume-F-senior-canva.pdf", format: "pdf" },
  { file: "canva-pdf-resume.pdf", format: "pdf" },
  { file: "generated-sidebar-professional.pdf", format: "pdf" },
  { file: "generated-table-resume.pdf", format: "pdf" },
  { file: "google-docs-resume.docx", format: "docx" },
  { file: "regtest1-regulated-nurse-resume.docx", format: "docx" },
  { file: "regtest3-two-column-pdf.pdf", format: "pdf" },
  { file: "regtest4-repeated-tokens-pdf.pdf", format: "pdf" },
  { file: "standard-pdf-resume.pdf", format: "pdf" },
  { file: "threepage-pdf-resume.pdf", format: "pdf" },
  { file: "word-docx-resume.docx", format: "docx" },
  { file: "lossless-synthetic/f1-career-profile-awards-custom.docx", format: "docx" },
  { file: "lossless-synthetic/f2-work-history-licenses-community.docx", format: "docx" },
  { file: "lossless-synthetic/f3-combined-licenses-certifications.docx", format: "docx" },
  { file: "lossless-synthetic/f4-projects.docx", format: "docx" },
  { file: "lossless-synthetic/f5-no-heading-document.docx", format: "docx" },
  { file: "lossless-synthetic/f6-docx-table-skills.docx", format: "docx" },
];

async function main() {
  const results: { file: string; passed: boolean; detail: string }[] = [];

  for (const { file, format } of FIXTURES) {
    try {
      const buffer = fs.readFileSync(path.join(FIXTURES_DIR, file));
      const layoutResult = await analyzeDocument("resume", format, buffer);
      const document = buildLosslessResumeDocument(layoutResult, { fileName: file, fileType: format });
      const model = buildStructuredResume(document);
      const assembly = buildProfessionalAtsAssembly(model);
      const v = assembly.validation;
      const detail = v.passed
        ? `OK visible=[${assembly.visibleSectionKeys.join(",")}]`
        : `order=${v.orderViolations.length} volPlacement=${v.volunteerPlacementViolations.length} missing=${v.missingEntryIds.length} dup=${v.duplicateEntryIds.length} invalidHidden=${v.invalidHiddenSectionsWithBlocks.length} destructive=${v.destructiveCompactionFlags.length}`;
      results.push({ file, passed: v.passed, detail });
    } catch (error) {
      results.push({ file, passed: false, detail: `CRASHED: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  console.log("\n=== PHASE 3 FULL 22-FIXTURE GATE MATRIX ===");
  let passCount = 0;
  for (const r of results) {
    console.log(`${r.passed ? "PASS" : "FAIL"} ${r.file} - ${r.detail}`);
    if (r.passed) passCount++;
  }
  console.log(`\n--- ${passCount}/${results.length} fixtures passed ---`);

  await closeSharedBrowser();
  if (passCount !== results.length) process.exit(1);
}

main().catch((error) => {
  console.error("Fixture gate run crashed:", error);
  process.exit(1);
});
