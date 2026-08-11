import OpenAI, { APIConnectionTimeoutError, RateLimitError } from "openai";
import { supabaseAdmin } from "../supabaseAdmin";
import { logSafeError } from "../errors/publicError";
import {
  PACKAGE_GENERATION_MODEL,
  PACKAGE_PROMPT_VERSION,
} from "../config/aiModels";
import {
  buildCareerMemoryManifest,
  buildUploadedResumeManifest,
  extractJson,
  cleanDocumentText,
  stripEmailSignatureContact,
  stripCoverLetterContactBlock,
  validateDocumentQuality,
  normalizePackageAnalysis,
  validateSourceIntegrity,
  validateProtectedClaims,
  validateCanadianScope,
  assertCanadaJobScopeAllowed,
  validateRequirementEvidence,
  validateAnalysisLogic,
  warnCardDifferences,
  classifyGenerationError,
  shouldRetryOpenAiError,
  logGenerationStage,
  buildLayoutCompressionPromptBlock,
  buildOriginalLayoutPromptBlock,
  buildResumeAnalysisPrompt,
  buildCoverLetterEmailPrompt,
  type LayoutConstraints,
  type ResumeAnalysisPackage,
  type CoverLetterEmailPackage,
  type PackageAnalysis,
  type DpeOriginalLayoutPayload,
} from "./shared";
import { runDpePreservationForApplication } from "../documentPreservation/runForApplication";
/*
  Phase 6G - Shadow Mode. runShadowComparisonSafely() NEVER throws (see
  its own header comment) and is always awaited at the two call sites
  below, AFTER the legacy write (success or failure) has already fully
  completed - shadow mode observes a finished legacy attempt, it never
  gates or delays it. Behind canonical_shadow_mode (default off); when
  off, runShadowComparisonSafely resolves immediately with a
  "skipped_flag_disabled" log line and does no work.
*/
import { runShadowComparisonSafely } from "../careerMemory/orchestration/canonicalShadowComparisonService";
/*
  D안 Phase 1 (Original Visual Tree) - feature-flagged (isVisualTreeEnabled,
  default OFF), upload-only, additive. Every import below is used ONLY
  inside the `if (isVisualTreeEnabled() && resumeSource === "upload")`
  block further down - when the flag is off, none of this module graph
  is ever executed, and this generation's behavior is byte-for-byte what
  it was before this Phase existed.
*/
import { analyzeDocument } from "../documentPreservation/layoutAnalysis";
import type { LayoutSourceFormat } from "../documentPreservation/layoutAnalysis/types";
import { generateContentBoxes } from "../documentPreservation/contentBox";
import { buildOriginalVisualTree } from "../documentPreservation/visualTree/buildVisualTree";
import { buildDesignTokens } from "../documentPreservation/visualTree/designTokens";
import { buildLayoutPlan } from "../documentPreservation/visualTree/buildLayoutPlan";
import { isVisualTreeEnabled } from "../documentPreservation/visualTree/types";
import { resolveNodeTexts, validateTree } from "../documentPreservation/treeExecution/treeValidation";
import { retryOverflowingLeaves } from "../documentPreservation/treeExecution/treeRetry";
/*
  Phase 6I.6.35 - wrapped for E2E safety only (no deterministic fake
  branch added here - a fresh synthetic E2E test user does not route to
  this legacy engine at all under this repo's current canary allowlist
  config, see canonicalTrafficRouter.ts). If some other code path ever
  did reach it while E2E mode is active, wrapOpenAiClientForE2eSafety
  makes it throw REAL_OPENAI_CALL_BLOCKED_IN_E2E instead of silently
  calling real OpenAI - a safe, loud failure, not a gap.
*/
import { wrapOpenAiClientForE2eSafety } from "../testing/e2eAiIsolation";
import { withOpenAiTelemetry } from "../openai/telemetry";

/*
  Deliberately relative imports throughout this file (and everything it
  imports from ./shared, ../supabaseAdmin, ../errors/publicError,
  ../config/aiModels - all already free of any local path-alias import,
  confirmed by direct inspection before this file was written) rather than
  the "@/..." alias used everywhere else in this codebase. This module is
  imported directly by netlify/functions/generate-package-background.ts,
  whose bundler is a separate build step from `next build` and is not
  confirmed to resolve tsconfig.json's custom path alias the same way
  Next.js does - relative imports remove that risk entirely rather than
  hoping the alias happens to work.
*/

const client = wrapOpenAiClientForE2eSafety(
  new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 0,
  })
);

/*
  This call now runs inside a Background Function (Netlify: up to 15
  minutes; local-dev stand-in: bounded only by the long-lived `next start`
  process), not the 60s-capped synchronous Netlify Function the old
  in-request OpenAI call used to run in - so the old OPENAI_CALL_TIMEOUT_MS
  = 60_000 (sized around a 90s *client* timeout that no longer applies
  here) is replaced with a wider ceiling. 120s sits comfortably above
  observed real latency (~26-31s locally, up to ~55s reported from
  Production in earlier investigation) while still failing well short of
  the background execution limit if something is genuinely hung.
*/
const OPENAI_CALL_TIMEOUT_MS = 120_000;

