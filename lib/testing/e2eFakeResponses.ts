/*
  Phase 6I.6.35 - deterministic synthetic AI responses used ONLY when
  isE2eAiModeActive() is true (checked by every call site before this
  module is even reached - see e2eAiIsolation.ts). Each function
  returns exactly the JSON shape the real production parser/validator
  for that call site expects, traced directly from the real validator
  source (not guessed):
    - buildE2eJobAnalysisResponse(): app/api/analyze-job/route.ts's
      JobAnalysisResponse + lib/jobPosting/postingValidation.ts's
      validateSpecificJobPosting() (needs non-placeholder title/company
      + at least one requirement).
    - buildE2eResumeAnalysisFields(): the `finalData` shape
      lib/documentAnalysis/resumeAnalysisCore.ts writes via
      complete_resume_analysis.
    - buildE2eCanonicalTailoringResponse(): the exact raw shape
      lib/careerMemory/orchestration/canonicalTailoringService.ts's
      validateAiTailoringResponse() accepts - an empty `entries: []`
      overlay (a valid, "no resume changes" response) plus a fully
      populated, schema-valid packageAnalysis/coverLetterText/
      emailDraftText.
*/
import {
  E2E_CANDIDATE_NAME,
  E2E_EMPLOYER_NAME,
  E2E_JOB_TITLE,
  E2E_JOB_LOCATION,
  E2E_COVER_MARKER,
  E2E_EMAIL_MARKER,
  E2E_PACKAGE_ANALYSIS_MARKER,
} from "./e2eMarkers";

export function buildE2eJobAnalysisResponseText(): string {
  return JSON.stringify({
    title: E2E_JOB_TITLE,
    company: E2E_EMPLOYER_NAME,
    location: E2E_JOB_LOCATION,
    type: "Full-time",
    category: "IT",
    icon: "\u{1F4BB}",
    match: "88%",
    keywordCount: 5,
    requirementsMatched: 5,
    keywords: ["TypeScript", "React", "Node.js", "SQL", "Testing"],
    summary: `${E2E_PACKAGE_ANALYSIS_MARKER} deterministic synthetic job summary for E2E testing.`,
    jobContext: {
      country: "Canada",
      sector: "private",
      province: "Ontario",
      municipality: "Toronto",
      supportedByCareerElan: true,
      classificationReason: "E2E deterministic fixture - Toronto, Ontario, Canada.",
    },
    requirements: [
      { requirement: "3+ years of TypeScript experience", category: "mandatory" },
      { requirement: "Experience with React", category: "mandatory" },
      { requirement: "Familiarity with SQL databases", category: "preferred" },
    ],
  });
}

export function buildE2eResumeAnalysisFields(): Record<string, unknown> {
  return {
    firstName: E2E_CANDIDATE_NAME.split("-")[0] || "E2E",
    lastName: "Candidate635",
    email: "e2e-candidate-635@example.test",
    phone: "555-000-0635",
    location: E2E_JOB_LOCATION,
    linkedin: "",
    headline: `${E2E_CANDIDATE_NAME} Software Engineer`,
    summary: `${E2E_CANDIDATE_NAME} deterministic synthetic professional summary for E2E testing.`,
    skills: ["TypeScript", "React", "Node.js", "SQL"],
    education: [
      { institution: "E2E Test University", degree: "B.Sc. Computer Science", dates: "2016 - 2020", location: "Toronto, ON" },
    ],
    workExperience: [
      {
        company: "E2E-EMPLOYER-635-PRIOR Inc.",
        role: "Software Engineer",
        dates: "2020 - Present",
        description: "Deterministic synthetic work experience bullet for E2E testing.",
      },
    ],
    volunteerExperience: [],
    languages: [{ language: "English", proficiency: "Fluent" }],
    certifications: [],
    projects: [],
  };
}

/*
  Phase 6I.6.35 Part A.6 follow-up - closing a real gap this task's own
  network-boundary instrumentation found: app/api/recommend-jobs/
  route.ts, app/api/career-insight/route.ts, app/api/analytics-summary/
  route.ts, and app/api/analyze-job-url/route.ts each instantiate their
  own OpenAI client and call client.responses.create() directly, with
  no isE2eAiModeActive() gate at all - unlike every other AI call site
  in this codebase. Dashboard auto-fetches recommend-jobs on load, and
  loginViaUi() lands every E2E test on /dashboard, so this was a real,
  previously-undetected REAL_AI_CALL_SAFETY_BREACH: every single E2E
  run this whole phase was silently making real, billed OpenAI calls in
  the background, undetected by any of the "0 AI calls" assertions
  (which only checked the routes they were directly testing). Confirmed
  via a real stack trace captured by openaiNetworkWatch.cjs pointing at
  OpenAI.makeRequest called from recommend-jobs' POST handler.
*/
export function buildE2eRecommendedJobsFakeResult(): { jobs: unknown[] } {
  return {
    jobs: [
      {
        title: `${E2E_PACKAGE_ANALYSIS_MARKER} Recommended Role A`,
        company: "Recommended Career",
        location: E2E_JOB_LOCATION,
        type: "Full-time",
        tags: ["TypeScript", "React"],
        match: "85%",
        matched: ["TypeScript experience", "React experience"],
        missing: ["Cloud certification"],
      },
      {
        title: `${E2E_PACKAGE_ANALYSIS_MARKER} Recommended Role B`,
        company: "Recommended Career",
        location: E2E_JOB_LOCATION,
        type: "Full-time",
        tags: ["Node.js"],
        match: "78%",
        matched: ["Node.js experience"],
        missing: ["Leadership experience"],
      },
    ],
  };
}

