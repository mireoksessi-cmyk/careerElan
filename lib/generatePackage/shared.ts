import {
  APIError,
  APIConnectionTimeoutError,
  RateLimitError,
} from "openai";

/*
  Pure, side-effect-free types/helpers/manifest-builders/validators shared
  between:
  - app/api/generate-package/route.ts (the synchronous claim route - only
    needs getFirstText/fallbackPackage/safeResumeResolutionMessage from
    here; it no longer builds a SourceManifest or calls OpenAI itself)
  - lib/generatePackage/generateCore.ts (the background worker - needs
    everything else: manifest builders, all validateX functions,
    classifyGenerationError, extractJson, cleanDocumentText,
    normalizePackageAnalysis)

  Extracted verbatim from app/api/generate-package/route.ts as it existed
  at commit c85271a (immediately before this Phase 1 async refactor) - no
  logic, wording, or behavior changed in the move, only which module
  declares each symbol and which are exported. Deliberately uses only
  relative/npm-package imports (no local path-alias import) so this
  subtree remains bundler-portable if a Netlify Background Function ever
  needs to import it directly - see generateCore.ts's own docstring for
  why that matters.
*/

export type ResumeSource =
  | "career_memory"
  | "upload";

export type JobSector =
  | "private"
  | "provincial"
  | "municipal"
  | "federal"
  | "unknown";

export type RequirementCategory =
  | "mandatory"
  | "preferred"
  | "legal_or_regulated";

export type EvidenceStatus =
  | "supported"
  | "partially_supported"
  | "not_supported"
  | "unclear";

export type ApplyRecommendation =
  | "recommended"
  | "consider"
  | "not_recommended";

export type RequirementSource =
  | "primary_resume"
  | "none";

export type JobRequirementEvidence = {
  requirement: string;
  category: RequirementCategory;
  evidenceStatus: EvidenceStatus;
  sourceEvidence: string;
  source: RequirementSource;
  regulated: boolean;
};

export type ScheduleRequirement = {
  dayShift: boolean;
  eveningShift: boolean;
  nightShift: boolean;
  rotatingShift: boolean;
  weekendWork: boolean;
  holidayWork: boolean;

  requirementLevel:
    | "mandatory"
    | "preferred"
    | "not_required"
    | "unclear";

  candidateStatus:
    | "supported"
    | "partially_supported"
    | "not_supported"
    | "unclear";

  explanation: string;
};

export type PackageVerification = {
  jobContext: {
    country:
      | "Canada"
      | "Unknown";

    sector: JobSector;
    province: string;
    municipality: string;
    supportedByCareerElan: boolean;
    classificationReason: string;
  };

  requirements:
    JobRequirementEvidence[];

  regulatedRole: {
    isRegulated: boolean;
    profession: string;
    jurisdiction: string;
    requiredLicence: string;
    licenceEvidence: string;

    licenceStatus:
      | "verified"
      | "missing"
      | "not_required"
      | "unclear";
  };

  bilingualRequirement: {
    level:
      | "mandatory"
      | "preferred"
      | "not_required"
      | "unclear";

    languages: string[];
    evidence: string;

    status:
      | "verified"
      | "partially_verified"
      | "missing"
      | "not_required"
      | "unclear";
  };

  scheduleRequirement:
    ScheduleRequirement;
};

export type PackageAnalysis = {
  overallMatch: number;

  matchLevel:
    | "strong"
    | "moderate"
    | "low"
    | "critical_mismatch";

  keyChanges: {
    section: string;
    original: string;
    revised: string;
    reason: string;
  }[];

  mismatch: {
    summary: string;
    missingRequirements: string[];
    unsupportedClaims: string[];
  };

  matches: {
    strongMatches: string[];
    transferableSkills: string[];
  };

  recommendation: {
    summary: string;
    applyRecommendation:
      ApplyRecommendation;

    nextSteps: string[];
  };

  verification:
    PackageVerification;

  /*
    D안 Phase 1 (Original Visual Tree) - optional, additive. Set only
    when the upload-source pipeline built a usable tree/rendered a
    usable node-text map (generateCore.ts) - undefined for every
    career_memory generation and every upload generation where the
    tree path didn't apply. Rides inside the EXISTING ai_insight jsonb
    column (no new column/migration) and flows to the client verbatim
    via app/api/applications/[id]/status/route.ts's own
    `packageAnalysis: row.ai_insight` passthrough - paste-job/page.tsx
    reads this same field to decide whether to render the Preview/
    Download PDF via originalLayoutRenderer.ts instead of the existing
    CareerElan pdfDocumentExport.ts path.
  */
  dpeOriginalLayout?: DpeOriginalLayoutPayload;
};

export type DpeOriginalLayoutPayload = {
  version: 1;
  tree: import("../documentPreservation/visualTree/types").OriginalVisualTree;
  designTokens: import("../documentPreservation/visualTree/types").DesignTokens;
  nodeTexts: Record<string, string>;
};

export type GeneratedPackage = {
  resume: string;
  coverLetter: string;
  emailDraft: string;
  packageAnalysis:
    PackageAnalysis;
};

/*
  Performance Optimization Round 4 - the two-call split's own response
  shapes. Each is just the relevant subset of the original GeneratedPackage
  fields (no field was redefined) - Call 1 never produces coverLetter/
  emailDraft, Call 2 never produces resume/packageAnalysis.
*/
export type ResumeAnalysisPackage = {
  resume: string;
  packageAnalysis:
    PackageAnalysis;
  /*
    D안 Phase 1 (Original Visual Tree) - optional, additive. Only ever
    requested when originalLayoutPromptBlock (see
    buildOriginalLayoutPromptBlock below) was non-empty, i.e. only for
    an "upload" source whose Original Visual Tree build succeeded. A
    career_memory generation, or any upload generation where the tree
    build failed/was skipped, never asks for this field, and the AI
    response is parsed exactly as before this field existed - `resume`
    (the flat text) stays mandatory and is always present regardless.
  */
  layoutNodes?: { nodeId: string; text: string }[];
};

export type CoverLetterEmailPackage = {
  coverLetter: string;
  emailDraft: string;
};

export type ResumeFact = {
  employer: string;
  title: string;
  dates: string;
};

export type EducationFact = {
  school: string;
  program: string;
  dates: string;
  gpa: string;
  coursework: string;
};

export type SourceManifest = {
  sourceType: ResumeSource;

  applicant: {
    name: string;
    email: string;
    phone: string;
    location: string;
    linkedin: string;
  };

  sectionPresence: {
    professionalSummary: boolean;
    skills: boolean;
    professionalExperience: boolean;
    volunteerExperience: boolean;
    education: boolean;
    certifications: boolean;
    languages: boolean;
    projects: boolean;
    careerGoals: boolean;
  };

  requiredExperienceFacts:
    ResumeFact[];

  requiredVolunteerFacts:
    ResumeFact[];

  requiredEducationFacts:
    EducationFact[];

  requiredCertificationFacts:
    string[];

  requiredSkillsFacts:
    string[];

  requiredLanguageFacts:
    string[];

  requiredProjectFacts:
    string[];

  requiredCareerGoalsText:
    string;

  originalText: string;
};

/* =========================================================
   BASIC HELPERS
========================================================= */

export function getFirstText(
  ...values: unknown[]
): string {
  for (const value of values) {
    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return "";
}

function getStringOrArrayText(
  value: unknown
): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .filter(
        (item) =>
          typeof item ===
            "string" &&
          item.trim()
      )
      .map((item) =>
        String(item).trim()
      )
      .join(", ");
  }

  return "";
}