/*
  Phase5 Beta stabilization - a single, narrowly-scoped retry for the
  OpenAI call only, added because real production log evidence (this
  session's own OPENAI_TIMEOUT investigation) showed the very next
  attempt for a comparable request routinely succeeds in well under a
  minute after a 120s timeout - i.e. the timeout is typically transient
  OpenAI-side tail latency, not a structural problem with this specific
  request. MAX_OPENAI_ATTEMPTS=2 means "1 original attempt + at most 1
  retry", never more - this is NOT a generic backoff/retry system, and
  is deliberately NOT implemented via the SDK's own `maxRetries` option
  (which retries indiscriminately on any retryable-by-SDK-definition
  error, with no observability into which class triggered it). The
  loop below only ever retries when the caught error is `instanceof
  APIConnectionTimeoutError` OR `RateLimitError` (Phase 6I.6.34 -
  see shouldRetryOpenAiError()'s own comment in shared.ts for why
  retrying a 429 here is safe) - any other error (other APIError,
  SyntaxError from a malformed response, etc.) is re-thrown
  immediately on the first attempt and reaches the existing outer
  catch/classifyGenerationError path, unchanged.
*/
const MAX_OPENAI_ATTEMPTS = 2;
const OPENAI_TIMEOUT_RETRY_DELAY_MS = 2_000;

/*
  D안 Phase 1 (Original Visual Tree) - Leaf Retry's protected-claims
  guard (treeRetry.ts's ProtectedClaimsCheckFn). Deliberately NOT a call
  into shared.ts's validateProtectedClaims() - that function is designed
  around a FULL three-document context (resume+coverLetter+emailDraft)
  and throws rather than returning a boolean; calling it with two empty
  placeholder documents to check one short section fragment risks false
  positives/negatives outside the context it was built for. This is a
  narrower, Phase-1-scoped heuristic: a rewrite is rejected whenever it
  drops a number that was present before (dates, percentages, dollar
  amounts, years of experience - the concrete facts most likely to be
  silently lost by a "make this shorter" rewrite). Prose-level fact
  preservation (employer names, job titles) is still governed by the
  prompt's own "Never invent/omit" rules (buildLeafRewritePrompt), same
  as every other rewrite freedom already granted elsewhere in this
  pipeline.
*/
function looksSafeAfterLeafRewrite(originalText: string, rewrittenText: string): boolean {
  const numberPattern = /\d[\d,.]*/g;
  const originalNumbers = new Set(originalText.match(numberPattern) ?? []);
  const rewrittenNumbers = new Set(rewrittenText.match(numberPattern) ?? []);
  for (const value of originalNumbers) {
    if (!rewrittenNumbers.has(value)) return false;
  }
  return true;
}

/*
  D안 Phase 1 - post-implementation audit finding: OriginalVisualNode.
  originalText exists purely as an in-request fallback source for
  resolveNodeTexts() (treeValidation.ts) when the AI's layoutNodes
  response omits a leaf - it is never read by the Renderer
  (originalLayoutRenderer.ts reads only the separate `nodeTexts` map).
  Stripped here before the tree is embedded in dpeOriginalLayoutPayload
  (persisted to ai_insight, and returned to the client) so the full
  original resume text is not silently duplicated a second time in that
  payload. Every other field (bounds/style/sectionKey/table/divider/
  children) is preserved unchanged - this only nulls one field, at every
  depth.
*/
function stripOriginalTextForStorage(
  tree: import("../documentPreservation/visualTree/types").OriginalVisualTree
): import("../documentPreservation/visualTree/types").OriginalVisualTree {
  type Node = typeof tree.root;
  const stripNode = (node: Node): Node => ({
    ...node,
    originalText: null,
    children: node.children.map(stripNode),
  });
  return { ...tree, root: stripNode(tree.root) };
}

type GenerationStage =
  | "claimed"
  | "loading_inputs"
  | "building_prompt"
  | "generating"
  | "validating"
  | "saving";

/*
  Best-effort, never throws: a stage-tracking write failing must never take
  down the actual generation. Via RPC - see update_generate_package_stage's
  migration comment for why service_role cannot write applications
  directly. Guarded server-side to only ever touch a still-pending row, so
  a stage update from a duplicate/retried invocation that lost the atomic
  claim can never resurrect stage text on an already-resolved row.
*/
async function setStage(
  applicationId: string,
  userId: string,
  stage: GenerationStage,
  workerRequestId: string
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc(
      "update_generate_package_stage",
      {
        p_application_id: applicationId,
        p_user_id: userId,
        p_stage: stage,
      }
    );

    if (error) {
      logSafeError(error, {
        requestId: workerRequestId,
        route: "generatePackage/generateCore#stage",
        userId,
      });
    }
  } catch (error) {
    logSafeError(error, {
      requestId: workerRequestId,
      route: "generatePackage/generateCore#stage",
      userId,
    });
  }
}

