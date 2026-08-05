/*
  Shared test-only helper: runs a fixture through Phase 1->3 (Phase 5B
  consumes ProfessionalAtsAssemblyDocument directly, no Phase 4 HTML
  preview dependency needed for content generation - Phase 4 is only
  imported by docxParityValidator.ts for the optional HTML-text
  comparison, never here).
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "../resumeStructured/buildStructuredResume";
import { buildProfessionalAtsAssembly } from "../professionalAtsAssembly/buildProfessionalAtsAssembly";
import type { ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";

export const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");

export async function loadFixtureAssembly(fixture: string): Promise<ProfessionalAtsAssemblyDocument> {
  const fullPath = path.join(FIXTURES_DIR, fixture);
  const buffer = fs.readFileSync(fullPath);
  const sourceFormat = fixture.toLowerCase().endsWith(".docx") ? "docx" : "pdf";
  const layoutResult = await analyzeDocument("resume", sourceFormat, buffer);
  const document = buildLosslessResumeDocument(layoutResult, { fileName: fixture, fileType: sourceFormat });
  const model = buildStructuredResume(document);
  return buildProfessionalAtsAssembly(model);
}