function normalizeForComparison(
  value: string
): string {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐-‒–—―－]/g, "-")
    .replace(/[•●▪◦]/g, " ")
    .replace(/[^a-z0-9@.+%-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesLoose(
  fullText: string,
  expected: string
): boolean {
  if (!expected.trim()) {
    return true;
  }

  return normalizeForComparison(
    fullText
  ).includes(
    normalizeForComparison(
      expected
    )
  );
}

/*
  Phase5 Beta stabilization - dedicated applicant-name normalization,
  scoped ONLY to validateSourceIntegrity's name check (never applied to
  email/phone, which keep using includesLoose/normalizeForComparison
  above unchanged, and never applied to any other validator or Protected
  Claims text). normalizeForComparison() (above) is deliberately left
  untouched - it is shared by other checks in this file, and this phase's
  own instruction is to add a narrow, name-only helper rather than change
  that shared behavior.

  Real problem this solves: a real hyphenated name (e.g. a romanized
  Korean given name) can legitimately be re-typeset by the AI as
  space-separated or run-together ("Kim-Lee" / "Kim Lee" / "KimLee"),
  none of which involve any factual change - but normalizeForComparison's
  own hyphen-preserving normalization treats "-" as a literal, required
  character, so a plain string a in the resume that only spells it a
  different way fails a strict substring check. This produced a real,
  evidenced false-positive risk (see the RC investigation's own report).

  Design: normalize to a SPACE-separated form first (every separator
  variant - hyphen/en dash/em dash/apostrophe/whitespace runs - folded to
  a single space), then derive a SECOND, fully compact form (spaces also
  removed) used for the actual equality/substring comparison. Comparing
  on the compact form is what makes "Kim Lee" (two words) and "KimLee"
  (one word, no separator at all in the source text) equal, while still
  rejecting a genuinely different name: "Kim Lee" vs "Kim Park" and
  "Ann Lee" vs "Anna Lee" differ by a real letter, not merely a
  separator, so their compact forms never match. Unicode letters/digits
  are kept (never force-stripped to ASCII) so an accented or non-Latin
  name is compared on its own real characters, not silently discarded -
  this is deliberately looser than normalizeForComparison's own
  ASCII-only allowlist, but only for names, and only regarding
  separator/diacritic-mark punctuation, never regarding which letters are
  present.

  RC follow-up (Known Limitation fix): the version of this comment above
  this line originally described a fully-compacted (all-whitespace-
  removed) substring comparison. That was confirmed, via a dedicated
  test added afterward, to have a real false-positive: compacting "Ann A
  Lee" (a genuine middle initial) removes the space on both sides of the
  "A", producing "annalee" - byte-identical to compact("Anna Lee"), a
  DIFFERENT person's name, because the middle initial's own letter
  happens to complete "Ann" into "Anna" once every separator is
  discarded. The compact-substring design is gone; matching is now
  token-array based (see tokenizeApplicantName/containsApplicantNameTokens
  below) - a middle initial becomes its own counted token
  ("ann","a","lee" - 3 tokens), never silently absorbed into a
  neighboring word, so it can no longer be mistaken for a shorter name
  that happens to share the same letters.

  normalizeApplicantName() itself is UNCHANGED by this fix - still NFKC
  normalization, lowercasing, apostrophe/hyphen normalization to a single
  space, and Unicode letters/digits kept (never force-stripped to
  ASCII/never dropping a real letter). Only what happens AFTER
  normalization (compacting vs. tokenizing) changed.
*/
export function normalizeApplicantName(
  value: string
): string {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘‚‛`´]/g, "'")
    .replace(/['’]/g, "")
    .replace(/[‐-‒–—―－]/g, "-")
    .replace(/[-\s]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .trim()
    .replace(/\s+/g, " ");
}

/*
  Splits normalizeApplicantName()'s own space-separated output into real
  word tokens, in order. Token COUNT is the whole point of this fix -
  "Kim-Lee"/"Kim Lee" both become ["kim","lee"] (2 tokens: the separator
  is real, so it stays a real word boundary), while "KimLee" becomes
  ["kimlee"] (1 token: there was never a separator there to begin with,
  in the actual source text). Nothing here decides whether two token
  arrays "match" - that is containsApplicantNameTokens's job below.
*/
function tokenizeApplicantName(
  value: string
): string[] {
  return normalizeApplicantName(value)
    .split(" ")
    .filter(Boolean);
}

/*
  Searches for `expectedTokens` (the applicant's real name, tokenized)
  anywhere inside `fullTextTokens` (a full generated resume, tokenized
  the same way). Two shapes are checked:

  1. An exact, same-order, same-COUNT run of tokens anywhere in the
     document. This is the common case and the one that actually
     enforces the fix: a 3-token source name ("Ann A Lee") can only
     match another exact 3-token run - it is never compared against a
     2-token run ("Anna Lee") by first collapsing away the token
     boundary, which is exactly what the old compact-substring
     comparison did. Different token counts are simply never the same
     person, UNLESS shape 2 below applies.

  2. A narrow, deliberate bridge for the ONE real case where a genuine
     separator/no-separator difference legitimately changes the token
     count: when the applicant's name has 2+ tokens but the resume
     writes it as a single run-together word ("Kim-Lee" -> "KimLee"), or
     the reverse (source is a single word, resume adds a space/hyphen).
     This only ever fires when exactly ONE side is a single token and
     that single token is character-for-character equal to the OTHER
     side's tokens concatenated with no separator - it can never trigger
     when both sides already have 2+ tokens (that shape is precisely the
     middle-initial collision this fix closes, so it is deliberately
     excluded, not just accidentally missed).
*/
function containsApplicantNameTokens(
  fullTextTokens: string[],
  expectedTokens: string[]
): boolean {
  if (expectedTokens.length === 0) {
    return true;
  }

  if (expectedTokens.length > 1) {
    for (
      let start = 0;
      start + expectedTokens.length <= fullTextTokens.length;
      start++
    ) {
      if (
        expectedTokens.every(
          (token, offset) => fullTextTokens[start + offset] === token
        )
      ) {
        return true;
      }
    }

    // Bridge: the resume ran the whole name together with no separator.
    const joinedExpected = expectedTokens.join("");
    return fullTextTokens.some((token) => token === joinedExpected);
  }

  // expectedTokens.length === 1 - the reverse bridge: the resume may
  // spell a single-word source name as a short run of separated tokens
  // ("KimLee" -> "Kim Lee"). Bounded by the target token's own character
  // length (never an unbounded/arbitrary window), so this stays cheap
  // even on a long resume.
  const target = expectedTokens[0];
  for (let start = 0; start < fullTextTokens.length; start++) {
    let joined = "";
    for (let end = start; end < fullTextTokens.length; end++) {
      joined += fullTextTokens[end];
      if (joined.length > target.length) {
        break;
      }
      if (joined === target) {
        return true;
      }
    }
  }
  return false;
}

export function includesApplicantName(
  fullText: string,
  expectedName: string
): boolean {
  const expectedTokens = tokenizeApplicantName(expectedName);
  if (expectedTokens.length === 0) {
    return true;
  }

  const fullTextTokens = tokenizeApplicantName(fullText);
  return containsApplicantNameTokens(fullTextTokens, expectedTokens);
}

function hasSectionHeading(
  document: string,
  headings: string[]
): boolean {
  const normalizedHeadings =
    headings.map((heading) =>
      normalizeForComparison(
        heading
      )
    );

  const lines = document
    .split(/\r?\n/)
    .map((line) =>
      normalizeForComparison(
        line
      )
    )
    .filter(Boolean);

  return lines.some((line) =>
    normalizedHeadings.some(
      (heading) =>
        line === heading ||
        line === `${heading} s` ||
        line.startsWith(
          `${heading} `
        )
    )
  );
}

/*
  Section headings this exact resume format can produce (per the
  "OUTPUT FORMAT" and "CAREER MEMORY OPTIONAL SECTIONS" rules in
  generateCore.ts's own prompt) - used only to find where the SKILLS
  section ends. Deliberately a small fixed whitelist rather than a
  generic "line is fully uppercase" heuristic: an all-caps acronym
  skill on its own line (e.g. "SQL", "AWS") would otherwise be
  misdetected as the start of the next section.
*/
const KNOWN_RESUME_SECTION_HEADINGS = new Set([
  "PROFESSIONAL SUMMARY",
  "SKILLS",
  "PROFESSIONAL EXPERIENCE",
  "EDUCATION",
  "CERTIFICATIONS",
  "LANGUAGES",
  "PROJECTS",
  "VOLUNTEER EXPERIENCE",
  "CAREER GOALS",
  "REFERENCES",
]);

/*
  Returns the non-empty lines between the "SKILLS" heading and the next
  known section heading (or end of document) - i.e. the individual skill
  entries as the AI actually rendered them. Used only to check skill
  preservation below; not a general-purpose section parser (that lives
  in lib/brand/sectionParser.ts, untouched by this generatePackage code).
*/
function extractSkillsSectionLines(
  resume: string
): string[] {
  const lines = resume.split(/\r?\n/);
  const headingIndex = lines.findIndex(
    (line) => line.trim() === "SKILLS"
  );

  if (headingIndex === -1) {
    return [];
  }

  const entries: string[] = [];

  for (
    let i = headingIndex + 1;
    i < lines.length;
    i++
  ) {
    const trimmed = lines[i].trim();

    if (!trimmed) {
      continue;
    }

    if (
      KNOWN_RESUME_SECTION_HEADINGS.has(
        trimmed
      )
    ) {
      break;
    }

    entries.push(trimmed);
  }

  return entries;
}

/*
  Case-folds and trims only - deliberately does NOT strip "/", "&", "+",
  "-", ".", parentheses, or collapse internal whitespace the way
  normalizeForComparison() above does. Those characters can be part of a
  skill's actual identity (e.g. "Excel/Google Sheets", "R&D", "C++"), so
  stripping them would make two genuinely different skill strings compare
  as equal and defeat the whole point of this check.
*/
function normalizeSkillEntry(
  value: string
): string {
  return value.trim().toLowerCase();
}

/*
  Exact-entry match only (never substring/includes) - a skill fact is
  "preserved" only if some single line in the SKILLS section equals it
  exactly (case-insensitive). This is what makes "SQL" not match a line
  that says "NoSQL", and what makes "Excel/Google Sheets" split across
  two lines ("Excel" / "Google Sheets") correctly fail rather than
  loosely pass.
*/
function skillEntryPreserved(
  skillLines: string[],
  requiredSkill: string
): boolean {
  const target = normalizeSkillEntry(requiredSkill);

  return skillLines.some(
    (line) => normalizeSkillEntry(line) === target
  );
}

/*
  Performance Optimization Round 4 - generic-ized so the same brace-slice
  parsing algorithm (unchanged) can be reused for both the Resume+Analysis
  call's response shape (ResumeAnalysisPackage) and the Cover Letter+Email
  call's response shape (CoverLetterEmailPackage), not just the original
  combined GeneratedPackage shape. Defaulting the type parameter to
  GeneratedPackage keeps every pre-existing call site (which never passed
  a type argument) byte-identical in behavior.
*/
export function extractJson<T = GeneratedPackage>(
  text: string
): T {
  const cleaned = String(
    text || ""
  )
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const first =
    cleaned.indexOf("{");

  const last =
    cleaned.lastIndexOf("}");

  if (
    first === -1 ||
    last === -1 ||
    last <= first
  ) {
    throw new Error(
      "No valid JSON object was found in the AI response."
    );
  }

  return JSON.parse(
    cleaned.slice(
      first,
      last + 1
    )
  ) as T;
}

/* =========================================================
   CAREER MEMORY SECTION DETECTION

   배열 길이가 아니라 핵심 필드로 판단한다.
========================================================= */

function isMeaningfulExperience(
  item: any
): boolean {
  if (!item) {
    return false;
  }

  if (
    typeof item === "string"
  ) {
    return Boolean(
      item.trim()
    );
  }

  if (
    typeof item !== "object" ||
    Array.isArray(item)
  ) {
    return false;
  }

  const employer =
    getFirstText(
      item.company,
      item.organization,
      item.employer,
      item.companyName,
      item.company_name
    );

  const title =
    getFirstText(
      item.jobTitle,
      item.job_title,
      item.title,
      item.role,
      item.position
    );

  const description =
    getFirstText(
      item.description,
      item.responsibilities,
      item.achievements,
      item.details
    );

  /*
    날짜만 존재하는 항목은
    실제 경력으로 보지 않는다.
  */
  return Boolean(
    employer ||
    title ||
    description
  );
}

function isMeaningfulEducation(
  item: any
): boolean {
  if (!item) {
    return false;
  }

  if (
    typeof item === "string"
  ) {
    return Boolean(
      item.trim()
    );
  }

  if (
    typeof item !== "object" ||
    Array.isArray(item)
  ) {
    return false;
  }

  /*
    학교나 과정 관련 핵심 정보가
    하나라도 있으면 Education은 존재한다.

    GPA와 coursework는 선택 필드다.
  */
  return Boolean(
    getFirstText(
      item.school,
      item.institution,
      item.university,
      item.college,
      item.schoolName,
      item.school_name,
      item.program,
      item.degree,
      item.qualification,
      item.fieldOfStudy,
      item.field_of_study,
      item.major
    )
  );
}

function isMeaningfulCertification(
  item: any
): boolean {
  if (!item) {
    return false;
  }

  if (
    typeof item === "string"
  ) {
    return Boolean(
      item.trim()
    );
  }

  if (
    typeof item !== "object" ||
    Array.isArray(item)
  ) {
    return false;
  }

  /*
    발급기관이나 날짜만 있는
    빈 자격증은 인정하지 않는다.
  */
  return Boolean(
    getFirstText(
      item.name,
      item.title,
      item.certification,
      item.certificate,
      item.licence,
      item.license,
      item.credential,
      item.training
    )
  );
}

function isMeaningfulLanguage(
  item: any
): boolean {
  if (!item) {
    return false;
  }

  if (
    typeof item === "string"
  ) {
    return Boolean(
      item.trim()
    );
  }

  if (
    typeof item !== "object" ||
    Array.isArray(item)
  ) {
    return false;
  }

  /*
    언어명이 없고 Fluent만 있으면
    Languages가 없는 것으로 처리한다.
  */
  return Boolean(
    getFirstText(
      item.language,
      item.name,
      item.languageName,
      item.language_name
    )
  );
}

function isMeaningfulProject(
  item: any
): boolean {
  if (!item) {
    return false;
  }

  if (
    typeof item === "string"
  ) {
    return Boolean(
      item.trim()
    );
  }

  if (
    typeof item !== "object" ||
    Array.isArray(item)
  ) {
    return false;
  }

  return Boolean(
    getFirstText(
      item.name,
      item.title,
      item.project,
      item.projectName,
      item.project_name,
      item.description,
      item.details
    )
  );
}

function getCareerGoalsText(
  memory: any
): string {
  const values = [
    memory?.career_goals,
    memory?.careerGoals,
    memory?.career_goal,
    memory?.careerGoal,
    memory?.career_goal_summary,
    memory?.careerGoalSummary,
    memory?.target_roles,
    memory?.targetRoles,
    memory?.preferred_roles,
    memory?.preferredRoles,
    memory?.target_industry,
    memory?.targetIndustry,
    memory?.target_location,
    memory?.targetLocation,
    memory?.salary_expectation,
    memory?.salaryExpectation,
    memory?.long_term_goals,
    memory?.longTermGoals,
  ];

  return values
    .map(
      getStringOrArrayText
    )
    .filter(Boolean)
    .join(" | ");
}

function getCareerMemoryEntries(
  memory: any
) {
  const experience =
    Array.isArray(
      memory?.experience
    )
      ? memory.experience.filter(
          isMeaningfulExperience
        )
      : [];

  const volunteer =
    Array.isArray(
      memory?.volunteer_experience
    )
      ? memory.volunteer_experience.filter(
          isMeaningfulExperience
        )
      : [];

  const education =
    Array.isArray(
      memory?.education
    )
      ? memory.education.filter(
          isMeaningfulEducation
        )
      : [];

  const certifications =
    Array.isArray(
      memory?.certifications
    )
      ? memory.certifications.filter(
          isMeaningfulCertification
        )
      : [];

  const languages =
    Array.isArray(
      memory?.languages
    )
      ? memory.languages.filter(
          isMeaningfulLanguage
        )
      : [];

  const projects =
    Array.isArray(
      memory?.projects
    )
      ? memory.projects.filter(
          isMeaningfulProject
        )
      : [];

  const skills =
    Array.isArray(
      memory?.skills
    )
      ? memory.skills
          .filter(
            (item: unknown) =>
              typeof item ===
                "string" &&
              item.trim()
          )
          .map((item: string) =>
            item.trim()
          )
      : [];

  return {
    experience,
    volunteer,
    education,
    certifications,
    languages,
    projects,
    skills,
    careerGoals:
      getCareerGoalsText(
        memory
      ),
  };
}

/* =========================================================
   CAREER MEMORY MANIFEST
========================================================= */

export function buildCareerMemoryManifest(
  memory: any,
  originalText: string
): SourceManifest {
  const entries =
    getCareerMemoryEntries(
      memory
    );

  const name = [
    getFirstText(
      memory?.first_name
    ),
    getFirstText(
      memory?.last_name
    ),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    sourceType:
      "career_memory",

    applicant: {
      name:
        name ||
        getFirstText(
          memory?.full_name
        ),

      email:
        getFirstText(
          memory?.email
        ),

      phone:
        getFirstText(
          memory?.phone
        ),

      location:
        getFirstText(
          memory?.location
        ),

      linkedin:
        getFirstText(
          memory?.linkedin
        ),
    },

    sectionPresence: {
      professionalSummary:
        Boolean(
          getFirstText(
            memory?.summary
          )
        ),

      skills:
        entries.skills.length >
        0,

      professionalExperience:
        entries.experience
          .length > 0,

      volunteerExperience:
        entries.volunteer
          .length > 0,

      education:
        entries.education
          .length > 0,

      certifications:
        entries.certifications
          .length > 0,

      languages:
        entries.languages
          .length > 0,

      projects:
        entries.projects
          .length > 0,

      careerGoals:
        Boolean(
          entries.careerGoals
        ),
    },

    requiredExperienceFacts:
      entries.experience.map(
        (item: any) => ({
          employer:
            getFirstText(
              item.company,
              item.organization,
              item.employer,
              item.companyName,
              item.company_name
            ),

          title:
            getFirstText(
              item.jobTitle,
              item.job_title,
              item.title,
              item.role,
              item.position
            ),

          dates:
            getFirstText(
              item.dates,
              item.date,
              [
                getFirstText(
                  item.startDate,
                  item.start_date,
                  item.from
                ),
                getFirstText(
                  item.endDate,
                  item.end_date,
                  item.to
                ),
              ]
                .filter(Boolean)
                .join(" - ")
            ),
        })
      ),

    requiredVolunteerFacts:
      entries.volunteer.map(
        (item: any) => ({
          employer:
            getFirstText(
              item.company,
              item.organization,
              item.employer
            ),

          title:
            getFirstText(
              item.jobTitle,
              item.job_title,
              item.title,
              item.role
            ),

          dates:
            getFirstText(
              item.dates,
              [
                getFirstText(
                  item.startDate,
                  item.start_date
                ),
                getFirstText(
                  item.endDate,
                  item.end_date
                ),
              ]
                .filter(Boolean)
                .join(" - ")
            ),
        })
      ),

    requiredEducationFacts:
      entries.education.map(
        (item: any) => ({
          school:
            getFirstText(
              item.school,
              item.institution,
              item.university,
              item.college
            ),

          program:
            getFirstText(
              item.program,
              item.degree,
              item.qualification,
              item.fieldOfStudy,
              item.field_of_study,
              item.major
            ),

          dates:
            getFirstText(
              item.dates,
              item.date,
              [
                getFirstText(
                  item.startDate,
                  item.start_date
                ),
                getFirstText(
                  item.endDate,
                  item.end_date
                ),
              ]
                .filter(Boolean)
                .join(" - ")
            ),

          gpa:
            getFirstText(
              item.gpa,
              item.GPA
            ),

          coursework:
            getStringOrArrayText(
              item.coursework ||
                item.relevantCoursework ||
                item.relevant_coursework
            ),
        })
      ),

    requiredCertificationFacts:
      entries.certifications
        .map((item: any) => {
          if (
            typeof item ===
            "string"
          ) {
            return item.trim();
          }

          return getFirstText(
            item.name,
            item.title,
            item.certification,
            item.certificate,
            item.licence,
            item.license,
            item.credential,
            item.training
          );
        })
        .filter(Boolean),

    /*
      entries.skills (from getCareerMemoryEntries) is already the
      career_memory skills array with only trim()/empty-filter applied -
      no splitting or rewriting - so it can be used verbatim as the
      atomic fact list the AI must preserve one-per-line in SKILLS.
    */
    requiredSkillsFacts:
      entries.skills,

    requiredLanguageFacts:
      entries.languages
        .map((item: any) => {
          if (
            typeof item ===
            "string"
          ) {
            return item.trim();
          }

          const language =
            getFirstText(
              item.language,
              item.name,
              item.languageName,
              item.language_name
            );

          if (!language) {
            return "";
          }

          const proficiency =
            getFirstText(
              item.proficiency,
              item.level,
              item.fluency,
              item.certificate,
              item.certification
            );

          return proficiency
            ? `${language}: ${proficiency}`
            : language;
        })
        .filter(Boolean),

    requiredProjectFacts:
      entries.projects
        .map((item: any) => {
          if (
            typeof item ===
            "string"
          ) {
            return item.trim();
          }

          return getFirstText(
            item.name,
            item.title,
            item.project,
            item.projectName,
            item.project_name,
            item.description
          );
        })
        .filter(Boolean),

    requiredCareerGoalsText:
      entries.careerGoals,

    originalText,
  };
}

/* =========================================================
   UPLOADED RESUME MANIFEST
========================================================= */

function getParsedArray(
  parsed: any,
  keys: string[]
): any[] {
  for (const key of keys) {
    if (
      Array.isArray(
        parsed?.[key]
      )
    ) {
      return parsed[key];
    }
  }

  return [];
}

function getResumeFact(
  item: any
): ResumeFact {
  return {
    employer:
      getFirstText(
        item?.company,
        item?.organization,
        item?.employer,
        item?.companyName,
        item?.company_name
      ),

    title:
      getFirstText(
        item?.jobTitle,
        item?.job_title,
        item?.title,
        item?.role,
        item?.position
      ),

    dates:
      getFirstText(
        item?.dates,
        item?.date,
        [
          getFirstText(
            item?.startDate,
            item?.start_date,
            item?.from
          ),
          getFirstText(
            item?.endDate,
            item?.end_date,
            item?.to
          ),
        ]
          .filter(Boolean)
          .join(" - ")
      ),
  };
}

function getEducationFact(
  item: any
): EducationFact {
  return {
    school:
      getFirstText(
        item?.school,
        item?.institution,
        item?.university,
        item?.college,
        item?.schoolName,
        item?.school_name
      ),

    program:
      getFirstText(
        item?.program,
        item?.degree,
        item?.qualification,
        item?.fieldOfStudy,
        item?.field_of_study,
        item?.major
      ),

    dates:
      getFirstText(
        item?.dates,
        item?.date,
        [
          getFirstText(
            item?.startDate,
            item?.start_date,
            item?.from
          ),
          getFirstText(
            item?.endDate,
            item?.end_date,
            item?.to
          ),
        ]
          .filter(Boolean)
          .join(" - ")
      ),

    gpa:
      getFirstText(
        item?.gpa,
        item?.GPA
      ),

    coursework:
      getStringOrArrayText(
        item?.coursework ||
          item?.relevantCoursework ||
          item?.relevant_coursework
      ),
  };
}

function getNamedItems(
  items: any[],
  keys: string[]
): string[] {
  return items
    .map((item) => {
      if (
        typeof item ===
        "string"
      ) {
        return item.trim();
      }

      for (const key of keys) {
        const value =
          getFirstText(
            item?.[key]
          );

        if (value) {
          return value;
        }
      }

      return "";
    })
    .filter(Boolean);
}

export function buildUploadedResumeManifest(
  uploadedResume: any
): SourceManifest {
  if (!uploadedResume) {
    throw new Error(
      "The selected uploaded resume could not be found."
    );
  }

  const originalText =
    getFirstText(
      uploadedResume.original_text
    );

  if (!originalText) {
    throw new Error(
      "The uploaded resume has no original text."
    );
  }

  let parsed =
    uploadedResume.parsed_data ||
    {};

  if (
    typeof parsed === "string"
  ) {
    try {
      parsed =
        JSON.parse(parsed);
    } catch {
      throw new Error(
        "The uploaded resume parsed data is invalid."
      );
    }
  }

  if (
    !parsed ||
    typeof parsed !==
      "object" ||
    Array.isArray(parsed)
  ) {
    parsed = {};
  }

  const experience =
    getParsedArray(parsed, [
      "experience",
      "workExperience",
      "work_experience",
      "professionalExperience",
      "employmentHistory",
    ])
      .filter(
        isMeaningfulExperience
      )
      .map(getResumeFact);

  const volunteer =
    getParsedArray(parsed, [
      "volunteerExperience",
      "volunteer_experience",
      "volunteer",
      "volunteering",
    ])
      .filter(
        isMeaningfulExperience
      )
      .map(getResumeFact);

  const education =
    getParsedArray(parsed, [
      "education",
      "educations",
      "academicBackground",
    ])
      .filter(
        isMeaningfulEducation
      )
      .map(getEducationFact);

  const certifications =
    getParsedArray(parsed, [
      "certifications",
      "certificates",
      "licenses",
      "licences",
      "credentials",
    ]).filter(
      isMeaningfulCertification
    );

  const languages =
    getParsedArray(parsed, [
      "languages",
      "languageSkills",
      "language_skills",
    ]).filter(
      isMeaningfulLanguage
    );

  const projects =
    getParsedArray(parsed, [
      "projects",
      "projectExperience",
      "project_experience",
    ]).filter(
      isMeaningfulProject
    );

  const parsedSkills =
    parsed?.skills;

  const skillsExist =
    Array.isArray(parsedSkills)
      ? parsedSkills.some(
          (item: unknown) =>
            typeof item ===
              "string" &&
            item.trim()
        )
      : Boolean(
          getFirstText(
            parsedSkills
          )
        );

  const firstName =
    getFirstText(
      parsed.firstName,
      parsed.first_name
    );

  const lastName =
    getFirstText(
      parsed.lastName,
      parsed.last_name
    );

  return {
    sourceType: "upload",

    applicant: {
      name:
        getFirstText(
          parsed.name,
          parsed.fullName,
          parsed.full_name,
          [firstName, lastName]
            .filter(Boolean)
            .join(" ")
        ),

      email:
        getFirstText(
          parsed.email,
          parsed.contact?.email
        ),

      phone:
        getFirstText(
          parsed.phone,
          parsed.contact?.phone
        ),

      location:
        getFirstText(
          parsed.location,
          parsed.address,
          parsed.contact
            ?.location
        ),

      linkedin:
        getFirstText(
          parsed.linkedin,
          parsed.linkedIn,
          parsed.contact
            ?.linkedin
        ),
    },

    sectionPresence: {
      professionalSummary:
        Boolean(
          getFirstText(
            parsed.summary,
            parsed.professionalSummary,
            parsed.professional_summary
          )
        ),

      skills: skillsExist,

      professionalExperience:
        experience.length > 0,

      volunteerExperience:
        volunteer.length > 0,

      education:
        education.length > 0,

      certifications:
        certifications.length > 0,

      languages:
        languages.length > 0,

      projects:
        projects.length > 0,

      careerGoals: false,
    },

    requiredExperienceFacts:
      experience,

    requiredVolunteerFacts:
      volunteer,

    requiredEducationFacts:
      education,

    requiredCertificationFacts:
      getNamedItems(
        certifications,
        [
          "name",
          "title",
          "certification",
          "certificate",
          "licence",
          "license",
          "credential",
        ]
      ),

    /*
      Only populated when parsedSkills is actually an array of strings -
      same shape parsedSkills is expected to have for skillsExist above.
      A non-array value (e.g. a raw comma string) has no reliable
      per-item boundary to split on, so it's left empty rather than
      guessed at.
    */
    requiredSkillsFacts:
      Array.isArray(parsedSkills)
        ? parsedSkills
            .filter(
              (item: unknown): item is string =>
                typeof item === "string" && item.trim().length > 0
            )
            .map((item: string) => item.trim())
        : [],

    requiredLanguageFacts:
      languages
        .map((item: any) => {
          if (
            typeof item ===
            "string"
          ) {
            return item.trim();
          }

          const language =
            getFirstText(
              item.language,
              item.name,
              item.languageName,
              item.language_name
            );

          const level =
            getFirstText(
              item.proficiency,
              item.level,
              item.fluency
            );

          return level
            ? `${language}: ${level}`
            : language;
        })
        .filter(Boolean),

    requiredProjectFacts:
      getNamedItems(
        projects,
        [
          "name",
          "title",
          "project",
          "projectName",
          "project_name",
        ]
      ),

    requiredCareerGoalsText:
      "",

    originalText,
  };
}

/* =========================================================
   SOURCE STRUCTURE VALIDATION
========================================================= */

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/*
  Protected Claims date-range policy (real, evidenced bug - see the
  session's own root-cause report): a source resume's own date range
  (e.g. "Mar 2021 to Present") and GPT's generated rewrite of the SAME
  range (e.g. "Mar 2021 - Present"/"Mar 2021 – Present"/"Mar 2021 —
  Present") describe the identical period - only the separator's WORD
  vs SYMBOL form differs, confirmed via real instrumented Generate
  Package runs where GPT consistently rewrites "to" as a dash while
  never changing the month/year/Present token on either side.
  includesLoose()/normalizeForComparison() above already unify dash
  VARIANTS (‐-‒–—―－ -> "-") but never unify the WORD "to" with a dash -
  that gap is this function's only job, and ONLY for `item.dates` (see
  validateFactEntry below); employer/title/name/email/phone/school/
  program/skills checks all keep calling includesLoose() directly,
  completely unchanged.

  Deliberately NOT a blanket "strip any separator and compare halves"
  relaxation (would let a genuinely different date range wrongly pass,
  e.g. by matching the wrong half against the wrong token) - only the
  two tokens on either side of the ORIGINAL fact's own separator are
  extracted (via DATE_RANGE_PATTERN, restricted to real month-name/
  4-digit-year/"present"/"current" tokens so it never mis-splits on an
  unrelated hyphen inside other text), then searched for verbatim,
  joined by EITHER separator form, in the generated text. A changed
  month, changed year, or "Present" swapped for a real end year fails to
  match on the token itself and is still correctly rejected exactly as
  before - this only widens what counts as an equivalent SEPARATOR
  between two otherwise-unchanged date tokens.
*/
const DATE_RANGE_MONTH = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const DATE_RANGE_TOKEN = `(?:(?:${DATE_RANGE_MONTH})\\.?\\s*\\d{4}|\\d{4}|present|current)`;
const DATE_RANGE_PATTERN = new RegExp(`^(${DATE_RANGE_TOKEN})\\s*(?:to|-)\\s*(${DATE_RANGE_TOKEN})$`);
const DATE_RANGE_SEPARATOR_ALTERNATION = "(?:to|-)";

function datesMatchLoosely(
  resume: string,
  expectedDateRange: string
): boolean {
  if (includesLoose(resume, expectedDateRange)) {
    return true;
  }

  const normalizedExpected = normalizeForComparison(expectedDateRange);
  const rangeMatch = normalizedExpected.match(DATE_RANGE_PATTERN);
  if (!rangeMatch) {
    return false;
  }

  const [, start, end] = rangeMatch;
  const normalizedResume = normalizeForComparison(resume);
  const equivalentRangePattern = new RegExp(
    `${escapeRegExpLiteral(start)}\\s*${DATE_RANGE_SEPARATOR_ALTERNATION}\\s*${escapeRegExpLiteral(end)}`
  );

  return equivalentRangePattern.test(normalizedResume);
}

function validateFactEntry(
  resume: string,
  item: ResumeFact,
  label: string,
  index: number,
  errors: string[]
) {
  if (
    item.employer &&
    !includesLoose(
      resume,
      item.employer
    )
  ) {
    errors.push(
      `${label} ${index + 1} organization is missing: ${item.employer}`
    );
  }

  if (
    item.title &&
    !includesLoose(
      resume,
      item.title
    )
  ) {
    errors.push(
      `${label} ${index + 1} title is missing: ${item.title}`
    );
  }

  if (
    item.dates &&
    !datesMatchLoosely(
      resume,
      item.dates
    )
  ) {
    errors.push(
      `${label} ${index + 1} dates are missing: ${item.dates}`
    );
  }
}

export function validateSourceIntegrity(
  resume: string,
  manifest: SourceManifest
) {
  const errors: string[] = [];

  if (
    manifest.sourceType ===
    "upload"
  ) {
    /*
      Phase5 Beta stabilization - name matching now uses the dedicated
      includesApplicantName()/normalizeApplicantName() helpers (defined
      above, near includesLoose()) instead of includesLoose() directly,
      so a real hyphen/space/no-separator variant of the same name (e.g.
      a romanized name written "Kim-Lee"/"Kim Lee"/"KimLee") is no longer
      a false-positive failure - see those helpers' own comment for the
      real, evidenced case this fixes. Email/phone below are deliberately
      left on includesLoose() unchanged, per this phase's own instruction
      not to apply name-only normalization to non-name fields.
    */
    if (
      manifest.applicant.name &&
      !includesApplicantName(
        resume,
        manifest.applicant.name
      )
    ) {
      errors.push(
        "Applicant name is missing from generated resume."
      );
    }

    if (
      manifest.applicant.email &&
      !includesLoose(
        resume,
        manifest.applicant.email
      )
    ) {
      errors.push(
        "Applicant email is missing from generated resume."
      );
    }

    if (
      manifest.applicant.phone &&
      !includesLoose(
        resume,
        manifest.applicant.phone
      )
    ) {
      errors.push(
        "Applicant phone is missing from generated resume."
      );
    }
  }

  manifest.requiredExperienceFacts.forEach(
    (item, index) =>
      validateFactEntry(
        resume,
        item,
        "Experience",
        index,
        errors
      )
  );

  manifest.requiredVolunteerFacts.forEach(
    (item, index) =>
      validateFactEntry(
        resume,
        item,
        "Volunteer experience",
        index,
        errors
      )
  );

  manifest.requiredEducationFacts.forEach(
    (item, index) => {
      if (
        item.school &&
        !includesLoose(
          resume,
          item.school
        )
      ) {
        errors.push(
          `Education ${index + 1} school is missing: ${item.school}`
        );
      }

      if (
        item.program &&
        !includesLoose(
          resume,
          item.program
        )
      ) {
        errors.push(
          `Education ${index + 1} program is missing: ${item.program}`
        );
      }

      if (
        item.dates &&
        !datesMatchLoosely(
          resume,
          item.dates
        )
      ) {
        errors.push(
          `Education ${index + 1} dates are missing: ${item.dates}`
        );
      }

      /*
        GPA와 coursework는 사용자가
        입력한 경우에만 보존한다.
      */
      if (
        item.gpa &&
        !includesLoose(
          resume,
          item.gpa
        )
      ) {
        errors.push(
          `Education ${index + 1} GPA is missing: ${item.gpa}`
        );
      }

      if (
        item.coursework &&
        !includesLoose(
          resume,
          item.coursework
        )
      ) {
        console.warn(
          `Education coursework may have been paraphrased or shortened: ${item.coursework}`
        );
      }
    }
  );

  manifest.requiredCertificationFacts.forEach(
    (item) => {
      if (
        item &&
        !includesLoose(
          resume,
          item
        )
      ) {
        errors.push(
          `Certification is missing: ${item}`
        );
      }
    }
  );

  /*
    Skill atomicity: each requiredSkillsFacts entry is one career_memory
    array element and must appear as exactly one line inside the SKILLS
    section - not split across two lines, not merged with another skill,
    not paraphrased. Checked within the SKILLS section only (via
    extractSkillsSectionLines) so a skill word appearing incidentally in
    the Summary or Experience text can't cause a false pass.
  */
  const skillSectionEntries =
    extractSkillsSectionLines(resume);

  manifest.requiredSkillsFacts.forEach(
    (skill) => {
      if (
        skill &&
        !skillEntryPreserved(
          skillSectionEntries,
          skill
        )
      ) {
        errors.push(
          `Required skill fact was not preserved exactly: ${skill}`
        );
      }
    }
  );

  manifest.requiredLanguageFacts.forEach(
    (item) => {
      if (
        item &&
        !includesLoose(
          resume,
          item
        )
      ) {
        /*
          "English: Fluent"와
          "English (Fluent)" 차이를 허용한다.
        */
        const parts =
          item
            .split(":")
            .map((part) =>
              part.trim()
            )
            .filter(Boolean);

        const partsExist =
          parts.every((part) =>
            includesLoose(
              resume,
              part
            )
          );

        if (!partsExist) {
          errors.push(
            `Language is missing: ${item}`
          );
        }
      }
    }
  );

  manifest.requiredProjectFacts.forEach(
    (item) => {
      if (
        item &&
        !includesLoose(
          resume,
          item
        )
      ) {
        errors.push(
          `Project is missing: ${item}`
        );
      }
    }
  );

  /*
    존재하지 않는 선택 섹션 생성 차단
  */
  const forbiddenSections: {
    allowed: boolean;
    headings: string[];
    message: string;
  }[] = [
    {
      allowed:
        manifest.sectionPresence
          .education,

      headings: [
        "education",
        "education and training",
        "academic background",
        "academic qualifications",
      ],

      message:
        "Education was added even though the selected source has no valid education entry.",
    },
    {
      allowed:
        manifest.sectionPresence
          .languages,

      headings: [
        "language",
        "languages",
        "language skills",
        "bilingual skills",
      ],

      message:
        "Languages were added even though the selected source has no valid language entry.",
    },
    {
      allowed:
        manifest.sectionPresence
          .certifications,

      headings: [
        "certification",
        "certifications",
        "certificates",
        "credentials",
        "licences",
        "licenses",
      ],

      message:
        "Certifications were added even though the selected source has no valid certification entry.",
    },
    {
      allowed:
        manifest.sectionPresence
          .projects,

      headings: [
        "project",
        "projects",
        "project experience",
      ],

      message:
        "Projects were added even though the selected source has no valid project entry.",
    },
    {
      allowed:
        manifest.sectionPresence
          .careerGoals,

      headings: [
        "career goal",
        "career goals",
        "career objective",
        "career objectives",
        "professional objective",
        "professional objectives",
        "target role",
        "target roles",
      ],

      message:
        "A career goal section was added even though Career Memory has no valid career-goal content.",
    },
    {
      allowed:
        manifest.sectionPresence
          .volunteerExperience,

      headings: [
        "volunteer experience",
        "volunteering",
        "community involvement",
      ],

      message:
        "Volunteer Experience was added even though the selected source has no volunteer section.",
    },
  ];

  forbiddenSections.forEach(
    ({
      allowed,
      headings,
      message,
    }) => {
      if (
        !allowed &&
        hasSectionHeading(
          resume,
          headings
        )
      ) {
        errors.push(message);
      }
    }
  );

  if (errors.length > 0) {
    throw new GenerationValidationError(
      "SOURCE_INTEGRITY_FAILED",
      "validateSourceIntegrity",
      `Source-integrity validation failed:\n${errors.join(
        "\n"
      )}`
    );
  }
}

/* =========================================================
   HIGH-RISK CLAIM VALIDATION
========================================================= */

const protectedClaimPatterns: {
  label: string;
  pattern: RegExp;
}[] = [
  {
    label:
      "Authorized to work in Canada",

    pattern:
      /\b(?:authorized|eligible|legally entitled)\s+to\s+work\s+in\s+canada\b/i,
  },
  {
    label:
      "Canadian work permit",

    pattern:
      /\b(?:valid|open|closed|employer[- ]specific)?\s*(?:canadian\s+)?work permit\b/i,
  },
  {
    label:
      "Permanent resident status",

    pattern:
      /\b(?:canadian\s+)?permanent resident\b/i,
  },
  {
    label:
      "Canadian citizenship",

    pattern:
      /\b(?:canadian citizen|citizen of canada|canadian citizenship)\b/i,
  },
  {
    label:
      "Reliability clearance",

    pattern:
      /\b(?:reliability status|reliability clearance|enhanced reliability)\b/i,
  },
  {
    label:
      "Secret clearance",

    pattern:
      /\bsecret(?:-level)?\s+(?:security\s+)?clearance\b/i,
  },
  {
    label:
      "Top Secret clearance",

    pattern:
      /\btop secret(?:-level)?\s+(?:security\s+)?clearance\b/i,
  },
];

const regulatedCredentialPatterns: {
  label: string;
  pattern: RegExp;
}[] = [
  {
    label:
      "Professional Engineer licence",

    pattern:
      /\b(?:licensed|registered)\s+(?:professional\s+engineer|p\.?\s*eng\.?)\b/i,
  },
  {
    label:
      "Registered Nurse licence",

    pattern:
      /\b(?:registered nurse|licensed rn|rn licence|rn license)\b/i,
  },
  {
    label:
      "Registered Practical Nurse licence",

    pattern:
      /\b(?:registered practical nurse|licensed rpn|rpn licence|rpn license)\b/i,
  },
  {
    label:
      "Lawyer or barrister licence",

    pattern:
      /\b(?:licensed lawyer|licensed barrister|member in good standing of the law society|called to the bar)\b/i,
  },
  {
    label:
      "Licensed paralegal",

    pattern:
      /\b(?:licensed paralegal|paralegal licence|paralegal license)\b/i,
  },
  {
    label:
      "Teacher certification",

    pattern:
      /\b(?:certified teacher|teacher certification|teaching certificate)\b/i,
  },
  {
    label:
      "Security guard licence",

    pattern:
      /\b(?:valid|current|licensed)\s+(?:ontario\s+)?security guard licen[cs]e\b/i,
  },
];

export function validateProtectedClaims(
  documents: {
    resume: string;
    coverLetter: string;
    emailDraft: string;
  },
  sourceText: string
) {
  const generatedText = [
    documents.resume,
    documents.coverLetter,
    documents.emailDraft,
  ].join("\n");

  const errors: string[] = [];

  [
    ...protectedClaimPatterns,
    ...regulatedCredentialPatterns,
  ].forEach(
    ({ label, pattern }) => {
      if (
        pattern.test(
          generatedText
        ) &&
        !pattern.test(
          sourceText
        )
      ) {
        errors.push(
          `Unsupported high-risk claim was generated: ${label}`
        );
      }
    }
  );

  if (errors.length > 0) {
    throw new GenerationValidationError(
      "PROTECTED_CLAIMS_FAILED",
      "validateProtectedClaims",
      `High-risk claim validation failed:\n${errors.join(
        "\n"
      )}`
    );
  }
}

/* =========================================================
   DOCUMENT QUALITY
========================================================= */

export function cleanDocumentText(
  value: string
): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t+/g, " ")
    .replace(
      /[ ]{4,}/g,
      " "
    )
    .replace(
      /[ ]+([,.;:!?])/g,
      "$1"
    )
    .replace(
      /\n{5,}/g,
      "\n\n\n"
    )
    .replace(
      /[ \t]+\n/g,
      "\n"
    )
    .trim();
}

/*
  Email Draft signature / Cover Letter contact-block stripping now live in
  ./textCleanup (dependency-free, so Job Tracker's own client-side
  Supabase read can safely reuse the exact same logic - see that module's
  own docstring). Re-exported here so every existing "./shared" import
  keeps working unchanged.
*/
export {
  stripEmailSignatureContact,
  stripCoverLetterContactBlock,
} from "./textCleanup";

export function validateDocumentQuality(
  name: string,
  text: string
) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (
    typeof text !== "string"
  ) {
    throw new GenerationValidationError(
      "DOCUMENT_QUALITY_FAILED",
      "validateDocumentQuality",
      `${name} is not a string.`
    );
  }

  if (!text.trim()) {
    throw new GenerationValidationError(
      "DOCUMENT_QUALITY_FAILED",
      "validateDocumentQuality",
      `${name} is empty.`
    );
  }

  const fatalPatterns: {
    label: string;
    pattern: RegExp;
  }[] = [
    {
      label:
        "replacement characters",

      pattern:
        /�|���/,
    },
    {
      label:
        "markdown code block",

      pattern:
        /```/,
    },
    {
      label:
        "literal escaped newline",

      pattern:
        /\\n/,
    },
    {
      label:
        "JSON property leakage",

      pattern:
        /"(?:resume|coverLetter|emailDraft|packageAnalysis|claim|sourceEvidence)"\s*:/i,
    },
    {
      label:
        "HTML document markup",

      pattern:
        /<(?:html|body|script|style|div|span|p|br|table|tr|td|ul|li)\b[^>]*>/i,
    },
    {
      label:
        "empty bullet",

      pattern:
        /(?:^|\n)\s*[•●▪◦-]\s*(?:\n|$)/,
    },
    {
      label:
        "repeated corrupted braces",

      pattern:
        /\{\{+|\}\}+/,
    },
    {
      label:
        "excessive symbol repetition",

      pattern:
        /([#@_=~^*\\])\1{4,}/,
    },
  ];

  fatalPatterns.forEach(
    ({ label, pattern }) => {
      if (pattern.test(text)) {
        errors.push(
          `${name} contains ${label}.`
        );
      }
    }
  );

  if (
    /\b(\w+)(?:\s+\1){2,}\b/i.test(
      text
    )
  ) {
    errors.push(
      `${name} contains the same word repeated at least three times consecutively.`
    );
  }

  const meaningfulLines =
    text
      .split(/\r?\n/)
      .map((line) =>
        line.trim()
      )
      .filter(Boolean);

  if (
    text.length > 500 &&
    meaningfulLines.length <= 2
  ) {
    warnings.push(
      `${name} may contain too little line structure.`
    );
  }

  if (
    meaningfulLines.length >
      20 &&
    meaningfulLines.filter(
      (line) =>
        line.split(/\s+/)
          .length <= 2
    ).length /
      meaningfulLines.length >
      0.75
  ) {
    errors.push(
      `${name} appears to have abnormal word-by-word line breaks.`
    );
  }

  const sentenceCandidates =
    text
      .split(
        /(?<=[.!?])\s+|\n+/
      )
      .map((sentence) =>
        normalizeForComparison(
          sentence
        )
      )
      .filter(
        (sentence) =>
          sentence.split(" ")
            .length >= 6
      );

  const seen =
    new Set<string>();

  for (
    const sentence of
      sentenceCandidates
  ) {
    if (seen.has(sentence)) {
      warnings.push(
        `${name} may contain a duplicated sentence.`
      );
      break;
    }

    seen.add(sentence);
  }

  if (
    /[ ]{4,}/.test(text)
  ) {
    warnings.push(
      `${name} contained excessive spaces and was normalized.`
    );
  }

  if (
    /\n{5,}/.test(text)
  ) {
    warnings.push(
      `${name} contained excessive blank lines and was normalized.`
    );
  }

  if (warnings.length > 0) {
    console.warn(
      `${name.toUpperCase()} QUALITY WARNINGS =`,
      warnings
    );
  }

  if (errors.length > 0) {
    throw new GenerationValidationError(
      "DOCUMENT_QUALITY_FAILED",
      "validateDocumentQuality",
      `${name} quality validation failed:\n${errors.join(
        "\n"
      )}`
    );
  }
}

/* =========================================================
   PACKAGE NORMALIZATION
========================================================= */

function defaultVerification():
  PackageVerification {
  return {
    jobContext: {
      country: "Unknown",
      sector: "unknown",
      province: "",
      municipality: "",
      supportedByCareerElan:
        false,
      classificationReason:
        "",
    },

    requirements: [],

    regulatedRole: {
      isRegulated: false,
      profession: "",
      jurisdiction: "",
      requiredLicence: "",
      licenceEvidence: "",
      licenceStatus:
        "unclear",
    },

    bilingualRequirement: {
      level: "unclear",
      languages: [],
      evidence: "",
      status: "unclear",
    },

    scheduleRequirement: {
      dayShift: false,
      eveningShift: false,
      nightShift: false,
      rotatingShift: false,
      weekendWork: false,
      holidayWork: false,
      requirementLevel:
        "unclear",
      candidateStatus:
        "unclear",
      explanation: "",
    },
  };
}

function defaultPackageAnalysis():
  PackageAnalysis {
  return {
    overallMatch: 0,
    matchLevel:
      "critical_mismatch",

    keyChanges: [],

    mismatch: {
      summary: "",
      missingRequirements: [],
      unsupportedClaims: [],
    },

    matches: {
      strongMatches: [],
      transferableSkills: [],
    },

    recommendation: {
      summary: "",
      applyRecommendation:
        "consider",
      nextSteps: [],
    },

    verification:
      defaultVerification(),
  };
}

function cleanStringArray(
  value: unknown,
  limit: number
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item) =>
        typeof item ===
          "string" &&
        item.trim()
    )
    .map((item) =>
      item.trim()
    )
    .slice(0, limit);
}

