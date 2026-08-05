/*
  Phase 5C.1 - Long-Token and URL Hardening permanent regression gate.
  Runs each long-token scenario (longTokenScenarios.ts) plus the
  original failing scenario (Phase 5B's urlAndLinkedIn, reused
  verbatim) through the full cross-format parity pipeline at both
  Letter and A4, then goes one step further than
  buildProfessionalAtsParity's own report: generates the REAL PDF and
  DOCX bytes directly and asserts the full original long-token string
  is present in each format's own NATIVE text layer (extractPdfPageText
  / extractDocxText) - the only way to actually prove no horizontal
  clipping occurred in Playwright's print-to-PDF output, since
  overflowPageIndices only measures vertical page-height overflow (see
  pageVerification.ts) and would stay empty even if a long unbroken
  token bled past the page's right edge and got clipped.

  The native-text assertion uses the SAME whitespace-tolerant matcher
  (fragmentSearchPattern from parityMatcher.ts) the parity engine
  itself now uses, not a raw string .includes(). A direct pdfjs
  TextItem dump confirmed a long unbroken token can legitimately wrap
  across two lines when the full contact line doesn't fit on one - the
  token's characters are all intact within their TextItems up to the
  wrap, then continue on the next line, and the ONLY difference from
  the source value is a real space at the wrap point. That is a
  genuine, disclosed line-wrap artifact, not clipping (which would
  mean characters are actually missing) - so this test's own "no
  clipping" check must tolerate it exactly as strictly as the engine's
  own MISSING_FRAGMENT/INVENTED_FRAGMENT checks do, or it would be
  testing a stricter, incorrect definition of "clipped" than the one
  actually being verified.

  Also re-runs Phase 4's own ALL_SYNTHETIC_SCENARIOS, Phase 5B's own
  ALL_MULTILINGUAL_SCENARIOS, and this phase's own
  ALL_PARITY_MULTILINGUAL_SCENARIOS as a regression guard: the
  .ats-identity-contact CSS scoping and IdentityView otherContactLines
  fix must not change output for any existing passing scenario. Korean
  (korean-text) is explicitly excluded from this gate's pass/fail tally
  per Career Élan's supported-language scope (English/French only) and
  reported separately as an unsupported-language scenario, never
  silently converted to pass or fail.

  Run with `npx tsx lib/documentPreservation/professionalAtsParity/longTokenGate.test.ts`.
*/
import { buildProfessionalAtsParity } from "./buildProfessionalAtsParity";
import { buildProfessionalAtsPdf } from "../professionalAtsPdf/buildProfessionalAtsPdf";
import { buildProfessionalAtsDocx } from "../professionalAtsDocx/buildProfessionalAtsDocx";
import { extractPdfPageText } from "../professionalAtsPdf/pdfTextExtraction";
import { extractDocxText } from "../professionalAtsDocx/docxTextExtraction";
import { fragmentSearchPattern } from "./parityMatcher";
import { closeSharedBrowser } from "../sharedBrowser";
import { urlAndLinkedIn } from "../professionalAtsDocx/multilingualScenarios";
import { ALL_LONG_TOKEN_SCENARIOS } from "./longTokenScenarios";
import { ALL_SYNTHETIC_SCENARIOS } from "../professionalAtsHtml/syntheticScenarios";
import { ALL_MULTILINGUAL_SCENARIOS } from "../professionalAtsDocx/multilingualScenarios";
import { ALL_PARITY_MULTILINGUAL_SCENARIOS } from "./parityMultilingualScenarios";
import type { PaperSize } from "../professionalAtsHtml/types";
import type { ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";

let pass = 0;
let fail = 0;
const unsupportedLanguage: string[] = [];
function checkTrue(label: string, actual: boolean, detail?: unknown) {
  const ok = actual === true;
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `detail=${JSON.stringify(detail)}`);
  if (ok) pass++;
  else fail++;
}

/* Every long-token scenario puts exactly one long value into
   identity.otherContactLines[0] - extract it directly from the built
   assembly so the assertion always checks the EXACT source string,
   never a hand-copied literal that could drift from the scenario. */
