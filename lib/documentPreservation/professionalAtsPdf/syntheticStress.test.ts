/*
  TASK 11 - Synthetic stress gate. Reuses Phase 4's own
  ALL_SYNTHETIC_SCENARIOS (long single entry, long skill group,
  volunteer-only, all-eleven-sections, custom-section-only, many short
  entries) verbatim - same synthetic assemblies Phase 4 already
  validated, run one level further through PDF generation. Run with
  `npx tsx lib/documentPreservation/professionalAtsPdf/syntheticStress.test.ts`.
*/
import { closeSharedBrowser } from "../sharedBrowser";
import { buildProfessionalAtsHtmlPreview } from "../professionalAtsHtml/buildProfessionalAtsHtmlPreview";
import { buildProfessionalAtsPdf } from "./buildProfessionalAtsPdf";
import { buildPdfFileName } from "./fileName";
import { ALL_SYNTHETIC_SCENARIOS } from "../professionalAtsHtml/syntheticScenarios";
import type { PaperSize } from "../professionalAtsHtml/types";

let pass = 0;
let fail = 0;
function checkTrue(label: string, actual: boolean, detail?: unknown) {
  const ok = actual === true;
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `detail=${JSON.stringify(detail)}`);
  if (ok) pass++;
  else fail++;
}

async function runScenario(name: string, build: () => ReturnType<typeof ALL_SYNTHETIC_SCENARIOS[number]["build"]>, paperSize: PaperSize) {
  const assembly = build();
  const htmlPreview = await buildProfessionalAtsHtmlPreview(assembly, paperSize);
  checkTrue(`${name}/${paperSize}: Phase 4 HTML validation passed (precondition)`, htmlPreview.validation.passed, htmlPreview.validation);
  if (!htmlPreview.validation.passed) return;

  const result = await buildProfessionalAtsPdf(assembly, paperSize);
  checkTrue(`${name}/${paperSize}: PDF validation passed`, result.validation.passed, result.validation);
  checkTrue(`${name}/${paperSize}: pageCount >= 1`, result.pageCount >= 1);
  checkTrue(`${name}/${paperSize}: no missing text`, result.validation.text.missingFragments.length === 0, result.validation.text.missingFragments);
  checkTrue(`${name}/${paperSize}: no invented text`, result.validation.text.inventedFragments.length === 0, result.validation.text.inventedFragments);
  checkTrue(`${name}/${paperSize}: no blank pages`, result.validation.structural.blankPages.length === 0);
  checkTrue(`${name}/${paperSize}: page count parity`, result.validation.parity.htmlPageCount === result.validation.parity.pdfPageCount);
  console.log(`  [${name}/${paperSize}] density=${result.density} pages=${result.pageCount}`);
}

async function main() {
  for (const scenario of ALL_SYNTHETIC_SCENARIOS) {
    await runScenario(scenario.name, scenario.build, "letter");
  }

  /* Ultra-compact / orphan-risk stress: veryLongSingleEntry and
     manyShortEntries are the two scenarios Phase 4's own test suite
     confirms force multi-page splits - re-verify at A4 too, the paper
     size most likely to reveal density-fallback edge cases (smaller
     usable content height than Letter). */
  await runScenario("veryLongSingleEntry", ALL_SYNTHETIC_SCENARIOS.find((s) => s.name === "very-long-single-entry")!.build, "a4");
  await runScenario("manyShortEntries", ALL_SYNTHETIC_SCENARIOS.find((s) => s.name === "many-short-entries")!.build, "a4");

  /* Applicant-name-missing fallback filename: customSectionOnly has no
     experience/identity-heavy content but still an identity block -
     directly exercise the pure filename helper's fallback path (full
     scenario coverage of "empty name -> resume_..." already lives in
     fileName.test.ts; this just confirms the orchestrator's real
     fileName field is well-formed for every synthetic scenario, not
     just the happy path). */
  for (const scenario of ALL_SYNTHETIC_SCENARIOS) {
    const assembly = scenario.build();
    const htmlPreview = await buildProfessionalAtsHtmlPreview(assembly, "letter");
    if (!htmlPreview.validation.passed) continue;
    const result = await buildProfessionalAtsPdf(assembly, "letter");
    checkTrue(`${scenario.name}: fileName ends with .pdf`, result.fileName.endsWith(".pdf"));
    checkTrue(`${scenario.name}: fileName has no path separators`, !result.fileName.includes("/") && !result.fileName.includes("\\"));
  }
  checkTrue("fallback filename helper (empty name) still produces valid .pdf name", buildPdfFileName(null, "letter", "professional-ats-v1").endsWith(".pdf"));

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
