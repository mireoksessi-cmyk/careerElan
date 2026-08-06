/*
  Phase 6F - capability-matrix helpers built on top of the registry
  (spec section 18's Template Capability Matrix). Pure read-side
  helpers only; registration itself lives in registry/templateRegistry.ts.
*/
import { listTemplates } from "../registry/templateRegistry";
import type { TemplateCapabilities, TemplateId } from "../contracts/types";

export type CapabilityMatrixRow = {
  feature: string;
  values: Record<TemplateId, boolean | string>;
};

/*
  A flattened, template-agnostic view of every boolean/level capability
  field, keyed by feature name - the exact shape spec section 18 asks
  the final report's Capability Matrix table to be built from.
*/
export function buildCapabilityMatrix(): CapabilityMatrixRow[] {
  const templates = listTemplates();
  const booleanFeatures: Array<[string, keyof TemplateCapabilities]> = [
    ["photo", "supportsPhoto"],
    ["sidebar", "supportsSidebar"],
    ["metricGrid", "supportsMetricGrid"],
    ["hierarchy", "supportsHierarchy"],
    ["languages", "supportsLanguages"],
    ["customSections", "supportsCustomSections"],
    ["multiPage", "supportsMultiplePages"],
  ];

  const rows: CapabilityMatrixRow[] = booleanFeatures.map(([feature, key]) => ({
    feature,
    values: Object.fromEntries(templates.map((t) => [t.id, Boolean(t[key])])) as Record<TemplateId, boolean | string>,
  }));

  rows.push({ feature: "atsLevel", values: Object.fromEntries(templates.map((t) => [t.id, t.atsLevel])) as Record<TemplateId, boolean | string> });
  rows.push({ feature: "formats", values: Object.fromEntries(templates.map((t) => [t.id, t.supportedFormats.join("/")])) as Record<TemplateId, boolean | string> });
  rows.push({ feature: "paperSizes", values: Object.fromEntries(templates.map((t) => [t.id, t.supportedPaperSizes.join("/")])) as Record<TemplateId, boolean | string> });

  return rows;
}

export function supportsFeature(id: TemplateId, feature: keyof TemplateCapabilities): boolean {
  const capabilities = listTemplates().find((t) => t.id === id);
  if (!capabilities) return false;
  return Boolean(capabilities[feature]);
}
