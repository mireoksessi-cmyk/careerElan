/*
  Single source of truth for the resume template identifier shape,
  shared by every surface that renders a resume from DocumentIR
  (React Preview, PDF export, DOCX export). Nothing downstream should
  invent its own template string or its own default - they all call
  normalizeResumeTemplateId() and fall back to DEFAULT_RESUME_TEMPLATE.

  Canonical ids are lowercase ("classic"). The existing, already-working
  Career Memory template selector (app/career-memory/page.tsx) persists
  capitalized display labels ("Classic" / "Professional" / "Creative")
  into career_memory.resume_template - that storage format predates this
  migration and is left untouched (no unrelated UI/schema change), so
  normalizeResumeTemplateId() is also the bridge between that legacy
  casing and the canonical id used everywhere in lib/brand/render.
*/

export type ResumeTemplateId = "classic" | "professional" | "creative" | "modern";

export const RESUME_TEMPLATE_IDS: ResumeTemplateId[] = [
  "classic",
  "professional",
  "creative",
  "modern",
];

export const DEFAULT_RESUME_TEMPLATE: ResumeTemplateId = "classic";

const CANONICAL_ID_SET = new Set<string>(RESUME_TEMPLATE_IDS);

export function normalizeResumeTemplateId(value: unknown): ResumeTemplateId {
  if (typeof value !== "string") return DEFAULT_RESUME_TEMPLATE;

  const normalized = value.trim().toLowerCase();
  return CANONICAL_ID_SET.has(normalized)
    ? (normalized as ResumeTemplateId)
    : DEFAULT_RESUME_TEMPLATE;
}

export const RESUME_TEMPLATE_DISPLAY_LABEL: Record<ResumeTemplateId, string> = {
  classic: "Classic",
  professional: "Professional",
  creative: "Creative",
  modern: "Modern",
};
