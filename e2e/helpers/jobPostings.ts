/*
  Phase 6I.6.35 Part F - synthetic job posting fixtures. Both are real
  text run through the REAL, non-AI classifyCanadaJobScope() (see
  app/api/analyze-job/route.ts - this runs unconditionally, even in
  E2E mode, against whatever jobText is actually pasted) - the
  Canada-scope gate is never mocked, only the AI-authored title/
  company/keywords fields are (via e2eFakeResponses.ts).
*/

// Deliberately includes an explicit Canadian province + city mention,
// which classifyCanadaJobScope's Tier 2 evidence check picks up as
// SUPPORTED ("mentions a Canadian location, province/territory...").
export const E2E_SUPPORTED_JOB_POSTING = `
Software Engineer - E2E-JOB-635 Software Engineer
E2E-EMPLOYER-635 Inc. - Toronto, Ontario, Canada

We are hiring a Software Engineer to join our team in Toronto, Ontario.
This is a full-time, permanent position based in our Toronto, Canada office.

Responsibilities:
- Build and maintain TypeScript/React applications
- Collaborate with cross-functional teams across our Canadian offices
- Write clean, tested, maintainable code

Requirements:
- 3+ years of TypeScript experience
- Experience with React
- Familiarity with SQL databases

This role is open to candidates legally authorized to work in Canada.
`.trim();

// Deliberately includes an explicit non-Canada eligibility restriction
// ("US residents only") - classifyCanadaJobScope's Tier 1 exclusion
// check returns UNSUPPORTED for this regardless of any other text.
export const E2E_UNSUPPORTED_JOB_POSTING = `
Software Engineer
Acme US Corp - New York, NY

We are hiring a Software Engineer for our New York office.
This position is open to US residents only. Applicants must already be
authorized to work in the United States; we are unable to sponsor or
consider candidates located outside the United States.

Requirements:
- 3+ years of software engineering experience
- Experience with distributed systems
`.trim();
