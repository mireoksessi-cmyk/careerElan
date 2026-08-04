/*
  TASK 6/7 gate test - pagination planner against real measured
  fixtures. Run with
  `npx tsx lib/documentPreservation/professionalAtsHtml/paginationPlanner.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "../resumeStructured/buildStructuredResume";
import { buildProfessionalAtsAssembly } from "../professionalAtsAssembly/buildProfessionalAtsAssembly";
import { measureFlatContent } from "./measurement";
import { buildPaginationPlan } from "./paginationPlanner";
import type { ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";
import type { PaginationPlan } from "./types";

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

const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");

/*
  Verifies every visible block's sub-items are covered by its
  placements exactly once, with no gaps and no overlaps (content
  preservation - the whole point of the "never drop content" rule).
  Blocks placed as a single whole (no subRange) are trivially covered.
*/
function verifyContentCoverage(assembly: ProfessionalAtsAssemblyDocument, plan: PaginationPlan, label: string) {
  const placementsByBlock = new Map<string, typeof plan.blockPlacements>();
  for (const p of plan.blockPlacements) {
    const list = placementsByBlock.get(p.blockId) ?? [];
    list.push(p);
    placementsByBlock.set(p.blockId, list);
  }

  for (const section of assembly.sections) {
    if (!section.visible) continue;
    for (const block of section.blocks) {
      const placements = placementsByBlock.get(block.id) ?? [];
      checkTrue(`${label}: ${block.id} has at least one placement`, placements.length > 0);
      if (placements.length === 0) continue;

      const withRange = placements.filter((p) => p.subRange);
      if (withRange.length === 0) {
        check(`${label}: ${block.id} placed whole exactly once`, placements.length, 1);
        continue;
      }

      const sorted = [...withRange].sort((a, b) => a.subRange!.startIndex - b.subRange!.startIndex);
      let expectedNext = 0;
      let contiguous = true;
      for (const p of sorted) {
        if (p.subRange!.startIndex !== expectedNext) contiguous = false;
        expectedNext = p.subRange!.endIndex + 1;
      }
      checkTrue(`${label}: ${block.id} sub-item ranges are contiguous with no gaps/overlaps`, contiguous);
      checkTrue(`${label}: ${block.id} first fragment is not a continuation`, sorted[0].isContinuation === false);
      checkTrue(
        `${label}: ${block.id} later fragments (if any) are continuations`,
        sorted.slice(1).every((p) => p.isContinuation === true)
      );
    }
  }
}

function verifyPageIndexBounds(plan: PaginationPlan, label: string) {
  checkTrue(`${label}: pageCount >= 1`, plan.pageCount >= 1);
  checkTrue(
    `${label}: all block placements within [0, pageCount)`,
    plan.blockPlacements.every((p) => p.pageIndex >= 0 && p.pageIndex < plan.pageCount)
  );
  checkTrue(
    `${label}: all section heading placements within [0, pageCount)`,
    plan.sectionHeadingPlacements.every((p) => p.pageIndex >= 0 && p.pageIndex < plan.pageCount)
  );
}

async function buildAssembly(file: string, format: "pdf" | "docx"): Promise<ProfessionalAtsAssemblyDocument> {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, file));
  const layoutResult = await analyzeDocument("resume", format, buffer);
  const document = buildLosslessResumeDocument(layoutResult, { fileName: file, fileType: format });
  const model = buildStructuredResume(document);
  return buildProfessionalAtsAssembly(model);
}

async function main() {
  // threepage-pdf-resume.pdf is a genuinely long real resume - at
  // comfortable density on Letter it must span more than one page.
  const threepage = await buildAssembly("threepage-pdf-resume.pdf", "pdf");
  const threepageMeasured = await measureFlatContent(threepage, "letter", "comfortable");
  const threepagePlan = buildPaginationPlan(threepage, threepageMeasured, "letter", "comfortable");
  checkTrue("threepage-pdf-resume.pdf/letter/comfortable: pageCount > 1", threepagePlan.pageCount > 1);
  verifyPageIndexBounds(threepagePlan, "threepage-pdf-resume.pdf/letter/comfortable");
  verifyContentCoverage(threepage, threepagePlan, "threepage-pdf-resume.pdf/letter/comfortable");

  // Same content at ultra-compact should never need MORE pages than
  // comfortable (density only shrinks, never grows content).
  const threepageMeasuredUltra = await measureFlatContent(threepage, "letter", "ultra-compact");
  const threepagePlanUltra = buildPaginationPlan(threepage, threepageMeasuredUltra, "letter", "ultra-compact");
  checkTrue(
    `threepage-pdf-resume.pdf: ultra-compact pageCount (${threepagePlanUltra.pageCount}) <= comfortable pageCount (${threepagePlan.pageCount})`,
    threepagePlanUltra.pageCount <= threepagePlan.pageCount
  );
  verifyContentCoverage(threepage, threepagePlanUltra, "threepage-pdf-resume.pdf/letter/ultra-compact");

  // bench-B is a shorter, real-world fixture - verify coverage/bounds hold there too.
  const benchB = await buildAssembly("bench/resume-B-junior-canva.pdf", "pdf");
  const benchBMeasured = await measureFlatContent(benchB, "letter", "comfortable");
  const benchBPlan = buildPaginationPlan(benchB, benchBMeasured, "letter", "comfortable");
  verifyPageIndexBounds(benchBPlan, "bench-B/letter/comfortable");
  verifyContentCoverage(benchB, benchBPlan, "bench-B/letter/comfortable");

  // A4 should also produce a valid, content-complete plan.
  const benchBMeasuredA4 = await measureFlatContent(benchB, "a4", "comfortable");
  const benchBPlanA4 = buildPaginationPlan(benchB, benchBMeasuredA4, "a4", "comfortable");
  verifyPageIndexBounds(benchBPlanA4, "bench-B/a4/comfortable");
  verifyContentCoverage(benchB, benchBPlanA4, "bench-B/a4/comfortable");

  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
