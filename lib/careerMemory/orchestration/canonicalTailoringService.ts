/*
  Phase 6G - deterministic AI-output-to-overlay validator (round spec
  §7/§8/§27-item-9: "AI 응답은 Zod/결정적 validator로 검증한다" - zod is not a
  dependency of this repo (confirmed: not in package.json, and adding a
  new dependency is explicitly out of this round's changed-file scope,
  §36), so this is the "결정적 validator" branch of that either/or,
  hand-written the same way the existing mergeTailoredOverlay() already
  validates overlay shape at runtime (lib/documentPreservation/
  resumeStructured/tailoredOverlay.ts).

  This module owns exactly the boundary between "raw AI JSON" and "the
  EXISTING TailoredResumeOverlay shape mergeTailoredOverlay() already
  accepts" - it does NOT reimplement overlay merging/validation (that
  stays entirely in tailoredOverlay.ts, unmodified, per this round's own
  "Canonical Runtime 계약 변경 금지" instruction extended in spirit to this
  adjacent, already-tested contract). The AI's own response shape (round
  spec §8) uses "sourceContentId" for a bullet's target id and adds a
  "skillEmphasis" array the existing merge engine has no field for -
  this validator accepts that AI-facing shape, renames sourceContentId
  -> id, and DROPS skillEmphasis before handing the result to the
  overlay engine (disclosed simplification, not silently invented
  support - see AiTailoringValidationResult.droppedSkillEmphasis).

  No entry can ever be invented here: any entryId not already present
  in the resume's own professionalExperience/volunteerExperience/
  projects id set is rejected outright (never forwarded to the overlay
  engine, which would also reject it, but rejecting one layer up avoids
  a wasted overlay-merge round trip and gives more specific structured
  errors here).
*/
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";
import type { TailoredResumeOverlay } from "../../documentPreservation/resumeStructured/tailoredOverlay";

export type AiTailoringRawResponse = unknown;

export type AiTailoringValidationIssue = {
  path: string;
  reason: string;
};

export type AiTailoringValidationResult =
  | { valid: true; overlay: TailoredResumeOverlay; droppedSkillEmphasis: boolean; issues: [] }
  | { valid: false; overlay: null; droppedSkillEmphasis: false; issues: AiTailoringValidationIssue[] };

const OVERLAY_SCHEMA_VERSION = "1.0.0";

function knownEntryIds(resume: ResumeStructuredModel): Set<string> {
  const ids = new Set<string>();
  for (const e of resume.professionalExperience) ids.add(e.id);
  for (const e of resume.volunteerExperience) ids.add(e.id);
  for (const e of resume.projects) ids.add(e.id);
  return ids;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/*
  Validates the AI's raw JSON response against the round's own §8
  contract shape, converts it into the existing overlay engine's
  TailoredResumeOverlay shape. Deliberately conservative: any
  structural surprise (wrong type, unknown entryId, missing required
  field on a present object) is a REJECTION, never a best-effort guess
  - see the round's own "1회 repair/retry 가능... 계속 실패하면 Legacy
  fallback" policy (§7), which this function's caller implements by
  retrying the whole AI call once, not by trying to salvage a
  half-valid response here.
*/
export function validateAiTailoringResponse(raw: AiTailoringRawResponse, resume: ResumeStructuredModel): AiTailoringValidationResult {
  const issues: AiTailoringValidationIssue[] = [];

  if (!isPlainObject(raw)) {
    return { valid: false, overlay: null, droppedSkillEmphasis: false, issues: [{ path: "$", reason: "response is not a JSON object" }] };
  }

  const allowedTopLevelKeys = new Set(["professionalSummaryText", "entries", "skillEmphasis"]);
  for (const key of Object.keys(raw)) {
    if (!allowedTopLevelKeys.has(key)) issues.push({ path: `$.${key}`, reason: "unrecognized field" });
  }

  let professionalSummaryText: string | undefined;
  if ("professionalSummaryText" in raw) {
    if (typeof raw.professionalSummaryText !== "string") {
      issues.push({ path: "$.professionalSummaryText", reason: "must be a string" });
    } else {
      professionalSummaryText = raw.professionalSummaryText;
    }
  }

  const knownIds = knownEntryIds(resume);
  const entries: TailoredResumeOverlay["entries"] = [];
  if ("entries" in raw) {
    if (!Array.isArray(raw.entries)) {
      issues.push({ path: "$.entries", reason: "must be an array" });
    } else {
      raw.entries.forEach((entry, entryIndex) => {
        const entryPath = `$.entries[${entryIndex}]`;
        if (!isPlainObject(entry)) {
          issues.push({ path: entryPath, reason: "entry must be an object" });
          return;
        }
        const allowedEntryKeys = new Set(["entryId", "bullets"]);
        for (const key of Object.keys(entry)) {
          if (!allowedEntryKeys.has(key)) issues.push({ path: `${entryPath}.${key}`, reason: "unrecognized field" });
        }
        if (typeof entry.entryId !== "string" || entry.entryId.length === 0) {
          issues.push({ path: `${entryPath}.entryId`, reason: "entryId must be a non-empty string" });
          return;
        }
        if (!knownIds.has(entry.entryId)) {
          issues.push({ path: `${entryPath}.entryId`, reason: `unknown entryId "${entry.entryId}" - does not match an existing experience/volunteer/project entry` });
          return;
        }
        const bullets: NonNullable<TailoredResumeOverlay["entries"]>[number]["bullets"] = [];
        if ("bullets" in entry) {
          if (!Array.isArray(entry.bullets)) {
            issues.push({ path: `${entryPath}.bullets`, reason: "bullets must be an array" });
          } else {
            entry.bullets.forEach((bullet, bulletIndex) => {
              const bulletPath = `${entryPath}.bullets[${bulletIndex}]`;
              if (!isPlainObject(bullet)) {
                issues.push({ path: bulletPath, reason: "bullet must be an object" });
                return;
              }
              const allowedBulletKeys = new Set(["sourceContentId", "text"]);
              for (const key of Object.keys(bullet)) {
                if (!allowedBulletKeys.has(key)) issues.push({ path: `${bulletPath}.${key}`, reason: "unrecognized field" });
              }
              if (typeof bullet.text !== "string" || bullet.text.trim().length === 0) {
                issues.push({ path: `${bulletPath}.text`, reason: "text must be a non-empty string" });
                return;
              }
              if ("sourceContentId" in bullet && typeof bullet.sourceContentId !== "string") {
                issues.push({ path: `${bulletPath}.sourceContentId`, reason: "sourceContentId must be a string when present" });
                return;
              }
              bullets?.push({ id: typeof bullet.sourceContentId === "string" ? bullet.sourceContentId : undefined, text: bullet.text });
            });
          }
        }
        entries?.push({ entryId: entry.entryId, bullets });
      });
    }
  }

  let droppedSkillEmphasis = false;
  if ("skillEmphasis" in raw) {
    if (!Array.isArray(raw.skillEmphasis) || !raw.skillEmphasis.every((s) => typeof s === "string")) {
      issues.push({ path: "$.skillEmphasis", reason: "must be an array of strings when present" });
    } else {
      droppedSkillEmphasis = true;
    }
  }

  if (issues.length > 0) {
    return { valid: false, overlay: null, droppedSkillEmphasis: false, issues };
  }

  const overlay: TailoredResumeOverlay = { schemaVersion: OVERLAY_SCHEMA_VERSION, professionalSummaryText, entries };
  return { valid: true, overlay, droppedSkillEmphasis, issues: [] };
}