/*
  Performance Optimization Round 4 - the single-retry OpenAI call loop
  (previously inline, once, in runPackageGeneration) extracted verbatim so
  both the Resume+Analysis call and the Cover Letter+Email call get the
  exact same retry policy independently, with zero duplication between
  the two call sites. Still MAX_OPENAI_ATTEMPTS=2 ("1 original attempt +
  at most 1 retry"), still only retries when shouldRetryOpenAiError()
  (imported from ./shared) says so and attempts remain - any other error
  class is re-thrown on the first attempt, reaching the same outer catch/
  classifyGenerationError path. `callLabel` is diagnostics-only (which of
  the two calls this attempt belongs to), never affects control flow.

  Phase 6I.6.34 - shouldRetryOpenAiError() (renamed from
  shouldRetryOpenAiTimeout()) now also retries a RateLimitError (429),
  not just APIConnectionTimeoutError - see that function's own comment
  in shared.ts for why this is safe here specifically (Generate Package
  quota is reserved once per logical request, before any OpenAI call,
  and completed/released once after the whole attempt resolves - an
  extra attempt inside this same bounded loop never double-reserves or
  double-consumes it).
*/
async function callOpenAiWithRetry(
  applicationId: string,
  promptText: string,
  resolvedModel: string,
  callLabel: "resume_analysis" | "cover_letter_email"
): Promise<OpenAI.Responses.Response> {
  // Explicitly typed as the non-streaming Response (not
  // ReturnType<typeof client.responses.create>, which resolves to the
  // streaming|non-streaming union once the call is behind a generic
  // helper rather than inline with a literal, stream-less args object) -
  // this call never passes `stream`, so it always resolves to this shape,
  // exactly as it did before this call was extracted into its own
  // function.
  let aiResponse: OpenAI.Responses.Response | null = null;

  for (let attempt = 1; attempt <= MAX_OPENAI_ATTEMPTS; attempt++) {
    const attemptStartedAt = Date.now();
    try {
      aiResponse = await withOpenAiTelemetry(
        { operation: "GENERATE_PACKAGE", model: resolvedModel, retryCount: attempt - 1, applicationId },
        () =>
          client.responses.create(
            {
              model: resolvedModel,
              input: promptText,
            },
            { timeout: OPENAI_CALL_TIMEOUT_MS, maxRetries: 0 }
          )
      );
      console.log(
        JSON.stringify({
          event: "generate_package_openai_attempt",
          applicationId,
          call: callLabel,
          attempt,
          maxAttempts: MAX_OPENAI_ATTEMPTS,
          model: resolvedModel,
          durationMs: Date.now() - attemptStartedAt,
          outcome: "ok",
        })
      );
      break;
    } catch (attemptError) {
      const isTimeout =
        attemptError instanceof APIConnectionTimeoutError;
      const isRateLimited =
        attemptError instanceof RateLimitError;
      console.log(
        JSON.stringify({
          event: "generate_package_openai_attempt",
          applicationId,
          call: callLabel,
          attempt,
          maxAttempts: MAX_OPENAI_ATTEMPTS,
          model: resolvedModel,
          durationMs: Date.now() - attemptStartedAt,
          outcome: isTimeout ? "timeout" : isRateLimited ? "rate_limited" : "error",
          errorCode: isTimeout
            ? "OPENAI_TIMEOUT"
            : isRateLimited
              ? "OPENAI_RATE_LIMITED"
              : attemptError instanceof Error
                ? attemptError.name
                : "Unknown",
        })
      );

      if (
        !shouldRetryOpenAiError(
          attemptError,
          attempt,
          MAX_OPENAI_ATTEMPTS
        )
      ) {
        throw attemptError;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, OPENAI_TIMEOUT_RETRY_DELAY_MS)
      );
    }
  }

  if (!aiResponse) {
    // Unreachable in practice (the loop above always either returns a
    // response or throws), kept only so TypeScript can see aiResponse is
    // non-null below without a non-null assertion.
    throw new Error("OpenAI call produced no response and no error.");
  }

  return aiResponse;
}

