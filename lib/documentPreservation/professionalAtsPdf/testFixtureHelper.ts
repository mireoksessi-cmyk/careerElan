/*
  Shared test-only helper: runs a fixture through Phase 1->4's full
  pipeline (unchanged, reused verbatim - same call sequence as
  professionalAtsHtml/paginationPlanner.test.ts) and returns both the
  Phase 3 assembly and the Phase 4 preview (plan/measurement/
  validation) for one paperSize. Phase 5A tests build on this instead
  of re-deriving plan/density themselves.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "../resumeStructured/buildStructuredResume";
import { buildProfessionalAtsAssembly } from "../professionalAtsAssembly/buildProfessionalAtsAssembly";
import { buildProfessionalAtsHtmlPreview } from "../professionalAtsHtml/buildProfessionalAtsHtmlPreview";
import type { ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";
import type { ProfessionalAtsHtmlPreviewDocument, PaperSize } from "../professionalAtsHtml/types";

export const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");

export type LoadedFixture = {
  fixture: string;
  assembly: ProfessionalAtsAssemblyDocument;
  preview: ProfessionalAtsHtmlPreviewDocument;
};

export async function loadFixtureThroughPhase4(fixture: string, paperSize: PaperSize): Promise<LoadedFixture> {
  const fullPath = path.join(FIXTURES_DIR, fixture);
  const buffer = fs.readFileSync(fullPath);
  const sourceFormat = fixture.toLowerCase().endsWith(".docx") ? "docx" : "pdf";
  const layoutResult = await analyzeDocument("resume", sourceFormat, buffer);
  const document = buildLosslessResumeDocument(layoutResult, { fileName: fixture, fileType: sourceFormat });
  const model = buildStructuredResume(document);
  const assembly = buildProfessionalAtsAssembly(model);
  const preview = await buildProfessionalAtsHtmlPreview(assembly, paperSize);
  return { fixture, assembly, preview };
}
