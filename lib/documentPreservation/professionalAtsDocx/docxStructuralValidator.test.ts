/*
  TASK 5 gate - real DOCX structural validation. Run with
  `npx tsx lib/documentPreservation/professionalAtsDocx/docxStructuralValidator.test.ts`.
*/
import { Packer } from "docx";
import { loadFixtureAssembly } from "./testFixtureHelper";
import { buildProfessionalAtsDocxDocument } from "./docxRenderer";
import { validateDocxStructure } from "./docxStructuralValidator";
import { PAGE_SIZE_TWIPS } from "./designTokens";
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
  const structural = await validateDocxStructure(new Uint8Array(buffer));

  checkTrue(`${fixture}/${paperSize}: validZipHeader`, structural.validZipHeader);
  checkTrue(`${fixture}/${paperSize}: parseableZip`, structural.parseableZip);
  checkTrue(`${fixture}/${paperSize}: requiredPartsPresent`, structural.requiredPartsPresent, structural.missingParts);
  checkTrue(`${fixture}/${paperSize}: parseableXml`, structural.parseableXml);
  checkTrue(`${fixture}/${paperSize}: macroFree`, structural.macroFree);
  checkTrue(`${fixture}/${paperSize}: not encrypted`, !structural.encrypted);
  check(`${fixture}/${paperSize}: no external relationships`, structural.externalRelationships, []);
  check(`${fixture}/${paperSize}: pageSize matches ${paperSize}`, structural.pageSize.widthTwips, PAGE_SIZE_TWIPS[paperSize].widthTwips);
  check(`${fixture}/${paperSize}: pageSize height matches ${paperSize}`, structural.pageSize.heightTwips, PAGE_SIZE_TWIPS[paperSize].heightTwips);
  check(`${fixture}/${paperSize}: orientation portrait`, structural.pageSize.orientation, "portrait");
}

async function main() {
  await testFixture("standard-pdf-resume.pdf", "letter");
  await testFixture("standard-pdf-resume.pdf", "a4");
  await testFixture("threepage-pdf-resume.pdf", "letter");
  await testFixture("regtest3-two-column-pdf.pdf", "a4");
  await testFixture("generated-sidebar-professional.pdf", "letter");
  await testFixture("lossless-synthetic/f6-docx-table-skills.docx", "letter");
  await testFixture("regtest1-regulated-nurse-resume.docx", "a4");

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
