/*
  TASK 3 gate test - real PDF and real DOCX fixture coverage check. Run
  with `npx tsx lib/documentPreservation/losslessSemantic/blockAdapter.test.ts`.
  No network/AI calls - pure local file parsing + Playwright DOCX render
  (same technique fixtures/scripts/introspectDpe.mts already uses).
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { adaptLayoutToBlocks } from "./blockAdapter";

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

async function runCoverageCheck(label: string, fileName: string, sourceFormat: "pdf" | "docx") {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, fileName));
  const layoutResult = await analyzeDocument("resume", sourceFormat, buffer);
  const { blocks } = adaptLayoutToBlocks(layoutResult);

  checkTrue(`${label}: at least one block produced`, blocks.length > 0);

  const totalSourceElements = layoutResult.pages.reduce((sum, p) => sum + p.elements.length, 0);
  const seen = new Map<string, number>();
  for (const block of blocks) {
    for (const id of block.sourceElementIds) {
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
  }
  const representedCount = seen.size;
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1);

  check(`${label}: represented element count == source element count`, representedCount, totalSourceElements);
  check(`${label}: zero duplicate element references`, duplicates.length, 0);

  const byPage = new Map<number, number[]>();
  for (const block of blocks) {
    const arr = byPage.get(block.pageIndex) ?? [];
    arr.push(block.sourceOrder);
    byPage.set(block.pageIndex, arr);
  }
  let sourceOrderOk = true;
  for (const orders of byPage.values()) {
    const sorted = [...orders].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] !== i) sourceOrderOk = false;
    }
  }
  checkTrue(`${label}: sourceOrder is a dense 0..n-1 sequence per page`, sourceOrderOk);

  const noInventedChars = blocks.every((b) => b.text.length <= b.rawText.length);
  checkTrue(`${label}: no block's normalized text is longer than its rawText`, noInventedChars);

  return blocks;
}

async function main() {
  const pdfBlocks = await runCoverageCheck("standard-pdf-resume.pdf", "standard-pdf-resume.pdf", "pdf");
  checkTrue(
    "PDF fixture: multiple distinct lines produced (not one giant merged block)",
    pdfBlocks.filter((b) => b.blockType !== "unknown").length >= 5
  );

  const docxBlocks = await runCoverageCheck("word-docx-resume.docx", "word-docx-resume.docx", "docx");
  checkTrue(
    "DOCX fixture: multiple distinct lines produced",
    docxBlocks.filter((b) => b.blockType !== "unknown").length >= 5
  );

  // Regression check for the SAME real 2-column false-merge bug
  // pdfContentBoxGenerator.ts's own groupIntoLines() was fixed against
  // (see this file's blockAdapter.ts header comment) - reruns it against
  // this module's own reimplementation of that technique, using the
  // exact fixture that originally exposed it.
  const twoColumnBlocks = await runCoverageCheck(
    "regtest3-two-column-pdf.pdf",
    "regtest3-two-column-pdf.pdf",
    "pdf"
  );
  const suspiciousMerges = twoColumnBlocks.filter(
    (b) => /Summary/i.test(b.rawText) && /Contact|Skills|Certifications/i.test(b.rawText) && b.rawText.length < 120
  );
  check(
    "2-column fixture: no single short line merges a main-column heading with a sidebar heading",
    suspiciousMerges.length,
    0
  );

  // Determinism smoke check (full TASK 6 determinism gate reruns this
  // more thoroughly against every fixture) - same input run twice ->
  // identical block IDs/order.
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, "standard-pdf-resume.pdf"));
  const layoutResult = await analyzeDocument("resume", "pdf", buffer);
  const run1 = adaptLayoutToBlocks(layoutResult).blocks.map((b) => b.id);
  const run2 = adaptLayoutToBlocks(layoutResult).blocks.map((b) => b.id);
  check("PDF fixture: repeat adapt run yields identical block id sequence", run1, run2);

  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
