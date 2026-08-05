/*
  TASK 9/10 - Full 22-fixture Letter gate + 9-fixture A4 gate. Same 22
  fixtures and same A4 subset as Phase 4/5A/5B's own fixtureGate.test.ts,
  so Phase 5C's coverage is a strict superset on the same fixture
  universe, never a different one. Each fixture is run through the full
  Assembly -> HTML -> PDF -> DOCX -> CrossFormatParityReport pipeline
  once (buildProfessionalAtsParity resolves density itself, matching
  buildProfessionalAtsParity.ts's own density-parity-by-construction
  design - no explicit density parameter here). Run with
  `npx tsx lib/documentPreservation/professionalAtsParity/fixtureGate.test.ts`.
*/
import { loadFixtureAssembly } from "./testFixtureHelper";
import { buildProfessionalAtsParity } from "./buildProfessionalAtsParity";
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
  const { report, htmlPageCount, pdfPageCount } = await buildProfessionalAtsParity(assembly, paperSize);

  checkTrue(`${fixture}/${paperSize}: overall report passed`, report.passed, report);
  checkTrue(`${fixture}/${paperSize}: html format passed`, report.formats.html.passed, report.formats.html);
  checkTrue(`${fixture}/${paperSize}: pdf format passed`, report.formats.pdf.passed, report.formats.pdf);
  checkTrue(`${fixture}/${paperSize}: docx format passed`, report.formats.docx.passed, report.formats.docx);
  checkTrue(`${fixture}/${paperSize}: 100% manifest source coverage`, report.manifest.sourceCoveragePercent === 100, report.manifest);
  checkTrue(`${fixture}/${paperSize}: html vs pdf same visible sections/order`, report.pairwise.htmlVsPdf.sameVisibleSections && report.pairwise.htmlVsPdf.sameSectionOrder && report.pairwise.htmlVsPdf.sameEntryOrder, report.pairwise.htmlVsPdf);
  checkTrue(`${fixture}/${paperSize}: html vs docx same visible sections/order`, report.pairwise.htmlVsDocx.sameVisibleSections && report.pairwise.htmlVsDocx.sameSectionOrder && report.pairwise.htmlVsDocx.sameEntryOrder, report.pairwise.htmlVsDocx);
  checkTrue(`${fixture}/${paperSize}: pdf vs docx same visible sections/order`, report.pairwise.pdfVsDocx.sameVisibleSections && report.pairwise.pdfVsDocx.sameSectionOrder && report.pairwise.pdfVsDocx.sameEntryOrder, report.pairwise.pdfVsDocx);
  checkTrue(`${fixture}/${paperSize}: same paper size/density across formats`, report.layoutPolicy.samePaperSize && report.layoutPolicy.sameDensity, report.layoutPolicy);
  checkTrue(`${fixture}/${paperSize}: html/pdf page count parity`, report.layoutPolicy.htmlPdfPageParity, { htmlPageCount, pdfPageCount });
  console.log(`  [${fixture}/${paperSize}] fragments=${report.manifest.fragmentCount} sections=${report.manifest.sectionCount} entries=${report.manifest.entryCount} htmlPages=${htmlPageCount} pdfPages=${pdfPageCount}`);
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
