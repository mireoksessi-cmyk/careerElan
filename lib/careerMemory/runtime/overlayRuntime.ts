/*
  Phase 6A.2 Implementation - Overlay Runtime wrapper. tailoredOverlay.ts
  (lib/documentPreservation/resumeStructured/tailoredOverlay.ts) is
  imported here but NEVER modified - this file only calls its exported
  mergeTailoredOverlay(), never re-implements or duplicates its merge
  logic (that would risk drifting from the one real, tested contract).

  runtime.resume is always the pristine, untailored canonical
  ResumeStructuredModel. mergeTailoredOverlay() itself never mutates its
  own input (see tailoredOverlay.ts's own header comment), and this
  wrapper preserves that guarantee one level up: applyOverlay/
  removeOverlay never write to runtime.resume, only to
  runtime.overlayState.history. The tailored VIEW - what the resume
  looks like with every applied overlay folded in, in application order -
  is always derived on demand by resolveTailoredResume(), never cached
  onto the runtime object itself. This is what makes removeOverlay
  correct without any special "undo" primitive: dropping one record from
  history and re-folding the rest reproduces exactly the state that
  would exist had that overlay never been applied - satisfying the
  Phase 6A.2 audit's own Overlay Contract (§F: canonical is never
  mutated by tailoring).
*/
import { mergeTailoredOverlay } from "../../documentPreservation/resumeStructured/tailoredOverlay";
import type { TailoredMergeRejection } from "../../documentPreservation/resumeStructured/tailoredOverlay";
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";
import type { CanonicalResumeRuntime, OverlayApplicationRecord, RuntimeOverlayState } from "./types";

export function resolveTailoredResume(runtime: CanonicalResumeRuntime): ResumeStructuredModel {
  let model = runtime.resume;
  for (const record of runtime.overlayState.history) {
    model = mergeTailoredOverlay(model, record.overlay).model;
  }
  return model;
}

export type OverlayValidationResult = {
  valid: boolean;
  rejections: TailoredMergeRejection[];
};

/*
  Dry-run only - never appends to history, never returns a new runtime.
  Folds the CURRENT tailored view (base + every already-applied overlay)
  so entryId validity is checked against what the caller would actually
  see if they applied this overlay next, not against the untouched base.
*/
export function validateOverlay(runtime: CanonicalResumeRuntime, overlay: unknown): OverlayValidationResult {
  const base = resolveTailoredResume(runtime);
  const result = mergeTailoredOverlay(base, overlay);
  return { valid: result.rejections.length === 0, rejections: result.rejections };
}

export type ApplyOverlayResult = {
  runtime: CanonicalResumeRuntime;
  appliedEntryIds: string[];
  rejections: TailoredMergeRejection[];
};

/*
  Always appends a history record, even when every entry in the overlay
  was rejected (rejections.length === appended overlay's own entry
  count) - the record is the caller's own audit trail of what was
  attempted, not just what succeeded. mergeTailoredOverlay's own partial-
  application behavior (some entries in one overlay call can succeed
  while others reject) is preserved unchanged.
*/
export function applyOverlay(runtime: CanonicalResumeRuntime, overlay: unknown): ApplyOverlayResult {
  const base = resolveTailoredResume(runtime);
  const result = mergeTailoredOverlay(base, overlay);
  const record: OverlayApplicationRecord = {
    overlay,
    appliedEntryIds: result.appliedEntryIds,
    rejections: result.rejections,
  };
  const nextOverlayState: RuntimeOverlayState = { history: [...runtime.overlayState.history, record] };
  return {
    runtime: { ...runtime, overlayState: nextOverlayState },
    appliedEntryIds: result.appliedEntryIds,
    rejections: result.rejections,
  };
}

/*
  Removes one previously-applied overlay by its position in
  overlayState.history (the order applyOverlay appended them). Everything
  after it is implicitly re-derived the next time resolveTailoredResume
  is called - this function itself does no re-folding, it only edits the
  history list. An out-of-range index is a no-op (returns the same
  runtime reference unchanged) rather than throwing, since a caller
  racing a concurrent removal is a normal, recoverable case, not a
  programming error.
*/
export function removeOverlay(runtime: CanonicalResumeRuntime, historyIndex: number): CanonicalResumeRuntime {
  if (historyIndex < 0 || historyIndex >= runtime.overlayState.history.length) return runtime;
  const nextHistory = runtime.overlayState.history.filter((_, i) => i !== historyIndex);
  return { ...runtime, overlayState: { history: nextHistory } };
}
