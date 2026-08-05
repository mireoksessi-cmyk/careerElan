/*
  TASK 11 - Synthetic/multilingual parity stress gate. Reuses Phase 4's
  own ALL_SYNTHETIC_SCENARIOS and Phase 5B's own ALL_MULTILINGUAL_SCENARIOS
  verbatim (same reuse precedent as Phase 5B's own syntheticStress.test.ts),
  run through the full Phase 5C cross-format parity pipeline
  (buildProfessionalAtsParity, not just a single-format builder). Adds
  three Phase-5C-specific short-token-collision scenarios from
  ./parityMultilingualScenarios.ts (repeated short location token,
  repeated year token, same company multiple roles) that directly
  target the class of bug parityMatcher.ts's advancing-cursor design
  was built to prevent. Run with
  `npx tsx lib/documentPreservation/professionalAtsParity/syntheticStress.test.ts`.
*/
import { buildProfessionalAtsParity } from "./buildProfessionalAtsParity";
import { closeSharedBrowser } from "../sharedBrowser";
import { ALL_SYNTHETIC_SCENARIOS } from "../professionalAtsHtml/syntheticScenarios";
import { ALL_MULTILINGUAL_SCENARIOS } from "../professionalAtsDocx/multilingualScenarios";
import { ALL_PARITY_MULTILINGUAL_SCENARIOS } from "./parityMultilingualScenarios";
import type { PaperSize } from "../professionalAtsHtml/types";
import type { ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";

let pass = 0;
let fail = 0;
function checkTrue(label: string, actual: boolean, detail?: unknown) {
  const ok = actual === true;
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `detail=${JSON.stringify(detail)}`);
  if (ok) pass++;
  else fail++;
}

async function runScenario(name: string, build: () => ProfessionalAtsAssemblyDocument, paperSize: PaperSize) {
  const assembly = build();

  /* A thrown exception (e.g. Phase 4's own buildProfessionalAtsPdf
     precondition throw when its HTML validation itself fails for a
     given synthetic shape) is a real finding about upstream behavior,
     not a Phase 5C engine bug - it must be recorded as a failure and
     the run must continue to the remaining scenarios, not abort the
     whole gate. */
  let report;
  try {
    ({ report } = await buildProfessionalAtsParity(assembly, paperSize));
  } catch (err) {
    checkTrue(`${name}/${paperSize}: buildProfessionalAtsParity did not throw`, false, err instanceof Error ? err.message : String(err));
    return;
  }

  checkTrue(`${name}/${paperSize}: overall report passed`, report.passed, report);
  checkTrue(`${name}/${paperSize}: html format passed`, report.formats.html.passed, report.formats.html);
  checkTrue(`${name}/${paperSize}: pdf format passed`, report.formats.pdf.passed, report.formats.pdf);
  checkTrue(`${name}/${paperSize}: docx format passed`, report.formats.docx.passed, report.formats.docx);
  checkTrue(`${name}/${paperSize}: no section order violations (any format)`, [...report.formats.html.sectionOrderViolations, ...report.formats.pdf.sectionOrderViolations, ...report.formats.docx.sectionOrderViolations].length === 0);
  checkTrue(`${name}/${paperSize}: no entry order violations (any format)`, [...report.formats.html.entryOrderViolations, ...report.formats.pdf.entryOrderViolations, ...report.formats.docx.entryOrderViolations].length === 0);
  checkTrue(`${name}/${paperSize}: no duplicate-entry false positives (any format)`, [...report.formats.html.duplicateEntries, ...report.formats.pdf.duplicateEntries, ...report.formats.docx.duplicateEntries].length === 0);
  console.log(`  [${name}/${paperSize}] fragments=${report.manifest.fragmentCount} entries=${report.manifest.entryCount}`);
}

async function main() {
  /* --- Phase 4's baseline synthetic scenarios, reused verbatim --- */
  for (const scenario of ALL_SYNTHETIC_SCENARIOS) {
    await runScenario(scenario.name, scenario.build, "letter");
  }

  /* --- Phase 5B's own multilingual scenarios, reused verbatim --- */
  for (const scenario of ALL_MULTILINGUAL_SCENARIOS) {
    await runScenario(scenario.name, scenario.build, "letter");
  }

  /* --- Phase 5C's own short-token-collision scenarios --- */
  for (const scenario of ALL_PARITY_MULTILINGUAL_SCENARIOS) {
    await runScenario(scenario.name, scenario.build, "letter");
    await runScenario(scenario.name, scenario.build, "a4");
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
