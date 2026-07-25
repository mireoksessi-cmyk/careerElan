/*
  Deterministic guard against treating a non-specific page (search/listing/
  promotional landing pages, "for you" recommendation feeds, etc.) as a
  successfully analyzed individual job posting. Runs on the already-parsed
  AI response fields - never changes the analysis prompt/model, and never
  by itself decides Canadian-scope eligibility (that remains
  jobContext.supportedByCareerElan, a separate concern).
*/

const PLACEHOLDER_VALUES = new Set([
  "",
  "unknown",
  "n/a",
  "na",
  "not specified",
  "not available",
  "not provided",
  "job posting",
  "detected company",
  "unknown company",
  "unknown employer",
]);

function isPlaceholder(value: unknown): boolean {
  return PLACEHOLDER_VALUES.has(String(value ?? "").trim().toLowerCase());
}

export const NOT_A_SPECIFIC_JOB_POSTING_MESSAGE =
  "We couldn't detect a specific job posting from this page. Please paste the direct URL of an individual job posting or paste the job description.";

export type JobPostingValidationResult =
  | { valid: true }
  | { valid: false; code: "NOT_A_SPECIFIC_JOB_POSTING"; error: string };

const MIN_DESCRIPTION_LENGTH = 60;

export function validateSpecificJobPosting(input: {
  title?: unknown;
  company?: unknown;
  description?: unknown;
  responsibilities?: unknown;
  qualifications?: unknown;
  requirements?: unknown;
}): JobPostingValidationResult {
  const title = String(input.title ?? "").trim();
  const company = String(input.company ?? "").trim();
  const description = String(input.description ?? "").trim();

  const hasStructuredContent =
    (Array.isArray(input.responsibilities) && input.responsibilities.length > 0) ||
    (Array.isArray(input.qualifications) && input.qualifications.length > 0) ||
    (Array.isArray(input.requirements) && input.requirements.length > 0);

  const hasSubstantialDescription = description.length >= MIN_DESCRIPTION_LENGTH;

  if (
    !title ||
    isPlaceholder(title) ||
    !company ||
    isPlaceholder(company) ||
    (!hasSubstantialDescription && !hasStructuredContent)
  ) {
    return {
      valid: false,
      code: "NOT_A_SPECIFIC_JOB_POSTING",
      error: NOT_A_SPECIFIC_JOB_POSTING_MESSAGE,
    };
  }

  return { valid: true };
}
