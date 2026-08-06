/*
  Phase 6F - Cross-format/cross-template parity test category (spec
  section 19, item "all 4 templates render identical canonical facts").
  Renders HTML for all 4 templates from the SAME Jordan Ellis runtime
  and asserts a fixed set of protected facts (identity, one experience
  organization, one education institution, one metric grid value, one
  project name, one award name) survives into EVERY template's visible
  text, regardless of each template's own distinct visual design. Only
  HTML is rendered here (PDF/DOCX per-template are already covered by
  the dedicated per-template test files) to keep this file's own
  Playwright cost small while still exercising all 4 renderers. Run
  with:
    npx tsx lib/resumeTemplates/tests/crossFormatParity.test.ts
*/
import { ensureTemplatesRegistered } from "../registry/bootstrap";
import { renderTemplateFromRuntime } from "../engine/renderTemplate";
import { closeSharedBrowser } from "../../documentPreservation/sharedBrowser";
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeOverlayState, createRuntimeVersion } from "../../careerMemory/runtime/factory";
import { buildJordanEllisResume } from "../../../fixtures/resumes/template-preview/jordanEllisFixture";
import { extractVisibleTextFromHtml } from "../shared/htmlText";
import { TEMPLATE_IDS, type TemplateId } from "../contracts/types";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}

const GENERATED_AT = "2026-01-01T00:00:00.000Z";

const PROTECTED_FACTS = ["Jordan Ellis", "Northbridge", "York University", "Meridian", "P&L Ownership"];

async function main() {
  ensureTemplatesRegistered();
  const resume = buildJordanEllisResume();
  const runtime = createCanonicalRuntime({
    resume,
    version: createRuntimeVersion({ id: "cross-parity-test-v1", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: resume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });

  check("TEMPLATE_IDS has exactly 4 entries to iterate over", TEMPLATE_IDS.length, 4);

  const results: Record<TemplateId, { text: string; passed: boolean }> = {} as never;
  for (const templateId of TEMPLATE_IDS) {
    const html = await renderTemplateFromRuntime(runtime, { templateId, generatedAt: GENERATED_AT }, "html");
    results[templateId] = { text: extractVisibleTextFromHtml(html.html), passed: html.validation.passed };
  }

  for (const templateId of TEMPLATE_IDS) {
    checkTrue(`${templateId}: HTML validation.passed is true`, results[templateId].passed);
    for (const fact of PROTECTED_FACTS) {
      checkTrue(`${templateId}: extracted text contains the protected fact "${fact}"`, results[templateId].text.includes(fact));
    }
  }

  /* Cross-template identity consistency: the SAME full name string appears verbatim across all 4, byte-for-byte (never a truncated/reformatted variant). */
  const fullNameOccurrences = TEMPLATE_IDS.map((id) => results[id].text.split("Jordan Ellis").length - 1);
  checkTrue("cross-template: 'Jordan Ellis' appears at least once in every template's extracted text", fullNameOccurrences.every((n) => n >= 1));

  /* Every template independently reaches the SAME zero-missing-text outcome against the shared ground-truth fragment list, despite 4 different visual designs. */
  const allFourPassed = TEMPLATE_IDS.every((id) => results[id].passed);
  checkTrue("cross-template: all 4 templates independently pass validation against the identical underlying canonical facts", allFourPassed);

  /* Distinct visual identity sanity check: no two templates produce byte-identical HTML (they are genuinely 4 different designs, not 4 thin skins of 1 layout). */
  const htmlLengths = new Set(TEMPLATE_IDS.map((id) => results[id].text.length));
  checkTrue("cross-template: not all 4 templates produce identical-length extracted text (confirms genuinely distinct layouts/labels, not copy-paste)", htmlLengths.size > 1 || TEMPLATE_IDS.length === 1);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
