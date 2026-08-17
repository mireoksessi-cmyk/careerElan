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

/*
  Admin-facing display labels only - never used for DB writes or
  filtering (those always use the raw OpenAiOperation value above).
  "OTHER" is labeled to disclose its one known real contributor
  (lib/resume-builder.ts's buildResumeFromCareerMemory, wrapped in
  Admin API Usage Phase 1) rather than presenting an opaque "OTHER" -
  it remains a shared bucket with any future genuinely-uncategorized
  call site, which is why the label says "or other" rather than
  claiming exclusivity.
*/
export const OPENAI_OPERATION_LABELS: Record<OpenAiOperation, string> = {
  RESUME_ANALYSIS: "Resume Analysis",
  COVER_LETTER_ANALYSIS: "Cover Letter Analysis",
  ANALYZE_JOB: "Job Analysis",
  ANALYZE_JOB_URL: "Job Analysis (URL)",
  GENERATE_PACKAGE: "Generate Package",
  RECOMMEND_JOBS: "Recommend Jobs",
  CAREER_INSIGHT: "Career Insight",
  ANALYTICS_SUMMARY: "Analytics Summary",
  OTHER: "Career Memory Resume Generation (or other)",
};
