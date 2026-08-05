/*
  TASK 9/10 - Full 22-fixture Letter gate + 9-fixture A4 gate. Same 22
  fixtures and same A4 subset as Phase 4/5A's own fixtureGate.test.ts,
  so Phase 5B's coverage is a strict superset on the same fixture
  universe, never a different one. Density fixed at "comfortable" for
  the fixture gate (per this phase's own design decision - Phase 5B
  does not depend on Phase 4's auto-fit density selection; all 4
  densities are separately exercised end-to-end in
  buildProfessionalAtsDocx.test.ts and syntheticStress.test.ts). Run
  with `npx tsx lib/documentPreservation/professionalAtsDocx/fixtureGate.test.ts`.
*/
import { loadFixtureAssembly } from "./testFixtureHelper";
import { buildProfessionalAtsDocx } from "./buildProfessionalAtsDocx";
import { closeSharedBrowser } from "../sharedBrowser";
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
  const assembly = await loadFixtureAssembly(fixture);
  const result = await buildProfessionalAtsDocx(assembly, paperSize, "comfortable");

  checkTrue(`${fixture}/${paperSize}: validation passed`, result.validation.passed, result.validation);
  checkTrue(`${fixture}/${paperSize}: structural valid`, result.validation.structural.validZipHeader && result.validation.structural.parseableZip);
  checkTrue(`${fixture}/${paperSize}: no missing text fragments`, result.validation.text.missingFragments.length === 0, result.validation.text.missingFragments);
  checkTrue(`${fixture}/${paperSize}: no invented text fragments`, result.validation.text.inventedFragments.length === 0, result.validation.text.inventedFragments);
  checkTrue(`${fixture}/${paperSize}: same section order`, result.validation.parity.sameSectionOrder);
  checkTrue(`${fixture}/${paperSize}: same entry order`, result.validation.parity.sameEntryOrder);
  checkTrue(`${fixture}/${paperSize}: 100% source coverage`, result.validation.parity.sourceCoveragePercent === 100);
  console.log(`  [${fixture}/${paperSize}] paragraphs=${result.structure.paragraphCount} bullets=${result.structure.bulletCount} bytes=${result.byteLength}`);
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
