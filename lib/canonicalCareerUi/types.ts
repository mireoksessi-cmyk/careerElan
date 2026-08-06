/*
  Phase 6E - shared type surface for the new Canonical Career Memory UI
  (app/canonical-career/**). Every type here is either a direct
  re-export of an existing Phase 6A-6D.1 type (so the UI and the
  backend can never silently drift apart) or a UI-only view type that
  has no backend equivalent (ConflictCard, MergePlan, etc.) - never a
  redefinition of a backend shape, which would risk the two diverging.
  This file imports read-only from lib/careerMemory/** and
  lib/documentPreservation/resumeStructured/types.ts - it does not
  modify either.
*/
import type {
  CareerProfileRow,
  CareerSourceDocumentRow,
  CareerResumeVersionRow,
  CareerTailoredResumeRow,
  CareerUserEditRow,
  GeneratedResumeDocumentRow,
} from "../careerMemory/persistence/types";
import type { CanonicalResumeRuntime } from "../careerMemory/runtime/types";
import type {
  ResumeStructuredModel,
  ExperienceEntry,
  EducationEntry,
  ProjectEntry,
  CredentialEntry,
  AwardEntry,
  PublicationEntry,
} from "../documentPreservation/resumeStructured/types";
import type { TailoredResumeOverlay, TailoredMergeRejection } from "../documentPreservation/resumeStructured/tailoredOverlay";

export type {
  CareerProfileRow,
  CareerSourceDocumentRow,
  CareerResumeVersionRow,
  CareerTailoredResumeRow,
  CareerUserEditRow,
  GeneratedResumeDocumentRow,
  CanonicalResumeRuntime,
  ResumeStructuredModel,
  ExperienceEntry,
  EducationEntry,
  ProjectEntry,
  CredentialEntry,
  AwardEntry,
  PublicationEntry,
  TailoredResumeOverlay,
  TailoredMergeRejection,
};

/* ---------------------------------------------------------------
   Conflict Resolver - UI-only view types
   ---------------------------------------------------------------
   A ConflictCard never appears in the backend - it is purely a
   client-side comparison of two entries drawn from two DIFFERENT
   ResumeStructuredModel snapshots (e.g. the current canonical resume
   vs. a version being restored/merged), surfaced so the user can pick
   one side manually. No auto-selection ever happens (spec section 9).
*/
export type ConflictEntryKind = "experience" | "education";

export type ConflictCard = {
  id: string;
  kind: ConflictEntryKind;
  /* Human label for the shared identity the two sides conflict on -
     e.g. the organization name or institution name both sides share. */
  sharedLabel: string;
  reasons: string[];
  left: { source: "base" | "incoming"; entry: ExperienceEntry | EducationEntry };
  right: { source: "base" | "incoming"; entry: ExperienceEntry | EducationEntry };
};

export type ConflictResolution =
  | { conflictId: string; choice: "left" }
  | { conflictId: string; choice: "right" }
  | { conflictId: string; choice: "both" };

/* ---------------------------------------------------------------
   Merge Wizard - UI-only view types
   ---------------------------------------------------------------
   Merging in this round is entirely user-driven (spec section 8: "자동
   Merge 금지"). MergeSelection records one decision per collection
   item; MergePreview is the pure, deterministic result of applying
   every recorded selection - never computed automatically without a
   selection for every item that needs one.
*/
export type MergeSectionKey = "professionalExperience" | "volunteerExperience" | "education" | "projects" | "credentials";

export type MergeItemChoice = "keep-base" | "take-incoming" | "keep-both";

export type MergeSelection = {
  section: MergeSectionKey;
  /* Index into the base OR incoming array this selection concerns -
     for "keep-both" this is not used to exclude anything, both survive
     as-is. */
  itemId: string;
  choice: MergeItemChoice;
};

export type MergePlan = {
  baseVersionId: string;
  incomingVersionId: string;
  selections: MergeSelection[];
  resolutions: ConflictResolution[];
};

export type MergePreviewSectionDiff = {
  section: MergeSectionKey;
  keptFromBase: number;
  takenFromIncoming: number;
  keptBoth: number;
  totalInPreview: number;
};

export type MergePreview = {
  resume: ResumeStructuredModel;
  sectionDiffs: MergePreviewSectionDiff[];
  unresolvedConflictIds: string[];
};

/* ---------------------------------------------------------------
   Version Compare - UI-only view types
   --------------------------------------------------------------- */
export type VersionDiffChangeKind = "added" | "removed" | "changed" | "unchanged";

export type VersionDiffRow = {
  section: MergeSectionKey | "identity" | "professionalSummary" | "skillGroups";
  label: string;
  change: VersionDiffChangeKind;
  before?: string;
  after?: string;
};

export type VersionDiffSummary = {
  fromVersionId: string;
  toVersionId: string;
  rows: VersionDiffRow[];
  addedCount: number;
  removedCount: number;
  changedCount: number;
};

/* ---------------------------------------------------------------
   Runtime Inspector - UI-only view types
   --------------------------------------------------------------- */
export type RuntimeInspectorSummary = {
  schemaVersion: string;
  serializerVersion: string;
  runtimeSerializerVersion: string;
  versionId: string;
  versionReason: string;
  parentVersionId?: string;
  overlayCount: number;
  sourceDocumentCount: number;
  validationPassed: boolean;
  validationWarningCount: number;
  entryCounts: Record<MergeSectionKey, number>;
};