export function normalizePackageAnalysis(
  raw: any
): PackageAnalysis {
  const fallback =
    defaultPackageAnalysis();

  const packageAnalysis =
    raw &&
    typeof raw === "object"
      ? raw
      : fallback;

  packageAnalysis.overallMatch =
    Math.max(
      0,
      Math.min(
        100,
        Math.round(
          Number(
            packageAnalysis.overallMatch
          ) || 0
        )
      )
    );

  if (
    packageAnalysis.overallMatch >=
    85
  ) {
    packageAnalysis.matchLevel =
      "strong";
  } else if (
    packageAnalysis.overallMatch >=
    65
  ) {
    packageAnalysis.matchLevel =
      "moderate";
  } else if (
    packageAnalysis.overallMatch >=
    40
  ) {
    packageAnalysis.matchLevel =
      "low";
  } else {
    packageAnalysis.matchLevel =
      "critical_mismatch";
  }

  packageAnalysis.keyChanges =
    Array.isArray(
      packageAnalysis.keyChanges
    )
      ? packageAnalysis.keyChanges
          .filter(
            (item: any) =>
              item &&
              typeof item ===
                "object"
          )
          .slice(0, 4)
          .map((item: any) => ({
            section:
              getFirstText(
                item.section
              ),

            original:
              getFirstText(
                item.original
              ),

            revised:
              getFirstText(
                item.revised
              ),

            reason:
              getFirstText(
                item.reason
              ),
          }))
      : [];

  if (
    !packageAnalysis.mismatch ||
    typeof packageAnalysis.mismatch !==
      "object"
  ) {
    packageAnalysis.mismatch =
      fallback.mismatch;
  }

  packageAnalysis.mismatch.summary =
    getFirstText(
      packageAnalysis.mismatch
        .summary
    );

  packageAnalysis.mismatch
    .missingRequirements =
    cleanStringArray(
      packageAnalysis.mismatch
        .missingRequirements,
      5
    );

  packageAnalysis.mismatch
    .unsupportedClaims =
    cleanStringArray(
      packageAnalysis.mismatch
        .unsupportedClaims,
      4
    );

  if (
    !packageAnalysis.matches ||
    typeof packageAnalysis.matches !==
      "object"
  ) {
    packageAnalysis.matches =
      fallback.matches;
  }

  packageAnalysis.matches
    .strongMatches =
    cleanStringArray(
      packageAnalysis.matches
        .strongMatches,
      5
    );

  packageAnalysis.matches
    .transferableSkills =
    cleanStringArray(
      packageAnalysis.matches
        .transferableSkills,
      4
    );

  if (
    !packageAnalysis.recommendation ||
    typeof packageAnalysis
      .recommendation !==
      "object"
  ) {
    packageAnalysis.recommendation =
      fallback.recommendation;
  }

  packageAnalysis.recommendation
    .summary =
    getFirstText(
      packageAnalysis
        .recommendation.summary
    );

  if (
    ![
      "recommended",
      "consider",
      "not_recommended",
    ].includes(
      packageAnalysis
        .recommendation
        .applyRecommendation
    )
  ) {
    packageAnalysis.recommendation
      .applyRecommendation =
      "consider";
  }

  packageAnalysis.recommendation
    .nextSteps =
    cleanStringArray(
      packageAnalysis
        .recommendation
        .nextSteps,
      3
    );

  if (
    !packageAnalysis.verification ||
    typeof packageAnalysis.verification !==
      "object"
  ) {
    packageAnalysis.verification =
      defaultVerification();
  }

  const verification =
    packageAnalysis.verification;

  if (
    !verification.jobContext ||
    typeof verification.jobContext !==
      "object"
  ) {
    verification.jobContext =
      defaultVerification()
        .jobContext;
  }

  verification.jobContext.country =
    verification.jobContext
      .country === "Canada"
      ? "Canada"
      : "Unknown";

  const validSectors:
    JobSector[] = [
      "private",
      "provincial",
      "municipal",
      "federal",
      "unknown",
    ];

  if (
    !validSectors.includes(
      verification.jobContext
        .sector
    )
  ) {
    verification.jobContext.sector =
      "unknown";
  }

  verification.jobContext.province =
    getFirstText(
      verification.jobContext
        .province
    );

  verification.jobContext
    .municipality =
    getFirstText(
      verification.jobContext
        .municipality
    );

  verification.jobContext
    .classificationReason =
    getFirstText(
      verification.jobContext
        .classificationReason
    );

  verification.jobContext
    .supportedByCareerElan =
    verification.jobContext
      .supportedByCareerElan ===
    true;

  verification.requirements =
    Array.isArray(
      verification.requirements
    )
      ? verification.requirements
          .filter(
            (item: any) =>
              item &&
              typeof item ===
                "object" &&
              getFirstText(
                item.requirement
              )
          )
          .slice(0, 20)
          .map((item: any) => ({
            requirement:
              getFirstText(
                item.requirement
              ),

            category:
              item.category ===
                "preferred" ||
              item.category ===
                "legal_or_regulated"
                ? item.category
                : "mandatory",

            evidenceStatus:
              [
                "supported",
                "partially_supported",
                "not_supported",
                "unclear",
              ].includes(
                item.evidenceStatus
              )
                ? item.evidenceStatus
                : "unclear",

            sourceEvidence:
              getFirstText(
                item.sourceEvidence
              ),

            source:
              item.source ===
              "primary_resume"
                ? "primary_resume"
                : "none",

            regulated:
              Boolean(
                item.regulated
              ),
          }))
      : [];

  if (
    !verification.regulatedRole ||
    typeof verification.regulatedRole !==
      "object"
  ) {
    verification.regulatedRole =
      defaultVerification()
        .regulatedRole;
  }

  if (
    !verification
      .bilingualRequirement ||
    typeof verification
      .bilingualRequirement !==
      "object"
  ) {
    verification
      .bilingualRequirement =
      defaultVerification()
        .bilingualRequirement;
  }

  if (
    !Array.isArray(
      verification
        .bilingualRequirement
        .languages
    )
  ) {
    verification
      .bilingualRequirement
      .languages = [];
  }

  if (
    !verification.scheduleRequirement ||
    typeof verification
      .scheduleRequirement !==
      "object"
  ) {
    verification.scheduleRequirement =
      defaultVerification()
        .scheduleRequirement;
  }

  return packageAnalysis;
}