/*
  Runs the actual AI generation for one already-claimed applications row.
  Performs its own atomic worker-claim first (UPDATE ... WHERE
  generation_status = 'pending' AND generation_worker_claimed_at IS NULL),
  so calling this twice for the same applicationId - e.g. a platform-level
  retry of a failed/timed-out Background Function invocation, or the
  local-dev stand-in route being hit twice - is safe: the second call's
  claim affects 0 rows and it returns immediately without ever calling
  OpenAI.

  Reads ONLY the applications row (via the service-role client, explicit
  id + generation_status + generation_worker_claimed_at filtering, since
  RLS is bypassed by design here) - never re-queries career_memory,
  resumes, or cover_letters. Every fact fed to the AI, and the entire
  fact-checking manifest, comes from the generation_input_* snapshot
  columns frozen at claim time by the synchronous route (see its own
  docstring), so a user changing their Dashboard selection mid-generation,
  or a retry of the same generationRequestId, cannot silently change what
  gets generated. "Ownership" of this row was already enforced once, by
  the authenticated (RLS-scoped) sync route at claim time; this function
  has no separate caller identity to check against - user_id on the
  already-claimed row is trusted as-is.
*/
export async function runPackageGeneration(
  applicationId: string
): Promise<void> {
  const workerRequestId = crypto.randomUUID();
  const workerReceivedAt = Date.now();

  console.log(
    `GP WORKER CLAIM START workerRequestId=${workerRequestId} applicationId=${applicationId}`
  );

  const claimStartedAt = Date.now();

  /*
    Via RPC, not a direct .from("applications").update(...) - service_role
    has no direct table GRANT on applications in this project (see the
    claim_generate_package_worker migration's own comment for why: every
    application table here is either RLS-scoped-client-only or, like
    generate_package_usage, RPC-only for service_role - there is no
    "service_role can read/write applications directly" path). This
    SECURITY DEFINER function performs the exact same atomic UPDATE ...
    WHERE generation_status='pending' AND generation_worker_claimed_at IS
    NULL RETURNING * this worker used to run directly.
  */
  const { data: claimedRows, error: claimError } = await supabaseAdmin.rpc(
    "claim_generate_package_worker",
    { p_application_id: applicationId }
  );

  logGenerationStage({
    applicationId,
    stage: "claim",
    durationMs: Date.now() - claimStartedAt,
    status: claimError ? "error" : claimedRows?.[0] ? "ok" : "miss",
  });

  if (claimError) {
    logSafeError(claimError, {
      requestId: workerRequestId,
      route: "generatePackage/generateCore#claim",
    });
    return;
  }

  const row = claimedRows?.[0];

  if (!row) {
    /*
      0 rows affected: either another invocation already claimed this
      applicationId (duplicate/retried worker call - the exact scenario
      this claim exists to make safe), or the row is no longer in a
      claimable state (already succeeded/failed). Either way, exiting
      silently here is correct - it is what makes worker-level duplicate
      execution safe without ever calling OpenAI a second time.
    */
    console.log(
      `GP WORKER CLAIM MISS workerRequestId=${workerRequestId} applicationId=${applicationId}`
    );
    return;
  }

  console.log(
    `GP WORKER CLAIM OK workerRequestId=${workerRequestId} applicationId=${applicationId}`
  );

  const userId: string = row.user_id;
  const generationRequestId: string | null = row.generation_request_id;

  await setStage(applicationId, userId, "claimed", workerRequestId);

  try {
    const loadInputsStartedAt = Date.now();
    await setStage(applicationId, userId, "loading_inputs", workerRequestId);

    const resumeText: string = row.generation_input_resume_text || "";
    const jobText: string = row.job_description || "";

    /*
      Defensive input validation - the sync route already guarantees both
      of these are non-empty before ever claiming a row, but the worker
      treats its own input as untrusted rather than assuming the snapshot
      is always well-formed (e.g. a future bug in the sync route, or a
      row manually edited in the database).
    */
    if (!resumeText.trim() || !jobText.trim()) {
      throw new Error(
        "The generation input snapshot is missing required resume or job description text."
      );
    }

    /*
      Phase 6I.6.22 - deterministic Canada-scope gate, run BEFORE any AI
      call (Call1 below) so an explicitly non-Canada job never reaches
      OpenAI at all (Part H/L). See assertCanadaJobScopeAllowed()'s own
      comment (shared.ts) for why this no longer waits for Call1's own
      jobContext response the way validateCanadianScope() (still called
      after Call1, below, for the separate federal-sector exclusion)
      does.
    */
    assertCanadaJobScopeAllowed(jobText);

    const resumeSource: "career_memory" | "upload" =
      row.resume_source === "uploaded" ? "upload" : "career_memory";

    const title: string = row.job_title || "the position";
    const company: string = row.company || "the company";
    const analysis: unknown = row.job_analysis || {};
    const existingCoverLetter: string =
      row.generation_input_cover_letter_text || "";

    const manifest =
      row.resume_source === "career_memory"
        ? buildCareerMemoryManifest(
            row.generation_input_manifest_source,
            resumeText
          )
        : buildUploadedResumeManifest(
            row.generation_input_manifest_source
          );

    logGenerationStage({
      applicationId,
      stage: "loading_inputs",
      durationMs: Date.now() - loadInputsStartedAt,
    });

    const buildPromptStartedAt = Date.now();
    await setStage(applicationId, userId, "building_prompt", workerRequestId);

    const resolvedModel =
      process.env.OPENAI_PACKAGE_MODEL || PACKAGE_GENERATION_MODEL;

    /*
      Document Preservation Engine (DPE) Phase 4B completion - optional
      Layout Compression Request (see shared.ts's own comment on
      GenerationMode/LayoutConstraints/buildLayoutCompressionPromptBlock).
      NULL/"standard" (every row before this phase, and every row from a
      caller that never sets these columns) produces layoutCompressionBlock
      = "" - the prompt below is then BYTE-IDENTICAL to before this phase,
      preserving the normal Generate Package path exactly.
    */
    const dpeGenerationMode: string | null = row.dpe_generation_mode || null;
    const dpeLayoutConstraints: LayoutConstraints | null =
      dpeGenerationMode === "layout_compression" && row.dpe_layout_constraints
        ? (row.dpe_layout_constraints as LayoutConstraints)
        : null;
    const layoutCompressionBlock = dpeLayoutConstraints
      ? `\n${buildLayoutCompressionPromptBlock(dpeLayoutConstraints)}\n`
      : "";

    /*
      D안 Phase 1 (Original Visual Tree) - built BEFORE Call1, same
      applicability boundary as the existing DPE (uploaded resumes
      only, real PDF/DOCX in Storage) - see runForApplication.ts's own
      comment for why career_memory has no original file to preserve.
      Read once here and reused both for this tree build and for the
      existing DPE call further below, so a successful tree build never
      causes the SAME original file to be downloaded/parsed twice.
    */
    const uploadedResumeSnapshot = row.generation_input_manifest_source as
      | { storage_path?: string | null; original_file_type?: string | null }
      | null
      | undefined;

    let visualTree: import("../documentPreservation/visualTree/types").OriginalVisualTree | null = null;
    let visualDesignTokens: import("../documentPreservation/visualTree/types").DesignTokens | null = null;
    let visualLayoutPlan: import("../documentPreservation/visualTree/buildLayoutPlan").LayoutGenerationPlan | null = null;
    let originalLayoutPromptBlock = "";

    if (isVisualTreeEnabled() && resumeSource === "upload") {
      try {
        const storagePath = uploadedResumeSnapshot?.storage_path ?? null;
        const sourceFormat = uploadedResumeSnapshot?.original_file_type ?? null;

        if (storagePath && (sourceFormat === "pdf" || sourceFormat === "docx")) {
          const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
            .from("resumes")
            .download(storagePath);

          if (!downloadError && fileBlob) {
            const buffer = Buffer.from(await fileBlob.arrayBuffer());
            const layoutResult = await analyzeDocument("resume", sourceFormat as LayoutSourceFormat, buffer);
            const layerModel = generateContentBoxes("resume", layoutResult);
            const tree = buildOriginalVisualTree(layerModel, layoutResult);

            if (tree.fallbackPolicy !== "flat_text_only") {
              const tokens = buildDesignTokens(layerModel, layoutResult);
              const plan = buildLayoutPlan(tree, tokens);
              visualTree = tree;
              visualDesignTokens = tokens;
              visualLayoutPlan = plan;
              originalLayoutPromptBlock = `\n${buildOriginalLayoutPromptBlock(plan)}\n`;
            }
          }
        }
      } catch (treeBuildError) {
        // Never blocks Generate Package - the same "a DPE failure keeps
        // Generate Package's own AI text unchanged" principle
        // runDpePreservationForApplication() already follows. Only a
        // safe status code is logged, never the caught error's own
        // message/stack (which could echo file/document content).
        console.log(
          JSON.stringify({
            event: "dpe_visual_tree_build_failed",
            applicationId,
            status: treeBuildError instanceof Error ? treeBuildError.name : "UnknownError",
          })
        );
      }
    }

    const resumeAnalysisPrompt = buildResumeAnalysisPrompt({
      resumeSource,
      manifest,
      resumeText,
      analysis,
      jobText,
      originalLayoutPromptBlock,
      layoutCompressionBlock,
    });

    logGenerationStage({
      applicationId,
      stage: "building_prompt",
      durationMs: Date.now() - buildPromptStartedAt,
    });

    console.log(
      `GP WORKER OPENAI START (call1: resume+analysis) workerRequestId=${workerRequestId} applicationId=${applicationId}`
    );
    const call1StartedAt = Date.now();
    await setStage(applicationId, userId, "generating", workerRequestId);

    const call1Response = await callOpenAiWithRetry(
      applicationId,
      resumeAnalysisPrompt,
      resolvedModel,
      "resume_analysis"
    );

    console.log(
      `GP WORKER OPENAI END (call1: resume+analysis) workerRequestId=${workerRequestId} applicationId=${applicationId}`
    );

    logGenerationStage({
      applicationId,
      stage: "call1_openai",
      durationMs: Date.now() - call1StartedAt,
      model: resolvedModel,
      inputTokens: call1Response.usage?.input_tokens,
      outputTokens: call1Response.usage?.output_tokens,
      cachedTokens:
        call1Response.usage?.input_tokens_details?.cached_tokens,
      status: "ok",
    });

    const call1ValidateStartedAt = Date.now();
    await setStage(applicationId, userId, "validating", workerRequestId);

    const rawResumeAnalysis = extractJson<ResumeAnalysisPackage>(
      call1Response.output_text
    );

    if (typeof rawResumeAnalysis.resume !== "string") {
      throw new Error(
        "The AI returned the resume in an invalid format."
      );
    }

    const resume = cleanDocumentText(rawResumeAnalysis.resume);

    validateDocumentQuality("Resume", resume);

    const packageAnalysis = normalizePackageAnalysis(
      rawResumeAnalysis.packageAnalysis
    );

    /*
      선택한 원본만 검증 기준으로 사용한다.
    */
    const sourceText = manifest.originalText;

    validateSourceIntegrity(resume, manifest);
    validateCanadianScope(packageAnalysis.verification);
    validateRequirementEvidence(packageAnalysis.verification, sourceText);
    validateAnalysisLogic(packageAnalysis);
    warnCardDifferences(packageAnalysis);

    logGenerationStage({
      applicationId,
      stage: "call1_validating",
      durationMs: Date.now() - call1ValidateStartedAt,
    });

    /*
      Document Preservation Engine (DPE) - Phase 1 completion (Phase 1-4
      roadmap-closure effort). The official Generate Package -> DPE ->
      Renderer execution path, run AFTER every one of Generate Package's
      own validators above already passed on `resume` unchanged - DPE
      never sees unvalidated text, and never bypasses any of those
      checks. Only ever OPTIONALLY re-expresses the ALREADY-VALIDATED
      resume text through the original uploaded file's own Content Boxes
      when doing so is confirmed (by real measurement/validation) to
      preserve the original layout - see runForApplication.ts's own
      comment for the full applicability boundary and why this never
      calls OpenAI or bypasses Protected Claims/Validation. Never throws:
      any failure here keeps `resume` (Generate Package's own AI output)
      completely unchanged, exactly this route's behavior before this
      pass.
    */
    /*
      D안 Phase 1 (Original Visual Tree) - Call1 output handling. Only
      ever runs when the pre-Call1 tree build above (visualTree) already
      succeeded. `resume` (the flat text validated above) is NEVER
      altered by this block - Cover Letter/Email and the DB's own
      `resume_text` column keep receiving exactly the same flat text
      regardless of whether this block runs, per this Phase's own
      "Cover Letter와 Email은... Layout Profile을 전달하지 않는다" rule.
      This block only ever produces a SEPARATE `dpeOriginalLayoutPayload`
      (tree + tokens + per-node text) used exclusively for rendering the
      Preview/Download PDF (paste-job/page.tsx) - see this Phase's final
      report for the disclosed trade-off this implies (a retried leaf's
      rendered text can differ slightly from the flat `resume` field).
    */
    let dpeOriginalLayoutPayload: DpeOriginalLayoutPayload | null = null;
    let visualTreeStatus: string | null = null;
    let visualTreeReason: string | null = null;

    if (visualTree && visualDesignTokens && visualLayoutPlan) {
      try {
        const rawLayoutNodes = Array.isArray(rawResumeAnalysis.layoutNodes) ? rawResumeAnalysis.layoutNodes : [];
        const layoutNodesInput = rawLayoutNodes.filter(
          (n): n is { nodeId: string; text: string } => !!n && typeof n.nodeId === "string" && typeof n.text === "string"
        );

        if (layoutNodesInput.length > 0) {
          let { nodeTexts } = resolveNodeTexts(visualTree, layoutNodesInput);
          let report = validateTree(visualTree, visualDesignTokens, visualLayoutPlan, layoutNodesInput);

          const nonOverflowErrors = report.errors.filter((e) => e.type !== "clipping" && e.type !== "page_overflow");
          const overflowNodeIds = [
            ...new Set(
              report.errors
                .filter((e) => (e.type === "clipping" || e.type === "page_overflow") && e.contentBoxId)
                .map((e) => e.contentBoxId as string)
            ),
          ];

          if (nonOverflowErrors.length === 0 && overflowNodeIds.length > 0) {
            const retryResult = await retryOverflowingLeaves({
              tree: visualTree,
              plan: visualLayoutPlan,
              nodeTexts,
              overflowingNodeIds: overflowNodeIds,
              overflowMmByNodeId: {},
              rewriteLeaf: async (prompt) => {
                const response = await callOpenAiWithRetry(applicationId, prompt, resolvedModel, "resume_analysis");
                return response.output_text ?? "";
              },
              isSafeAgainstProtectedClaims: looksSafeAfterLeafRewrite,
            });
            nodeTexts = retryResult.nodeTexts;
            report = validateTree(
              visualTree,
              visualDesignTokens,
              visualLayoutPlan,
              Object.entries(nodeTexts).map(([nodeId, text]) => ({ nodeId, text }))
            );
          }

          if (report.errors.filter((e) => e.type !== "clipping" && e.type !== "page_overflow").length === 0 && !report.errors.some((e) => e.type === "broken_mapping")) {
            // Sanitize before persisting/transmitting - originalText only
            // ever needed the (already-consumed, above) resolveNodeTexts()
            // fallback during THIS request. The client-side Renderer
            // (originalLayoutRenderer.ts) reads exclusively from
            // nodeTexts, never from tree node.originalText - persisting it
            // anyway would silently duplicate the full original resume
            // text a second time inside ai_insight, growing that column
            // and the client's API response for no functional benefit
            // (found during this Phase's post-implementation audit).
            dpeOriginalLayoutPayload = { version: 1, tree: stripOriginalTextForStorage(visualTree), designTokens: visualDesignTokens, nodeTexts };
            visualTreeStatus = report.valid ? "VISUAL_TREE_APPLIED" : "VISUAL_TREE_APPLIED_WITH_WARNINGS";
            visualTreeReason = `D안 Phase 1 Original Visual Tree applied - ${Object.keys(nodeTexts).length} node(s) rendered from the original document's own layout (${report.errors.length} unresolved overflow finding(s)).`;
          } else {
            visualTreeStatus = "VISUAL_TREE_REJECTED";
            visualTreeReason = `D안 Phase 1 Original Visual Tree validation failed non-overflow checks (${report.errors.map((e) => e.type).join(", ")}) - falling back to the existing Renderer path.`;
          }
        }
      } catch (treeOutputError) {
        console.log(
          JSON.stringify({
            event: "dpe_visual_tree_output_failed",
            applicationId,
            status: treeOutputError instanceof Error ? treeOutputError.name : "UnknownError",
          })
        );
      }
    }

    const dpeStartedAt = Date.now();

    // The existing DPE (text-reconstruction through CareerElan's own
    // Renderer) only runs when the Visual Tree path above did NOT
    // already produce a usable result - mutually exclusive by
    // construction, so the original file is never parsed twice on any
    // single successful path (Visual Tree parses once and this is
    // skipped, or Visual Tree was skipped/failed and this parses once,
    // exactly as it always has).
    const dpeOutcome = dpeOriginalLayoutPayload
      ? { applied: false, finalResumeText: null, status: visualTreeStatus ?? "VISUAL_TREE_APPLIED", reason: visualTreeReason ?? "" }
      : await runDpePreservationForApplication({
          applicationId,
          resumeSource: row.resume_source ?? null,
          resumeId: row.resume_id ?? null,
          storagePath: uploadedResumeSnapshot?.storage_path ?? null,
          originalFileType: uploadedResumeSnapshot?.original_file_type ?? null,
          aiGeneratedResumeText: resume,
          templateId: row.resume_template_id || "classic",
        });

    logGenerationStage({
      applicationId,
      stage: "dpe",
      durationMs: Date.now() - dpeStartedAt,
      status: dpeOutcome.status,
    });

    const finalResumeText = dpeOutcome.applied && dpeOutcome.finalResumeText
      ? dpeOutcome.finalResumeText
      : resume;

    /*
      Performance Optimization Round 4 - Call 2 (Cover Letter + Email
      only). Deliberately does NOT receive packageAnalysis or the
      SourceManifest (per this round's explicit instruction and Round 3's
      dependency analysis, which found neither used by Cover Letter/Email
      writing logic) - only the finalized Resume text, the job posting,
      title/company, and the existing cover letter style reference.
    */
    const coverLetterEmailPrompt = buildCoverLetterEmailPrompt({
      title,
      company,
      finalResumeText,
      jobText,
      existingCoverLetter,
    });

    console.log(
      `GP WORKER OPENAI START (call2: cover letter+email) workerRequestId=${workerRequestId} applicationId=${applicationId}`
    );
    const call2StartedAt = Date.now();
    await setStage(applicationId, userId, "generating", workerRequestId);

    const call2Response = await callOpenAiWithRetry(
      applicationId,
      coverLetterEmailPrompt,
      resolvedModel,
      "cover_letter_email"
    );

    console.log(
      `GP WORKER OPENAI END (call2: cover letter+email) workerRequestId=${workerRequestId} applicationId=${applicationId}`
    );

    logGenerationStage({
      applicationId,
      stage: "call2_openai",
      durationMs: Date.now() - call2StartedAt,
      model: resolvedModel,
      inputTokens: call2Response.usage?.input_tokens,
      outputTokens: call2Response.usage?.output_tokens,
      cachedTokens:
        call2Response.usage?.input_tokens_details?.cached_tokens,
      status: "ok",
    });

    const call2ValidateStartedAt = Date.now();
    await setStage(applicationId, userId, "validating", workerRequestId);

    const rawCoverLetterEmail = extractJson<CoverLetterEmailPackage>(
      call2Response.output_text
    );

    if (
      typeof rawCoverLetterEmail.coverLetter !== "string" ||
      typeof rawCoverLetterEmail.emailDraft !== "string"
    ) {
      throw new Error(
        "The AI returned one or more documents in an invalid format."
      );
    }

    /*
      Resume contact info is untouched (out of scope) -
      stripCoverLetterContactBlock only ever removes the applicant's own
      contact lines directly under their name at the very top of the
      cover letter, never the recipient's company/address block further
      down or anything mentioned in the body.
    */
    const coverLetter = stripCoverLetterContactBlock(
      cleanDocumentText(rawCoverLetterEmail.coverLetter)
    );
    /*
      stripEmailSignatureContact only ever removes a trailing phone/email
      line directly under the closing signature block, never anything
      mentioned earlier in the email body.
    */
    const emailDraft = stripEmailSignatureContact(
      cleanDocumentText(rawCoverLetterEmail.emailDraft)
    );

    validateDocumentQuality("Cover Letter", coverLetter);
    validateDocumentQuality("Email Draft", emailDraft);

    /*
      Uses the pre-DPE `resume` (Call 1's cleaned AI output), not
      `finalResumeText` - byte-identical to this validator's original
      timing/target (it ran before DPE in the single-call pipeline too).
      Only the wall-clock position moved (now after Call 2), never the
      text it checks.
    */
    const documents = { resume, coverLetter, emailDraft };

    validateProtectedClaims(documents, sourceText);

    logGenerationStage({
      applicationId,
      stage: "call2_validating",
      durationMs: Date.now() - call2ValidateStartedAt,
    });

    console.log(
      `GP WORKER DB UPDATE START workerRequestId=${workerRequestId} applicationId=${applicationId}`
    );
    const saveStartedAt = Date.now();
    await setStage(applicationId, userId, "saving", workerRequestId);

    /*
      D안 Phase 1 (Original Visual Tree) - the tree/tokens/node-texts
      payload rides inside the EXISTING ai_insight jsonb column (no new
      column, no migration - "DB migration 금지"), as an additive key
      alongside the normal PackageAnalysis fields. This is exactly the
      same column app/api/applications/[id]/status/route.ts already
      returns to the client verbatim as `packageAnalysis` (confirmed by
      reading that route) - paste-job/page.tsx's existing
      packageData.packageAnalysis state picks up the new key with zero
      changes to how that value is fetched/stored, only to how the PDF
      preview/download effect reads it (see that file's own changes).
    */
    const aiInsightPayload: PackageAnalysis = dpeOriginalLayoutPayload
      ? { ...packageAnalysis, dpeOriginalLayout: dpeOriginalLayoutPayload }
      : packageAnalysis;

    // Via RPC - see claim_generate_package_worker's migration comment for
    // why service_role cannot write applications directly.
    const { error: completeWriteError } = await supabaseAdmin.rpc(
      "complete_generate_package_generation",
      {
        p_application_id: applicationId,
        p_user_id: userId,
        p_resume_text: finalResumeText,
        p_cover_letter_text: coverLetter,
        p_email_draft: emailDraft,
        p_ai_insight: aiInsightPayload,
        p_generation_model: resolvedModel,
        p_prompt_version: PACKAGE_PROMPT_VERSION,
        p_dpe_status: dpeOutcome.status,
        p_dpe_reason: dpeOutcome.reason,
      }
    );

    if (completeWriteError) {
      throw completeWriteError;
    }
    console.log(
      `GP WORKER DB UPDATE END workerRequestId=${workerRequestId} applicationId=${applicationId}`
    );

    logGenerationStage({
      applicationId,
      stage: "saving",
      durationMs: Date.now() - saveStartedAt,
    });

    /*
      Best-effort, retried, but deliberately NOT "fail closed" the way the
      old synchronous route had to be: there is no HTTP caller left
      waiting to receive an error and decide whether to retry. Instead,
      durability comes from two things that are both already true the
      moment generation_status flips to 'succeeded' above: (1) the result
      itself is already durably saved on the applications row regardless
      of whether this RPC ever succeeds, and (2)
      reserve_generate_package_usage()/get_generate_package_usage()'s own
      reconcile step (see supabase/migrations/
      20260725171800_generate_package_quota_state_reclaim.sql) already
      self-heals any 'reserved' row whose linked application has
      generation_status = 'succeeded' into 'completed' on the very next
      call either function receives for this user - including the next
      time the Dashboard's AI Usage widget polls
      /api/generate-package/usage. A failure here is therefore never a
      silent free generation; it's logged and left to that self-healing
      path.
    */
    if (generationRequestId) {
      console.log(
        `GP WORKER QUOTA COMPLETE START workerRequestId=${workerRequestId} applicationId=${applicationId}`
      );
      let completeError = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await supabaseAdmin.rpc(
          "complete_generate_package_usage",
          {
            p_user_id: userId,
            p_request_id: generationRequestId,
          }
        );

        completeError = error;

        if (!completeError) {
          break;
        }

        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      if (completeError) {
        logSafeError(completeError, {
          requestId: workerRequestId,
          route: "generatePackage/generateCore#quota-complete",
          userId,
          generationRequestId,
        });
      } else {
        console.log(
          `GP WORKER QUOTA COMPLETE END workerRequestId=${workerRequestId} applicationId=${applicationId}`
        );
      }
    }

    logGenerationStage({
      applicationId,
      stage: "worker_total",
      durationMs: Date.now() - workerReceivedAt,
      status: "succeeded",
    });

    /*
      Phase 6G Shadow Mode - awaited, fully isolated. runShadowComparisonSafely()
      is itself designed to never throw (see its own header comment), but this
      call site adds its own redundant try/catch anyway: it sits inside the
      SAME try block as the legacy success path above, so an uncaught
      exception here would otherwise fall into the catch block below and
      incorrectly re-run failure RPCs (fail_generate_package_generation,
      quota release) against an application that has already succeeded.
      Defense-in-depth, not reliance on the callee's own contract alone.
    */
    try {
      await runShadowComparisonSafely({
        userId,
        applicationId,
        jobDescriptionText: String(row.job_description || ""),
        jobAnalysisSummary: String(row.job_description_normalized || ""),
        legacySucceeded: true,
      });
    } catch (shadowError) {
      console.log(
        `GP WORKER SHADOW UNEXPECTED workerRequestId=${workerRequestId} applicationId=${applicationId} name=${shadowError instanceof Error ? shadowError.name : typeof shadowError}`
      );
    }
  } catch (error) {
    const caughtErrorName =
      error instanceof Error ? error.name : typeof error;
    console.log(
      `GP WORKER CAUGHT ERROR workerRequestId=${workerRequestId} applicationId=${applicationId} name=${caughtErrorName}`
    );

    const { code, summary } = classifyGenerationError(error);

    try {
      // Via RPC - see claim_generate_package_worker's migration comment for
      // why service_role cannot write applications directly.
      await supabaseAdmin.rpc("fail_generate_package_generation", {
        p_application_id: applicationId,
        p_user_id: userId,
        p_error_code: code,
        p_error_summary: summary,
      });
    } catch {
      /*
        Best-effort only - a failure to mark this row as failed must never
        mask or replace the original error being logged below.
      */
    }

    if (generationRequestId) {
      try {
        /*
          Best-effort, single attempt (unlike the retried quota-complete
          call above) - matches the old synchronous route's own catch-block
          behavior. A failure here still self-heals: reserve_generate_
          package_usage()'s reconcile step marks a 'reserved' row 'released'
          once it sees generation_status = 'failed' on the linked
          application, on the very next reserve/get call for this user.
        */
        await supabaseAdmin.rpc("release_generate_package_usage", {
          p_user_id: userId,
          p_request_id: generationRequestId,
        });
      } catch {
        /*
          Best-effort only - must never mask the original error logged
          below.
        */
      }
    }

    logSafeError(error, {
      requestId: workerRequestId,
      route: "generatePackage/generateCore#generate",
      userId,
      generationRequestId: generationRequestId ?? undefined,
    });

    logGenerationStage({
      applicationId,
      stage: "worker_total",
      durationMs: Date.now() - workerReceivedAt,
      status: `failed:${code}`,
    });

    /*
      Phase 6G Shadow Mode - awaited, fully isolated. Same redundant
      try/catch rationale as the success-path call site above: this is the
      last statement in the worker's own catch block, so an uncaught
      exception here would otherwise escape runPackageGeneration entirely
      as an unhandled rejection, even though the legacy failure has already
      been fully recorded (fail RPC + quota release already ran above).
    */
    try {
      await runShadowComparisonSafely({
        userId,
        applicationId,
        jobDescriptionText: String(row.job_description || ""),
        jobAnalysisSummary: String(row.job_description_normalized || ""),
        legacySucceeded: false,
      });
    } catch (shadowError) {
      console.log(
        `GP WORKER SHADOW UNEXPECTED workerRequestId=${workerRequestId} applicationId=${applicationId} name=${shadowError instanceof Error ? shadowError.name : typeof shadowError}`
      );
    }
  }
}
