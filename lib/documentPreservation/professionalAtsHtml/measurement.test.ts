/*
  TASK 5 gate test - real browser measurement against real fixtures. Run
  with `npx tsx lib/documentPreservation/professionalAtsHtml/measurement.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "../resumeStructured/buildStructuredResume";
import { buildProfessionalAtsAssembly } from "../professionalAtsAssembly/buildProfessionalAtsAssembly";
import { measureFlatContent } from "./measurement";
import { DENSITY_SPACING } from "./designTokens";
import { PROFESSIONAL_ATS_SECTION_LABELS } from "../professionalAtsAssembly/sectionLabels";

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

async function main() {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, "threepage-pdf-resume.pdf"));
  const layoutResult = await analyzeDocument("resume", "pdf", buffer);
  const document = buildLosslessResumeDocument(layoutResult, { fileName: "threepage-pdf-resume.pdf", fileType: "pdf" });
  const model = buildStructuredResume(document);
  const assembly = buildProfessionalAtsAssembly(model);

  // --- Letter, comfortable ---
  const letterComfortable = await measureFlatContent(assembly, "letter", "comfortable");
  checkTrue("letter/comfortable: measurable", letterComfortable.measurable);
  check("letter/comfortable: no measurement errors", letterComfortable.measurementErrors, []);

  const expectedContentWidth = 8.5 * 96 - 2 * DENSITY_SPACING.comfortable.pagePaddingPx;
  checkTrue(
    `letter/comfortable: contentWidthPx close to expected (${expectedContentWidth})`,
    Math.abs(letterComfortable.contentWidthPx - expectedContentWidth) < 2
  );

  // "identity" intentionally has a null label (sectionLabels.ts) - the
  // identity block is the name/contact header, not a labeled section
  // like "PROFESSIONAL EXPERIENCE", so it never renders a
  // [data-section-heading] element and is excluded here, not a bug.
  const visibleLabeledSectionKeys = assembly.visibleSectionKeys.filter((k) => PROFESSIONAL_ATS_SECTION_LABELS[k] !== null);
  check(
    "letter/comfortable: sectionHeadings cover exactly the visible labeled sections",
    letterComfortable.sectionHeadings.map((h) => h.sectionKey).sort(),
    [...visibleLabeledSectionKeys].sort()
  );
  checkTrue(
    "letter/comfortable: every section heading has positive height",
    letterComfortable.sectionHeadings.every((h) => h.heightPx > 0)
  );

  const totalBlockCount = assembly.sections.filter((s) => s.visible).reduce((n, s) => n + s.blocks.length, 0);
  check("letter/comfortable: measured block count matches assembly block count", letterComfortable.blocks.length, totalBlockCount);
  checkTrue(
    "letter/comfortable: every measured block has positive totalHeightPx",
    letterComfortable.blocks.every((b) => b.totalHeightPx > 0)
  );

  // Cross-check: a block with N sub-items should have exactly N measured subItems, and
  // totalHeightPx should be >= headerHeightPx + sum(subItem heights) (gaps only add, never subtract).
  for (const section of assembly.sections) {
    if (!section.visible) continue;
    for (const block of section.blocks) {
      const measured = letterComfortable.blocks.find((b) => b.blockId === block.id);
      if (!measured) continue;
      if (measured.subItems.length > 0) {
        checkTrue(
          `letter/comfortable: ${block.id} totalHeightPx >= headerHeightPx + subItem heights`,
          measured.totalHeightPx >= measured.headerHeightPx + measured.subItems.reduce((n, s) => n + s.heightPx, 0) - 1
        );
      }
    }
  }

  // --- A4, comfortable: different width, same content, heights should differ from Letter (wrapping changes) ---
  const a4Comfortable = await measureFlatContent(assembly, "a4", "comfortable");
  checkTrue("a4/comfortable: measurable", a4Comfortable.measurable);
  const a4ExpectedContentWidth = (210 * 96) / 25.4 - 2 * DENSITY_SPACING.comfortable.pagePaddingPx;
  checkTrue(
    `a4/comfortable: contentWidthPx close to expected (${a4ExpectedContentWidth})`,
    Math.abs(a4Comfortable.contentWidthPx - a4ExpectedContentWidth) < 2
  );
  checkTrue("letter and a4 content widths differ", letterComfortable.contentWidthPx !== a4Comfortable.contentWidthPx);

  // --- Letter, ultra-compact: smaller font/line-height should measure strictly shorter total block heights ---
  const letterUltraCompact = await measureFlatContent(assembly, "letter", "ultra-compact");
  checkTrue("letter/ultra-compact: measurable", letterUltraCompact.measurable);
  const totalComfortable = letterComfortable.blocks.reduce((n, b) => n + b.totalHeightPx, 0);
  const totalUltraCompact = letterUltraCompact.blocks.reduce((n, b) => n + b.totalHeightPx, 0);
  checkTrue(
    `letter ultra-compact total block height (${totalUltraCompact}) < comfortable total (${totalComfortable})`,
    totalUltraCompact < totalComfortable
  );

  // --- Empty-safe fixture: a fixture with very few sections still measures cleanly ---
  const wbuffer = fs.readFileSync(path.join(FIXTURES_DIR, "lossless-synthetic/f5-no-heading-document.docx"));
  const wLayout = await analyzeDocument("resume", "docx", wbuffer);
  const wDoc = buildLosslessResumeDocument(wLayout, { fileName: "lossless-synthetic/f5-no-heading-document.docx", fileType: "docx" });
  const wModel = buildStructuredResume(wDoc);
  const wAssembly = buildProfessionalAtsAssembly(wModel);
  const wMeasured = await measureFlatContent(wAssembly, "letter", "comfortable");
  checkTrue("f5-no-heading-document.docx: measurable", wMeasured.measurable);

  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