/* =========================================================
   BUSINESS LOGIC VALIDATION
========================================================= */

export function validateCanadianScope(
  verification:
    PackageVerification
) {
  const context =
    verification.jobContext;

  if (
    context.country !==
    "Canada"
  ) {
    throw new GenerationValidationError(
      "CANADIAN_SCOPE_FAILED",
      "validateCanadianScope",
      "Career Élan currently supports Canadian job postings only."
    );
  }

  if (
    context.sector ===
    "federal"
  ) {
    throw new GenerationValidationError(
      "CANADIAN_SCOPE_FAILED",
      "validateCanadianScope",
      "Canadian federal government applications are not currently supported."
    );
  }

  if (
    ![
      "private",
      "provincial",
      "municipal",
    ].includes(
      context.sector
    )
  ) {
    throw new GenerationValidationError(
      "CANADIAN_SCOPE_FAILED",
      "validateCanadianScope",
      "The job posting could not be classified as a supported Canadian private, provincial, or municipal posting."
    );
  }

  if (
    context.supportedByCareerElan !==
    true
  ) {
    throw new GenerationValidationError(
      "CANADIAN_SCOPE_FAILED",
      "validateCanadianScope",
      "This job posting is outside Career Élan's supported scope."
    );
  }
}

export function validateRequirementEvidence(
  verification:
    PackageVerification,
  sourceText: string
) {
  const warnings: string[] = [];

  verification.requirements.forEach(
    (item) => {
      if (
        item.evidenceStatus ===
          "supported" ||
        item.evidenceStatus ===
          "partially_supported"
      ) {
        if (
          !item.sourceEvidence
        ) {
          warnings.push(
            `Requirement marked ${item.evidenceStatus} without source evidence: ${item.requirement}`
          );

          item.evidenceStatus =
            "unclear";

          item.source = "none";

          return;
        }

        if (
          !includesLoose(
            sourceText,
            item.sourceEvidence
          )
        ) {
          /*
            이 검사는 카드 분석용이므로
            500으로 중단하지 않고 unclear로 보정한다.
          */
          warnings.push(
            `Requirement evidence could not be matched exactly and was changed to unclear: ${item.requirement}`
          );

          item.evidenceStatus =
            "unclear";

          item.sourceEvidence =
            "";

          item.source = "none";
        }
      }

      if (
        item.evidenceStatus ===
          "not_supported" ||
        item.evidenceStatus ===
          "unclear"
      ) {
        item.sourceEvidence =
          "";

        item.source = "none";
      }
    }
  );

  if (warnings.length > 0) {
    console.warn(
      "REQUIREMENT WARNINGS =",
      warnings
    );
  }
}

