/*
  TASK 8 - Tailored Overlay Contract. Section 17 of the spec: a
  forward-looking type + PURE merge function for a future AI-tailoring
  step that has not been built and is NOT connected to anything here -
  no network call, no OpenAI client, nothing imported from the existing
  production Generate Package path. This module only defines the safe
  SHAPE a future tailoring result would have to fit, and a merge
  function that can be unit-tested against that contract today.

  Three hard rules from the spec, enforced structurally wherever
  possible rather than only by a runtime check:
  - Protected facts (organization/role/dates/institution/credential/
    location/etc.) can NEVER change. The overlay type itself has no
    field capable of expressing a change to any of them - not a runtime
    restriction, a type that cannot represent the forbidden case at all.
  - An overlay entryId that doesn't match an existing entry is REJECTED
    (reported, not silently dropped) - never used to create a new entry.
  - No new professionalExperience/volunteerExperience/project entry can
    ever be invented by an overlay - the merge function only ever
    mutates the bullets of an entry already present at a known index; it
    never pushes into those arrays.

  Scope decision: bullets are the only overlaid field. Real AI-tailoring
  (the concrete example in spec section 2) rewrites bullet wording to
  match a target job - that's what StructuredBullet.text exists to
  carry. ExperienceEntry and ProjectEntry are the only entry types with
  a `bullets` field; education/credentials/awards/publications don't
  have an equivalent narrative field with real fixture evidence of
  needing AI rewrite, so they're intentionally out of scope this round
  rather than invented speculatively. professionalSummary is also
  covered since spec section 2's example resume-tailoring flow
  routinely rewrites/re-emphasizes the summary line as well.

  Because a real AI response arrives as untyped JSON (not statically
  checked TypeScript), mergeTailoredOverlay treats its `overlay`
  parameter as `unknown` and performs its own runtime shape validation -
  any unexpected key on an entry/bullet overlay (e.g. an attempt to slip
  `organization` or `dateRangeText` into an entry overlay) is treated as
  an invalid, rejected result, not silently stripped and allowed
  through.
*/
import type { ResumeStructuredModel, ExperienceEntry, ProjectEntry, StructuredBullet } from "./types";

export type TailoredBulletOverlay = {
  /* When id matches an existing bullet on the target entry, this is a
     rewrite of that bullet's wording (its own source trace is kept,
     since the underlying fact it's based on hasn't changed - only the
     phrasing has). When id is omitted or matches nothing, this is
     treated as an ADDITIONAL bullet on that entry, not a new entry - the
     one deliberate case where new text is allowed without a Phase 1
     source block, since job-tailoring exists specifically to
     re-emphasize a candidate's already-verified facts in new wording
     for a specific job, distinct from inventing a new fact outright. */
  id?: string;
  text: string;
};

export type TailoredEntryOverlay = {
  /* Must match the `id` of an EXISTING professionalExperience,
     volunteerExperience, or projects entry already produced by Phase
     2's own extractors - never a freshly minted id. */
  entryId: string;
  bullets?: TailoredBulletOverlay[];
};

export type TailoredResumeOverlay = {
  schemaVersion: string;
  professionalSummaryText?: string;
  entries?: TailoredEntryOverlay[];
};

export type TailoredMergeRejection = {
  entryId?: string;
  reason: "unknown-entry-id" | "invalid-overlay-shape" | "protected-field-attempted";
  detail: string;
};

export type TailoredMergeResult = {
  /* A NEW model object - the input `model` is never mutated. */
  model: ResumeStructuredModel;
  appliedEntryIds: string[];
  rejections: TailoredMergeRejection[];
};

