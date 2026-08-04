/*
  TASK 8 - Density auto-fit. Tries all 4 densities in escalation order
  (DENSITY_ESCALATION_ORDER), measuring+packing each via a real browser
  pass (measurement.ts + paginationPlanner.ts), and picks whichever
  density yields the FEWEST pages - ties broken toward the LEAST
  compact (most readable) option, since page count is otherwise equal
  and comfortable spacing is strictly better for the reader.

  Why all 4, not "stop at first improvement": page count vs density is
  monotonic-non-increasing in practice (more compact spacing/font can
  only shrink content, never grow it - verified in
  paginationPlanner.test.ts's own "ultra-compact <= comfortable"
  assertion), but a single step (e.g. balanced -> compact) can
  legitimately show no improvement while a LATER step (compact ->
  ultra-compact) still does, so evaluating a step at a time and
  stopping on the first non-improvement could miss a real win.
  Evaluating all 4 is cheap (4 browser passes, not per-block/per-page)
  and matches this module's own name: "auto-FIT", not "auto-stop-early".

  Content is NEVER trimmed at any density (Phase 3's
  AssemblyCompactionPolicy already hardcodes every destructive flag
  false, unchanged here) - if even ultra-compact still needs multiple
  pages, that's the accepted, correct outcome (ADD a page, per spec),
  not a failure of this function.
*/
import { measureFlatContent } from "./measurement";
import { buildPaginationPlan } from "./paginationPlanner";
import { DENSITY_ESCALATION_ORDER } from "./designTokens";
import type { PaginationPlan, FlatMeasurementResult, PaperSize } from "./types";
import type { AssemblyDensity, ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";

export type DensityAutoFitResult = {
  density: AssemblyDensity;
  plan: PaginationPlan;
  measurement: FlatMeasurementResult;
  densityFallbackHistory: AssemblyDensity[];
};

export async function autoFitDensity(assembly: ProfessionalAtsAssemblyDocument, paperSize: PaperSize): Promise<DensityAutoFitResult> {
  const candidates: { density: AssemblyDensity; plan: PaginationPlan; measurement: FlatMeasurementResult }[] = [];

  for (const density of DENSITY_ESCALATION_ORDER) {
    const measurement = await measureFlatContent(assembly, paperSize, density);
    const plan = buildPaginationPlan(assembly, measurement, paperSize, density);
    candidates.push({ density, plan, measurement });
  }

  let best = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (candidate.plan.pageCount < best.plan.pageCount) {
      best = candidate;
    }
  }

  return {
    density: best.density,
    plan: best.plan,
    measurement: best.measurement,
    densityFallbackHistory: candidates.map((c) => c.density),
  };
}
