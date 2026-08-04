/*
  Orchestrator - ties TASK 5-9 together into one
  ProfessionalAtsHtmlPreviewDocument (types.ts's own top-level
  contract): auto-fit density (measure+plan at all 4 densities, pick
  fewest pages) -> real per-page verify pass at the chosen density ->
  full HTML validation. Mirrors Phase 3's buildProfessionalAtsAssembly
  orchestrator pattern - a thin composition, no new decision logic of
  its own.
*/
import { autoFitDensity } from "./densityAutoFit";
import { verifyPaginatedPages } from "./pageVerification";
import { validateProfessionalAtsHtml } from "./htmlValidator";
import type { ProfessionalAtsHtmlPreviewDocument, PaperSize } from "./types";
import type { ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";

export const PROFESSIONAL_ATS_HTML_SCHEMA_VERSION = "1.0.0";

export async function buildProfessionalAtsHtmlPreview(
  assembly: ProfessionalAtsAssemblyDocument,
  paperSize: PaperSize
): Promise<ProfessionalAtsHtmlPreviewDocument> {
  const fit = await autoFitDensity(assembly, paperSize);
  const measurement = await verifyPaginatedPages(assembly, fit.plan, paperSize, fit.density);
  const validation = await validateProfessionalAtsHtml(assembly, fit.plan, fit.measurement, paperSize, fit.density);

  return {
    schemaVersion: PROFESSIONAL_ATS_HTML_SCHEMA_VERSION,
    templateId: "professional-ats-v1",
    sourceModelVersion: assembly.schemaVersion,
    paperSize,
    plan: fit.plan,
    measurement,
    validation,
    densityFallbackHistory: fit.densityFallbackHistory,
  };
}
