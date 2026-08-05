/*
  TASK 10 - Full Fixture Gate. Runs Phase 2's buildStructuredResume
  against all Phase 1 fixtures (16 real + 16 synthetic, 32 total as of
  Phase 5D.2B's f8-f11 metric-grid additions) and reports a
  fixture-by-fixture pass/fail matrix based on structuredValidator's own
  report - the same gate
  buildStructuredResume.test.ts already applies to a 9-fixture subset,
  extended here to every fixture in fixtures/resumes/ so no fixture
  escapes the gate purely because it wasn't picked for TASK 7's earlier,
  narrower test. Run with
  `npx tsx lib/documentPreservation/resumeStructured/fullFixtureGate.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "./buildStructuredResume";

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
  { file: "lossless-synthetic/f7-embedded-education-certifications.pdf", format: "pdf" },
  { file: "lossless-synthetic/f7-embedded-education-certifications.docx", format: "docx" },
  { file: "lossless-synthetic/f8-metric-grid-4col-kpi.pdf", format: "pdf" },
  { file: "lossless-synthetic/f8-metric-grid-4col-kpi.docx", format: "docx" },
  { file: "lossless-synthetic/f9-metric-cards-2col.pdf", format: "pdf" },
  { file: "lossless-synthetic/f9-metric-cards-2col.docx", format: "docx" },
  { file: "lossless-synthetic/f10-metric-cards-3col.pdf", format: "pdf" },
  { file: "lossless-synthetic/f10-metric-cards-3col.docx", format: "docx" },
  { file: "lossless-synthetic/f11-metric-score-panel-stacked.pdf", format: "pdf" },
  { file: "lossless-synthetic/f11-metric-score-panel-stacked.docx", format: "docx" },
];

async function main() {
  const results: { file: string; passed: boolean; detail: string }[] = [];

  for (const { file, format } of FIXTURES) {
    try {
      const buffer = fs.readFileSync(path.join(FIXTURES_DIR, file));
      const layoutResult = await analyzeDocument("resume", format, buffer);
      const document = buildLosslessResumeDocument(layoutResult, { fileName: file, fileType: format });
      const model = buildStructuredResume(document);
      const v = model.validation;
      const detail = v.passed
        ? "OK"
        : `missing=${v.missingBlockIds.length} dup=${v.duplicateBlockIds.length} invented=${v.inventedFactValues.length} volMixed=${v.volunteerMixedIntoProfessional.length} missingCustom=${v.missingCustomSections.length} missingSection=${v.missingSectionIds.length}`;
      results.push({ file, passed: v.passed, detail });
    } catch (error) {
      results.push({ file, passed: false, detail: `CRASHED: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  console.log("\n=== FULL 22-FIXTURE GATE MATRIX ===");
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
  console.error("Full fixture gate run crashed:", error);
  process.exit(1);
});
