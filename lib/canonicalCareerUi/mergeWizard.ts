/*
  Phase 6E - Merge Wizard (spec section 8: "자동 Merge 금지... 사용자가
  Experience/Education/Project/Credential/Conflict를 하나씩 선택. Merge
  Preview 제공."). computeMergePreview is a PURE function - it never
  invents a choice for an item the caller hasn't explicitly decided.
  An item with no matching MergeSelection (and not covered by a
  resolved ConflictResolution) is simply left OUT of the preview - the
  UI is expected to show it separately as "awaiting your selection"
  rather than this module guessing on the user's behalf.

  Conflict handling: entries detected by conflictDetection.ts as a
  ConflictCard are resolved via `plan.resolutions` (left/right/both),
  NOT via a plain per-item MergeSelection - a conflicting pair is
  reasoned about together, not as two independent items. Any entry
  that is one side of an UNRESOLVED conflict is also left out of the
  preview and its conflictId is reported in unresolvedConflictIds, so
  the UI can block "Finalize Merge" until every conflict has a choice.
*/
import type {
  ResumeStructuredModel,
  MergePlan,
  MergePreview,
  MergePreviewSectionDiff,
  MergeSectionKey,
  ConflictCard,
  ExperienceEntry,
  EducationEntry,
  ProjectEntry,
  CredentialEntry,
} from "./types";
import { detectAllConflicts } from "./conflictDetection";

type SectionEntry = ExperienceEntry | EducationEntry | ProjectEntry | CredentialEntry;

function sectionArray(model: ResumeStructuredModel, section: MergeSectionKey): SectionEntry[] {
  switch (section) {
    case "professionalExperience":
      return model.professionalExperience;
    case "volunteerExperience":
      return model.volunteerExperience;
    case "education":
      return model.education;
    case "projects":
      return model.projects;
    case "credentials":
      return model.credentials;
  }
}

function withSectionArray<T extends SectionEntry>(model: ResumeStructuredModel, section: MergeSectionKey, entries: T[]): ResumeStructuredModel {
  return { ...model, [section]: entries } as ResumeStructuredModel;
}

/*
  conflictedIds: the set of entry ids (from EITHER side) that appear in
  at least one detected conflict, keyed by section - these ids are
  excluded from the plain per-item selection pass and handled only via
  plan.resolutions.
*/
function conflictedIdsBySection(conflicts: ConflictCard[]): Record<MergeSectionKey, Set<string>> {
  const bySection: Record<MergeSectionKey, Set<string>> = {
    professionalExperience: new Set(),
    volunteerExperience: new Set(),
    education: new Set(),
    projects: new Set(),
    credentials: new Set(),
  };
  for (const card of conflicts) {
    const section: MergeSectionKey = card.kind === "experience" ? "professionalExperience" : "education";
    bySection[section].add(card.left.entry.id);
    bySection[section].add(card.right.entry.id);
  }
  return bySection;
}

export function computeMergePreview(base: ResumeStructuredModel, incoming: ResumeStructuredModel, plan: MergePlan): MergePreview {
  const conflicts = detectAllConflicts(base, incoming);
  const conflictedIds = conflictedIdsBySection(conflicts);
  const resolutionByConflictId = new Map(plan.resolutions.map((r) => [r.conflictId, r]));

  const sections: MergeSectionKey[] = ["professionalExperience", "volunteerExperience", "education", "projects", "credentials"];
  const sectionDiffs: MergePreviewSectionDiff[] = [];
  const resultBySection: Partial<Record<MergeSectionKey, SectionEntry[]>> = {};

  for (const section of sections) {
    const baseEntries = sectionArray(base, section);
    const incomingEntries = sectionArray(incoming, section);
    const baseById = new Map(baseEntries.map((e) => [e.id, e]));
    const incomingById = new Map(incomingEntries.map((e) => [e.id, e]));
    const conflictedForSection = conflictedIds[section];

    const candidateIds = new Set<string>([...baseById.keys(), ...incomingById.keys()]);
    const selectionByItemId = new Map(plan.selections.filter((s) => s.section === section).map((s) => [s.itemId, s]));

    const result: SectionEntry[] = [];
    let keptFromBase = 0;
    let takenFromIncoming = 0;
    let keptBoth = 0;

    for (const id of candidateIds) {
      if (conflictedForSection.has(id)) continue; // handled via conflict resolutions below, not here
      const selection = selectionByItemId.get(id);
      if (!selection) continue; // no explicit decision yet - omitted, never guessed

      if (selection.choice === "keep-base") {
        const entry = baseById.get(id);
        if (entry) {
          result.push(entry);
          keptFromBase++;
        }
      } else if (selection.choice === "take-incoming") {
        const entry = incomingById.get(id);
        if (entry) {
          result.push(entry);
          takenFromIncoming++;
        }
      } else if (selection.choice === "keep-both") {
        const baseEntry = baseById.get(id);
        const incomingEntry = incomingById.get(id);
        if (baseEntry) result.push(baseEntry);
        if (incomingEntry && incomingEntry !== baseEntry) result.push(incomingEntry);
        keptBoth++;
      }
    }

    for (const card of conflicts) {
      const cardSection: MergeSectionKey = card.kind === "experience" ? "professionalExperience" : "education";
      if (cardSection !== section) continue;
      const resolution = resolutionByConflictId.get(card.id);
      if (!resolution) continue;
      if (resolution.choice === "left") {
        result.push(card.left.entry as SectionEntry);
        keptFromBase++;
      } else if (resolution.choice === "right") {
        result.push(card.right.entry as SectionEntry);
        takenFromIncoming++;
      } else {
        result.push(card.left.entry as SectionEntry, card.right.entry as SectionEntry);
        keptBoth++;
      }
    }

    resultBySection[section] = result;
    sectionDiffs.push({ section, keptFromBase, takenFromIncoming, keptBoth, totalInPreview: result.length });
  }

  let resume = base;
  for (const section of sections) {
    resume = withSectionArray(resume, section, resultBySection[section] ?? []);
  }

  const unresolvedConflictIds = conflicts.filter((c) => !resolutionByConflictId.has(c.id)).map((c) => c.id);

  return { resume, sectionDiffs, unresolvedConflictIds };
}
