/*
  Phase 6F - real output generator. Renders the Jordan Ellis synthetic
  fixture through all 4 registered templates (HTML/PDF/DOCX each) via
  the SAME registry/engine pipeline the Gallery API route uses - not a
  separate/duplicate rendering path. Writes real files to the scratch
  output directory and prints their exact absolute paths + byte sizes
  + validation.passed status, so the caller can hand the user real,
  openable paths. Run with:
    npx tsx fixtures/scripts/phase6fGenerateOutputs.mts
*/
import fs from "node:fs";
import path from "node:path";
import { ensureTemplatesRegistered } from "../../lib/resumeTemplates/registry/bootstrap";
import { listTemplates } from "../../lib/resumeTemplates/registry/templateRegistry";
import { renderTemplateFromRuntime } from "../../lib/resumeTemplates/engine/renderTemplate";
import { closeSharedBrowser } from "../../lib/documentPreservation/sharedBrowser";
import { buildJordanEllisRuntime } from "../resumes/template-preview/jordanEllisFixture";
import type { TemplateId } from "../../lib/resumeTemplates/contracts/types";

const OUTPUT_DIR = process.env.PHASE6F_OUTPUT_DIR ?? path.join(process.env.TEMP ?? process.env.TMP ?? "/tmp", "phase6f-template-preview");
const SYNTHETIC_DIR = path.join(OUTPUT_DIR, "synthetic");

async function main() {
  fs.mkdirSync(SYNTHETIC_DIR, { recursive: true });

  ensureTemplatesRegistered();
  const templates = listTemplates();
  const runtime = buildJordanEllisRuntime();
  const generatedAt = new Date().toISOString();

  const results: Array<{ templateId: TemplateId; format: string; path: string; bytes: number; passed: boolean; pageCount?: number }> = [];

  for (const capabilities of templates) {
    const templateId = capabilities.id;
    console.log(`\n=== ${templateId} ===`);

    const htmlResult = await renderTemplateFromRuntime(runtime, { templateId, generatedAt }, "html");
    const htmlPath = path.join(SYNTHETIC_DIR, `${templateId}-preview.html`);
    fs.writeFileSync(htmlPath, htmlResult.html, "utf8");
    console.log(`HTML: ${htmlPath} (${fs.statSync(htmlPath).size} bytes, ${htmlResult.pageCount} pages, validation.passed=${htmlResult.validation.passed})`);
    results.push({ templateId, format: "html", path: htmlPath, bytes: fs.statSync(htmlPath).size, passed: htmlResult.validation.passed, pageCount: htmlResult.pageCount });

    const pdfResult = await renderTemplateFromRuntime(runtime, { templateId, generatedAt }, "pdf");
    const pdfPath = path.join(SYNTHETIC_DIR, `${templateId}-preview.pdf`);
    fs.writeFileSync(pdfPath, pdfResult.bytes);
    console.log(`PDF:  ${pdfPath} (${fs.statSync(pdfPath).size} bytes, ${pdfResult.pageCount} pages, selectableText=${pdfResult.hasSelectableText}, validation.passed=${pdfResult.validation.passed})`);
    results.push({ templateId, format: "pdf", path: pdfPath, bytes: fs.statSync(pdfPath).size, passed: pdfResult.validation.passed, pageCount: pdfResult.pageCount });

    const docxResult = await renderTemplateFromRuntime(runtime, { templateId, generatedAt }, "docx");
    const docxPath = path.join(SYNTHETIC_DIR, `${templateId}-preview.docx`);
    fs.writeFileSync(docxPath, docxResult.bytes);
    console.log(`DOCX: ${docxPath} (${fs.statSync(docxPath).size} bytes, editable=${docxResult.isEditableNativeDocx}, validation.passed=${docxResult.validation.passed})`);
    results.push({ templateId, format: "docx", path: docxPath, bytes: fs.statSync(docxPath).size, passed: docxResult.validation.passed });

    if (!htmlResult.validation.passed) console.log("  HTML issues:", JSON.stringify(htmlResult.validation.issues));
    if (!pdfResult.validation.passed) console.log("  PDF issues:", JSON.stringify(pdfResult.validation.issues));
    if (!docxResult.validation.passed) console.log("  DOCX issues:", JSON.stringify(docxResult.validation.issues));
  }

  const manifestPath = path.join(OUTPUT_DIR, "synthetic-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(results, null, 2), "utf8");

  const allPassed = results.every((r) => r.passed);
  console.log(`\n${results.length} files generated. All validation.passed=${allPassed}.`);
  console.log(`Manifest: ${manifestPath}`);

  await closeSharedBrowser();
  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
