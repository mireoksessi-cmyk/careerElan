/*
  Phase 6E - Version Compare (spec section "Resume Version Compare").
  Pure, read-only diff between two ResumeStructuredModel snapshots (two
  CareerResumeVersionRow.snapshot values, or a version's snapshot vs.
  the current tailored/canonical resume). Never mutates either input,
  never calls the network - the UI passes in already-fetched data.

  Entry-list sections (experience/education/projects/credentials) are
  compared BY ID: an id present in only one side is added/removed; an
  id present in both is compared by rawHeaderText + a content
  fingerprint (join of every bullet/content-block text) to decide
  changed vs unchanged - never a deep-equal of the full entry object,
  since two extractions of the identical text can legitimately differ
  in confidence/extractionMethod/source without the user-visible
  content having changed at all.
*/
import type {
  ResumeStructuredModel,
  ExperienceEntry,
  EducationEntry,
  ProjectEntry,
  CredentialEntry,
  VersionDiffRow,
  VersionDiffSummary,
  MergeSectionKey,
} from "./types";

function textOf(v: { value: string } | undefined): string {
  return v?.value ?? "";
}

function entryLabel(kind: "experience" | "education" | "project" | "credential", entry: ExperienceEntry | EducationEntry | ProjectEntry | CredentialEntry): string {
  if (kind === "experience") {
    const e = entry as ExperienceEntry;
    return textOf(e.organization) || e.rawHeaderText || e.id;
  }
  if (kind === "education") {
    const e = entry as EducationEntry;
    return textOf(e.institution) || e.rawHeaderText || e.id;
  }
  if (kind === "project") {
    const e = entry as ProjectEntry;
    return textOf(e.name) || e.rawHeaderText || e.id;
  }
  const e = entry as CredentialEntry;
  return textOf(e.name) || e.rawHeaderText || e.id;
}

/*
  Per-kind scalar field lists - NOT a blanket introspection of every
  object property. Two real reasons: (1) each `source` trace is a
  provenance pointer (sourceSectionId/sourceBlockIds/sourceElementIds),
  not user-visible content - two extractions of the IDENTICAL text can
  legitimately land a different trace, and a blanket walk would wrongly
  flag that as "changed"; (2) confidence/extractionMethod/isUncertain/
  reasonCodes describe the extractor's own certainty, not what the
  reader sees. Listing exactly the fields a change actually shows up
  in keeps the diff honest without either of those false positives.
*/
const SCALAR_FIELDS_BY_KIND: Record<"experience" | "education" | "project" | "credential", string[]> = {
  experience: ["organization", "role", "location", "startDateText", "endDateText", "dateRangeText"],
  education: ["institution", "credential", "fieldOfStudy", "location", "startDateText", "endDateText", "dateRangeText", "gpa"],
  project: ["name", "role", "dateRangeText"],
  credential: ["name", "issuer", "credentialId", "issueDateText", "expiryDateText", "location"],
};

function contentFingerprint(kind: "experience" | "education" | "project" | "credential", entry: ExperienceEntry | EducationEntry | ProjectEntry | CredentialEntry): string {
  const record = entry as unknown as Record<string, { value: string } | undefined>;
  const parts: string[] = [entry.rawHeaderText];
  for (const field of SCALAR_FIELDS_BY_KIND[kind]) {
    parts.push(record[field]?.value ?? "");
  }
  const withContent = entry as { content?: { text: string }[] };
  if (Array.isArray(withContent.content)) parts.push(...withContent.content.map((c) => c.text));
  const withDetails = entry as { details?: { value: string }[] };
  if (Array.isArray(withDetails.details)) parts.push(...withDetails.details.map((d) => d.value));
  const withTechnologies = entry as { technologies?: { value: string }[] };
  if (Array.isArray(withTechnologies.technologies)) parts.push(...withTechnologies.technologies.map((t) => t.value));
  return parts.join("\n");
}

function diffEntryList<T extends { id: string }>(
  section: MergeSectionKey,
  kind: "experience" | "education" | "project" | "credential",
  before: T[],
  after: T[]
): VersionDiffRow[] {
  const beforeById = new Map(before.map((e) => [e.id, e]));
  const afterById = new Map(after.map((e) => [e.id, e]));
  const rows: VersionDiffRow[] = [];

  for (const [id, entry] of beforeById) {
    if (!afterById.has(id)) {
      rows.push({ section, label: entryLabel(kind, entry as never), change: "removed", before: entryLabel(kind, entry as never) });
    }
  }
  for (const [id, entry] of afterById) {
    const beforeEntry = beforeById.get(id);
    if (!beforeEntry) {
      rows.push({ section, label: entryLabel(kind, entry as never), change: "added", after: entryLabel(kind, entry as never) });
      continue;
    }
    const changed = contentFingerprint(kind, beforeEntry as never) !== contentFingerprint(kind, entry as never);
    rows.push({
      section,
      label: entryLabel(kind, entry as never),
      change: changed ? "changed" : "unchanged",
      before: changed ? entryLabel(kind, beforeEntry as never) : undefined,
      after: changed ? entryLabel(kind, entry as never) : undefined,
    });
  }
  return rows;
}

export function compareResumeVersions(fromVersionId: string, toVersionId: string, before: ResumeStructuredModel, after: ResumeStructuredModel): VersionDiffSummary {
  const rows: VersionDiffRow[] = [];

  const beforeName = textOf(before.identity?.fullName);
  const afterName = textOf(after.identity?.fullName);
  rows.push({ section: "identity", label: "Full name", change: beforeName === afterName ? "unchanged" : "changed", before: beforeName || undefined, after: afterName || undefined });

  const beforeHeadline = textOf(before.identity?.headline);
  const afterHeadline = textOf(after.identity?.headline);
  rows.push({ section: "identity", label: "Headline", change: beforeHeadline === afterHeadline ? "unchanged" : "changed", before: beforeHeadline || undefined, after: afterHeadline || undefined });

  const beforeSummary = before.professionalSummary?.text ?? "";
  const afterSummary = after.professionalSummary?.text ?? "";
  rows.push({
    section: "professionalSummary",
    label: "Professional summary",
    change: beforeSummary === afterSummary ? "unchanged" : beforeSummary === "" ? "added" : afterSummary === "" ? "removed" : "changed",
    before: beforeSummary || undefined,
    after: afterSummary || undefined,
  });

  const beforeSkills = before.skillGroups.flatMap((g) => g.skills).join(", ");
  const afterSkills = after.skillGroups.flatMap((g) => g.skills).join(", ");
  rows.push({ section: "skillGroups", label: "Skills", change: beforeSkills === afterSkills ? "unchanged" : "changed", before: beforeSkills || undefined, after: afterSkills || undefined });

  rows.push(...diffEntryList("professionalExperience", "experience", before.professionalExperience, after.professionalExperience));
  rows.push(...diffEntryList("volunteerExperience", "experience", before.volunteerExperience, after.volunteerExperience));
  rows.push(...diffEntryList("education", "education", before.education, after.education));
  rows.push(...diffEntryList("projects", "project", before.projects, after.projects));
  rows.push(...diffEntryList("credentials", "credential", before.credentials, after.credentials));

  return {
    fromVersionId,
    toVersionId,
    rows,
    addedCount: rows.filter((r) => r.change === "added").length,
    removedCount: rows.filter((r) => r.change === "removed").length,
    changedCount: rows.filter((r) => r.change === "changed").length,
  };
}
