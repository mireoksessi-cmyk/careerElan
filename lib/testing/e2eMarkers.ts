/*
  Phase 6I.6.35 - fixed, unique text markers embedded in every E2E
  deterministic fake AI response and every synthetic seed fixture, so
  Playwright specs can assert "the real generated content is loaded"
  (not a placeholder, not stale data) via simple substring checks,
  without embedding any personal or realistic-looking data anywhere in
  the test suite.
*/
export const E2E_CANDIDATE_NAME = "E2E-CANDIDATE-635";
export const E2E_EMPLOYER_NAME = "E2E-EMPLOYER-635 Inc.";
export const E2E_JOB_TITLE = "E2E-JOB-635 Software Engineer";
export const E2E_JOB_LOCATION = "Toronto, Ontario, Canada";
export const E2E_RESUME_MARKER = "E2E-RESUME-MARKER-635";
export const E2E_COVER_MARKER = "E2E-COVER-MARKER-635";
export const E2E_EMAIL_MARKER = "E2E-EMAIL-MARKER-635";
export const E2E_PACKAGE_ANALYSIS_MARKER = "E2E-PKGANALYSIS-635";
