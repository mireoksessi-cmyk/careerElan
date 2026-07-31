/*
  Document Preservation Engine (DPE) - Phase 1 skeleton.

  Interface only - no validator implementation. The investigation for
  this DPE effort confirmed no existing code checks rendered/exported
  output for clipping, overlap, out-of-bounds content, or missing/
  duplicate text (the closest existing thing, skillEntryPreserved() in
  lib/generatePackage/shared.ts:449, checks whether a generated FACT is
  present in the generated TEXT - a content QA check, not a layout
  check). This module does not touch that function or duplicate it; it
  defines the shape a future DPE-specific layout validator will return.
*/

import type { DPEDocument } from "./types";

export type DPEValidationIssueType =
  | "text_clipping"
  | "element_overlap"
  | "content_outside_bounds"
  | "column_boundary_violation"
  | "table_boundary_violation"
  | "missing_text"
  | "duplicate_text"
  | "lost_section"
  | "broken_bullet"
  | "orphan_section_heading"
  | "unbreakable_group_split"
  | "incorrect_repeated_element"
  | "first_page_only_element_duplication"
  | "footer_collision"
  | "header_collision"
  | "font_substitution"
  | "unsupported_glyph"
  | "incorrect_source_document_mapping"
  | "resume_cover_letter_selection_mismatch";

export type DPEValidationIssue = {
  type: DPEValidationIssueType;
  pageIndex?: number;
  elementId?: string;
  message: string;
};

export type DPEValidationResult = {
  valid: boolean;
  issues: DPEValidationIssue[];
};

/*
  Phase 2+ implements this. Phase 1 declares the signature only, so a
  broken document can never be silently returned as valid by omission -
  a future implementation must exist and be wired in before DPE output
  is treated as trustworthy (see the master spec's "검증에 실패하면
  깨진 문서를 정상 결과로 반환하지 않는다").
*/
export type DPEValidator = (document: DPEDocument) => DPEValidationResult;
