/*
  PoC-only types for the Section Parser / DocumentIR experiment (see
  sectionParser.ts / buildDocumentIR.ts / components/brand/
  BrandedResumeTextPreview.tsx). Not wired into any production route -
  this module exists purely to let app/dev/brand-poc/page.tsx render a
  resume_text-derived preview next to the existing
  CareerMemoryTemplatePreview for side-by-side comparison.
*/

export type SectionKey =
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "projects"
  | "certifications"
  | "languages"
  | "volunteer"
  | "references";

/*
  One entry inside an "experience" (or "volunteer") section. `raw` is
  ALWAYS the exact original text for this entry, untouched - `structured`
  is only true when the parser is confident enough to also offer
  jobTitle/company/dates/description split out. Renderers must fall back
  to displaying `raw` whenever `structured` is false; they must never
  invent a title/company/date the parser wasn't confident about.
*/
export type ParsedExperienceEntry = {
  raw: string;
  structured: boolean;
  jobTitle?: string;
  company?: string;
  dates?: string;
  description?: string;
};

export type ParsedSection = {
  key: SectionKey;
  /* The exact heading line found in resume_text, verbatim (not the
     normalized dictionary key) - e.g. "WORK EXPERIENCE" vs "Experience". */
  headingText: string;
  /* Exact original body text for this section, never modified. */
  raw: string;
  /* Only populated for key === "experience" | "volunteer". */
  experienceEntries?: ParsedExperienceEntry[];
};

export type DocumentIR = {
  sections: ParsedSection[];
  /* Text that appeared before the first recognized heading (typically
     contact info, or an unlabeled opening summary paragraph). Never
     dropped - always surfaced somewhere by the renderer. */
  leadingText: string;
};
