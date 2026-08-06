/*
  Phase 6E - Conflict Resolver (spec section 9). Pure detection only -
  NEVER auto-selects a side. Given two ResumeStructuredModel snapshots
  ("base" = the current canonical resume, "incoming" = a version/import
  being merged in), finds pairs of entries that plausibly describe the
  SAME real-world thing (same company, same school) but disagree on
  details (dates, role, program) - exactly the shape spec section 9
  calls out: "동일 회사 다른 기간", "다른 직책", "동일 학교", "다른 Program".

  A pair is only ever flagged when the two entries have DIFFERENT ids -
  same-id entries are a version_compare concern (changed vs unchanged),
  not a conflict-resolver concern (which side to keep). Matching is by
  normalized organization/institution name (trim + lowercase +
  collapse whitespace) - deliberately NOT fuzzy/typo-tolerant, since a
  false-positive "conflict" the user must manually dismiss is a much
  smaller cost than a false-negative that silently double-counts the
  same job/degree as two separate entries with no comparison offered.
*/
import type { ResumeStructuredModel, ExperienceEntry, EducationEntry, ConflictCard } from "./types";

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function textOf(v: { value: string } | undefined): string | undefined {
  return v?.value;
}

export function detectExperienceConflicts(base: ExperienceEntry[], incoming: ExperienceEntry[]): ConflictCard[] {
  const cards: ConflictCard[] = [];
  for (const baseEntry of base) {
    const baseOrg = normalize(textOf(baseEntry.organization));
    if (!baseOrg) continue;
    for (const incomingEntry of incoming) {
      if (incomingEntry.id === baseEntry.id) continue;
      const incomingOrg = normalize(textOf(incomingEntry.organization));
      if (incomingOrg !== baseOrg) continue;

      const reasons: string[] = [];
      const baseDates = textOf(baseEntry.dateRangeText);
      const incomingDates = textOf(incomingEntry.dateRangeText);
      if (baseDates !== incomingDates) reasons.push(`Different date range: "${baseDates ?? "(none)"}" vs "${incomingDates ?? "(none)"}"`);

      const baseRole = textOf(baseEntry.role);
      const incomingRole = textOf(incomingEntry.role);
      if (baseRole !== incomingRole) reasons.push(`Different role: "${baseRole ?? "(none)"}" vs "${incomingRole ?? "(none)"}"`);

      if (reasons.length === 0) continue;

      cards.push({
        id: `experience:${baseEntry.id}:${incomingEntry.id}`,
        kind: "experience",
        sharedLabel: textOf(baseEntry.organization) ?? "(unlabeled organization)",
        reasons,
        left: { source: "base", entry: baseEntry },
        right: { source: "incoming", entry: incomingEntry },
      });
    }
  }
  return cards;
}

export function detectEducationConflicts(base: EducationEntry[], incoming: EducationEntry[]): ConflictCard[] {
  const cards: ConflictCard[] = [];
  for (const baseEntry of base) {
    const baseInstitution = normalize(textOf(baseEntry.institution));
    if (!baseInstitution) continue;
    for (const incomingEntry of incoming) {
      if (incomingEntry.id === baseEntry.id) continue;
      const incomingInstitution = normalize(textOf(incomingEntry.institution));
      if (incomingInstitution !== baseInstitution) continue;

      const reasons: string[] = [];
      const baseField = textOf(baseEntry.fieldOfStudy);
      const incomingField = textOf(incomingEntry.fieldOfStudy);
      if (baseField !== incomingField) reasons.push(`Different program: "${baseField ?? "(none)"}" vs "${incomingField ?? "(none)"}"`);

      const baseCredential = textOf(baseEntry.credential);
      const incomingCredential = textOf(incomingEntry.credential);
      if (baseCredential !== incomingCredential) reasons.push(`Different credential: "${baseCredential ?? "(none)"}" vs "${incomingCredential ?? "(none)"}"`);

      if (reasons.length === 0) continue;

      cards.push({
        id: `education:${baseEntry.id}:${incomingEntry.id}`,
        kind: "education",
        sharedLabel: textOf(baseEntry.institution) ?? "(unlabeled institution)",
        reasons,
        left: { source: "base", entry: baseEntry },
        right: { source: "incoming", entry: incomingEntry },
      });
    }
  }
  return cards;
}

export function detectAllConflicts(base: ResumeStructuredModel, incoming: ResumeStructuredModel): ConflictCard[] {
  return [
    ...detectExperienceConflicts(base.professionalExperience, incoming.professionalExperience),
    ...detectExperienceConflicts(base.volunteerExperience, incoming.volunteerExperience),
    ...detectEducationConflicts(base.education, incoming.education),
  ];
}
