/*
  TASK 4 gate - pure string-splice test, no PDF/browser involved. Run
  with `npx tsx lib/documentPreservation/professionalAtsPdf/printableHtml.test.ts`.
*/
import { closeSharedBrowser } from "../sharedBrowser";
import { loadFixtureThroughPhase4 } from "./testFixtureHelper";
import { buildPrintablePdfHtml } from "./printableHtml";
import { buildPaginatedPageHtml } from "../professionalAtsHtml/paginatedHtmlString";

let pass = 0;
let fail = 0;
function checkTrue(label: string, actual: boolean) {
  console.log(actual ? "PASS" : "FAIL", label);
  if (actual) pass++;
  else fail++;
}

async function main() {
  const { assembly, preview } = await loadFixtureThroughPhase4("standard-pdf-resume.pdf", "letter");
  const baseHtml = await buildPaginatedPageHtml(assembly, preview.plan, "letter", preview.plan.density);
  const printableHtml = await buildPrintablePdfHtml(assembly, preview.plan, "letter", preview.plan.density);

  checkTrue("printable HTML contains print media style block", printableHtml.includes('<style media="print">'));
  checkTrue("printable HTML contains break-after: page rule", printableHtml.includes("break-after: page"));
  checkTrue("printable HTML overrides body background to white for print", printableHtml.includes("background: #ffffff !important"));
  checkTrue("printable HTML is strictly longer than base HTML (pure addition)", printableHtml.length > baseHtml.length);

  const baseWithoutPrintBlock = printableHtml.replace(
    /<style media="print">[\s\S]*?<\/style>/,
    ""
  );
  checkTrue("removing the injected print block recovers byte-identical base HTML", baseWithoutPrintBlock === baseHtml);

  const atsPageDivCountBase = (baseHtml.match(/class="ats-page"/g) ?? []).length;
  const atsPageDivCountPrintable = (printableHtml.match(/class="ats-page"/g) ?? []).length;
  checkTrue("same number of .ats-page divs (content untouched)", atsPageDivCountBase === atsPageDivCountPrintable);
  checkTrue("at least one .ats-page div present", atsPageDivCountPrintable >= 1);

  const bodyTextBase = baseHtml.replace(/<[^>]+>/g, "");
  const bodyTextPrintable = printableHtml.replace(/<style media="print">[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, "");
  checkTrue("visible text content is byte-identical after stripping the injected block", bodyTextBase === bodyTextPrintable);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