const ALLOWED_ENTRY_OVERLAY_KEYS = new Set(["entryId", "bullets"]);
const ALLOWED_BULLET_OVERLAY_KEYS = new Set(["id", "text"]);
const ALLOWED_TOP_LEVEL_KEYS = new Set(["schemaVersion", "professionalSummaryText", "entries"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extraKeys(obj: Record<string, unknown>, allowed: Set<string>): string[] {
  return Object.keys(obj).filter((k) => !allowed.has(k));
}

function nextBulletId(entryId: string, existingCount: number, offset: number): string {
  return `${entryId}-tailored-bullet-${existingCount + offset}`;
}

/*
  Applies one entry's bullet overlays to a copy of its existing bullets.
  Returns undefined (meaning: reject, don't apply) if the overlay shape
  is invalid or attempts to touch anything beyond id/text.
*/
function mergeBullets(existing: StructuredBullet[], entryId: string, overlays: unknown): StructuredBullet[] | undefined {
  if (!Array.isArray(overlays)) return undefined;

  const result = existing.map((b) => ({ ...b }));
  let appendedCount = 0;

  for (const raw of overlays) {
    if (!isPlainObject(raw)) return undefined;
    const extra = extraKeys(raw, ALLOWED_BULLET_OVERLAY_KEYS);
    if (extra.length > 0) return undefined;
    if (typeof raw.text !== "string" || raw.text.trim().length === 0) return undefined;
    if (raw.id !== undefined && typeof raw.id !== "string") return undefined;

    const matchIndex = raw.id !== undefined ? result.findIndex((b) => b.id === raw.id) : -1;
    if (matchIndex >= 0) {
      result[matchIndex] = { ...result[matchIndex], text: raw.text };
    } else {
      result.push({
        id: nextBulletId(entryId, existing.length, appendedCount),
        text: raw.text,
        source: { sourceSectionId: "tailored-overlay", sourceBlockIds: [], sourceElementIds: [] },
      });
      appendedCount++;
    }
  }

  return result;
}

type BulletBearingEntry = ExperienceEntry | ProjectEntry;

function collectBulletBearingEntries(model: ResumeStructuredModel): { array: BulletBearingEntry[]; index: number; entry: BulletBearingEntry }[] {
  const groups: BulletBearingEntry[][] = [model.professionalExperience, model.volunteerExperience, model.projects];
  const located: { array: BulletBearingEntry[]; index: number; entry: BulletBearingEntry }[] = [];
  for (const array of groups) {
    array.forEach((entry, index) => located.push({ array, index, entry }));
  }
  return located;
}

export function mergeTailoredOverlay(model: ResumeStructuredModel, overlay: unknown): TailoredMergeResult {
  const rejections: TailoredMergeRejection[] = [];
  const appliedEntryIds: string[] = [];

  // Deep-enough clone: only the branches this function can possibly
  // touch (professionalSummary, professionalExperience, volunteerExperience,
  // projects) need real copies - everything else is safe to share by
  // reference since it's never written to.
  const nextModel: ResumeStructuredModel = {
    ...model,
    professionalSummary: model.professionalSummary ? { ...model.professionalSummary } : model.professionalSummary,
    professionalExperience: model.professionalExperience.map((e) => ({ ...e, bullets: e.bullets.map((b) => ({ ...b })) })),
    volunteerExperience: model.volunteerExperience.map((e) => ({ ...e, bullets: e.bullets.map((b) => ({ ...b })) })),
    projects: model.projects.map((p) => ({ ...p, bullets: p.bullets.map((b) => ({ ...b })) })),
  };

  if (!isPlainObject(overlay)) {
    rejections.push({ reason: "invalid-overlay-shape", detail: "overlay is not a plain object" });
    return { model: nextModel, appliedEntryIds, rejections };
  }

  const topExtra = extraKeys(overlay, ALLOWED_TOP_LEVEL_KEYS);
  if (topExtra.length > 0) {
    rejections.push({ reason: "protected-field-attempted", detail: `unexpected top-level key(s): ${topExtra.join(", ")}` });
    return { model: nextModel, appliedEntryIds, rejections };
  }

  if (typeof overlay.schemaVersion !== "string" || overlay.schemaVersion.length === 0) {
    rejections.push({ reason: "invalid-overlay-shape", detail: "schemaVersion is required" });
    return { model: nextModel, appliedEntryIds, rejections };
  }

  if (overlay.professionalSummaryText !== undefined) {
    if (typeof overlay.professionalSummaryText !== "string" || overlay.professionalSummaryText.trim().length === 0) {
      rejections.push({ reason: "invalid-overlay-shape", detail: "professionalSummaryText must be a non-empty string when present" });
    } else if (nextModel.professionalSummary) {
      // The summary's own source trace is left untouched - it still
      // points at the real Phase 1 blocks the tailored wording is based
      // on, even though the text itself has been rephrased.
      nextModel.professionalSummary = { ...nextModel.professionalSummary, text: overlay.professionalSummaryText };
    } else {
      // There is no existing professionalSummary slot for this resume -
      // an overlay cannot invent one from nothing (no source blocks
      // would exist to trace it to).
      rejections.push({ reason: "unknown-entry-id", detail: "professionalSummaryText was supplied but this resume has no professionalSummary slot to tailor" });
    }
  }

  if (overlay.entries !== undefined) {
    if (!Array.isArray(overlay.entries)) {
      rejections.push({ reason: "invalid-overlay-shape", detail: "entries must be an array" });
      return { model: nextModel, appliedEntryIds, rejections };
    }

    const located = collectBulletBearingEntries(nextModel);
    const byId = new Map(located.map((loc) => [loc.entry.id, loc]));

    for (const raw of overlay.entries) {
      if (!isPlainObject(raw)) {
        rejections.push({ reason: "invalid-overlay-shape", detail: "an entry overlay is not a plain object" });
        continue;
      }
      const extra = extraKeys(raw, ALLOWED_ENTRY_OVERLAY_KEYS);
      if (extra.length > 0) {
        rejections.push({ entryId: typeof raw.entryId === "string" ? raw.entryId : undefined, reason: "protected-field-attempted", detail: `unexpected key(s) on entry overlay: ${extra.join(", ")}` });
        continue;
      }
      if (typeof raw.entryId !== "string" || raw.entryId.length === 0) {
        rejections.push({ reason: "invalid-overlay-shape", detail: "entry overlay is missing a valid entryId" });
        continue;
      }

      const located_ = byId.get(raw.entryId);
      if (!located_) {
        rejections.push({ entryId: raw.entryId, reason: "unknown-entry-id", detail: `no professionalExperience/volunteerExperience/projects entry with id "${raw.entryId}" exists in this model` });
        continue;
      }

      if (raw.bullets === undefined) {
        // Nothing to merge for this entry - not an error, just a no-op.
        continue;
      }

      const mergedBullets = mergeBullets(located_.entry.bullets, raw.entryId, raw.bullets);
      if (mergedBullets === undefined) {
        rejections.push({ entryId: raw.entryId, reason: "invalid-overlay-shape", detail: "bullets overlay is malformed - every item must be {id?, text} with a non-empty text" });
        continue;
      }

      located_.array[located_.index] = { ...located_.entry, bullets: mergedBullets };
      appliedEntryIds.push(raw.entryId);
    }
  }

  return { model: nextModel, appliedEntryIds, rejections };
}
