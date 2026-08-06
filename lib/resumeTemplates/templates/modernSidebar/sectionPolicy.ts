/*
  Phase 6F - Template 2, Modern Sidebar section routing (spec section
  8 + the ATS reading-order requirement in spec section 3: DOM/manifest
  order stays identity -> summary -> experience -> education ->
  projects -> skills/languages regardless of the SIDEBAR's visual
  left-column placement of identity/skills/languages).

  Two independent content streams, each with its own pagination plan
  (see html.tsx): MAIN carries summary/experience/volunteer/projects/
  education/credentials/awards/publications/custom (everything except
  what's routed to the sidebar); SIDEBAR carries skills plus any
  custom section whose heading looks language-related (a heuristic,
  not a new canonical field - this type has no dedicated "languages"
  concept, see the Phase 6F pre-report's contentAdapters research).
  Identity itself is neither stream - it's a fixed masthead rendered
  once at the top of page 1's sidebar column only.
*/
import type { NormalizedCustomSection } from "../../shared/contentAdapters";

const LANGUAGE_HEADING_PATTERN = /langu(age|e)/i;

export function isLanguageCustomSection(section: NormalizedCustomSection): boolean {
  return LANGUAGE_HEADING_PATTERN.test(section.heading);
}

export const MODERN_SIDEBAR_MAIN_ORDER = ["summary", "experience", "volunteer", "projects", "education", "credentials", "awards", "publications", "custom"] as const;

export const MODERN_SIDEBAR_LABELS: Record<string, string> = {
  summary: "Profile",
  experience: "Experience",
  volunteer: "Volunteer Experience",
  projects: "Projects",
  education: "Education",
  credentials: "Certifications",
  awards: "Awards",
  publications: "Publications",
  custom: "Additional Information",
  skills: "Skills",
  languages: "Languages",
};