export function validateAnalysisLogic(
  analysis: PackageAnalysis
) {
  const verification =
    analysis.verification;

  /*
    Phase5 Gate Blocker 1 root-cause fix (real, evidenced - see the
    session's own investigation): this used to fire from `requirements`
    ALONE, with no gate on whether the role is actually regulated -
    inconsistent with `missingLicence` right below it, which correctly
    gates on `regulatedRole.isRegulated === true`. Real instrumented
    output (standard_pdf's Operations Analyst run) showed the AI's own
    `verification.requirements` routinely includes two generic
    boilerplate entries - "Licences or regulated professional status"
    and "Security screening or clearance" - marked "not_supported" for
    completely ordinary, non-regulated private-sector jobs (the source
    resume simply never mentions a licence/clearance, because the job
    never asked for one), while the SAME analysis call's own
    `regulatedRole.isRegulated` correctly says `false` for that exact
    job. Without this gate, those two boilerplate entries alone were
    enough to block ANY "strong" match rating for most ordinary jobs -
    not a real regulated-qualification gap. Gating on `isRegulated`
    (the AI's own dedicated, purpose-built signal for "is this role
    actually regulated") makes this check fire only for genuinely
    regulated roles, exactly matching `missingLicence`'s existing,
    already-correct semantics - never loosened for a role the AI itself
    marked regulated.
  */
  const missingLegalRequirement =
    verification.regulatedRole
      .isRegulated === true &&
    verification.requirements.some(
      (item) =>
        item.category ===
          "legal_or_regulated" &&
        (
          item.evidenceStatus ===
            "not_supported" ||
          item.evidenceStatus ===
            "unclear"
        )
    );

  const missingLicence =
    verification.regulatedRole
      .isRegulated === true &&
    verification.regulatedRole
      .licenceStatus ===
      "missing";

  const missingMandatoryBilingual =
    verification
      .bilingualRequirement.level ===
      "mandatory" &&
    (
      verification
        .bilingualRequirement.status ===
        "missing" ||
      verification
        .bilingualRequirement.status ===
        "partially_verified" ||
      verification
        .bilingualRequirement.status ===
        "unclear"
    );

  if (
    analysis.matchLevel ===
      "critical_mismatch" &&
    analysis.recommendation
      .applyRecommendation ===
      "recommended"
  ) {
    throw new GenerationValidationError(
      "ANALYSIS_LOGIC_FAILED",
      "validateAnalysisLogic",
      "A critical mismatch cannot have a recommended application decision."
    );
  }

  if (
    (
      missingLegalRequirement ||
      missingLicence
    ) &&
    analysis.matchLevel ===
      "strong"
  ) {
    throw new GenerationValidationError(
      "ANALYSIS_LOGIC_FAILED",
      "validateAnalysisLogic",
      "The application cannot be rated strong while a mandatory regulated qualification is missing."
    );
  }

  if (
    missingLicence &&
    analysis.recommendation
      .applyRecommendation ===
      "recommended"
  ) {
    throw new GenerationValidationError(
      "ANALYSIS_LOGIC_FAILED",
      "validateAnalysisLogic",
      "A regulated role with a missing required licence cannot be recommended."
    );
  }

  if (
    missingMandatoryBilingual &&
    analysis.matchLevel ===
      "strong"
  ) {
    throw new GenerationValidationError(
      "ANALYSIS_LOGIC_FAILED",
      "validateAnalysisLogic",
      "The application cannot be rated strong while a mandatory bilingual requirement is not fully verified."
    );
  }
}

