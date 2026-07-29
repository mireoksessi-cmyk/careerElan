import { parseSections } from "./sectionParser";
import { parseExperienceEntries } from "./experienceParser";
import type { DocumentIR } from "./types";

/*
  PoC entry point - resume_text/cover_letter_text (plain string, exactly
  as Generate Package stored it, never touched) -> DocumentIR. Combines
  parseSections() (heading detection) with parseExperienceEntries()
  (best-effort per-role split, experience/volunteer sections only).
*/
export function buildDocumentIRFromText(text: string): DocumentIR {
  const ir = parseSections(text);

  return {
    ...ir,
    sections: ir.sections.map((section) => {
      if (section.key !== "experience" && section.key !== "volunteer") {
        return section;
      }

      return {
        ...section,
        experienceEntries: parseExperienceEntries(section.raw),
      };
    }),
  };
}
