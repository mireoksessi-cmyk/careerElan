/*
  Phase 6F - shared section-visibility/ordering helpers. Each
  template's own sectionPolicy.ts (under templates/<name>/) defines
  its section ORDER (spec section 8); this file supplies the one shared "does this
  section actually have content" check so all 4 policies agree on what
  counts as empty, and a shared decision-list builder that respects an
  optional caller override (TemplateRenderContext.sectionVisibility -
  reserved for a future editing UI, spec section 8's own note that this
  round builds no such UI yet).

  A template is never allowed to drop a non-empty section outright
  (spec section 7): "not supported" must route to a general-purpose
  fallback (e.g. "Additional Information"), never to silence. This
  file only decides visible/hidden for a section's OWN placement; the
  fallback-routing decision itself is each template's responsibility
  since it depends on that template's own section list.
*/
import type { NormalizedResume } from "./contentAdapters";

export type SectionKey =
  | "identity"
  | "summary"
  | "metricHighlights"
  | "skills"
  | "experience"
  | "volunteer"
  | "education"
  | "credentials"
  | "projects"
  | "awards"
  | "publications"
  | "custom"
  | "additional";

export type SectionVisibilityDecision = {
  key: SectionKey;
  visible: boolean;
  reason: "has-content" | "empty";
};

export function sectionHasContent(normalized: NormalizedResume, key: SectionKey): boolean {
  switch (key) {
    case "identity":
      return Boolean(normalized.identity.fullName) || normalized.identity.otherContactLines.length > 0;
    case "summary":
      return normalized.summary.trim().length > 0;
    case "metricHighlights":
      return normalized.metricGrids.some((grid) => grid.entries.length > 0);
    case "skills":
      return normalized.skillGroups.some((group) => group.skills.length > 0);
    case "experience":
      return normalized.professionalExperience.length > 0;
    case "volunteer":
      return normalized.volunteerExperience.length > 0;
    case "education":
      return normalized.education.length > 0;
    case "credentials":
      return normalized.credentials.length > 0;
    case "projects":
      return normalized.projects.length > 0;
    case "awards":
      return normalized.awards.length > 0;
    case "publications":
      return normalized.publications.length > 0;
    case "custom":
    case "additional":
      return normalized.customSections.length > 0;
    default:
      return false;
  }
}

export function computeSectionVisibility(order: SectionKey[], normalized: NormalizedResume, overrides?: Record<string, boolean>): SectionVisibilityDecision[] {
  return order.map((key) => {
    const overridden = overrides?.[key];
    const hasContent = sectionHasContent(normalized, key);
    const visible = overridden ?? hasContent;
    return { key, visible, reason: hasContent ? "has-content" : "empty" };
  });
}

export function visibleSectionKeys(order: SectionKey[], normalized: NormalizedResume, overrides?: Record<string, boolean>): SectionKey[] {
  return computeSectionVisibility(order, normalized, overrides)
    .filter((d) => d.visible)
    .map((d) => d.key);
}
