/*
  TASK 4 - Section ordering policy. Spec section 6:
  - Visible sections always render in PROFESSIONAL_ATS_SECTION_ORDER -
    never reordered by content size, confidence, or any other signal.
  - professional_experience / volunteer_experience are two independent
    slots (never merged) - if both are visible, professional always
    precedes volunteer purely because that is their fixed position in
    PROFESSIONAL_ATS_SECTION_ORDER; if only one is visible, only that
    one appears at its own fixed slot.
  - certifications_licenses: Phase 2's own buildStructuredResume.ts
    already merges "certifications" and "licenses" Phase 1 sections
    into ONE `credentials` array, in document traversal order - Phase 3
    performs no additional merging, only maps that array's existing
    order onto the section's blocks.
  - additional_information: customSections sorted by their own
    sourceOrder (the original Phase 1 document position), never by
    Phase 3-invented criteria.
*/
import type { ProfessionalAtsSectionKey } from "./types";
import type { CustomResumeSection } from "../resumeStructured/types";
import { PROFESSIONAL_ATS_SECTION_ORDER } from "./sectionLabels";

export function computeVisibleSectionOrder(visibility: Partial<Record<ProfessionalAtsSectionKey, boolean>>): ProfessionalAtsSectionKey[] {
  return PROFESSIONAL_ATS_SECTION_ORDER.filter((key) => visibility[key] === true);
}

export function computeHiddenSectionOrder(visibility: Partial<Record<ProfessionalAtsSectionKey, boolean>>): ProfessionalAtsSectionKey[] {
  return PROFESSIONAL_ATS_SECTION_ORDER.filter((key) => visibility[key] !== true);
}

export function orderCustomSectionsBySourceOrder(sections: CustomResumeSection[]): CustomResumeSection[] {
  return [...sections].sort((a, b) => a.sourceOrder - b.sourceOrder);
}
