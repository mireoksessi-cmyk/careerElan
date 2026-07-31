/*
  Document Preservation Engine (DPE) - Phase 1 completion (Phase 1-4
  roadmap-closure effort). The official Generate Package -> DPE ->
  Renderer execution path this phase's own spec requires
  ("Execution Engine이 'Not called from anywhere' 상태를 제거한다").

  This is the ONLY place in the whole DPE tree that is actually invoked
  by production code (see generateCore.ts's own call site, added in this
  same pass) - every other module here (layoutAnalysis, contentBox,
  contentMapping, executionEngine) is wired together for the first time
  through this one entry point, not duplicated or reimplemented.

  Backward compatibility (this phase's own hard requirement): if this
  function is not applicable, fails, or is not confident, the caller
  (generateCore.ts) keeps using Generate Package's own AI-generated
  resume text completely unchanged - exactly today's behavior. DPE only
  ever OPTIONALLY improves layout preservation for the one case it can
  legitimately help: a resume whose ORIGINAL uploaded file (PDF/DOCX)
  still exists in Storage, so there is a real original layout to
  preserve. A career_memory-sourced resume has no such original file
  (it was generated from structured fields, never uploaded), so DPE
  correctly never applies there - this is the real, disclosed
  applicability boundary, not an arbitrary restriction.

  Never calls OpenAI, never regenerates content, never bypasses Generate
  Package's own Protected Claims/Validation (those already ran, in
  generateCore.ts, on the SAME resume text this function receives,
  before this function is ever called) - this function only decides
  whether the ALREADY-VALIDATED text can be re-expressed through the
  original document's own Content Boxes with real layout preservation
  confirmed by real measurement.

  Real E2E verification round bug fix: this function used to read
  `storage_path`/`original_file_type` itself via
  `supabaseAdmin.from("resumes").select(...)` - a raw table SELECT as
  service_role. A real end-to-end Generate Package run (real login, real
  HTTP call, real OpenAI, real DB) confirmed this ALWAYS failed with
  "permission denied for table resumes": service_role is granted only
  REFERENCES/TRIGGER/TRUNCATE/MAINTAIN on `resumes` (see
  supabase/migrations/20260720153937_remote_schema.sql) - the same
  restriction documented at the top of
  supabase/migrations/20260728100037_document_analysis_async_tracking.sql
  for the exact same table. This meant DPE had never actually run for any
  real production Generate Package request - always silently fell back to
  `status: "not_applicable"`, invisibly, since a DPE failure never blocks
  Generate Package's own success by design. Fixed by having the caller
  (generateCore.ts) pass `storagePath`/`originalFileType` directly - it
  already has them, snapshotted via the ORIGINAL request's real
  authenticated user session at claim time
  (`row.generation_input_manifest_source`, the same real resumes-row
  snapshot `buildUploadedResumeManifest()` already reads from) - no new
  table read, no migration, no new grant needed.
*/
import { supabaseAdmin } from "../supabaseAdmin";
import { analyzeDocument } from "./layoutAnalysis";
import type { LayoutSourceFormat } from "./layoutAnalysis/types";
import { generateContentBoxes } from "./contentBox";
import { createReplacementPlan } from "./contentMapping";
import { runExecutionEngine } from "./executionEngine";
import type { ExecutionStatus } from "./executionEngine/types";

export type DpePreservationOutcome = {
  applied: boolean;
  finalResumeText: string | null;
  status: ExecutionStatus | "not_applicable" | "error";
  reason: string;
};

const SUPPORTED_SOURCE_FORMATS: LayoutSourceFormat[] = ["pdf", "docx"];

/*
  A DPE result is only ever used when it genuinely preserved required
  content and passed validation - PAGE_EXPANDED is included (more pages
  than the original, but Content/Template both confirmed intact by real
  measurement, per executionEngine's own status definition), the other
  three (MAPPING_FAILED/VALIDATION_FAILED/LAYOUT_IMPOSSIBLE) never are.
*/
const USABLE_STATUSES: ExecutionStatus[] = ["SUCCESS", "PARTIAL_SUCCESS", "PAGE_EXPANDED"];

export async function runDpePreservationForApplication(params: {
  applicationId: string;
  resumeSource: string | null;
  resumeId: string | null;
  storagePath: string | null;
  originalFileType: string | null;
  aiGeneratedResumeText: string;
  templateId: string;
}): Promise<DpePreservationOutcome> {
  const { resumeSource, resumeId, storagePath, originalFileType, aiGeneratedResumeText, templateId } = params;

  if (resumeSource !== "uploaded" || !resumeId) {
    return {
      applied: false,
      finalResumeText: null,
      status: "not_applicable",
      reason:
        "Resume source is not an uploaded original file (career_memory-sourced resumes have no original document layout to preserve).",
    };
  }

  try {
    const sourceFormat = originalFileType;
    if (!sourceFormat || !SUPPORTED_SOURCE_FORMATS.includes(sourceFormat as LayoutSourceFormat)) {
      return {
        applied: false,
        finalResumeText: null,
        status: "not_applicable",
        reason: `Original file type "${sourceFormat ?? "unknown"}" is not a format DPE analyzes (pdf/docx only).`,
      };
    }

    if (!storagePath) {
      return {
        applied: false,
        finalResumeText: null,
        status: "not_applicable",
        reason: "No storage_path recorded for this resume - the original file is not retrievable.",
      };
    }

    const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
      .from("resumes")
      .download(storagePath);

    if (downloadError || !fileBlob) {
      return {
        applied: false,
        finalResumeText: null,
        status: "not_applicable",
        reason: `Could not download the original resume file (${downloadError?.message ?? "no file"}).`,
      };
    }

    const buffer = Buffer.from(await fileBlob.arrayBuffer());

    const layoutResult = await analyzeDocument("resume", sourceFormat as LayoutSourceFormat, buffer);
    const layerModel = generateContentBoxes("resume", layoutResult);
    const replacementPlan = createReplacementPlan("resume", aiGeneratedResumeText, layerModel);

    const result = await runExecutionEngine({
      applicationId: params.applicationId,
      documentType: "resume",
      layerModel,
      replacementPlan,
      templateId,
      // regeneratePackage intentionally omitted - this Phase 1 wiring
      // never triggers a real Compression Retry / OpenAI call on its
      // own; Compression Retry only runs when a caller explicitly
      // injects a real regeneratePackage implementation (see
      // executionEngine/realRegeneratePackage.ts), which this
      // integration point does not do.
    });

    if (!USABLE_STATUSES.includes(result.status) || !result.finalText || !result.validation.valid) {
      return {
        applied: false,
        finalResumeText: null,
        status: result.status,
        reason: `DPE ran but its result was not usable (status=${result.status}, validation.valid=${result.validation.valid}) - keeping Generate Package's own AI-generated resume text unchanged.`,
      };
    }

    return {
      applied: true,
      finalResumeText: result.finalText,
      status: result.status,
      reason: `DPE reconstructed the resume through the original document's own Content Boxes (status=${result.status}), real-measured and validated.`,
    };
  } catch (error) {
    return {
      applied: false,
      finalResumeText: null,
      status: "error",
      reason: `DPE preservation threw and was skipped: ${(error as Error).message}`,
    };
  }
}
