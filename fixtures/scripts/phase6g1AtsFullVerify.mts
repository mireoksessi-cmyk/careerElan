/*
  Phase 6G.1 Part A item 5/6 - verifies HTML/PDF/DOCX for the
  professional-ats template across 6 real (non-synthetic) canonical
  resumes plus the buildFixtureRuntime() fixture that originally
  exposed the blocker, and reports a before/after fallback-rate summary.

  Run: npx tsx fixtures/scripts/phase6g1AtsFullVerify.mts
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureTemplatesRegistered } from "../../lib/resumeTemplates/registry/bootstrap";
import { validateTemplateId } from "../../lib/resumeTemplates/registry/templateRegistry";
import { renderTemplateFromRuntime } from "../../lib/resumeTemplates/engine/renderTemplate";
import { closeSharedBrowser } from "../../lib/documentPreservation/sharedBrowser";
import { buildFixtureRuntime } from "../../lib/careerMemory/persistence/testFixtures";
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeOverlayState, createRuntimeVersion } from "../../lib/careerMemory/runtime/factory";
import type { CanonicalResumeRuntime } from "../../lib/careerMemory/runtime/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const RESUMES = ["resume-A-junior-ats.pdf", "resume-B-junior-canva.pdf", "resume-C-mid-ats.pdf", "resume-D-mid-canva.pdf", "resume-E-senior-ats.pdf", "resume-F-senior-canva.pdf"];

async function main() {
  const { analyzeDocument } = await import("../../lib/documentPreservation/layoutAnalysis");
  const { buildLosslessResumeDocument } = await import("../../lib/documentPreservation/losslessSemantic/buildLosslessDocument");
  const { buildStructuredResume } = await import("../../lib/documentPreservation/resumeStructured/buildStructuredResume");

  ensureTemplatesRegistered();
  const templateId = validateTemplateId("professional-ats");
  const generatedAt = new Date(0).toISOString();

  const runtimes: { key: string; runtime: CanonicalResumeRuntime }[] = [];

  for (const fileName of RESUMES) {
    const filePath = path.join(REPO_ROOT, "fixtures", "resumes", "bench", fileName);
    const buffer = fs.readFileSync(filePath);
    const layoutResult = await analyzeDocument("resume", "pdf", buffer);
    const document = buildLosslessResumeDocument(layoutResult, { fileName, fileType: "pdf" });
    const model = buildStructuredResume(document);
    const runtime = createCanonicalRuntime({
      resume: model,
      version: createRuntimeVersion({ id: `${fileName}-v1`, reason: "initial", createdAt: generatedAt }),
      metadata: createRuntimeMetadata({ schemaVersion: model.schemaVersion }),
      overlayState: createRuntimeOverlayState(),
    });
    runtimes.push({ key: fileName, runtime });
  }
  runtimes.push({ key: "buildFixtureRuntime()", runtime: { ...buildFixtureRuntime(), sourceDocuments: [], overlayState: { history: [] } } });

  let successCount = 0;
  const results: { key: string; html: boolean; pdf: boolean; docx: boolean }[] = [];

  for (const { key, runtime } of runtimes) {
    const row = { key, html: false, pdf: false, docx: false };
    for (const format of ["html", "pdf", "docx"] as const) {
      try {
        const result = await renderTemplateFromRuntime(runtime, { templateId, generatedAt }, format);
        const bytes = format === "html" ? Buffer.byteLength(result.html) : result.bytes.length;
        console.log(`[${key}] ${format}: OK, ${bytes} bytes${"validation" in result ? `, validation.passed=${result.validation.passed}` : ""}`);
        row[format] = true;
      } catch (error) {
        console.log(`[${key}] ${format}: FAILED - ${error instanceof Error ? error.message.slice(0, 150) : "unknown"}`);
      }
    }
    if (row.html && row.pdf && row.docx) successCount++;
    results.push(row);
  }

  console.log(`\n=== SUMMARY: ${successCount}/${runtimes.length} profiles succeeded on all 3 formats (professional-ats) ===`);
  console.log(JSON.stringify(results, null, 2));

  await closeSharedBrowser();
}
main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
