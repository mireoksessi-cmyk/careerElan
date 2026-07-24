import {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  RateLimitError,
} from "openai";

/*
  Shared, pure (no OpenAI client, no DB access) types/helpers used by both
  the synchronous claim route (app/api/generate-package/route.ts) and the
  background generation worker (lib/generatePackage/generateCore.ts +
  netlify/functions/generate-package-background.ts). Moved here verbatim
  from the old single-file route.ts during the async-architecture
  refactor - no logic changes.
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
};

export type GeneratedPackage = {
  resume: string;
  coverLetter: string;
  emailDraft: string;
  packageAnalysis:
    PackageAnalysis;
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

export function getStringOrArrayText(
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

export function normalizeForComparison(
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

export function includesLoose(
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

export function hasSectionHeading(
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

export function extractJson(
  text: string
): GeneratedPackage {
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
  ) as GeneratedPackage;
}

/* =========================================================
   CAREER MEMORY SECTION DETECTION

   배열 길이가 아니라 핵심 필드로 판단한다.
========================================================= */

export function isMeaningfulExperience(
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

export function isMeaningfulEducation(
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

export function isMeaningfulCertification(
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

export function isMeaningfulLanguage(
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

export function isMeaningfulProject(
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

export function getCareerGoalsText(
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

export function getCareerMemoryEntries(
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

export function getParsedArray(
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

export function getResumeFact(
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

export function getEducationFact(
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

export function getNamedItems(
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

export function validateFactEntry(
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
    !includesLoose(
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
    if (
      manifest.applicant.name &&
      !includesLoose(
        resume,
        manifest.applicant.name
      )
    ) {
      errors.push(
        `Applicant name is missing: ${manifest.applicant.name}`
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
        `Applicant email is missing: ${manifest.applicant.email}`
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
        `Applicant phone is missing: ${manifest.applicant.phone}`
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
        !includesLoose(
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
    throw new Error(
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
    throw new Error(
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

export function validateDocumentQuality(
  name: string,
  text: string
) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (
    typeof text !== "string"
  ) {
    throw new Error(
      `${name} is not a string.`
    );
  }

  if (!text.trim()) {
    throw new Error(
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
    throw new Error(
      `${name} quality validation failed:\n${errors.join(
        "\n"
      )}`
    );
  }
}

/* =========================================================
   PACKAGE NORMALIZATION
========================================================= */

export function defaultVerification():
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

export function defaultPackageAnalysis():
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

export function cleanStringArray(
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
    throw new Error(
      "Career Élan currently supports Canadian job postings only."
    );
  }

  if (
    context.sector ===
    "federal"
  ) {
    throw new Error(
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
    throw new Error(
      "The job posting could not be classified as a supported Canadian private, provincial, or municipal posting."
    );
  }

  if (
    context.supportedByCareerElan !==
    true
  ) {
    throw new Error(
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

  const missingLegalRequirement =
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
    throw new Error(
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
    throw new Error(
      "The application cannot be rated strong while a mandatory regulated qualification is missing."
    );
  }

  if (
    missingLicence &&
    analysis.recommendation
      .applyRecommendation ===
      "recommended"
  ) {
    throw new Error(
      "A regulated role with a missing required licence cannot be recommended."
    );
  }

  if (
    missingMandatoryBilingual &&
    analysis.matchLevel ===
      "strong"
  ) {
    throw new Error(
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

export type GenerationErrorCode =
  | "OPENAI_TIMEOUT"
  | "OPENAI_RATE_LIMITED"
  | "OPENAI_ERROR"
  | "NETWORK_ERROR"
  | "VALIDATION_FAILED"
  | "MALFORMED_AI_RESPONSE"
  | "BACKGROUND_ENQUEUE_FAILED"
  | "UNKNOWN";

/*
  Maps a caught error to a small closed code + a summary drawn only from the
  fixed dictionary below - never the caught error's own message, and never
  anything from the AI response. This is what makes it safe to persist in
  the applications table: there is no code path that copies raw error text,
  a stack trace, or AI/prompt content into these two columns.

  Ordering matters: APIConnectionTimeoutError extends APIConnectionError,
  which extends APIError, and RateLimitError also extends APIError - the
  more specific subclasses are checked first so a timeout or rate-limit
  error is never miscategorized as a generic OPENAI_ERROR or NETWORK_ERROR.
  Every validator in this file (validateSourceIntegrity,
  validateProtectedClaims, validateDocumentQuality, validateCanadianScope,
  validateRequirementEvidence, validateAnalysisLogic) throws a plain Error
  with its own message text with no shared keyword, so rather than
  string-matching each one, anything that reaches this function as a plain
  Error (not an OpenAI SDK error, not a JSON parse failure) is - by this
  route's own structure, since it only runs after the OpenAI call already
  succeeded - definitionally one of those content-quality checks.
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
  } else if (error instanceof APIConnectionError) {
    code = "NETWORK_ERROR";
  } else if (error instanceof APIError) {
    code = "OPENAI_ERROR";
  } else if (error instanceof SyntaxError) {
    code = "MALFORMED_AI_RESPONSE";
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
    NETWORK_ERROR:
      "A network error occurred while contacting the AI service.",
    VALIDATION_FAILED:
      "The generated package failed a content-quality check.",
    MALFORMED_AI_RESPONSE:
      "The AI response could not be parsed into a valid package.",
    BACKGROUND_ENQUEUE_FAILED:
      "Could not start AI generation. Please try again.",
    UNKNOWN:
      "An unexpected error occurred while generating the package.",
  };

  return { code, summary: summaries[code] };
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
