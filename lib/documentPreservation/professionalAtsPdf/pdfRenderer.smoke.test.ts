/*
  TASK 4 smoke test - the FIRST real page.pdf() call in this codebase.
  Minimal byte-level checks only (no pdfjs-dist parsing yet - that's
  TASK 5's pdfStructuralValidator.ts). Run with
  `npx tsx lib/documentPreservation/professionalAtsPdf/pdfRenderer.smoke.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { closeSharedBrowser } from "../sharedBrowser";
import { loadFixtureThroughPhase4 } from "./testFixtureHelper";
import { renderProfessionalAtsPdf } from "./pdfRenderer";

let pass = 0;
let fail = 0;
function checkTrue(label: string, actual: boolean) {
  console.log(actual ? "PASS" : "FAIL", label);
  if (actual) pass++;
  else fail++;
}

async function main() {
  const { assembly, preview } = await loadFixtureThroughPhase4("standard-pdf-resume.pdf", "letter");
  checkTrue("fixture's Phase 4 HTML validation passed (precondition)", preview.validation.passed);

  const bytes = await renderProfessionalAtsPdf(assembly, preview.plan, "letter", preview.plan.density);

  checkTrue("PDF bytes non-empty", bytes.byteLength > 0);
  const header = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  checkTrue(`PDF magic header present (got "${header}")`, header === "%PDF-");

  const outPath = path.resolve(__dirname, "../../../fixtures/scripts/.scratch-smoke.pdf");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, bytes);
  checkTrue("PDF written to disk for manual inspection", fs.existsSync(outPath));
  console.log(`Wrote ${bytes.byteLength} bytes to ${outPath}`);
  fs.rmSync(outPath, { force: true });

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