export function warnCardDifferences(
  analysis: PackageAnalysis
) {
  /*
    카드 문구와 Resume 문장을
    강제로 일치시키지 않는다.
  */

  const unsupported =
    analysis.verification
      .requirements.filter(
        (item) =>
          item.evidenceStatus ===
            "not_supported" ||
          item.evidenceStatus ===
            "unclear"
      );

  if (
    analysis.mismatch
      .missingRequirements
      .length > 0 &&
    unsupported.length === 0
  ) {
    console.warn(
      "CARD WARNING: Missing Requirements contains items, but verification has no unsupported or unclear requirements."
    );
  }

  const supported =
    analysis.verification
      .requirements.filter(
        (item) =>
          item.evidenceStatus ===
            "supported" ||
          item.evidenceStatus ===
            "partially_supported"
      );

  if (
    analysis.matches
      .strongMatches.length >
      0 &&
    supported.length === 0
  ) {
    console.warn(
      "CARD WARNING: Strong Matches contains items, but verification has no supported requirements."
    );
  }
}

/* =========================================================
   FALLBACK
========================================================= */

/*
  Maps a ResumeResolutionError code to a message that is safe and useful
  to show the user directly - none of these reveal anything beyond "you
  need to fix your selection in Dashboard," never an internal reason.
*/
export function safeResumeResolutionMessage(
  code: string
): string {
  switch (code) {
    case "NO_CAREER_MEMORY":
      return "Please complete your Career Memory before generating a package.";
    case "NO_SELECTION":
      return "Please select a resume from Dashboard.";
    case "UNKNOWN_SOURCE":
      return "Your resume selection could not be recognized. Please reselect a resume from Dashboard.";
    case "NO_RESUME_ID":
      return "Please select a resume from Dashboard.";
    case "RESUME_NOT_FOUND":
      return "The selected resume could not be found. Please reselect a resume from Dashboard.";
    case "EMPTY_GENERATION_TEXT":
      return "The selected resume has no usable content. Please re-upload it or edit your Career Memory.";
    default:
      return "Please select a resume from Dashboard.";
  }
}

/*
  Phase5 Beta stabilization - per-validator error codes. Previously every
  validator in this file threw a plain Error, and classifyGenerationError
  below collapsed all of them into one generic VALIDATION_FAILED code/
  summary - real operational logs could not tell which validator actually
  fired without reading raw server console output. ValidatorErrorCode is
  the closed set of codes a validator throw can now carry; ValidatorName
  is the fixed label recorded alongside it purely for server-side
  logSafeError() output (never sent to the client, never stored in the
  DB - see GenerationValidationError's own comment).

  REQUIREMENT_EVIDENCE_FAILED exists in this set for completeness with
  the other five validators, but is currently unreachable:
  validateRequirementEvidence() (below) only ever pushes to a warnings
  array and self-corrects the affected field - it has no throw path
  today. Disclosed here rather than silently omitted, and not changed by
  this phase (changing that function's behavior is out of this phase's
  scope).
*/
export type ValidatorErrorCode =
  | "SOURCE_INTEGRITY_FAILED"
  | "PROTECTED_CLAIMS_FAILED"
  | "CANADIAN_SCOPE_FAILED"
  | "REQUIREMENT_EVIDENCE_FAILED"
  | "ANALYSIS_LOGIC_FAILED"
  | "DOCUMENT_QUALITY_FAILED";

/*
  Typed validation error carrying a stable, validator-specific code.
  `internalReason` becomes this Error's own `.message` - the ONLY place a
  validator's descriptive text (which may reference resume facts, e.g. a
  school name) is kept. That message reaches the server console ONLY via
  the existing logSafeError() call in generateCore.ts's catch block
  (unchanged by this phase) - it is never persisted to the applications
  table and never returned to the client. The DB/client only ever see
  `code`, mapped through the fixed `summaries` table in
  classifyGenerationError() below - the same safety guarantee that
  function's own original comment already documented for the generic
  case, now preserved per-validator instead of collapsed into one bucket.
*/
export class GenerationValidationError extends Error {
  readonly code: ValidatorErrorCode;
  readonly validator: string;

  constructor(
    code: ValidatorErrorCode,
    validator: string,
    internalReason: string
  ) {
    super(internalReason);
    this.name = "GenerationValidationError";
    this.code = code;
    this.validator = validator;
  }
}

export type GenerationErrorCode =
  | "OPENAI_TIMEOUT"
  | "OPENAI_RATE_LIMITED"
  | "OPENAI_ERROR"
  | "VALIDATION_FAILED"
  | "MALFORMED_AI_RESPONSE"
  | "UNKNOWN"
  | ValidatorErrorCode;

/*
  Phase5 Beta stabilization - the single-retry decision for generateCore.ts's
  OpenAI call, factored out as a pure predicate purely so it can be unit
  tested directly (generateCore.ts's own OpenAI client is a module-level
  singleton, not easily mocked) without duplicating the policy in a test
  file. Retries ONLY on a genuine `APIConnectionTimeoutError` (never
  RateLimitError/429, never any other APIError, never a JSON parse
  failure), and only while `attempt` is still below `maxAttempts` - see
  generateCore.ts's own MAX_OPENAI_ATTEMPTS/OPENAI_TIMEOUT_RETRY_DELAY_MS
  comment for why this is a single fixed-delay retry, not a backoff
  system.
*/
export function shouldRetryOpenAiTimeout(
  error: unknown,
  attempt: number,
  maxAttempts: number
): boolean {
  return (
    error instanceof APIConnectionTimeoutError &&
    attempt < maxAttempts
  );
}

/*
  Maps a caught error to a small closed code + a summary drawn only from the
  fixed dictionary below - never the caught error's own message, and never
  anything from the AI response. This is what makes it safe to persist in
  the applications table: there is no code path that copies raw error text,
  a stack trace, or AI/prompt content into these two columns.

  Ordering matters: APIConnectionTimeoutError and RateLimitError are both
  subclasses of APIError, so they're checked first, and GenerationValidationError
  (a validator's own typed throw) is checked before the generic
  `instanceof Error` fallback so a validator's specific code always wins
  over the generic VALIDATION_FAILED bucket. Any OTHER plain Error this
  route's own structure can still produce (e.g. the AI-response
  shape/required-field check in generateCore.ts, which throws a plain
  Error rather than a GenerationValidationError) still falls through to
  the original generic VALIDATION_FAILED code/summary, unchanged from
  before this phase - only the six validators above were asked to be
  differentiated, nothing else in this classification was widened.
*/
export function classifyGenerationError(error: unknown): {
  code: GenerationErrorCode;
  summary: string;
} {
  let code: GenerationErrorCode = "UNKNOWN";

  if (error instanceof APIConnectionTimeoutError) {
    code = "OPENAI_TIMEOUT";
  } else if (error instanceof RateLimitError) {
    code = "OPENAI_RATE_LIMITED";
  } else if (error instanceof APIError) {
    code = "OPENAI_ERROR";
  } else if (error instanceof SyntaxError) {
    code = "MALFORMED_AI_RESPONSE";
  } else if (error instanceof GenerationValidationError) {
    code = error.code;
  } else if (error instanceof Error) {
    code = "VALIDATION_FAILED";
  }

  const summaries: Record<GenerationErrorCode, string> = {
    OPENAI_TIMEOUT:
      "The AI generation request took too long and was stopped.",
    OPENAI_RATE_LIMITED:
      "The AI service is temporarily rate-limited or out of quota.",
    OPENAI_ERROR:
      "The AI service returned an error while generating the package.",
    VALIDATION_FAILED:
      "The generated package failed a content-quality check.",
    MALFORMED_AI_RESPONSE:
      "The AI response could not be parsed into a valid package.",
    UNKNOWN:
      "An unexpected error occurred while generating the package.",
    SOURCE_INTEGRITY_FAILED:
      "The generated resume did not preserve required applicant details. Please try again.",
    PROTECTED_CLAIMS_FAILED:
      "The generated package changed protected resume facts and was stopped.",
    CANADIAN_SCOPE_FAILED:
      "The generated package did not meet the required job-scope rules.",
    REQUIREMENT_EVIDENCE_FAILED:
      "The generated package included unsupported requirement claims.",
    ANALYSIS_LOGIC_FAILED:
      "The generated package failed an analysis consistency check.",
    DOCUMENT_QUALITY_FAILED:
      "The generated document did not pass the final quality check.",
  };

  return { code, summary: summaries[code] };
}

/* =========================================================
   Generation stage tracking - real, worker-reported progress
========================================================= */

/*
  The single source of truth for stage -> percentage. Used by both
  app/api/applications/[id]/status/route.ts (server) - never duplicated on
  the frontend, per the instruction that stage->progress mapping must live
  in exactly one place. "succeeded"/"failed" are not stored in
  generation_stage itself (that column only moves while generation_status
  stays 'pending' - see the migration's own comment) but are included here
  so the status route can compute a progress number for every
  generation_status without a second switch statement elsewhere.
*/
export const GENERATION_STAGE_PROGRESS: Record<string, number> = {
  queued: 10,
  claimed: 20,
  loading_inputs: 30,
  building_prompt: 40,
  generating: 55,
  validating: 80,
  saving: 90,
};

export function resolveGenerationProgress(
  generationStatus: string | null,
  generationStage: string | null
): number {
  if (generationStatus === "succeeded") return 100;
  if (generationStatus === "failed") return 0;

  if (generationStage && generationStage in GENERATION_STAGE_PROGRESS) {
    return GENERATION_STAGE_PROGRESS[generationStage];
  }

  // pending with no stage recorded yet (e.g. a row claimed by the sync
  // route a moment before the worker's own first stage write lands, or an
  // older row from before this column existed) - queued is the honest
  // floor, never 0 (0 is reserved for "failed").
  return GENERATION_STAGE_PROGRESS.queued;
}

/*
  Structured, PII-free timing log for one generation-pipeline stage -
  console.log only (stdout, captured by Netlify Function Logs/local dev
  console), never written to the database. Deliberately accepts only
  primitive, pre-approved fields (never a free-form `details` object) so a
  future call site cannot accidentally log resume/cover-letter/job-
  description text or applicant PII by passing it through here.
*/
export function logGenerationStage(fields: {
  applicationId: string;
  stage: string;
  durationMs: number;
  attempt?: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  status?: string;
}): void {
  console.log(
    JSON.stringify({
      event: "generate_package_stage",
      applicationId: fields.applicationId,
      stage: fields.stage,
      durationMs: fields.durationMs,
      attempt: fields.attempt,
      model: fields.model,
      inputTokens: fields.inputTokens,
      outputTokens: fields.outputTokens,
      cachedTokens: fields.cachedTokens,
      status: fields.status,
    })
  );
}

export function fallbackPackage(
  title = "the position",
  company = "the company",
  applicantName = "Applicant"
): GeneratedPackage {
  return {
    resume: "",
    coverLetter: "",
    emailDraft: "",

    packageAnalysis: {
      overallMatch: 0,
      matchLevel:
        "critical_mismatch",

      keyChanges: [],

      mismatch: {
        summary:
          `The package for ${title} at ${company} could not be generated.`,

        missingRequirements:
          [],

        unsupportedClaims:
          [],
      },

      matches: {
        strongMatches: [],
        transferableSkills:
          [],
      },

      recommendation: {
        summary:
          `${applicantName}, review the selected source and try again.`,

        applyRecommendation:
          "consider",

        nextSteps: [
          "Confirm that the selected resume contains complete information.",
          "Confirm that the full job posting was loaded.",
          "Generate the package again.",
        ],
      },

      verification:
        defaultVerification(),
    },
  };
}

/*
  Document Preservation Engine (DPE) Phase 4B completion - minimal, official
  public contract extension for a Layout Compression Request. This is DATA
  the Document Preservation Engine hands to Generate Package; it is never
  assembled into a prompt string by the DPE itself (forbidden - "DPE는
  Prompt를 조합하지 않는다"). Only generateCore.ts's own
  buildLayoutCompressionPromptBlock() below turns it into instruction text,
  and only as an ADDITIONAL block appended to the existing, unchanged
  prompt - never replacing SourceManifest/Protected Claims/Never-invent/
  Preserve rules, all of which appear earlier in the same prompt regardless
  of this block's presence.
*/
export type GenerationMode = "standard" | "layout_compression";

