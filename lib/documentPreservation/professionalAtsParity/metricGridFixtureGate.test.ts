/*
  Phase 5D.2B gate test - real-fixture cross-format proof that the
  Metric Pair (Value<->Label) relationship survives identically through
  HTML, PDF, and DOCX for all four new synthetic KPI/metric-grid
  fixtures (f8 4-column, f9 2-column, f10 3-column, f11 vertically-
  stacked score panel), through the SAME CrossFormatParityReport
  machinery every other fixture is gated on (never a bespoke check).
  Run with `npx tsx lib/documentPreservation/professionalAtsParity/metricGridFixtureGate.test.ts`.
*/
import { loadFixtureAssembly, FIXTURES_DIR } from "./testFixtureHelper";
import { buildProfessionalAtsParity } from "./buildProfessionalAtsParity";
import { buildCanonicalParityManifest } from "./canonicalParityManifest";
import { closeSharedBrowser } from "../sharedBrowser";
import type { PaperSize } from "../professionalAtsHtml/types";
import type { MetricGrid } from "../resumeStructured/types";
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "../resumeStructured/buildStructuredResume";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean, detail?: unknown) {
  const ok = actual === true;
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `detail=${JSON.stringify(detail)}`);
  if (ok) pass++;
  else fail++;
}

const FIXTURES: { file: string; expectedColumns: number; expectedEntries: number }[] = [
  { file: "lossless-synthetic/f8-metric-grid-4col-kpi.pdf", expectedColumns: 4, expectedEntries: 4 },
  { file: "lossless-synthetic/f9-metric-cards-2col.pdf", expectedColumns: 2, expectedEntries: 2 },
  { file: "lossless-synthetic/f10-metric-cards-3col.pdf", expectedColumns: 3, expectedEntries: 3 },
  { file: "lossless-synthetic/f11-metric-score-panel-stacked.pdf", expectedColumns: 1, expectedEntries: 3 },
  { file: "lossless-synthetic/f11-metric-score-panel-stacked.docx", expectedColumns: 1, expectedEntries: 3 },
];

async function main() {
  for (const { file, expectedColumns, expectedEntries } of FIXTURES) {
    const format = file.toLowerCase().endsWith(".docx") ? "docx" : "pdf";
    const buffer = fs.readFileSync(path.join(FIXTURES_DIR, file));
    const layoutResult = await analyzeDocument("resume", format, buffer);
    const document = buildLosslessResumeDocument(layoutResult, { fileName: file, fileType: format });
    const model = buildStructuredResume(document);

    check(`${file}: exactly 1 grid detected`, model.metricGrids.length, 1);
    const grid = model.metricGrids[0] as MetricGrid | undefined;
    check(`${file}: columns=${expectedColumns}`, grid?.columns, expectedColumns);
    check(`${file}: entries=${expectedEntries}`, grid?.entries.length, expectedEntries);
    checkTrue(`${file}: Phase 2 validator passed`, model.validation.passed, model.validation);

    const assembly = await loadFixtureAssembly(file);
    checkTrue(`${file}: metric_highlights visible in Assembly`, assembly.visibleSectionKeys.includes("metric_highlights"));

    const paperSize: PaperSize = "letter";
    const parity = await buildProfessionalAtsParity(assembly, paperSize);
    checkTrue(`${file}: cross-format parity report passed`, parity.report.passed, parity.report);
    checkTrue(`${file}: HTML format passed`, parity.report.formats.html.passed, parity.report.formats.html);
    checkTrue(`${file}: PDF format passed`, parity.report.formats.pdf.passed, parity.report.formats.pdf);
    checkTrue(`${file}: DOCX format passed`, parity.report.formats.docx.passed, parity.report.formats.docx);

    /* Every metric value AND label must appear as a required fragment
       in the canonical manifest - proves the parity machinery is
       actually checking Metric Pair content, not silently skipping it
       via an empty extractPayloadFragments case. Density doesn't affect
       WHICH fragments are expected (only layout), so "comfortable" is a
       safe fixed choice for this content-only check. */
    const manifest = buildCanonicalParityManifest(assembly, paperSize, "comfortable");
    const metricFragmentValues = new Set(manifest.expectedTextFragments.filter((f) => f.kind === "metric").map((f) => f.value));
    for (const entry of grid?.entries ?? []) {
      checkTrue(`${file}: manifest contains value "${entry.value.value}"`, metricFragmentValues.has(entry.value.value));
      checkTrue(`${file}: manifest contains label "${entry.label.value}"`, metricFragmentValues.has(entry.label.value));
    }
  }

  await closeSharedBrowser();
  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("metricGridFixtureGate crashed:", error);
  process.exit(1);
});
