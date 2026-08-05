/*
  TASK 6 gate - real DOCX text preservation. Run with
  `npx tsx lib/documentPreservation/professionalAtsDocx/docxTextPreservationValidator.test.ts`.
*/
import { Packer } from "docx";
import { loadFixtureAssembly } from "./testFixtureHelper";
import { buildProfessionalAtsDocxDocument } from "./docxRenderer";
import { extractDocxText } from "./docxTextExtraction";
import { validateDocxTextPreservation } from "./docxTextPreservationValidator";
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
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

async function testFixture(fixture: string, paperSize: PaperSize) {
  const assembly = await loadFixtureAssembly(fixture);
  const { document } = buildProfessionalAtsDocxDocument(assembly, paperSize, "comfortable");
  const buffer = await Packer.toBuffer(document);
  const text = await extractDocxText(new Uint8Array(buffer));
  const result = validateDocxTextPreservation(assembly, text);

  check(`${fixture}/${paperSize}: missingFragments empty`, result.missingFragments, []);
  check(`${fixture}/${paperSize}: inventedFragments empty`, result.inventedFragments, []);
  check(`${fixture}/${paperSize}: duplicateEntryIds empty`, result.duplicateEntryIds, []);
  check(`${fixture}/${paperSize}: foundFragmentCount equals expectedFragmentCount`, result.foundFragmentCount, result.expectedFragmentCount);
  checkTrue(`${fixture}/${paperSize}: expectedFragmentCount > 0`, result.expectedFragmentCount > 0);
}

async function main() {
  await testFixture("standard-pdf-resume.pdf", "letter");
  await testFixture("threepage-pdf-resume.pdf", "letter");
  await testFixture("regtest3-two-column-pdf.pdf", "a4");
  await testFixture("generated-sidebar-professional.pdf", "letter");
  await testFixture("generated-table-resume.pdf", "a4");
  await testFixture("lossless-synthetic/f6-docx-table-skills.docx", "letter");
  await testFixture("regtest1-regulated-nurse-resume.docx", "letter");

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
