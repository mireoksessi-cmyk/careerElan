/*
  Phase 6G - top-level Canonical Generate Package orchestrator. Runs
  the full production architecture the round spec's §4 names: resolve
  profile -> resolve latest version -> deserialize runtime -> call AI
  for a tailoring overlay (ID-based, never touches canonical facts) ->
  validate -> persist overlay (system_create_canonical_overlay, a
  service-role-safe RPC - see the migration's own header comment for
  why the existing auth.uid()-based create_canonical_overlay cannot be
  called from this background-worker context) -> apply overlay
  in-memory -> render all requested formats through the UNMODIFIED
  Phase 6F Template Engine -> upload real bytes -> atomically record
  document + application metadata (complete_canonical_generation).

  Never calls OpenAI more than once per invocation (one summary+bullet
  tailoring call, distinct from and independent of the legacy
  pipeline's own two calls) - a single repair retry is allowed on
  schema-validation failure only (round §7), never a second full
  generation attempt.
*/
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveCanonicalResumeContext } from "../services/resolveCanonicalResumeContext";
import { getCanonicalRuntimeViaServiceRole } from "./canonicalMemoryBundleFetch";
import { applyOverlay, resolveTailoredResume } from "../runtime/overlayRuntime";
import { validateAiTailoringResponse, type CanonicalAnalysisRaw } from "./canonicalTailoringService";
import { buildCanonicalTailoringPrompt } from "./canonicalTailoringPrompt";
import { renderCanonicalPackage, type RenderCanonicalPackageResult } from "./canonicalRenderService";
import { PACKAGE_GENERATION_MODEL } from "../../config/aiModels";
import {
  CanonicalProfileUnavailableError,
  CanonicalVersionUnavailableError,
  CanonicalDeserializationError,
  CanonicalTailoringError,
} from "../errors/domainErrors";
import type { PaperSize } from "../../documentPreservation/professionalAtsHtml/types";
import type { TemplateDensity } from "../../resumeTemplates/contracts/types";
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";
import { normalizePackageAnalysis, includesLoose, shouldRetryOpenAiError, type PackageAnalysis } from "../../generatePackage/shared";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_CALL_TIMEOUT_MS = 60_000;
const MAX_TAILORING_ATTEMPTS = 2; // 1 original + 1 schema-repair retry, per round spec §7

export type CanonicalGeneratePackageInput = {
  userId: string;
  applicationId: string;
  jobDescriptionText: string;
  jobAnalysisSummary: string;
  targetRole?: string;
  /*
    Phase 6I.6.6 - company/existingCoverLetterText feed the SAME AI
    call's cover-letter/email prompt section (canonicalTailoringPrompt.ts),
    mirroring legacy's buildCoverLetterEmailPrompt({company,
    existingCoverLetter, ...}). Both optional/absent-safe: an unknown
    company or no prior cover letter to use as a style reference are
    normal, valid states, not errors.
  */
  company?: string;
  existingCoverLetterText?: string;
  templateId: string;
  paperSize: PaperSize;
  density: TemplateDensity;
  locale: string;
};

export type CanonicalGeneratePackageResult = {
  canonicalProfileId: string;
  canonicalResumeVersionId: string;
  tailoredResumeId: string | null;
  appliedEntryIds: string[];
  overlayRejections: string[];
  render: RenderCanonicalPackageResult;
  /*
    Phase 6I.6.5 - the SAME AI call's packageAnalysis, grounded (see
    groundKeyChanges below) and mapped through legacy Generate Package's
    own normalizePackageAnalysis() rather than a second, duplicated
    shape. Always present (packageAnalysis was required in the AI
    response and validated by canonicalTailoringService.ts) - keyChanges
    may legitimately be an empty array if nothing survived grounding.
  */
  packageAnalysis: PackageAnalysis;
  /*
    Phase 6I.6.6 - the SAME AI call's cover letter/email draft, reusing
    applications.cover_letter_text/email_draft (the exact columns
    legacy Generate Package already writes) rather than new columns.
    Always a non-empty string - validated required by
    canonicalTailoringService.ts, same treatment as packageAnalysis.
  */
  coverLetterText: string;
  emailDraftText: string;
};

function extractJsonLoose(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("no JSON object found in AI response");
  return JSON.parse(text.slice(start, end + 1));
}

