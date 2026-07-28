/*
  Shared stage/progress mapping for the async Resume/Cover Letter analysis
  background jobs (./resumeAnalysisCore.ts, ./coverLetterAnalysisCore.ts) -
  the same "one place owns stage->percentage" rule as
  lib/generatePackage/shared.ts's GENERATION_STAGE_PROGRESS, so the frontend
  never invents its own percentage from elapsed time (the fake 40->66%
  interval ticker in app/career-memory/page.tsx was exactly that problem -
  a client-side timer with no relationship to real server stages - and is
  being replaced by this real, worker-reported progress).

  classifyGenerationError/GenerationErrorCode are reused directly from
  lib/generatePackage/shared.ts - already fully generic (OpenAI timeout/
  rate-limit/API-error/malformed-JSON/validation/unknown), nothing
  analysis-specific needs its own copy. Imported via a RELATIVE path, not
  the "@/..." alias: like lib/generatePackage/shared.ts itself, this module
  is imported both by normal Next.js routes (alias resolves fine there) and
  by netlify/functions/analyze-*-background.ts, whose bundler is a separate
  build step from `next build` and may not resolve tsconfig's path alias -
  see lib/generatePackage/generateCore.ts's own docstring for the same
  reasoning.
*/
export {
  classifyGenerationError,
  type GenerationErrorCode,
} from "../generatePackage/shared";

/*
  queued/downloading_file are shared by both document types (identical
  first two steps); the rest diverge because Cover Letter can take a
  Vision-OCR detour (running_ocr) that Resume's route never attempts (see
  app/api/analyze-resume/route.ts's own 400 response when direct text
  extraction is too thin, instead of falling back to OCR).
*/
export const RESUME_ANALYSIS_STAGE_PROGRESS: Record<string, number> = {
  queued: 10,
  downloading_file: 20,
  extracting_text: 40,
  reconstructing_text: 60,
  extracting_fields: 80,
  verifying: 92,
};

export const COVER_LETTER_ANALYSIS_STAGE_PROGRESS: Record<string, number> = {
  queued: 10,
  downloading_file: 20,
  extracting_text: 35,
  running_ocr: 50,
  reconstructing_text: 65,
  extracting_fields: 82,
  verifying: 92,
};

export function resolveAnalysisProgress(
  analysisStatus: string | null,
  analysisStage: string | null,
  stageProgress: Record<string, number>
): number {
  if (analysisStatus === "succeeded") return 100;
  if (analysisStatus === "failed") return 0;

  if (analysisStage && analysisStage in stageProgress) {
    return stageProgress[analysisStage];
  }

  // pending with no stage recorded yet (claimed a moment before the
  // worker's own first stage write lands) - queued is the honest floor,
  // never 0 (0 is reserved for "failed").
  return stageProgress.queued;
}
