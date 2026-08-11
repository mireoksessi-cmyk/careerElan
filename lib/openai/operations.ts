/*
  Phase 6I.6.38A - the closed OpenAI operation taxonomy, derived from an
  independent, fresh audit of every real OpenAI call site in the repo
  (not from the Phase 6I.6.36/37 reports). Mirrors the openai_usage_events
  table's own `operation` CHECK constraint - keep both in sync by hand if
  a new call site is ever added.
*/

export type OpenAiOperation =
  | "RESUME_ANALYSIS"
  | "COVER_LETTER_ANALYSIS"
  | "ANALYZE_JOB"
  | "ANALYZE_JOB_URL"
  | "GENERATE_PACKAGE"
  | "RECOMMEND_JOBS"
  | "CAREER_INSIGHT"
  | "ANALYTICS_SUMMARY"
  | "OTHER";

export const OPENAI_OPERATIONS: OpenAiOperation[] = [
  "RESUME_ANALYSIS",
  "COVER_LETTER_ANALYSIS",
  "ANALYZE_JOB",
  "ANALYZE_JOB_URL",
  "GENERATE_PACKAGE",
  "RECOMMEND_JOBS",
  "CAREER_INSIGHT",
  "ANALYTICS_SUMMARY",
  "OTHER",
];
