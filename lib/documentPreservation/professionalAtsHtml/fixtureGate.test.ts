/*
  TASK 10 - Full 22-fixture gate. Runs the complete Phase 1 -> 2 -> 3 ->
  Phase 4 HTML preview pipeline (buildProfessionalAtsHtmlPreview) for
  every real fixture at Letter, plus A4 for the larger/most-structurally-
  complex subset (mirrors Phase 3's own fixtureGate.test.ts convention:
  Letter for all 22, A4 for at least the major/most-complex ones). Run
  with `npx tsx lib/documentPreservation/professionalAtsHtml/fixtureGate.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "../resumeStructured/buildStructuredResume";
import { buildProfessionalAtsAssembly } from "../professionalAtsAssembly/buildProfessionalAtsAssembly";
import { buildProfessionalAtsHtmlPreview } from "./buildProfessionalAtsHtmlPreview";
import type { PaperSize } from "./types";

let pass = 0;
let fail = 0;

function checkTrue(label: string, actual: boolean, detail?: unknown) {
  const ok = actual === true;
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `detail=${JSON.stringify(detail)}`);
  if (ok) pass++;
  else fail++;
}

const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");

const ALL_22_FIXTURES: { file: string; format: "pdf" | "docx" }[] = [
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
  { file: "lossless-synthetic/f1-career-profile-awards-custom.docx", format: "docx" },
  { file: "lossless-synthetic/f2-work-history-licenses-community.docx", format: "docx" },
  { file: "lossless-synthetic/f3-combined-licenses-certifications.docx", format: "docx" },
  { file: "lossless-synthetic/f4-projects.docx", format: "docx" },
  { file: "lossless-synthetic/f5-no-heading-document.docx", format: "docx" },
  { file: "lossless-synthetic/f6-docx-table-skills.docx", format: "docx" },
  { file: "regtest1-regulated-nurse-resume.docx", format: "docx" },
  { file: "regtest3-two-column-pdf.pdf", format: "pdf" },
  { file: "regtest4-repeated-tokens-pdf.pdf", format: "pdf" },
  { file: "standard-pdf-resume.pdf", format: "pdf" },
  { file: "threepage-pdf-resume.pdf", format: "pdf" },
  { file: "word-docx-resume.docx", format: "docx" },
];

// Larger/most-structurally-complex subset also verified at A4.
const A4_SUBSET = new Set([
  "threepage-pdf-resume.pdf",
  "bench/resume-B-junior-canva.pdf",
  "regtest3-two-column-pdf.pdf",
  "generated-sidebar-professional.pdf",
  "generated-table-resume.pdf",
  "lossless-synthetic/f1-career-profile-awards-custom.docx",
]);

async function runOne(file: string, format: "pdf" | "docx", paperSize: PaperSize) {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, file));
  const layoutResult = await analyzeDocument("resume", format, buffer);
  const document = buildLosslessResumeDocument(layoutResult, { fileName: file, fileType: format });
  const model = buildStructuredResume(document);
  const assembly = buildProfessionalAtsAssembly(model);
  const preview = await buildProfessionalAtsHtmlPreview(assembly, paperSize);

  checkTrue(`${file}/${paperSize}: validation passed`, preview.validation.passed, preview.validation);
  checkTrue(`${file}/${paperSize}: measurement measurable`, preview.measurement.measurable);
  checkTrue(`${file}/${paperSize}: pageCount >= 1`, preview.plan.pageCount >= 1);
  console.log(`  [${file}/${paperSize}] density=${preview.plan.density} pages=${preview.plan.pageCount}`);
}

async function main() {
  for (const { file, format } of ALL_22_FIXTURES) {
    await runOne(file, format, "letter");
  }
  for (const { file, format } of ALL_22_FIXTURES) {
    if (A4_SUBSET.has(file)) await runOne(file, format, "a4");
  }

  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
