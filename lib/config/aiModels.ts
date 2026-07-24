/*
  Central place for AI model names and prompt-template versions used across
  the resume/job-package pipeline. Not yet applied to any route in this
  phase - each route below still has its model name hardcoded inline;
  wiring these constants in (and recording the actual resolved model/prompt
  version onto the applications row at generation time) is a follow-up
  step. Listed here now so that step touches one constant per call site
  instead of re-deriving the mapping later.

  PACKAGE_PROMPT_VERSION should be bumped by hand whenever the
  generate-package prompt template changes in a way that could affect
  output (not on every commit that touches the file).
*/

// app/api/generate-package/route.ts - main resume+coverLetter+email call
export const PACKAGE_GENERATION_MODEL = "gpt-5.5";
/*
  Bumped v1 -> v2: removed the duplicate full resume text (SOURCE
  MANIFEST.originalText was byte-identical to the PRIMARY RESUME block)
  and the "PREVIOUS JOB ANALYSIS" block (a JSON dump of the earlier
  analyze-job result that the prompt's own "JOB POSTING ANALYSIS - DO THIS
  FIRST" instructions already require the model to re-derive from the
  complete job description anyway). No instruction/rule text changed -
  same required output shape, same fact-checking constraints.
*/
export const PACKAGE_PROMPT_VERSION = "package-v2";

// lib/resume-builder.ts - first-pass draft used for career_memory sources
export const CAREER_MEMORY_DRAFT_MODEL = "gpt-4.1";

// app/api/analyze-job/route.ts, app/api/analyze-job-url/route.ts
export const JOB_ANALYSIS_MODEL = "gpt-5.5";

// app/api/analyze-resume/route.ts
export const RESUME_PARSE_DRAFT_MODEL = "gpt-4.1-mini"; // reconstruction + verify passes
export const RESUME_PARSE_MODEL = "gpt-4.1"; // structured extraction pass

// app/api/analyze-cover-letter/route.ts
export const COVER_LETTER_PARSE_DRAFT_MODEL = "gpt-4.1-mini"; // reconstruction + verify passes
export const COVER_LETTER_PARSE_MODEL = "gpt-4.1"; // structured extraction + vision OCR pass