export type LayoutConstraints = {
  targetPageCount?: number;
  maxRenderedHeightBySection?: Record<string, number>;
  maxBulletCountByExperience?: number;
  overflowSections?: string[];
  sectionCharacterBudgets?: Record<string, number>;
  preserveProtectedClaims?: boolean;
};

/*
  Every instruction below stays inside the SAME rewrite freedoms already
  granted earlier in the prompt ("tailor the Professional Summary, reorder
  bullets, rewrite existing work more professionally... dedupe, trim
  non-essential modifiers, tighten long bullets, merge similar bullets, cut
  unnecessary sentence structure") - this block never grants a new freedom
  (e.g. it never says "you may delete a job" or "you may omit a
  certification"), it only asks that those SAME existing freedoms be
  applied more aggressively, in priority order, to fit a page/height/bullet
  budget. Every "Never invent"/"Preserve"/Protected Claims rule stated
  earlier in the prompt still applies unchanged and is explicitly restated
  as non-negotiable here.
*/
export function buildLayoutCompressionPromptBlock(
  constraints: LayoutConstraints
): string {
  const lines: string[] = [
    "==================================================",
    "LAYOUT COMPRESSION REQUEST",
    "==================================================",
    "",
    "The previous attempt to render this resume did not fit the required layout.",
    "Rewrite the resume more concisely so it fits, using ONLY the rewriting",
    "freedoms already described above (tailor the summary, reorder bullets,",
    "rewrite existing work more professionally, use truthful ATS keywords).",
    "This section adds a stricter LENGTH budget on top of those same rules -",
    "it grants no new freedom to delete, merge employers, or omit a",
    "qualification.",
    "",
    "Apply these techniques, in this priority order, only as far as needed to",
    "fit the budget below:",
    "1. Remove duplicated or redundant phrasing across bullets.",
    "2. Trim non-essential adjectives/adverbs that do not carry a fact.",
    "3. Tighten long bullets into a single concise sentence.",
    "4. Merge two bullets describing closely related work into one, only",
    "   when doing so loses no distinct fact, employer, date, or number.",
    "5. Reduce unnecessary sentence structure (e.g. redundant lead-in",
    "   phrases) while keeping every fact intact.",
    "",
    "Do NOT, under any circumstance, as a way to save space:",
    "- delete an employer, job title, employment date, education entry,",
    "  certification, licence, or quantified achievement",
    "- remove a skill listed in requiredSkillsFacts",
    "- shorten a company name, job title, or date range",
    "- omit a section that has real content",
    "",
  ];

  if (constraints.targetPageCount) {
    lines.push(
      `Target: the resume should fit within approximately ${constraints.targetPageCount} page(s) when rendered.`
    );
  }

  if (constraints.maxBulletCountByExperience) {
    lines.push(
      `Where reasonable without losing a fact, keep each PROFESSIONAL EXPERIENCE entry to at most ${constraints.maxBulletCountByExperience} bullets by merging closely related bullets (rule 4 above) - never by deleting a bullet's underlying fact.`
    );
  }

  if (constraints.overflowSections && constraints.overflowSections.length > 0) {
    lines.push(
      `These sections specifically overflowed the available space and most need tightening: ${constraints.overflowSections.join(", ")}.`
    );
  }

  if (
    constraints.sectionCharacterBudgets &&
    Object.keys(constraints.sectionCharacterBudgets).length > 0
  ) {
    lines.push("Approximate character budgets per section (guidance, not a hard cutoff that may drop facts):");
    for (const [section, budget] of Object.entries(constraints.sectionCharacterBudgets)) {
      lines.push(`- ${section}: ~${budget} characters`);
    }
  }

  if (
    constraints.maxRenderedHeightBySection &&
    Object.keys(constraints.maxRenderedHeightBySection).length > 0
  ) {
    lines.push("Approximate rendered-height budgets per section (guidance only, from real measured layout):");
    for (const [section, height] of Object.entries(constraints.maxRenderedHeightBySection)) {
      lines.push(`- ${section}: ~${Math.round(height)}px`);
    }
  }

  lines.push(
    "",
    "Every rule stated earlier in this prompt (Never invent, Preserve every",
    "existing employer/job title/date/education/certification/quantified",
    "achievement, Protected Claims) remains fully in force and takes priority",
    "over fitting this length budget. If the two conflict, preserving the",
    "facts wins and the document may remain longer than requested."
  );

  return lines.join("\n");
}

/*
  D안 Phase 1 (Original Visual Tree) - additive Call1 prompt extension.
  Empty string ("") whenever the tree build was skipped or failed, or
  the source is career_memory - buildResumeAnalysisPrompt's own prompt
  stays byte-identical to before this Phase in every such case (see
  this function's own call site in generateCore.ts). Deliberately sends
  only the compressed, per-leaf STRUCTURE (page/column/section/budget) -
  never raw x/y/width/height pixel coordinates, per this Phase's own
  "AI에게 raw x/y 픽셀 전체를 보내지 않는다" rule; only the Renderer
  (originalLayoutRenderer.ts) ever reads real bounds.
*/
export function buildOriginalLayoutPromptBlock(
  plan: import("../documentPreservation/visualTree/buildLayoutPlan").LayoutGenerationPlan
): string {
  const lines: string[] = [
    "==================================================",
    "ORIGINAL LAYOUT PLAN",
    "==================================================",
    "",
    "The candidate's ORIGINAL uploaded resume file has a real page/column",
    "layout. Write the resume so it fits this SAME structure as closely as",
    "possible, using ONLY the rewriting freedoms already described above -",
    "this section adds no new freedom to invent, omit, or reorder facts.",
    "",
    `Original page count: approximately ${plan.targetPageCount} page(s).`,
    `Section order in the original document: ${plan.sectionOrder.join(", ") || "(none detected)"}.`,
  ];

  if (plan.sidebarSectionKeys.length > 0) {
    lines.push(
      `These sections sit in a narrow SIDEBAR column in the original document and should stay concise: ${plan.sidebarSectionKeys.join(", ")}.`
    );
  }
  if (plan.mainColumnSectionKeys.length > 0) {
    lines.push(
      `These sections sit in the main column: ${plan.mainColumnSectionKeys.join(", ")}.`
    );
  }

  lines.push(
    "",
    "Approximate per-section character budgets (from the original document's",
    "own real layout - APPROXIMATE guidance, not a hard cutoff that may drop",
    "a fact; exact pixel fit is verified afterward by a separate Renderer",
    "step, not by you):"
  );
  for (const leaf of plan.leaves) {
    if (!leaf.sectionKey) continue;
    const bulletNote = leaf.maxBullets ? `, at most ~${leaf.maxBullets} bullets` : "";
    lines.push(`- [${leaf.nodeId}] ${leaf.sectionKey}: ~${leaf.characterBudget} characters${bulletNote}`);
  }

  lines.push(
    "",
    "OUTPUT ADDITION for this document only: in addition to the normal",
    '"resume" field, also include a top-level "layoutNodes" array, one entry',
    "per node id listed above, in this exact shape:",
    "",
    '"layoutNodes": [ { "nodeId": "node-...", "text": "..." } ]',
    "",
    "- Use the EXACT nodeId values listed above, never invented ones.",
    "- Each entry's text must be the same content that appears in the",
    '  "resume" field for that section, not different content - "resume"',
    "  stays the complete, authoritative document either way.",
    "- Every rule stated earlier in this prompt (Never invent, Preserve every",
    "  existing employer/job title/date/education/certification/quantified",
    "  achievement, Protected Claims) remains fully in force and takes",
    "  priority over fitting these budgets."
  );

  return lines.join("\n");
}

/* =========================================================
   TWO-CALL GENERATION PROMPTS (Performance Optimization Round 4)

   Splits the single combined prompt that used to live inline in
   generateCore.ts (Resume + Cover Letter + Email Draft + PackageAnalysis,
   one OpenAI call) into two independent prompts, so Resume + Analysis can
   finish, validate, and go through DPE before Cover Letter + Email are
   generated in a second call. Every instructional sentence below is
   copied verbatim from that original single-call prompt - no wording was
   reworded or improved. A section is included only where it is copied
   whole (never spliced mid-sentence); a section is omitted entirely
   (never partially reworded) when it only concerns a document/field the
   given call does not produce:
   - Call 2 omits CAREER MEMORY OPTIONAL SECTIONS, JOB POSTING ANALYSIS,
     FOUR ANALYSIS CARDS, MATCH SCORE, and CANADIAN SCOPE (all
     PackageAnalysis-only, and Call 2 never receives or produces
     PackageAnalysis, per this round's explicit instruction).
   - Call 2's REGULATED AND HIGH-RISK REQUIREMENTS keeps only its first
     paragraph (the "never state X unless the PRIMARY RESUME supports it"
     rule, which applies to any document); the licenceStatus/matchLevel/
     applyRecommendation/scheduleRequirement paragraphs are omitted
     wholesale since those fields don't exist in Call 2's output.
   - Call 2's SINGLE FACTUAL SOURCE drops only the "Resume source selected
     by the user: ${resumeSource}" line and the two "If the source is
     career_memory/upload: ... SOURCE MANIFEST" bullets, because Call 2
     has no resumeSource/SourceManifest concept at all (Round 3's
     dependency analysis found SOURCE MANIFEST unused by Cover Letter/
     Email logic) - every other sentence in that block is unchanged.
   - The shared role header's second sentence ("You must first analyze...
     before you write the resume, cover letter, and application email") is
     dropped for Call 2 only, because it no longer describes Call 2's
     actual task (Call 2 never analyzes and never writes the resume) -
     keeping it would misdirect the model into expecting an output slot
     that doesn't exist in Call 2's schema. This is the one line that does
     not appear verbatim-in-full in both prompts; every other line either
     appears in full or is omitted in full.
   - The OUTPUT JSON shape is trimmed to only the fields each call
     actually produces (structural necessity of the split itself, not a
     wording change to any instruction) - the "packageAnalysis" nested
     object and the Resume writing/formatting rules are byte-identical to
     the original prompt wherever they appear.
*/

