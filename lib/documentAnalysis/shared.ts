/*
  classifyGenerationError/GenerationErrorCode are reused directly from
  lib/generatePackage/shared.ts by ./resumeAnalysisCore.ts and
  ./coverLetterAnalysisCore.ts - already fully generic (OpenAI timeout/
  rate-limit/API-error/malformed-JSON/validation/unknown), nothing
  analysis-specific needs its own copy.
*/
export {
  classifyGenerationError,
  type GenerationErrorCode,
} from "../generatePackage/shared";
