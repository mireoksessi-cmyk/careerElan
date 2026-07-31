/*
  Document Preservation Engine (DPE) - Phase 1 skeleton.

  Outcome states for a DPE pass, so a future phase can tell the caller
  "the original layout could not be preserved" explicitly instead of
  silently falling back to a different design (see the master DPE spec's
  Fallback Principle). No existing status enum in this codebase covers
  this - applications.generation_status ("pending"/"succeeded"/"failed",
  supabase/migrations/20260722172902_applications_generation_tracking.sql)
  is about whether AI text generation succeeded, not whether the ORIGINAL
  DOCUMENT'S LAYOUT was preserved when placing that text back into it.
  These are different questions; this type does not replace or overlap
  with generation_status.

  Phase 1 never produces "preserved" or "preserved_with_page_expansion" -
  no layout analysis exists yet to earn those. The only status Phase 1's
  entry point can honestly return is "not_implemented".
*/
export type DPEPreservationStatus =
  | "not_implemented"
  | "preserved"
  | "preserved_with_page_expansion"
  | "partially_preserved"
  | "preservation_failed"
  | "unsupported_layout";
