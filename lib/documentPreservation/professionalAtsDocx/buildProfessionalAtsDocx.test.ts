/*
  Orchestrator gate test. Run with
  `npx tsx lib/documentPreservation/professionalAtsDocx/buildProfessionalAtsDocx.test.ts`.
*/
import { loadFixtureAssembly } from "./testFixtureHelper";
import { buildProfessionalAtsDocx } from "./buildProfessionalAtsDocx";
import { closeSharedBrowser } from "../sharedBrowser";
import type { AssemblyDensity } from "../professionalAtsAssembly/types";

let pass = 0;
let fail = 0;
function checkTrue(label: string, actual: boolean, detail?: unknown) {
  const ok = actual === true;
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `detail=${JSON.stringify(detail)}`);
  if (ok) pass++;
  else fail++;
}
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

async function main() {
  const assembly = await loadFixtureAssembly("standard-pdf-resume.pdf");
  const result = await buildProfessionalAtsDocx(assembly, "letter", "comfortable");

  check("templateId", result.templateId, "professional-ats-v1");
  check("paperSize", result.paperSize, "letter");
  check("density", result.density, "comfortable");
  checkTrue("fileName ends with .docx", result.fileName.endsWith(".docx"));
  checkTrue("byteLength matches bytes.length", result.byteLength === result.bytes.byteLength);
  checkTrue("byteLength > 0", result.byteLength > 0);
  checkTrue("sha256 is 64 hex chars", /^[0-9a-f]{64}$/.test(result.sha256));
  checkTrue("structure.paragraphCount > 0", result.structure.paragraphCount > 0);
  checkTrue("structure.sectionCount > 0", result.structure.sectionCount > 0);
  checkTrue("sourceMapping non-empty", result.sourceMapping.length > 0);
  checkTrue("validation.passed", result.validation.passed, result.validation);
  check("validation.parity.sourceCoveragePercent is 100", result.validation.parity.sourceCoveragePercent, 100);

  const secondRun = await buildProfessionalAtsDocx(assembly, "letter", "comfortable");
  check("determinism: structure identical across runs", secondRun.structure, result.structure);
  check("determinism: text validation identical across runs", secondRun.validation.text, result.validation.text);
  check("determinism: fileName identical across runs", secondRun.fileName, result.fileName);
  checkTrue("bytes are NOT expected to be byte-identical (docx package timestamps) - documented, not asserted equal", true);

  /* All 4 densities work end-to-end (spec test item 43). */
  const densities: AssemblyDensity[] = ["comfortable", "balanced", "compact", "ultra-compact"];
  for (const density of densities) {
    const r = await buildProfessionalAtsDocx(assembly, "a4", density);
    checkTrue(`density=${density}/a4: validation.passed`, r.validation.passed, r.validation);
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