/*
  Phase 6I.6.5 - flattens every piece of resume text the canonical
  tailoring prompt was allowed to touch (professional summary + bullets
  on professionalExperience/volunteerExperience/projects - the same
  three entry kinds canonicalTailoringPrompt.ts's own editableEntries()
  exposes) into one blob for includesLoose() containment checks. Never
  used for anything but grounding - not persisted, not rendered.
*/
export function collectEditableResumeText(resume: ResumeStructuredModel): string {
  const parts: string[] = [];
  if (resume.professionalSummary?.text) parts.push(resume.professionalSummary.text);
  for (const entry of [...resume.professionalExperience, ...resume.volunteerExperience]) {
    for (const bullet of entry.bullets) parts.push(bullet.text);
  }
  for (const project of resume.projects) {
    for (const bullet of project.bullets) parts.push(bullet.text);
  }
  return parts.join("\n");
}

/*
  Phase 6I.6.5 - the round's own §4 requirement: "packageAnalysis.
  keyChanges must correspond to REAL canonical overlay changes... do
  not allow the model to claim original=X/revised=Y if the overlay did
  not actually perform that change." The AI's keyChanges are advisory
  prose describing what it believes it changed - this function is the
  actual source of truth check, run AFTER the overlay has been applied,
  against the real base/tailored resume text (not the AI's own claim
  about itself). A keyChange survives only if:
    - its "original" text (when non-empty - empty is legitimately a
      brand-new bullet with no prior text) actually appears, loosely,
      somewhere in the real BASE resume text, AND
    - its "revised" text actually appears, loosely, somewhere in the
      real TAILORED (post-overlay) resume text.
  Anything that fails either check is dropped, not displayed as a
  verified change (round §4's own instruction) - never silently
  "corrected" into something it didn't claim.
*/
export function groundKeyChanges(
  rawKeyChanges: CanonicalAnalysisRaw["keyChanges"],
  beforeText: string,
  afterText: string
): CanonicalAnalysisRaw["keyChanges"] {
  return rawKeyChanges.filter((kc) => {
    const originalGrounded = !kc.original.trim() || includesLoose(beforeText, kc.original);
    const revisedGrounded = includesLoose(afterText, kc.revised);
    return originalGrounded && revisedGrounded;
  });
}

/*
  Phase 6I.6.5 - maps the grounded canonical analysis into legacy
  Generate Package's own PackageAnalysis input shape, then hands it to
  the EXISTING normalizePackageAnalysis() (lib/generatePackage/
  shared.ts) for all defaulting/clamping/coercion - no duplicated
  normalization logic. verification/mismatch.unsupportedClaims/
  matches.transferableSkills/recommendation.nextSteps are intentionally
  left absent here: canonical never re-runs legacy's own Canadian-
  scope/regulated-role/bilingual classification (that would be a much
  larger, unrelated prompt addition, and normalizePackageAnalysis
  already defaults every one of these to a safe, honest empty shape
  when absent - see that function's own behavior). applyRecommendation
  is derived from the SAME 85/65/40 overallMatch thresholds
  normalizePackageAnalysis itself uses for matchLevel, not invented.
*/
export function toPackageAnalysisInput(raw: CanonicalAnalysisRaw, groundedKeyChanges: CanonicalAnalysisRaw["keyChanges"]) {
  const applyRecommendation =
    raw.overallMatch >= 85 ? "recommended" : raw.overallMatch >= 40 ? "consider" : "not_recommended";

  return {
    overallMatch: raw.overallMatch,
    keyChanges: groundedKeyChanges,
    matches: { strongMatches: raw.strengths, transferableSkills: [] },
    mismatch: { summary: "", missingRequirements: raw.gaps, unsupportedClaims: [] },
    recommendation: { summary: raw.summary, applyRecommendation, nextSteps: [] },
  };
}