export function buildE2eCareerInsightFakeResult() {
  return {
    mismatch: {
      summary: `${E2E_PACKAGE_ANALYSIS_MARKER} deterministic synthetic career-insight mismatch summary for E2E testing.`,
      missingRequirements: [`${E2E_PACKAGE_ANALYSIS_MARKER}-MISSING-A`],
      unsupportedClaims: [],
    },
    matches: {
      strongMatches: [`${E2E_PACKAGE_ANALYSIS_MARKER}-MATCH-A`],
      transferableSkills: [],
    },
    recommendation: {
      summary: `${E2E_PACKAGE_ANALYSIS_MARKER} deterministic synthetic career-insight recommendation for E2E testing.`,
      applyRecommendation: "consider" as const,
      nextSteps: [`${E2E_PACKAGE_ANALYSIS_MARKER}-NEXTSTEP-A`],
    },
  };
}

export function buildE2eAnalyticsSummaryFakeText(): string {
  return `${E2E_PACKAGE_ANALYSIS_MARKER} deterministic synthetic analytics summary for E2E testing. No real AI was called to produce this text.`;
}

export function buildE2eJobAnalysisUrlResponseText(): string {
  return JSON.stringify({
    title: E2E_JOB_TITLE,
    company: E2E_EMPLOYER_NAME,
    location: E2E_JOB_LOCATION,
    type: "Full-time",
    category: "IT",
    icon: "\u{1F4BB}",
    match: "--",
    keywordCount: 3,
    requirementsMatched: 0,
    keywords: ["TypeScript", "React", "SQL"],
    summary: `${E2E_PACKAGE_ANALYSIS_MARKER} deterministic synthetic URL job summary for E2E testing.`,
    jobContext: {
      country: "Canada",
      sector: "private",
      province: "Ontario",
      municipality: "Toronto",
      supportedByCareerElan: true,
      classificationReason: "E2E deterministic fixture - Toronto, Ontario, Canada.",
    },
    requirements: [
      { requirement: "3+ years of TypeScript experience", category: "mandatory", kind: "experience", regulated: false },
    ],
    experienceRequirement: { minimumYears: 3, description: "3+ years of TypeScript experience", mandatory: true },
    educationRequirement: { level: "", fieldOfStudy: "", mandatory: false, explanation: "" },
    regulatedRole: { isRegulated: false, profession: "", jurisdiction: "", requiredLicence: "", requirementLevel: "not_required" },
    bilingualRequirement: { level: "not_required", languages: [], explanation: "" },
    scheduleRequirement: {
      dayShift: true, eveningShift: false, nightShift: false, rotatingShift: false,
      weekendWork: false, holidayWork: false, requirementLevel: "not_required", explanation: "",
    },
    driversLicenceRequirement: { required: false, licenceClass: "", preferred: false, explanation: "" },
    mobilityRequirement: { travelRequired: false, relocationRequired: false, ownVehicleRequired: false, explanation: "" },
    softwareRequirements: ["TypeScript", "React"],
    equipmentRequirements: [],
    technicalSkillRequirements: ["TypeScript", "React", "SQL"],
    securityRequirements: [],
    jobDetails: {
      description: `${E2E_PACKAGE_ANALYSIS_MARKER} deterministic synthetic job description for E2E testing.`,
      responsibilities: ["Build features", "Review code", "Write tests"],
      qualifications: ["3+ years of TypeScript experience", "Experience with React"],
      benefits: [],
      salary: "",
      schedule: "Full-time",
      applyUrl: "",
    },
  });
}

export function buildE2eCanonicalTailoringResponseText(): string {
  return JSON.stringify({
    entries: [],
    packageAnalysis: {
      overallMatch: 82,
      summary: `${E2E_PACKAGE_ANALYSIS_MARKER} deterministic synthetic match summary for E2E testing.`,
      strengths: [`${E2E_PACKAGE_ANALYSIS_MARKER}-STRENGTH-A`, `${E2E_PACKAGE_ANALYSIS_MARKER}-STRENGTH-B`],
      gaps: [`${E2E_PACKAGE_ANALYSIS_MARKER}-GAP-A`],
      keyChanges: [],
    },
    coverLetterText: `${E2E_COVER_MARKER}\n\nDear Hiring Manager,\n\nThis is a deterministic synthetic cover letter generated by the Phase 6I.6.35 E2E test harness for ${E2E_JOB_TITLE} at ${E2E_EMPLOYER_NAME}. No real AI was called to produce this text.\n\nSincerely,\n${E2E_CANDIDATE_NAME}`,
    emailDraftText: `${E2E_EMAIL_MARKER}\n\nSubject: Application for ${E2E_JOB_TITLE}\n\nHello,\n\nThis is a deterministic synthetic email draft generated by the Phase 6I.6.35 E2E test harness. No real AI was called to produce this text.\n\nBest,\n${E2E_CANDIDATE_NAME}`,
  });
}
