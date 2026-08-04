/*
  Section 7 of the spec - alias dictionary as a single registry/data map,
  not if/else scattered across files. Deliberately NOT reusing
  lib/brand/sectionParser.ts's matchHeading()/HEADING_DICTIONARY directly
  - that dictionary only covers 9 SectionKey values (this module needs
  17 SemanticSectionType values, e.g. "licenses" vs "certifications" kept
  distinct, "objective"/"awards"/"publications"/"training"/
  "professional_development"/"affiliations"/"interests" that
  sectionParser.ts has no entries for at all) and is scoped to AI-
  generated-text parsing, a different concern than this module's -
  extending that shared enum to 17 values would change AI-facing
  behavior elsewhere, out of scope this round.

  Matching rule (used by both sectionBoundaryDetector.ts and
  classifier.ts): EXACT match only, against the normalized heading text
  (see normalizeHeading in classifier.ts) - never substring/fuzzy match.
  "Experience Highlights" does NOT match "experience" here on purpose
  (ambiguous per section 7's own instruction) - it falls through to
  content-rule classification instead.
*/
import type { SemanticSectionType } from "./types";

export const ALIAS_DICTIONARY: Record<Exclude<SemanticSectionType, "custom">, string[]> = {
  summary: [
    "summary",
    "professional summary",
    "career summary",
    "executive summary",
    "profile",
    "professional profile",
    "career profile",
    "executive profile",
    "qualifications summary",
    "summary of qualifications",
  ],
  objective: ["objective", "career objective", "professional objective"],
  experience: [
    "experience",
    "work experience",
    "professional experience",
    "relevant experience",
    "employment",
    "employment history",
    "work history",
    "career history",
    "professional background",
  ],
  education: [
    "education",
    "academic background",
    "academic history",
    "academic qualifications",
    "educational background",
  ],
  skills: [
    "skills",
    "core skills",
    "key skills",
    "technical skills",
    "professional skills",
    "core competencies",
    "competencies",
    "areas of expertise",
    "expertise",
  ],
  projects: ["projects", "selected projects", "key projects", "academic projects", "professional projects"],
  awards: ["awards", "honors", "honours", "awards and honors", "awards and honours", "achievements", "distinctions"],
  licenses: ["licenses", "licences", "professional licenses", "professional licences", "registrations"],
  certifications: ["certifications", "certificates", "professional certifications", "credentials"],
  volunteering: ["volunteer experience", "volunteering", "community involvement", "community service", "civic engagement"],
  publications: ["publications", "selected publications", "research publications"],
  training: ["training", "courses", "relevant coursework", "additional training"],
  professional_development: ["professional development", "continuing education", "continuing professional development"],
  affiliations: ["affiliations", "professional affiliations", "memberships", "professional memberships", "associations"],
  languages: ["languages", "language skills", "linguistic skills"],
  interests: ["interests", "hobbies", "activities and interests"],
  references: ["references", "professional references"],
};

/*
  Reverse lookup, built once - normalized alias string -> section type.
  "Licenses & Certifications" (a combined heading present in real
  fixtures) is deliberately NOT added as its own alias key here - see
  section 7's own instruction "한 제목에 두 의미가 결합된 경우 강제
  분해하지 않는다" - a combined heading that doesn't exact-match either
  list falls through to custom, which is the correct/expected outcome,
  not a dictionary gap to patch.
*/
export function buildAliasLookup(): Map<string, Exclude<SemanticSectionType, "custom">> {
  const lookup = new Map<string, Exclude<SemanticSectionType, "custom">>();
  for (const [type, aliases] of Object.entries(ALIAS_DICTIONARY) as [
    Exclude<SemanticSectionType, "custom">,
    string[],
  ][]) {
    for (const alias of aliases) {
      lookup.set(alias, type);
    }
  }
  return lookup;
}

export function matchAlias(normalizedHeading: string): Exclude<SemanticSectionType, "custom"> | null {
  return ALIAS_LOOKUP.get(normalizedHeading) ?? null;
}

const ALIAS_LOOKUP = buildAliasLookup();