/*
  Phase 6I.6.34 - retry condition now delegates to the SAME
  shouldRetryOpenAiError() predicate the legacy engine uses (imported
  from ../../generatePackage/shared), instead of a separately-
  maintained inline `error instanceof APIConnectionTimeoutError`
  check - closes a real asymmetry the phase's own retry audit found
  (legacy retried timeouts only; this engine's inline check, before
  this change, did too, but the two conditions were drifting apart in
  two different files with no shared source of truth). This also
  means a RateLimitError (429) is now retried here too, bounded by the
  same MAX_TAILORING_ATTEMPTS=2 - safe for the identical quota-timing
  reason documented on shouldRetryOpenAiError() itself.
*/
async function callTailoringOpenAi(promptText: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_TAILORING_ATTEMPTS; attempt++) {
    try {
      const response = await client.responses.create({ model: process.env.OPENAI_PACKAGE_MODEL || PACKAGE_GENERATION_MODEL, input: promptText }, { timeout: OPENAI_CALL_TIMEOUT_MS, maxRetries: 0 });
      return response.output_text;
    } catch (error) {
      if (shouldRetryOpenAiError(error, attempt, MAX_TAILORING_ATTEMPTS)) continue;
      throw error;
    }
  }
  throw new Error("unreachable");
}

