import type { SectionKey } from "./types";

/*
  Display label per SectionKey - shared by the PoC preview
  (components/brand/BrandedResumeTextPreview.tsx) and the production
  DocumentIR renderers (lib/brand/render/*) so both show the same section
  titles instead of maintaining two copies of this mapping.
*/
export const SECTION_HEADING_LABELS: Record<SectionKey, string> = {
  summary: "Professional Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  projects: "Projects",
  certifications: "Certifications",
  languages: "Languages",
  volunteer: "Volunteer / Internship",
  references: "References",
};