function extractLongToken(assembly: ProfessionalAtsAssemblyDocument): string {
  const identityBlock = assembly.sections.find((s) => s.key === "identity")!.blocks[0];
  const identity = identityBlock.payload as { otherContactLines: { value: string }[] };
  return identity.otherContactLines[identity.otherContactLines.length - 1].value;
}

async function runLongTokenScenario(name: string, build: () => ProfessionalAtsAssemblyDocument, paperSize: PaperSize) {
  const assembly = build();
  const longToken = extractLongToken(assembly);

  const { report } = await buildProfessionalAtsParity(assembly, paperSize);
  checkTrue(`${name}/${paperSize}: overall report passed`, report.passed, report);
  checkTrue(`${name}/${paperSize}: html format passed (no missing fragment, no overflow)`, report.formats.html.passed, report.formats.html);
  checkTrue(`${name}/${paperSize}: pdf format passed`, report.formats.pdf.passed, report.formats.pdf);
  checkTrue(`${name}/${paperSize}: docx format passed`, report.formats.docx.passed, report.formats.docx);
  checkTrue(`${name}/${paperSize}: html/pdf page count parity (no forced overflow page)`, report.layoutPolicy.htmlPdfPageParity, report);

  const pdfResult = await buildProfessionalAtsPdf(assembly, paperSize);
  const pdfPages = await extractPdfPageText(pdfResult.bytes);
  const pdfText = pdfPages.map((p) => p.text).join(" ");
  checkTrue(`${name}/${paperSize}: PDF generation succeeds`, pdfResult.byteLength > 0);
  checkTrue(`${name}/${paperSize}: PDF native text contains full long token (no clipping)`, fragmentSearchPattern(longToken).test(pdfText), { longToken, pdfTextLength: pdfText.length });

  const docxResult = await buildProfessionalAtsDocx(assembly, paperSize, "comfortable");
  const docxText = await extractDocxText(docxResult.bytes);
  checkTrue(`${name}/${paperSize}: DOCX native text contains full long token`, docxText.includes(longToken), { longToken });

  console.log(`  [${name}/${paperSize}] token="${longToken}" pdfBytes=${pdfResult.byteLength} docxBytes=${docxResult.byteLength}`);
}

async function runRegressionScenario(name: string, build: () => ProfessionalAtsAssemblyDocument, paperSize: PaperSize) {
  if (name === "korean-text") {
    unsupportedLanguage.push(`${name}/${paperSize}`);
    console.log("SKIP (unsupported-language scenario, not counted as pass or fail):", `${name}/${paperSize}`);
    return;
  }
  const assembly = build();
  let report;
  try {
    ({ report } = await buildProfessionalAtsParity(assembly, paperSize));
  } catch (err) {
    checkTrue(`${name}/${paperSize}: buildProfessionalAtsParity did not throw`, false, err instanceof Error ? err.message : String(err));
    return;
  }
  checkTrue(`${name}/${paperSize}: overall report passed (regression guard)`, report.passed, report);
}

async function main() {
  /* --- The original failing scenario, now fixed --- */
  await runLongTokenScenario("url-and-linkedin", urlAndLinkedIn, "letter");
  await runLongTokenScenario("url-and-linkedin", urlAndLinkedIn, "a4");

  /* --- New Phase 5C.1 long-token scenarios --- */
  for (const scenario of ALL_LONG_TOKEN_SCENARIOS) {
    await runLongTokenScenario(scenario.name, scenario.build, "letter");
    await runLongTokenScenario(scenario.name, scenario.build, "a4");
  }

  /* --- Regression guard: existing scenario suites must still pass unchanged --- */
  for (const scenario of ALL_SYNTHETIC_SCENARIOS) {
    await runRegressionScenario(scenario.name, scenario.build, "letter");
  }
  for (const scenario of ALL_MULTILINGUAL_SCENARIOS) {
    await runRegressionScenario(scenario.name, scenario.build, "letter");
  }
  for (const scenario of ALL_PARITY_MULTILINGUAL_SCENARIOS) {
    await runRegressionScenario(scenario.name, scenario.build, "letter");
    await runRegressionScenario(scenario.name, scenario.build, "a4");
  }

  console.log(`\n--- ${pass} passed, ${fail} failed, ${unsupportedLanguage.length} unsupported-language (excluded from tally: ${unsupportedLanguage.join(", ")}) ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
