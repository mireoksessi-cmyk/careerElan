/*
  TASK 2 - Professional ATS v1's fixed section labels and order. Spec
  section 2: these labels are the ONE common English name used across
  all future templates for this slot - never the resume's own original
  section heading (that stays available via source trace / custom
  section metadata only, never as the displayed top-level label).
*/
import type { ProfessionalAtsSectionKey } from "./types";

export const PROFESSIONAL_ATS_SECTION_ORDER: ProfessionalAtsSectionKey[] = [
  "identity",
  "professional_summary",
  "core_skills",
  "professional_experience",
  "volunteer_experience",
  "education",
  "certifications_licenses",
  "projects",
  "awards",
  "publications",
  "additional_information",
];

export const PROFESSIONAL_ATS_SECTION_LABELS: Record<ProfessionalAtsSectionKey, string | null> = {
  identity: null,
  professional_summary: "PROFESSIONAL SUMMARY",
  core_skills: "CORE SKILLS",
  professional_experience: "PROFESSIONAL EXPERIENCE",
  volunteer_experience: "VOLUNTEER EXPERIENCE",
  education: "EDUCATION",
  certifications_licenses: "CERTIFICATIONS / LICENSES",
  projects: "PROJECTS",
  awards: "AWARDS",
  publications: "PUBLICATIONS",
  additional_information: "ADDITIONAL INFORMATION",
};
