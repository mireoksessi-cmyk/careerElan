/*
  Phase 6F - Template 3, Executive Minimal section order (spec section
  8). Extends the spec's own listed default (identity/metric
  highlights/executive summary/experience/projects/education/
  credentials/awards/publications/additional) with "skills" and
  "volunteer" - sections spec section 7 forbids ever silently dropping
  even when a template's own stated design doesn't foreground them.
*/
import type { SectionKey } from "../../shared/sectionAdapters";

export const EXECUTIVE_MINIMAL_SECTION_ORDER: SectionKey[] = ["identity", "metricHighlights", "summary", "skills", "experience", "volunteer", "projects", "education", "credentials", "awards", "publications", "custom"];

export const EXECUTIVE_MINIMAL_SECTION_LABELS: Partial<Record<SectionKey, string>> = {
  metricHighlights: "Highlights",
  summary: "Executive Summary",
  skills: "Core Competencies",
  experience: "Professional Experience",
  volunteer: "Board & Volunteer Leadership",
  projects: "Selected Initiatives",
  education: "Education",
  credentials: "Credentials",
  awards: "Awards & Recognition",
  publications: "Publications",
  custom: "Additional Information",
};