export async function generateCanonicalPackage(client_: SupabaseClient, input: CanonicalGeneratePackageInput): Promise<CanonicalGeneratePackageResult> {
  /*
    Phase 6I.6 - resolve the resume to generate from via
    resolveCanonicalResumeContext() instead of always reaching for
    "profile's globally-latest version" - honors
    career_memory.selected_resume_id when the user has made an explicit
    selection. "not-canonical" (the selection is the career_memory-
    authored resume, which structurally can never have a canonical
    version - see CanonicalResumeImportService's own applicability
    boundary) and "legacy-only" (no selection has ever been made, or no
    canonical profile exists at all) both fall back to the exact same
    "profile's latest version" resolution this function used
    unconditionally before this round - a disclosed, intentional
    limitation, not a silent regression: those two cases have no
    canonical-eligible identity to honor, so falling back to latest is
    the best available proxy rather than an error a user could not act
    on. A genuinely selected-but-unresolvable resume
    (SELECTED_RESUME_UNAVAILABLE) is never silently substituted - it
    propagates as a thrown error, same as every other domain error in
    this function.

    Phase 6I.6.16 - passes applicationId so the application-binding
    branch (Branch A) wins permanently once the dispatcher has already
    frozen canonical_profile_id/canonical_resume_version_id onto this
    row at claim time - the worker must never re-read the user's
    CURRENT selected_resume_id once an application has been bound (see
    resolveCanonicalResumeContext.ts's own ServiceRoleModeInput.
    applicationId header comment for the full race this closes).
    Applications created before this phase (no binding yet) fall
    through to the exact same selected-resume/profile-latest resolution
    unchanged - no backfill, no rebinding of historical rows.
  */
  let resolved;
  try {
    resolved = await resolveCanonicalResumeContext({ mode: "service-role", client: client_, userId: input.userId, applicationId: input.applicationId });
  } catch (error) {
    throw new CanonicalDeserializationError(error instanceof Error ? error.message.slice(0, 200) : "unknown deserialization failure");
  }

  if (resolved.status === "not-canonical" || resolved.status === "legacy-only") {
    let lookup;
    try {
      lookup = await getCanonicalRuntimeViaServiceRole(client_, input.userId);
    } catch (error) {
      throw new CanonicalDeserializationError(error instanceof Error ? error.message.slice(0, 200) : "unknown deserialization failure");
    }
    if (!lookup.found) {
      if (lookup.reason === "no_profile") throw new CanonicalProfileUnavailableError("no canonical profile exists for this user");
      throw new CanonicalVersionUnavailableError("no resume version exists for this profile");
    }
    if (!lookup.runtime.version?.id) throw new CanonicalVersionUnavailableError("no resume version exists for this profile");
    resolved = { status: "resolved", source: "profile-latest", profileId: lookup.profile.id, versionId: lookup.runtime.version.id, sourceDocumentId: null, runtime: lookup.runtime } as const;
  }
  if (!resolved.runtime) {
    throw new CanonicalDeserializationError("resolved canonical resume context did not include a runtime");
  }

  const canonicalProfileId = resolved.profileId;
  const canonicalResumeVersionId = resolved.versionId;
  const runtime = resolved.runtime;

  // --- AI tailoring call: raw JSON -> deterministic validator, 1 repair retry ---
  const prompt = buildCanonicalTailoringPrompt({
    resume: runtime.resume,
    jobDescriptionText: input.jobDescriptionText,
    jobAnalysisSummary: input.jobAnalysisSummary,
    targetRole: input.targetRole,
    company: input.company,
    existingCoverLetterText: input.existingCoverLetterText,
  });

  let validated: ReturnType<typeof validateAiTailoringResponse> | null = null;
  for (let attempt = 1; attempt <= MAX_TAILORING_ATTEMPTS; attempt++) {
    const outputText = await callTailoringOpenAi(prompt);
    let raw: unknown;
    try {
      raw = extractJsonLoose(outputText);
    } catch {
      if (attempt < MAX_TAILORING_ATTEMPTS) continue;
      throw new CanonicalTailoringError(["AI response was not valid JSON after retry"]);
    }
    const result = validateAiTailoringResponse(raw, runtime.resume);
    if (result.valid) {
      validated = result;
      break;
    }
    if (attempt >= MAX_TAILORING_ATTEMPTS) {
      throw new CanonicalTailoringError(result.issues.map((i) => `${i.path}: ${i.reason}`));
    }
  }
  if (!validated || !validated.valid) {
    throw new CanonicalTailoringError(["AI tailoring produced no valid overlay"]);
  }

  // --- Apply overlay in-memory for rendering (pure, never mutates canonical facts) ---
  const beforeText = collectEditableResumeText(resolveTailoredResume(runtime));
  const applied = applyOverlay(runtime, validated.overlay);
  if (applied.rejections.length > 0) {
    throw new CanonicalTailoringError(applied.rejections.map((r) => `${r.entryId ?? "summary"}: ${r.reason} (${r.detail})`));
  }

  /*
    Phase 6I.6.5 - ground packageAnalysis.keyChanges against the REAL
    before/after resume text now that the overlay has actually been
    applied (see groundKeyChanges's own header comment). Any keyChange
    that fails grounding is dropped, never shown as a verified change -
    round §4. This never fails/throws generation; a package with zero
    grounded keyChanges still succeeds (round §14: "keyChanges may
    validly be empty arrays").
  */
  const afterText = collectEditableResumeText(resolveTailoredResume(applied.runtime));
  const groundedKeyChanges = groundKeyChanges(validated.packageAnalysisRaw.keyChanges, beforeText, afterText);
  if (groundedKeyChanges.length < validated.packageAnalysisRaw.keyChanges.length) {
    console.warn(
      `[canonical-package-analysis] dropped ${validated.packageAnalysisRaw.keyChanges.length - groundedKeyChanges.length} ungrounded keyChange(s) for application ${input.applicationId}`
    );
  }
  const packageAnalysis = normalizePackageAnalysis(toPackageAnalysisInput(validated.packageAnalysisRaw, groundedKeyChanges));

  // --- Persist the overlay (service-role-safe RPC, see canonicalRenderService.ts's own comment) ---
  const { data: overlayRpcResult, error: overlayError } = await client_.rpc("system_create_canonical_overlay", {
    p_user_id: input.userId,
    p_profile_id: canonicalProfileId,
    p_resume_version_id: canonicalResumeVersionId,
    p_application_id: input.applicationId,
    p_template_id: input.templateId,
    p_ai_model: process.env.OPENAI_PACKAGE_MODEL || PACKAGE_GENERATION_MODEL,
    p_prompt_version: "canonical-tailoring-v1",
    p_overlay: validated.overlay,
  });
  if (overlayError) {
    throw new CanonicalTailoringError([`overlay persistence failed: ${overlayError.message.slice(0, 200)}`]);
  }
  const overlayResult = overlayRpcResult as { status: string; overlayId?: string };
  const tailoredResumeId = overlayResult.status === "success" ? (overlayResult.overlayId ?? null) : null;

  // --- Render all formats + real document storage ---
  const render = await renderCanonicalPackage(client_, {
    userId: input.userId,
    applicationId: input.applicationId,
    runtime: applied.runtime,
    useTailored: true,
    templateId: input.templateId,
    paperSize: input.paperSize,
    density: input.density,
    locale: input.locale,
    canonicalProfileId,
    canonicalResumeVersionId,
    tailoredResumeId,
    generatedAt: new Date(0).toISOString(), // overwritten by caller when a real timestamp is available; see route/worker call sites
  });

  return {
    canonicalProfileId,
    canonicalResumeVersionId,
    tailoredResumeId,
    appliedEntryIds: applied.appliedEntryIds,
    overlayRejections: applied.rejections.map((r) => `${r.entryId ?? "summary"}: ${r.reason}`),
    render,
    packageAnalysis,
    coverLetterText: validated.coverLetterText,
    emailDraftText: validated.emailDraftText,
  };
}
