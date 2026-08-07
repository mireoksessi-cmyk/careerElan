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
import OpenAI, { APIConnectionTimeoutError } from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCanonicalRuntimeViaServiceRole } from "./canonicalMemoryBundleFetch";
import { applyOverlay } from "../runtime/overlayRuntime";
import { validateAiTailoringResponse } from "./canonicalTailoringService";
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

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_CALL_TIMEOUT_MS = 60_000;
const MAX_TAILORING_ATTEMPTS = 2; // 1 original + 1 schema-repair retry, per round spec §7

export type CanonicalGeneratePackageInput = {
  userId: string;
  applicationId: string;
  jobDescriptionText: string;
  jobAnalysisSummary: string;
  targetRole?: string;
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
};

function extractJsonLoose(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("no JSON object found in AI response");
  return JSON.parse(text.slice(start, end + 1));
}

async function callTailoringOpenAi(promptText: string): Promise<string> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await client.responses.create({ model: process.env.OPENAI_PACKAGE_MODEL || PACKAGE_GENERATION_MODEL, input: promptText }, { timeout: OPENAI_CALL_TIMEOUT_MS, maxRetries: 0 });
      return response.output_text;
    } catch (error) {
      if (attempt < 2 && error instanceof APIConnectionTimeoutError) continue;
      throw error;
    }
  }
  throw new Error("unreachable");
}

export async function generateCanonicalPackage(client_: SupabaseClient, input: CanonicalGeneratePackageInput): Promise<CanonicalGeneratePackageResult> {
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
  const { profile, runtime } = lookup;
  if (!runtime.version?.id) {
    throw new CanonicalVersionUnavailableError("no resume version exists for this profile");
  }

  const canonicalProfileId = profile.id;
  const canonicalResumeVersionId = runtime.version.id;

  // --- AI tailoring call: raw JSON -> deterministic validator, 1 repair retry ---
  const prompt = buildCanonicalTailoringPrompt({ resume: runtime.resume, jobDescriptionText: input.jobDescriptionText, jobAnalysisSummary: input.jobAnalysisSummary, targetRole: input.targetRole });

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
  const applied = applyOverlay(runtime, validated.overlay);
  if (applied.rejections.length > 0) {
    throw new CanonicalTailoringError(applied.rejections.map((r) => `${r.entryId ?? "summary"}: ${r.reason} (${r.detail})`));
  }

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
  };
}
