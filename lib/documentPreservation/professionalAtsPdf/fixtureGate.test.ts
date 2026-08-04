/*
  TASK 9/10 - Full 22-fixture Letter gate + 9-fixture A4 gate. Mirrors
  Phase 4's own fixtureGate.test.ts fixture list exactly (same 22
  files) so Phase 5A's coverage is a strict superset check on top of
  an already-passing Phase 4 gate, never a different fixture universe.
  Run with `npx tsx lib/documentPreservation/professionalAtsPdf/fixtureGate.test.ts`.
*/
import { closeSharedBrowser } from "../sharedBrowser";
import { loadFixtureThroughPhase4 } from "./testFixtureHelper";
import { buildProfessionalAtsPdf } from "./buildProfessionalAtsPdf";
import type { PaperSize } from "../professionalAtsHtml/types";

let pass = 0;
let fail = 0;
function checkTrue(label: string, actual: boolean, detail?: unknown) {
  const ok = actual === true;
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `detail=${JSON.stringify(detail)}`);
  if (ok) pass++;
  else fail++;
}

const ALL_22_FIXTURES: string[] = [
  "bench/resume-A-junior-ats.pdf",
  "bench/resume-B-junior-canva.pdf",
  "bench/resume-C-mid-ats.pdf",
  "bench/resume-D-mid-canva.pdf",
  "bench/resume-E-senior-ats.pdf",
  "bench/resume-F-senior-canva.pdf",
  "canva-pdf-resume.pdf",
  "generated-sidebar-professional.pdf",
  "generated-table-resume.pdf",
  "google-docs-resume.docx",
  "lossless-synthetic/f1-career-profile-awards-custom.docx",
  "lossless-synthetic/f2-work-history-licenses-community.docx",
  "lossless-synthetic/f3-combined-licenses-certifications.docx",
  "lossless-synthetic/f4-projects.docx",
  "lossless-synthetic/f5-no-heading-document.docx",
  "lossless-synthetic/f6-docx-table-skills.docx",
  "regtest1-regulated-nurse-resume.docx",
  "regtest3-two-column-pdf.pdf",
  "regtest4-repeated-tokens-pdf.pdf",
  "standard-pdf-resume.pdf",
  "threepage-pdf-resume.pdf",
  "word-docx-resume.docx",
];

/* 9 major/structurally-complex fixtures for the A4 matrix (spec
   section 16 "최소 9개"), same A4_SUBSET Phase 4 already uses plus 3
   more to reach 9: standard-pdf-resume.pdf (baseline 1-page),
   regtest1-regulated-nurse-resume.docx (certifications-heavy), and
   lossless-synthetic/f4-projects.docx (custom-section-leaning). */
const A4_SUBSET: string[] = [
  "threepage-pdf-resume.pdf",
  "bench/resume-B-junior-canva.pdf",
  "regtest3-two-column-pdf.pdf",
  "generated-sidebar-professional.pdf",
  "generated-table-resume.pdf",
  "lossless-synthetic/f1-career-profile-awards-custom.docx",
  "standard-pdf-resume.pdf",
  "regtest1-regulated-nurse-resume.docx",
  "lossless-synthetic/f4-projects.docx",
];

async function runOne(fixture: string, paperSize: PaperSize) {
  const { assembly, preview } = await loadFixtureThroughPhase4(fixture, paperSize);
  checkTrue(`${fixture}/${paperSize}: Phase 4 HTML validation passed (precondition)`, preview.validation.passed, preview.validation);
  if (!preview.validation.passed) return;

  const result = await buildProfessionalAtsPdf(assembly, paperSize);
  checkTrue(`${fixture}/${paperSize}: PDF validation passed`, result.validation.passed, result.validation);
  checkTrue(`${fixture}/${paperSize}: pageCount >= 1`, result.pageCount >= 1);
  checkTrue(`${fixture}/${paperSize}: no missing text fragments`, result.validation.text.missingFragments.length === 0, result.validation.text.missingFragments);
  checkTrue(`${fixture}/${paperSize}: no invented text fragments`, result.validation.text.inventedFragments.length === 0, result.validation.text.inventedFragments);
  checkTrue(`${fixture}/${paperSize}: no blank pages`, result.validation.structural.blankPages.length === 0, result.validation.structural.blankPages);
  checkTrue(`${fixture}/${paperSize}: HTML/PDF page count parity`, result.validation.parity.htmlPageCount === result.validation.parity.pdfPageCount);
  checkTrue(`${fixture}/${paperSize}: 100% source coverage`, result.validation.parity.sourceCoveragePercent === 100);
  console.log(`  [${fixture}/${paperSize}] density=${result.density} pages=${result.pageCount} bytes=${result.byteLength}`);
}

async function main() {
  for (const fixture of ALL_22_FIXTURES) {
    await runOne(fixture, "letter");
  }
  for (const fixture of A4_SUBSET) {
    await runOne(fixture, "a4");
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
