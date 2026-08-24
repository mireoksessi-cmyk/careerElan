/*
  Professional ATS Assembly Engine - Phase 3 feasibility gate. Consumes
  Phase 2's ResumeStructuredModel (lib/documentPreservation/
  resumeStructured) and decides section visibility, fixed ordering,
  entry-to-block grouping, and renderer-independent layout intent for
  Career Élan's first standard output format, "Professional ATS".

  This module does NOT render HTML/CSS, does NOT compute real pixel
  heights or page counts, and is not wired into Career Memory or
  Generate Package. See buildProfessionalAtsAssembly.ts's own header
  comment for the full list of what this phase deliberately does not do.

  Core invariant (mirrors Phase 1/2's own): every Phase 2 entry/value
  that has real content must end up represented by exactly one
  AssemblyBlock - never silently dropped, never invented, never
  duplicated. Content itself (bullet text, dates, org names) is never
  rewritten here - Phase 3 only decides visibility/order/grouping/break
  intent around content Phase 2 already produced.
*/
import type { LanguageEntry } from "../resumeStructured/types";

export type ProfessionalAtsSectionKey =
  | "identity"
  | "professional_summary"
  | "metric_highlights"
  | "core_skills"
  | "professional_experience"
  | "volunteer_experience"
  | "education"
  | "certifications_licenses"
  | "projects"
  | "awards"
  | "publications"
  | "additional_information";

export type AssemblyVisibilityReason =
  | "has-content"
  | "empty"
  | "whitespace-only"
  | "no-valid-entries"
  | "moved-to-additional"
  | "suppressed-by-policy";

export type BreakPolicy = "avoid" | "allow" | "force-before" | "force-after";

export type KeepTogetherPolicy =
  | "none"
  | "heading-with-first-item"
  | "entry-header-with-first-content"
  | "whole-entry-if-fits"
  | "whole-block";

export type AssemblyDensity = "comfortable" | "balanced" | "compact" | "ultra-compact";

export type AssemblyBlockKind =
  | "identity"
  | "summary"
  | "skill-group"
  | "experience-entry"
  | "volunteer-entry"
  | "education-entry"
  | "credential-entry"
  | "project-entry"
  | "award-entry"
  | "publication-entry"
  | "custom-section"
  | "custom-paragraph"
  | "custom-bullet-group"
  | "metric-grid";

export type AssemblySplitStrategy = "none" | "between-bullets" | "between-paragraphs" | "between-items";

export type AssemblyBlock = {
  id: string;
  kind: AssemblyBlockKind;

  sourceEntryId?: string;
  sourceSectionIds: string[];
  sourceBlockIds: string[];

  /* Deterministic, renderer-agnostic relative content size - see
     contentUnits.ts. NOT a pixel height, NOT a line count - only
     comparable to other AssemblyBlocks' estimatedContentUnits within
     the same document. */
  estimatedContentUnits: number;
  /* The minimum unit count that must stay together with this block's
     header per keepTogether (e.g. header + first bullet). */
  minVisibleContentUnits: number;

  breakPolicy: BreakPolicy;
  keepTogether: KeepTogetherPolicy;

  canSplit: boolean;
  splitStrategy: AssemblySplitStrategy;

  priority: number;
  isOptional: boolean;
  isUncertain: boolean;

  payload: unknown;

  /*
    Languages only. A resume's Languages section reaches Phase 2 as a
    CustomResumeSection whose lines are UNPAIRED ("English", "French",
    "Native or Bilingual", "Native or Bilingual" as four separate
    values), while languageExtractor has ALREADY paired the same lines
    into model.languages. Rendering the raw section leaves a reader with
    four detached lines instead of two entries.

    These are the extractor's own LanguageEntry objects, carried BESIDE
    the payload rather than folded into it: `payload` stays the exact
    model.customSections[i] reference, so assemblyValidator's identity
    provenance check (its check E) still traces this block to a real
    Phase 2 object with no exception of any kind. Populated only when
    buildProfessionalAtsAssembly has PROVEN, from sourceBlockIds alone,
    that these entries cover every content line of that section;
    otherwise it is absent and the raw section renders exactly as
    before. Deliberately LanguageEntry-typed rather than a general
    content-override channel - there is no string here for this layer to
    author.
  */
  languageEntries?: LanguageEntry[];
};

export type ProfessionalAtsAssemblySection = {
  key: ProfessionalAtsSectionKey;
  label: string | null;

  order: number;

  visible: boolean;
  visibilityReason: AssemblyVisibilityReason;

  blocks: AssemblyBlock[];

  keepHeadingWithFirstBlock: boolean;
  breakBefore: BreakPolicy;
  breakAfter: BreakPolicy;

  minBlocksToShow: number;
  sourceSectionIds: string[];
};

export type AssemblyCompactionPolicy = {
  allowedDensities: AssemblyDensity[];

  canReduceSectionSpacing: boolean;
  canReduceEntrySpacing: boolean;
  canReduceBulletSpacing: boolean;
  canTightenSkillLayout: boolean;

  canTrimContent: false;
  canDropSections: false;
  canDropEntries: false;
  canDropBullets: false;
};

export type ProfessionalAtsAssemblyValidationReport = {
  passed: boolean;

  visibleSectionKeys: ProfessionalAtsSectionKey[];
  hiddenSectionKeys: ProfessionalAtsSectionKey[];

  orderViolations: string[];
  volunteerPlacementViolations: string[];

  missingEntryIds: string[];
  duplicateEntryIds: string[];

  invalidHiddenSectionsWithBlocks: string[];

  destructiveCompactionFlags: string[];

  warnings: string[];
};

export type ProfessionalAtsAssemblyDocument = {
  schemaVersion: string;
  templateId: "professional-ats-v1";

  sourceModelVersion: string;

  sections: ProfessionalAtsAssemblySection[];

  visibleSectionKeys: ProfessionalAtsSectionKey[];
  hiddenSectionKeys: ProfessionalAtsSectionKey[];

  defaultDensity: AssemblyDensity;
  compactionPolicy: AssemblyCompactionPolicy;

  validation: ProfessionalAtsAssemblyValidationReport;
};
