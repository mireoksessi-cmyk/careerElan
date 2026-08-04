/*
  TASK 3 gate test - static renderer + text preservation, using
  react-dom/server (no browser needed for text-only checks; real
  browser measurement is TASK 5). Run with
  `npx tsx lib/documentPreservation/professionalAtsHtml/renderers.test.tsx`.
*/
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "../resumeStructured/buildStructuredResume";
import { buildProfessionalAtsAssembly } from "../professionalAtsAssembly/buildProfessionalAtsAssembly";
import { ProfessionalAtsFlatContent, AssemblyBlockView } from "./renderers";
import { validateBlockTextPreservation, findDuplicateBlockIds } from "./textPreservationValidator";

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

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
}

function htmlToText(html: string): string {
  // Mirrors what a real browser's .textContent already gives you for
  // free (entities decoded) - Playwright-based measurement.ts doesn't
  // need this step since page.evaluate(() => el.textContent) returns
  // already-decoded text; this manual decode only exists because this
  // test strips tags with a plain regex instead of a real DOM.
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "));
}

const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");

async function main() {
  const files: { file: string; format: "pdf" | "docx" }[] = [
    { file: "threepage-pdf-resume.pdf", format: "pdf" },
    { file: "bench/resume-B-junior-canva.pdf", format: "pdf" },
    { file: "lossless-synthetic/f5-no-heading-document.docx", format: "docx" },
    { file: "lossless-synthetic/f1-career-profile-awards-custom.docx", format: "docx" },
  ];

  for (const { file, format } of files) {
    const buffer = fs.readFileSync(path.join(FIXTURES_DIR, file));
    const layoutResult = await analyzeDocument("resume", format, buffer);
    const document = buildLosslessResumeDocument(layoutResult, { fileName: file, fileType: format });
    const model = buildStructuredResume(document);
    const assembly = buildProfessionalAtsAssembly(model);

    // --- per-block text preservation (scoped, avoids cross-block substring collisions) ---
    let totalBlocksChecked = 0;
    for (const section of assembly.sections) {
      if (!section.visible) continue;
      for (const block of section.blocks) {
        totalBlocksChecked++;
        const blockHtml = renderToStaticMarkup(<AssemblyBlockView block={block} />);
        const blockText = htmlToText(blockHtml);
        const result = validateBlockTextPreservation(block, blockText);
        check(`${file}/${block.id}: zero missing text fragments`, result.missing.length, 0);
        checkTrue(`${file}/${block.id}: no invented text leftover (leftover="${result.leftoverAfterRemoval}")`, !result.inventedSuspected);
      }
    }
    checkTrue(`${file}: at least one visible block was checked`, totalBlocksChecked > 0);

    // --- whole-document structural checks ---
    const html = renderToStaticMarkup(<ProfessionalAtsFlatContent assembly={assembly} />);

    check(`${file}: zero duplicate block ids in flat render`, findDuplicateBlockIds(html), []);

    for (const section of assembly.sections) {
      if (section.visible) continue;
      checkTrue(`${file}: hidden section ${section.key} has no data-section-key in rendered HTML`, !html.includes(`data-section-key="${section.key}"`));
    }

    const domSectionOrder = [...html.matchAll(/data-section-key="([^"]+)"/g)].map((m) => m[1]);
    check(`${file}: DOM section order matches visibleSectionKeys`, domSectionOrder, assembly.visibleSectionKeys);

    checkTrue(`${file}: no empty section heading`, !/data-section-heading="[^"]+"[^>]*>\s*<\/h2>/.test(html));
  }

  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
