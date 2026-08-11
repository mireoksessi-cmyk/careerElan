/*
  Phase5 Beta stabilization - minimal, dependency-free unit tests for the
  four fixes made in this round (PII-free validator messages, applicant-name
  normalization, per-validator error codes, and the OpenAI-timeout retry
  predicate). Follows the same convention as
  lib/careerFairs/careerFairs.test.ts (no jest/vitest in this project - run
  with `npx tsx lib/generatePackage/shared.test.ts`). Exits non-zero on any
  failure.

  Deliberately does NOT attempt to mock generateCore.ts's module-level
  OpenAI client to test the retry loop end-to-end - that would require
  restructuring generateCore.ts for dependency injection, which is out of
  this phase's scope. Instead this tests shouldRetryOpenAiError(), the
  exact pure predicate generateCore.ts's (and
  canonicalGeneratePackageService.ts's) retry loop calls, directly.

  Phase 6I.6.34 - shouldRetryOpenAiTimeout() was renamed to
  shouldRetryOpenAiError() and its policy extended: RateLimitError
  (429) is now retried (bounded, same maxAttempts as a timeout) rather
  than never retried - see that function's own updated comment in
  shared.ts for why this is safe (quota is reserved once per logical
  request, not per OpenAI attempt).
*/
import { APIConnectionTimeoutError, RateLimitError, APIError } from "openai";
import {
  includesApplicantName,
  normalizeApplicantName,
  validateSourceIntegrity,
  validateProtectedClaims,
  validateCanadianScope,
  validateRequirementEvidence,
  validateAnalysisLogic,
  validateDocumentQuality,
  classifyGenerationError,
  shouldRetryOpenAiError,
  GenerationValidationError,
  type SourceManifest,
  type PackageAnalysis,
} from "./shared";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    ok ? "PASS" : "FAIL",
    label,
    ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`
  );
  if (ok) pass++;
  else fail++;
}

function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}

/* ============================================================
   1. Name normalization - required PASS/FAIL pairs from the spec
============================================================ */

function namesMatch(a: string, b: string): boolean {
  // Mirrors the pairwise-equivalence framing the spec's test cases use -
  // both directions of includesApplicantName() must agree since a real
  // resume can contain the name in either variant relative to the source.
  return (
    includesApplicantName(a, b) &&
    includesApplicantName(b, a)
  );
}

checkTrue('name match: "Kim-Lee" <-> "Kim Lee"', namesMatch("Kim-Lee", "Kim Lee"));
checkTrue('name match: "Kim-Lee" <-> "KimLee"', namesMatch("Kim-Lee", "KimLee"));
checkTrue("name match: O’Connor <-> O'Connor", namesMatch("O’Connor", "O'Connor"));
checkTrue('name match: "Anne Marie" <-> "Anne-Marie"', namesMatch("Anne Marie", "Anne-Marie"));

check('name mismatch: "Kim Lee" vs "Kim Park"', namesMatch("Kim Lee", "Kim Park"), false);
check('name mismatch: "John Smith" vs "John Smyth"', namesMatch("John Smith", "John Smyth"), false);
check('name mismatch: "Ann Lee" vs "Anna Lee"', namesMatch("Ann Lee", "Anna Lee"), false);

// includesApplicantName as actually used: the applicant's name must be
// findable inside a full generated resume text, in any of the accepted
// separator variants.
checkTrue(
  "includesApplicantName finds hyphenated name written with a space in the resume",
  includesApplicantName(
    "John Kim-Lee\nSenior Analyst\nExperience...",
    "John Kim-Lee"
  )
);
checkTrue(
  "includesApplicantName finds name when resume omits the separator entirely",
  includesApplicantName("JohnKimLee\nSenior Analyst", "John Kim-Lee")
);
check(
  "includesApplicantName does not match a different surname",
  includesApplicantName("John Kim-Park\nSenior Analyst", "John Kim-Lee"),
  false
);
checkTrue(
  "includesApplicantName never force-strips non-ASCII letters",
  includesApplicantName("José García\nEngineer", "José García")
);
check(
  "normalizeApplicantName collapses separator variants to the same core form",
  normalizeApplicantName("Kim-Lee").replace(/\s+/g, ""),
  normalizeApplicantName("Kim Lee").replace(/\s+/g, "")
);

/* ============================================================
   1b. Middle-initial collision tests (RC final verification round)

   Directly checks whether a middle initial in the applicant's real name
   can cause it to be wrongly treated as the same person as a DIFFERENT,
   shorter name that happens to share the same letters once compacted -
   the exact risk this file's own normalizeApplicantName()/
   includesApplicantName() comment already disclosed ("a name that
   happens to be a strict prefix of a longer compacted name... could in
   principle still match"). These use includesApplicantName() directly
   (the real function validateSourceIntegrity() calls), not the
   bidirectional namesMatch() helper above, since the real usage is
   always directional: is the SOURCE name (with a middle initial)
   findable inside the GENERATED resume text (which may have dropped
   it)?
============================================================ */

function nameFoundInResumeContaining(sourceName: string, resumeName: string): boolean {
  return includesApplicantName(
    `${resumeName}\nProfessional Summary\nExperience...`,
    sourceName
  );
}

// Was a KNOWN, CONFIRMED LIMITATION in the previous round (compacting
// "Ann A Lee" removed the space around the middle initial "A",
// producing "annalee" - byte-identical to compact("Anna Lee"), a
// different person's name). Fixed by switching includesApplicantName()
// from compact-substring matching to token-array matching (see that
// function's own comment) - "Ann A Lee" now tokenizes to 3 tokens
// ["ann","a","lee"], "Anna Lee" to 2 tokens ["anna","lee"], and
// different token counts are never treated as the same name (except the
// one narrow single-token bridge documented on
// containsApplicantNameTokens, which does not apply here since both
// sides have 2+ tokens).
check(
  '"Ann A Lee" (source) vs resume containing "Anna Lee" - must NOT match',
  nameFoundInResumeContaining("Ann A Lee", "Anna Lee"),
  false
);

check(
  '"Ann B Lee" (source) vs resume containing "Anna Lee" - must NOT match',
  nameFoundInResumeContaining("Ann B Lee", "Anna Lee"),
  false
);

check(
  '"Kim J Lee" (source) vs resume containing "Kim Lee" - must NOT match',
  nameFoundInResumeContaining("Kim J Lee", "Kim Lee"),
  false
);

check(
  '"Kim S Lee" (source) vs resume containing "Kim Lee" - must NOT match',
  nameFoundInResumeContaining("Kim S Lee", "Kim Lee"),
  false
);

check(
  '"John A Smith" (source) vs resume containing "John Smith" - must NOT match',
  nameFoundInResumeContaining("John A Smith", "John Smith"),
  false
);

// Confirms the spec's own PASS cases still hold when checked in the
// same directional shape as the collision tests above (source name ->
// resume text), not just via the bidirectional namesMatch() helper.
check(
  '"Kim-Lee" (source) vs resume containing "Kim Lee" - must match',
  nameFoundInResumeContaining("Kim-Lee", "Kim Lee"),
  true
);
check(
  '"Kim-Lee" (source) vs resume containing "KimLee" - must match',
  nameFoundInResumeContaining("Kim-Lee", "KimLee"),
  true
);
check(
  "\"O'Connor\" (source) vs resume containing “O’Connor” - must match",
  nameFoundInResumeContaining("O'Connor", "O’Connor"),
  true
);
check(
  '"Anne Marie" (source) vs resume containing "Anne-Marie" - must match',
  nameFoundInResumeContaining("Anne Marie", "Anne-Marie"),
  true
);

/* ============================================================
   2. Validation error code mapping - each validator -> its own code
============================================================ */

const baseManifest: SourceManifest = {
  sourceType: "upload",
  applicant: { name: "Taylor Example", email: "", phone: "", location: "", linkedin: "" },
  sectionPresence: {
    professionalSummary: true,
    skills: true,
    professionalExperience: true,
    volunteerExperience: false,
    education: false,
    certifications: false,
    languages: false,
    projects: false,
    careerGoals: false,
  },
  requiredExperienceFacts: [],
  requiredVolunteerFacts: [],
  requiredEducationFacts: [],
  requiredCertificationFacts: [],
  requiredSkillsFacts: [],
  requiredLanguageFacts: [],
  requiredProjectFacts: [],
  requiredCareerGoalsText: "",
  originalText: "Taylor Example resume text.",
};

function expectCode(
  label: string,
  fn: () => void,
  expectedCode: string
) {
  try {
    fn();
    check(label, "no throw", expectedCode);
  } catch (error) {
    check(label, classifyGenerationError(error).code, expectedCode);
  }
}

expectCode(
  "validateSourceIntegrity -> SOURCE_INTEGRITY_FAILED",
  () => validateSourceIntegrity("A resume with a different name entirely.", baseManifest),
  "SOURCE_INTEGRITY_FAILED"
);

expectCode(
  "validateProtectedClaims -> PROTECTED_CLAIMS_FAILED",
  () =>
    validateProtectedClaims(
      {
        resume: "Authorized to work in Canada.",
        coverLetter: "",
        emailDraft: "",
      },
      "Taylor Example resume text with no such claim."
    ),
  "PROTECTED_CLAIMS_FAILED"
);

const baseVerification: PackageAnalysis["verification"] = {
  jobContext: {
    country: "Canada",
    sector: "private",
    province: "",
    municipality: "",
    supportedByCareerElan: true,
    classificationReason: "",
  },
  requirements: [],
  regulatedRole: {
    isRegulated: false,
    profession: "",
    jurisdiction: "",
    requiredLicence: "",
    licenceEvidence: "",
    licenceStatus: "not_required",
  },
  bilingualRequirement: {
    level: "not_required",
    languages: [],
    evidence: "",
    status: "not_required",
  },
  scheduleRequirement: {
    dayShift: false,
    eveningShift: false,
    nightShift: false,
    rotatingShift: false,
    weekendWork: false,
    holidayWork: false,
    requirementLevel: "not_required",
    candidateStatus: "unclear",
    explanation: "",
  },
};

/*
  Phase 6I.6.22 - validateCanadianScope()'s own scope narrowed to ONLY
  the federal-sector exclusion; geographic Canada-scope validation moved
  to assertCanadaJobScopeAllowed() (see canadaScopeClassifier6I622.test.ts
  for that function's own dedicated test matrix, A-T). This assertion
  updated to match: country is no longer this function's concern at all.
*/
expectCode(
  "validateCanadianScope -> CANADIAN_SCOPE_FAILED (federal sector)",
  () =>
    validateCanadianScope({
      ...baseVerification,
      jobContext: { ...baseVerification.jobContext, sector: "federal" },
    }),
  "CANADIAN_SCOPE_FAILED"
);

expectCode(
  "validateAnalysisLogic -> ANALYSIS_LOGIC_FAILED",
  () =>
    validateAnalysisLogic({
      overallMatch: 10,
      matchLevel: "critical_mismatch",
      keyChanges: [],
      mismatch: { summary: "", missingRequirements: [], unsupportedClaims: [] },
      matches: { strongMatches: [], transferableSkills: [] },
      recommendation: { summary: "", applyRecommendation: "recommended", nextSteps: [] },
      verification: baseVerification,
    }),
  "ANALYSIS_LOGIC_FAILED"
);

expectCode(
  "validateDocumentQuality -> DOCUMENT_QUALITY_FAILED",
  () => validateDocumentQuality("Resume", ""),
  "DOCUMENT_QUALITY_FAILED"
);

/* ============================================================
   3. PII must never appear in a validator's thrown message
============================================================ */

try {
  validateSourceIntegrity(
    "A resume with a completely different name.",
    {
      ...baseManifest,
      applicant: {
        name: "Real Applicant Name",
        email: "realapplicant@example.com",
        phone: "555-123-4567",
        location: "",
        linkedin: "",
      },
    }
  );
  check("validateSourceIntegrity should have thrown", "did not throw", "threw");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  checkTrue(
    "SOURCE_INTEGRITY error message excludes the real applicant name",
    !message.includes("Real Applicant Name")
  );
  checkTrue(
    "SOURCE_INTEGRITY error message excludes the real applicant email",
    !message.includes("realapplicant@example.com")
  );
  checkTrue(
    "SOURCE_INTEGRITY error message excludes the real applicant phone",
    !message.includes("555-123-4567")
  );
  checkTrue(
    "SOURCE_INTEGRITY error IS a GenerationValidationError",
    error instanceof GenerationValidationError
  );
}

checkTrue(
  "classifyGenerationError never echoes the caught error's own message into the summary",
  !classifyGenerationError(
    new Error("Real Applicant Name leaked into a message")
  ).summary.includes("Real Applicant Name")
);

/* ============================================================
   3b. PII/log-safety regression - user-supplied fact values must
   never appear in a validator's thrown message or console.warn args
   (log-safety fix: shared.ts errors.push/console.warn sites that used
   to interpolate item.employer/item.title/item.school/item.coursework/
   item.requirement etc. directly into the string).
============================================================ */

try {
  validateSourceIntegrity(
    "A resume with none of these facts present.",
    {
      ...baseManifest,
      requiredExperienceFacts: [
        { employer: "Secret Employer Inc", title: "Secret Title", dates: "2020-2021" },
      ],
      requiredCertificationFacts: ["Secret Certification Name"],
      requiredSkillsFacts: ["SecretSkillName"],
      requiredLanguageFacts: ["SecretLanguage: Fluent"],
      requiredProjectFacts: ["Secret Project Name"],
      sectionPresence: {
        ...baseManifest.sectionPresence,
        education: true,
      },
      requiredEducationFacts: [
        {
          school: "Secret School Name",
          program: "Secret Program Name",
          dates: "2015-2019",
          gpa: "3.99",
          coursework: "",
        },
      ],
    }
  );
  check("validateSourceIntegrity (facts) should have thrown", "did not throw", "threw");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  checkTrue(
    "SOURCE_INTEGRITY error message excludes raw employer/title/dates",
    !message.includes("Secret Employer Inc") &&
      !message.includes("Secret Title") &&
      !message.includes("2020-2021")
  );
  checkTrue(
    "SOURCE_INTEGRITY error message excludes raw school/program/GPA",
    !message.includes("Secret School Name") &&
      !message.includes("Secret Program Name") &&
      !message.includes("3.99")
  );
  checkTrue(
    "SOURCE_INTEGRITY error message excludes raw certification/skill/language/project names",
    !message.includes("Secret Certification Name") &&
      !message.includes("SecretSkillName") &&
      !message.includes("SecretLanguage") &&
      !message.includes("Secret Project Name")
  );
}

{
  const originalWarn = console.warn;
  const capturedArgs: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    capturedArgs.push(args);
  };

  try {
    validateSourceIntegrity(
      "A resume that contains Secret School Name so no error is thrown, just the coursework warning.",
      {
        ...baseManifest,
        sectionPresence: {
          ...baseManifest.sectionPresence,
          education: true,
        },
        requiredEducationFacts: [
          {
            school: "Secret School Name",
            program: "",
            dates: "",
            gpa: "",
            coursework: "Secret Coursework Detail Never To Be Logged",
          },
        ],
      }
    );
  } catch {
    // Not the focus of this check - only console.warn's own arguments matter here.
  }

  console.warn = originalWarn;

  const warnedText = JSON.stringify(capturedArgs);
  checkTrue(
    "Education coursework console.warn excludes the raw coursework text",
    !warnedText.includes("Secret Coursework Detail Never To Be Logged")
  );
  checkTrue(
    "Education coursework console.warn still carries safe metadata (characterCount)",
    warnedText.includes("characterCount")
  );
}

{
  const originalWarn = console.warn;
  const capturedArgs: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    capturedArgs.push(args);
  };

  validateRequirementEvidence(
    {
      ...baseVerification,
      requirements: [
        {
          requirement: "Secret Job Requirement Text",
          category: "mandatory",
          evidenceStatus: "supported",
          sourceEvidence: "",
          source: "none",
          regulated: false,
        },
      ],
    },
    "Some unrelated source text."
  );

  console.warn = originalWarn;

  const warnedText = JSON.stringify(capturedArgs);
  checkTrue(
    "validateRequirementEvidence console.warn excludes the raw requirement text",
    !warnedText.includes("Secret Job Requirement Text")
  );
  checkTrue(
    "validateRequirementEvidence console.warn still carries the requirement index",
    warnedText.includes("Requirement 1")
  );
}

/* ============================================================
   4. OPENAI_TIMEOUT single-retry predicate
============================================================ */

const timeoutError = Object.create(APIConnectionTimeoutError.prototype);
const rateLimitError = Object.create(RateLimitError.prototype);
const genericApiError = Object.create(APIError.prototype);

check(
  "retry: 1st timeout with maxAttempts=2 -> retry",
  shouldRetryOpenAiError(timeoutError, 1, 2),
  true
);
check(
  "retry: timeout already at maxAttempts -> no retry",
  shouldRetryOpenAiError(timeoutError, 2, 2),
  false
);
check(
  "retry: RateLimitError (429), 1st attempt with maxAttempts=2 -> retried (Phase 6I.6.34: transient, safe to retry within the same bounded loop - quota is reserved once per logical request, not per OpenAI attempt)",
  shouldRetryOpenAiError(rateLimitError, 1, 2),
  true
);
check(
  "retry: RateLimitError (429) already at maxAttempts -> no retry (still bounded, same as timeout)",
  shouldRetryOpenAiError(rateLimitError, 2, 2),
  false
);
check(
  "retry: generic APIError -> never retried",
  shouldRetryOpenAiError(genericApiError, 1, 2),
  false
);
check(
  "retry: SyntaxError (malformed JSON) -> never retried",
  shouldRetryOpenAiError(new SyntaxError("bad json"), 1, 2),
  false
);
check(
  "retry: GenerationValidationError -> never retried",
  shouldRetryOpenAiError(
    new GenerationValidationError("SOURCE_INTEGRITY_FAILED", "validateSourceIntegrity", "x"),
    1,
    2
  ),
  false
);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) {
  process.exit(1);
}
