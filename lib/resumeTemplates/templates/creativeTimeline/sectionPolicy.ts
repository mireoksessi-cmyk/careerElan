/*
  Phase 6F - Template 4, Creative Timeline section routing (spec
  section 8). Same two-stream approach as Modern Sidebar
  (sectionPolicy.ts's own header comment applies here too): MAIN
  carries summary/experience-timeline/education-timeline/projects/
  credentials/awards/publications/custom; SIDEBAR carries skills,
  language-heading custom sections, and reference/interest-heading
  custom sections (spec section 3's "선택적 references/interests").
*/
import type { NormalizedCustomSection } from "../../shared/contentAdapters";

const LANGUAGE_HEADING_PATTERN = /langu(age|e)/i;
const SIDEBAR_EXTRA_PATTERN = /reference|interest/i;

export function isLanguageCustomSection(section: NormalizedCustomSection): boolean {
  return LANGUAGE_HEADING_PATTERN.test(section.heading);
}

export function isSidebarExtraCustomSection(section: NormalizedCustomSection): boolean {
  return SIDEBAR_EXTRA_PATTERN.test(section.heading);
}

export const CREATIVE_TIMELINE_LABELS: Record<string, string> = {
  summary: "Profile",
  experience: "Work Experience",
  volunteer: "Volunteer Experience",
  education: "Education",
  projects: "Projects",
  credentials: "Credentials",
  awards: "Awards",
  publications: "Publications",
  custom: "Additional Information",
  skills: "Skills",
  languages: "Languages",
  contact: "Contact",
};
