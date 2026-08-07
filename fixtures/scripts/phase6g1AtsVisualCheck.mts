/*
  Phase 6G.1 Part B - generates real professional-ats PDFs post-fix and
  converts page 1 to PNG for visual inspection. Output goes to the
  scratch-only temp dir (never the repo).
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
const OUT_DIR = path.join(process.env.TEMP ?? "/tmp", "phase6g1-visual-check");

async function main() {
  const { analyzeDocument } = await import("../../lib/documentPreservation/layoutAnalysis");
  const { buildLosslessResumeDocument } = await import("../../lib/documentPreservation/losslessSemantic/buildLosslessDocument");
  const { buildStructuredResume } = await import("../../lib/documentPreservation/resumeStructured/buildStructuredResume");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  ensureTemplatesRegistered();
  const templateId = validateTemplateId("professional-ats");
  const generatedAt = new Date(0).toISOString();

  const profiles: { key: string; runtime: CanonicalResumeRuntime }[] = [];
  for (const fileName of ["resume-A-junior-ats.pdf", "resume-E-senior-ats.pdf"]) {
    const buffer = fs.readFileSync(path.join(REPO_ROOT, "fixtures", "resumes", "bench", fileName));
    const layoutResult = await analyzeDocument("resume", "pdf", buffer);
    const document = buildLosslessResumeDocument(layoutResult, { fileName, fileType: "pdf" });
    const model = buildStructuredResume(document);
    const runtime = createCanonicalRuntime({
      resume: model,
      version: createRuntimeVersion({ id: `${fileName}-v1`, reason: "initial", createdAt: generatedAt }),
      metadata: createRuntimeMetadata({ schemaVersion: model.schemaVersion }),
      overlayState: createRuntimeOverlayState(),
    });
    profiles.push({ key: fileName.replace(/\.pdf$/, ""), runtime });
  }
  profiles.push({ key: "fixture", runtime: { ...buildFixtureRuntime(), sourceDocuments: [], overlayState: { history: [] } } });

  for (const { key, runtime } of profiles) {
    const pdfResult = await renderTemplateFromRuntime(runtime, { templateId, generatedAt }, "pdf");
    fs.writeFileSync(path.join(OUT_DIR, `${key}.pdf`), pdfResult.bytes);
    const htmlResult = await renderTemplateFromRuntime(runtime, { templateId, generatedAt }, "html");
    const htmlPath = path.join(OUT_DIR, `${key}.html`);
    fs.writeFileSync(htmlPath, htmlResult.html);
    console.log(`${key}: PDF ${pdfResult.bytes.length} bytes (validation.passed=${pdfResult.validation.passed}), HTML -> ${htmlPath} (pageCount=${htmlResult.pageCount})`);
  }

  await closeSharedBrowser();
}
main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