export function buildResumeAnalysisPrompt(params: {
  resumeSource: "career_memory" | "upload";
  manifest: SourceManifest;
  resumeText: string;
  analysis: unknown;
  jobText: string;
  layoutCompressionBlock: string;
  /*
    D안 Phase 1 - defaults to "" at every existing call site until a
    caller explicitly builds one via buildOriginalLayoutPromptBlock().
    "" produces a byte-identical prompt to before this field existed
    (same additive convention as layoutCompressionBlock above).
  */
  originalLayoutPromptBlock?: string;
}): string {
  const {
    resumeSource,
    manifest,
    resumeText,
    analysis,
    jobText,
    layoutCompressionBlock,
    originalLayoutPromptBlock = "",
  } = params;

  return `
You are Career Élan's Canadian resume strategist, ATS specialist, recruiter, and application writer.

You must first analyze the complete job posting. Only after the job analysis is complete may you write the resume, cover letter, and application email.

==================================================
SINGLE FACTUAL SOURCE
==================================================

Resume source selected by the user:

${resumeSource}

The PRIMARY RESUME below is the only factual source.

If the source is career_memory:
- use only the Career Memory resume represented by the PRIMARY RESUME and SOURCE MANIFEST

If the source is upload:
- use only the selected uploaded resume represented by the PRIMARY RESUME and SOURCE MANIFEST

The job posting is not evidence about the candidate.

The existing cover letter is not a factual source. It may be used only as a tone and writing-style reference.

Do not use unselected resumes or unrelated Career Memory information.

Never invent:

- companies
- organizations
- employers
- job titles
- employment dates
- new responsibilities
- new work experience
- education
- degrees
- fields of study
- certifications
- licences
- registrations
- languages
- language proficiency
- software experience
- equipment experience
- technical experience
- numerical achievements
- citizenship
- permanent residence
- visas
- work permits
- work authorization
- security clearances
- regulated professional status

You may professionally rewrite a responsibility that already exists.

Example:

Source:
Answered phone inquiries.

Allowed:
Responded to client inquiries by phone and provided clear service guidance.

Not allowed:
Managed a national high-volume customer service centre.

Do not add a number unless the number appears in the PRIMARY RESUME.

==================================================
CAREER MEMORY OPTIONAL SECTIONS
==================================================

The SOURCE MANIFEST determines which sections actually exist.

A section exists only when its core identifying information is present.

If sectionPresence.education is false:
- do not create Education
- do not create Academic Background
- do not create Education and Training

If sectionPresence.languages is false:
- do not create Languages
- do not create Language Skills
- do not create Bilingual Skills

If sectionPresence.certifications is false:
- do not create Certifications
- do not create Certificates
- do not create Credentials
- do not create Licences

If sectionPresence.projects is false:
- do not create Projects
- do not create Project Experience

If sectionPresence.careerGoals is false:
- do not create Career Goals
- do not create Career Objective
- do not create Professional Objective
- do not create Target Role

If sectionPresence.volunteerExperience is false:
- do not create a separate Volunteer Experience section

A section may be partially completed.

Include only fields actually entered by the user.

Example:

Education:
- school: Seneca Polytechnic
- program: Law Clerk
- date: empty
- GPA: empty
- coursework: empty

Allowed:
Include Seneca Polytechnic and Law Clerk.

Not allowed:
Invent dates, GPA, coursework, awards, or graduation status.

Do not treat these as valid sections:

- Education containing only dates, GPA, or coursework with no school, program, degree, or field
- Language containing only "Fluent" with no language name
- Certification containing only issuer or date with no credential name
- Project containing only dates with no project name or meaningful description

A qualification mentioned by the user inside the source summary may remain in the summary.

A summary mention alone does not authorize creating a new separate section.

==================================================
JOB POSTING ANALYSIS — DO THIS FIRST
==================================================

Before writing, analyze:

- employer and sector
- main business need
- major responsibilities
- mandatory requirements
- preferred requirements
- required years of experience
- education and field-of-study requirements
- certifications
- licences
- regulated professional status
- security screening and clearance
- bilingual or multilingual requirements
- day shift
- evening shift
- night shift
- rotating shift
- weekend work
- holiday work
- driver's licence
- travel or mobility requirements
- required software
- required equipment
- technical skills
- repeated ATS keywords

Compare each important requirement to the PRIMARY RESUME and classify it as:

- supported
- partially_supported
- not_supported
- unclear

Transferable experience is not direct proof of a mandatory technical or professional requirement.

For supported or partially supported requirements:
- sourceEvidence must be a short phrase appearing in the PRIMARY RESUME
- source must be primary_resume

For not_supported or unclear requirements:
- sourceEvidence must be empty
- source must be none

==================================================
DOCUMENT WRITING
==================================================

RESUME

Return a complete plain-text resume.

Preserve every existing:

- applicant identity and contact information
- company
- organization
- employer
- job title
- date
- work-history entry
- volunteer-history entry
- education entry
- certification
- licence
- language entry
- project entry

Preserve the order of work and volunteer history.

You may:

- tailor the Professional Summary
- reorder skills
- reorder bullets within the same role
- rewrite existing work more professionally
- use truthful ATS keywords
- emphasize relevant duties
- reduce emphasis on unrelated duties

You may not:

- delete factual history
- move duties between employers
- merge separate roles
- change dates
- change job titles
- convert volunteer work into paid work
- add missing qualifications
- add missing shift experience
- add missing software or equipment experience

Do not output an empty section.

==================================================
OUTPUT FORMAT — FOUR RESUME SECTIONS
==================================================

The following formatting rules apply ONLY to the PROFESSIONAL EXPERIENCE,
SKILLS, EDUCATION, and CERTIFICATIONS sections. They control formatting
only - they never authorize inventing, dropping, or reordering a fact. If
a date, school, employer, or issuer is missing from the PRIMARY RESUME,
leave it out rather than inventing a placeholder.

PROFESSIONAL EXPERIENCE

Section heading must be exactly:
PROFESSIONAL EXPERIENCE

Each entry must use exactly this structure, in this order:

Company Name
Job Title | StartDate - EndDate
- Bullet
- Bullet

- Line 1 is always the company/employer name.
- Line 2 is always the job title, then " | " (space-pipe-space), then the
  date range.
- Never swap company and job title. Never guess which value is which.
- Never put company and job title on the same line.
- Never put the date on its own separate line.
- Never use an em dash or hyphen between company and job title.
- The separator before the date range is exactly " | ".
- The separator inside the date range is exactly " - " (space-hyphen-space).
- Use "Present" as the end date only when the source material actually
  indicates the role is current or ongoing. If only a single date is
  available with no such indication, output only that one date - do not
  invent an end date or "Present".
- Every description line must be a bullet starting with "- " (hyphen,
  space). Never write plain prose lines with no bullet marker, and never
  use "•", "*", or numbered lists.
- No blank line directly after the Company/Title/Date header, before the
  first bullet.
- Exactly one blank line between two different experience entries.

Example:

PROFESSIONAL EXPERIENCE

Northbridge Analytics
Senior Business Analyst | 2021-02 - Present
- Built executive dashboards that improved reporting visibility.
- Led requirements gathering across business and engineering teams.

SKILLS

Section heading must be exactly:
SKILLS

Never use "CORE SKILLS" or any other heading variant.

List exactly one skill per line. Do not use "|", ",", or ";" as
separators. Do not use category labels such as "Technical Skills:",
"Tools:", or "Programming:". Do not use bullet markers or numbers. Do not
repeat the same skill twice. Do not output a blank skill line.

Each entry in requiredSkillsFacts (see SOURCE MANIFEST) is a single
atomic skill exactly as stored in Career Memory. Preserve it exactly, one
line per entry. Do not treat "/", "&", "+", "-", ".", parentheses, or
spaces inside a skill string as a delimiter to split it. Do not merge,
abbreviate, expand, or rewrite a skill name, including for ATS
optimization. For example, "Excel/Google Sheets" is one line, never
"Excel" and "Google Sheets" on separate lines. "Agile/Scrum" is one line,
never "Agile" and "Scrum" on separate lines.

Example:

SKILLS

SQL
Python
AWS

EDUCATION

Section heading must be exactly:
EDUCATION

Each entry must use exactly this structure, in this order:

School Name
Degree or Program | StartDate - EndDate

- Line 1 is always the school name.
- Line 2 is always the degree/program, then " | ", then the date range.
- Never swap school and degree/program.
- Never split the date onto a third line.
- Never combine school and degree on one line.
- Exactly one blank line between two different education entries.
- Never use bullets in this section.
- If only one of the start/end dates is available, keep that one date and
  do not invent the missing one.
- If no date is available at all, omit the " | " and the date entirely -
  output only the school name and degree/program.

Example (with dates):

EDUCATION

University of Toronto
Bachelor of Commerce, Business Analytics | 2014-09 - 2018-05

Example (no dates available):

EDUCATION

University of Toronto
Bachelor of Commerce, Business Analytics

CERTIFICATIONS

Section heading must be exactly:
CERTIFICATIONS

Each certification is exactly one line:

Certification Name - Issuer, Year

- The separator is exactly " - " using an ASCII hyphen. Never use an em
  dash (—) or en dash (–).
- If an issuer and a year are both available, put exactly ", " between
  them.
- One certification per line, no bullets, no blank line between entries.
- If part of the information is missing, use only what is available:
  - name and issuer only: Certification Name - Issuer
  - name and year only: Certification Name, Year
  - name only: Certification Name

Example:

CERTIFICATIONS

Certified Business Analysis Professional - IIBA, 2023
${layoutCompressionBlock}
==================================================
CANADIAN SCOPE
==================================================

Career Élan supports:

- Canadian private-sector postings
- Canadian provincial-government postings
- Canadian municipal or local-government postings

It does not support Canadian federal-government applications.

Classify the posting as:

- private
- provincial
- municipal
- federal
- unknown

If federal:
- sector must be federal
- supportedByCareerElan must be false

==================================================
REGULATED AND HIGH-RISK REQUIREMENTS
==================================================

Never state that the candidate has:

- citizenship
- permanent residence
- a work permit
- authorization to work
- security clearance
- professional registration
- a regulated licence

unless the PRIMARY RESUME explicitly supports it.

If a mandatory regulated licence is missing:
- licenceStatus must be missing
- matchLevel must not be strong
- applyRecommendation must not be recommended

If mandatory bilingual ability is not fully supported:
- do not call the candidate bilingual
- matchLevel must not be strong

If mandatory night, rotating, weekend, or holiday availability is required but the source does not confirm it:
- scheduleRequirement.candidateStatus must be not_supported or unclear
- include it in missingRequirements when important

==================================================
FOUR ANALYSIS CARDS
==================================================

Keep these four cards:

1. keyChanges
Explain the most meaningful tailoring changes.

The wording does not need to be exactly identical to the final resume.

2. mismatch
Show important mandatory or preferred requirements not confirmed by the source.

3. matches
Separate direct matches from realistic transferable skills.

4. recommendation
State whether the candidate should apply and list practical next steps.

Do not repeat the same point across every card.

==================================================
MATCH SCORE
==================================================

85–100:
strong

65–84:
moderate

40–64:
low

0–39:
critical_mismatch

Do not inflate the score.

A missing core licence, legal qualification, essential degree, or central professional requirement should normally result in low or critical_mismatch.
${originalLayoutPromptBlock}
==================================================
OUTPUT
==================================================

Return only valid JSON.

Do not use markdown.
Do not use code fences.

Use exactly this structure:

{
  "resume": "Complete resume string",
  "packageAnalysis": {
    "overallMatch": 0,
    "matchLevel": "strong | moderate | low | critical_mismatch",
    "keyChanges": [
      {
        "section": "",
        "original": "",
        "revised": "",
        "reason": ""
      }
    ],
    "mismatch": {
      "summary": "",
      "missingRequirements": [],
      "unsupportedClaims": []
    },
    "matches": {
      "strongMatches": [],
      "transferableSkills": []
    },
    "recommendation": {
      "summary": "",
      "applyRecommendation": "recommended | consider | not_recommended",
      "nextSteps": []
    },
    "verification": {
      "jobContext": {
        "country": "Canada | Unknown",
        "sector": "private | provincial | municipal | federal | unknown",
        "province": "",
        "municipality": "",
        "supportedByCareerElan": true,
        "classificationReason": ""
      },
      "requirements": [
        {
          "requirement": "",
          "category": "mandatory | preferred | legal_or_regulated",
          "evidenceStatus": "supported | partially_supported | not_supported | unclear",
          "sourceEvidence": "",
          "source": "primary_resume | none",
          "regulated": false
        }
      ],
      "regulatedRole": {
        "isRegulated": false,
        "profession": "",
        "jurisdiction": "",
        "requiredLicence": "",
        "licenceEvidence": "",
        "licenceStatus": "verified | missing | not_required | unclear"
      },
      "bilingualRequirement": {
        "level": "mandatory | preferred | not_required | unclear",
        "languages": [],
        "evidence": "",
        "status": "verified | partially_verified | missing | not_required | unclear"
      },
      "scheduleRequirement": {
        "dayShift": false,
        "eveningShift": false,
        "nightShift": false,
        "rotatingShift": false,
        "weekendWork": false,
        "holidayWork": false,
        "requirementLevel": "mandatory | preferred | not_required | unclear",
        "candidateStatus": "supported | partially_supported | not_supported | unclear",
        "explanation": ""
      }
    }
  }
}

Limits:

- keyChanges: maximum 4
- missingRequirements: maximum 5
- unsupportedClaims: maximum 4
- strongMatches: maximum 5
- transferableSkills: maximum 4
- nextSteps: maximum 3
- requirements: maximum 20

==================================================
SOURCE MANIFEST
==================================================

${JSON.stringify(
  manifest,
  null,
  2
)}

==================================================
PRIMARY RESUME — ONLY FACTUAL SOURCE
==================================================

${resumeText}

==================================================
PREVIOUS JOB ANALYSIS — REFERENCE ONLY
==================================================

${JSON.stringify(
  analysis,
  null,
  2
)}

==================================================
COMPLETE JOB DESCRIPTION
==================================================

${jobText}
`;
}

export function buildCoverLetterEmailPrompt(params: {
  title: string;
  company: string;
  finalResumeText: string;
  jobText: string;
  existingCoverLetter: string;
}): string {
  const { title, company, finalResumeText, jobText, existingCoverLetter } =
    params;

  return `
You are Career Élan's Canadian resume strategist, ATS specialist, recruiter, and application writer.

==================================================
SINGLE FACTUAL SOURCE
==================================================

The PRIMARY RESUME below is the only factual source.

The job posting is not evidence about the candidate.

The existing cover letter is not a factual source. It may be used only as a tone and writing-style reference.

Do not use unselected resumes or unrelated Career Memory information.

Never invent:

- companies
- organizations
- employers
- job titles
- employment dates
- new responsibilities
- new work experience
- education
- degrees
- fields of study
- certifications
- licences
- registrations
- languages
- language proficiency
- software experience
- equipment experience
- technical experience
- numerical achievements
- citizenship
- permanent residence
- visas
- work permits
- work authorization
- security clearances
- regulated professional status

You may professionally rewrite a responsibility that already exists.

Example:

Source:
Answered phone inquiries.

Allowed:
Responded to client inquiries by phone and provided clear service guidance.

Not allowed:
Managed a national high-volume customer service centre.

Do not add a number unless the number appears in the PRIMARY RESUME.

==================================================
DOCUMENT WRITING
==================================================

COVER LETTER

Write specifically for:

Position: ${title}
Company: ${company}

Connect the employer's main requirements to supported candidate experience.

When experience is transferable rather than direct, say so naturally.

Do not present transferable experience as direct industry experience.

Do not claim a missing mandatory qualification.

Do not copy the resume paragraph by paragraph.

EMAIL DRAFT

Keep the email concise.

Include:

- subject line
- greeting
- exact position title
- company name
- expression of interest
- reference to attached resume and cover letter
- professional closing
- applicant name

Do not load the email with unnecessary career facts.

==================================================
REGULATED AND HIGH-RISK REQUIREMENTS
==================================================

Never state that the candidate has:

- citizenship
- permanent residence
- a work permit
- authorization to work
- security clearance
- professional registration
- a regulated licence

unless the PRIMARY RESUME explicitly supports it.

==================================================
OUTPUT
==================================================

Return only valid JSON.

Do not use markdown.
Do not use code fences.

Use exactly this structure:

{
  "coverLetter": "Complete cover letter string",
  "emailDraft": "Complete application email string"
}

==================================================
PRIMARY RESUME — ONLY FACTUAL SOURCE
==================================================

${finalResumeText}

==================================================
EXISTING COVER LETTER — STYLE REFERENCE ONLY
==================================================

${existingCoverLetter}

==================================================
COMPLETE JOB DESCRIPTION
==================================================

${jobText}
`;
}
