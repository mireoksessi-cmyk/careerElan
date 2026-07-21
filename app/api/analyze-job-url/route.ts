import OpenAI from "openai";
import { NextResponse } from "next/server";
import { assertSafeJobUrl, UnsafeUrlError } from "@/lib/security/ssrfGuard";
import { toSafeResponse } from "@/lib/errors/publicError";
import { JOB_ANALYSIS_MODEL } from "@/lib/config/aiModels";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MAX_REDIRECTS = 5;
const TOTAL_FETCH_DEADLINE_MS = 20000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

class JobFetchHttpError extends Error {
  status: number;

  constructor(status: number) {
    super(`Job URL responded with HTTP ${status}`);
    this.status = status;
  }
}

/*
  Reads a fetch Response body as text with a hard byte cap, cancelling the
  stream as soon as the cap is exceeded rather than trusting the
  (spoofable) Content-Length header.
*/
async function readWithSizeLimit(
  response: Response,
  maxBytes: number
): Promise<string> {
  const reader = response.body?.getReader();

  if (!reader) return await response.text();

  const decoder = new TextDecoder();
  let received = 0;
  let result = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    received += value.byteLength;

    if (received > maxBytes) {
      await reader.cancel();
      throw new UnsafeUrlError("Response too large.");
    }

    result += decoder.decode(value, { stream: true });
  }

  result += decoder.decode();

  return result;
}

/*
  Fetches a user-supplied job URL with SSRF protections: the initial URL
  and every redirect target are validated with assertSafeJobUrl before any
  request is made to them, redirects are followed manually (never
  automatically) so each hop can be re-validated, and the whole chain
  shares one deadline and one response-size cap.
*/
async function fetchJobUrlSafely(rawUrl: string): Promise<string> {
  let currentUrl = await assertSafeJobUrl(rawUrl);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    TOTAL_FETCH_DEADLINE_MS
  );

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await fetch(currentUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");

        if (!location) {
          throw new UnsafeUrlError("Redirect with no location header.");
        }

        const nextUrl = new URL(location, currentUrl);

        // Re-validated against the exact same policy as the initial URL -
        // a redirect from an allowed dev host to a private address is
        // blocked here even though the first hop was allowed.
        currentUrl = await assertSafeJobUrl(
          nextUrl.toString(),
          hop + 1,
          MAX_REDIRECTS
        );
        continue;
      }

      if (!response.ok) {
        throw new JobFetchHttpError(response.status);
      }

      return await readWithSizeLimit(response, MAX_RESPONSE_BYTES);
    }

    throw new UnsafeUrlError("Too many redirects.");
  } finally {
    clearTimeout(timeout);
  }
}

type RequirementCategory =
  | "mandatory"
  | "preferred"
  | "legal_or_regulated";

type ScheduleAnalysis = {
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

  explanation: string;
};

type BilingualAnalysis = {
  level:
    | "mandatory"
    | "preferred"
    | "not_required"
    | "unclear";

  languages: string[];
  explanation: string;
};

type RegulatedRoleAnalysis = {
  isRegulated: boolean;
  profession: string;
  jurisdiction: string;
  requiredLicence: string;

  requirementLevel:
    | "mandatory"
    | "preferred"
    | "not_required"
    | "unclear";
};

type RequirementKind =
  | "experience"
  | "education"
  | "certification"
  | "licence"
  | "language"
  | "software"
  | "equipment"
  | "technical_skill"
  | "drivers_licence"
  | "travel"
  | "schedule"
  | "security_screening"
  | "work_authorization"
  | "other";

type AnalyzedRequirement = {
  requirement: string;
  category: RequirementCategory;
  kind: RequirementKind;
  regulated: boolean;
};

type CanadianJobContext = {
  country:
    | "Canada"
    | "Unknown";

  sector:
    | "private"
    | "provincial"
    | "municipal"
    | "federal"
    | "unknown";

  province: string;
  municipality: string;

  supportedByCareerElan: boolean;
  classificationReason: string;
};

type ExperienceRequirementAnalysis = {
  minimumYears: number | null;
  description: string;
  mandatory: boolean;
};

type EducationRequirementAnalysis = {
  level: string;
  fieldOfStudy: string;
  mandatory: boolean;
  explanation: string;
};

type DriversLicenceRequirement = {
  required: boolean;
  licenceClass: string;
  preferred: boolean;
  explanation: string;
};

type MobilityRequirement = {
  travelRequired: boolean;
  relocationRequired: boolean;
  ownVehicleRequired: boolean;
  explanation: string;
};

type JobAnalysisResponse = {
  title: string;
  company: string;
  location: string;
  type: string;
  category: string;
  icon: string;

  match: string;
  keywordCount: number;
  requirementsMatched: number;

  keywords: string[];
  summary: string;

  jobContext: CanadianJobContext;
  requirements: AnalyzedRequirement[];

  experienceRequirement: ExperienceRequirementAnalysis;
  educationRequirement: EducationRequirementAnalysis;
  regulatedRole: RegulatedRoleAnalysis;
  bilingualRequirement: BilingualAnalysis;
  scheduleRequirement: ScheduleAnalysis;

  driversLicenceRequirement: DriversLicenceRequirement;
  mobilityRequirement: MobilityRequirement;

  softwareRequirements: string[];
  equipmentRequirements: string[];
  technicalSkillRequirements: string[];
  securityRequirements: string[];

  jobDetails?: {
    description: string;
    responsibilities: string[];
    qualifications: string[];
    benefits: string[];
    salary: string;
    schedule: string;
    applyUrl: string;
  };
};

function cleanHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJson(text: string) {
  const cleaned = text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");

  if (first === -1 || last === -1) {
    throw new Error("No JSON found in AI response.");
  }

  return JSON.parse(cleaned.slice(first, last + 1));
}

function normalizeUrl(url: string) {
  const trimmed = url.trim();
  if (trimmed.startsWith("www.")) return `https://${trimmed}`;
  return trimmed;
}

function fallbackMessage() {
  return "This website is slow or cannot be read automatically. Please paste the job description, upload a PDF/DOCX, or upload a screenshot of the job posting.";
}

function normalizeStringList(
  value: unknown,
  limit = 15
): string[] {
  return Array.isArray(value)
    ? value
        .filter(
          (item): item is string =>
            typeof item === "string" &&
            item.trim().length > 0
        )
        .map((item) => item.trim())
        .slice(0, limit)
    : [];
}
export async function POST(req: Request) {
  console.time("total analyze-job-url");

  const requestId = crypto.randomUUID();

  try {
    const { jobUrl } = await req.json();

    if (!jobUrl || typeof jobUrl !== "string") {
      console.timeEnd("total analyze-job-url");
      return NextResponse.json(
        { error: "Job URL is required." },
        { status: 400 }
      );
    }

    const finalUrl = normalizeUrl(jobUrl);

    let html: string;

    try {
      console.time("1 fetch job url");
      html = await fetchJobUrlSafely(finalUrl);
      console.timeEnd("1 fetch job url");
    } catch (error) {
      console.timeEnd("1 fetch job url");
      console.timeEnd("total analyze-job-url");

      if (error instanceof UnsafeUrlError) {
        // Never echo the blocked hostname/IP back to the client.
        return NextResponse.json(
          {
            error:
              "This URL cannot be analyzed. Please paste the job description instead.",
          },
          { status: 400 }
        );
      }

      if (error instanceof JobFetchHttpError) {
        return NextResponse.json(
          { error: fallbackMessage() },
          { status: 422 }
        );
      }

      // Network error, DNS failure, or the shared deadline aborting the
      // fetch - all fall back to the same "couldn't read it" message.
      return NextResponse.json(
        { error: fallbackMessage() },
        { status: 408 }
      );
    }

    console.time("3 clean html");
    const jobText = cleanHtml(html).slice(0, 8000);
    console.timeEnd("3 clean html");

    console.log("jobText length:", jobText.length);
    console.log("jobText preview:", jobText.slice(0, 300));

    if (jobText.length < 300) {
      console.timeEnd("total analyze-job-url");
      return NextResponse.json(
        { error: fallbackMessage() },
        { status: 422 }
      );
    }

    console.time("4 openai analyze");
    const aiResponse = await client.responses.create({
      model: JOB_ANALYSIS_MODEL,
      input: `
Analyze this job posting page text and return ONLY valid JSON.

Return this exact JSON structure:

{
  "title": "",
  "company": "",
  "location": "",
  "type": "",
  "category": "",
  "icon": "",
  "match": "",
  "keywordCount": 0,
  "requirementsMatched": 0,
  "keywords": [],
  "summary": "",

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
      "kind": "experience | education | certification | licence | language | software | equipment | technical_skill | drivers_licence | travel | schedule | security_screening | work_authorization | other",
      "regulated": false
    }
  ],

  "experienceRequirement": {
    "minimumYears": null,
    "description": "",
    "mandatory": false
  },

  "educationRequirement": {
    "level": "",
    "fieldOfStudy": "",
    "mandatory": false,
    "explanation": ""
  },

  "regulatedRole": {
    "isRegulated": false,
    "profession": "",
    "jurisdiction": "",
    "requiredLicence": "",
    "requirementLevel": "mandatory | preferred | not_required | unclear"
  },

  "bilingualRequirement": {
    "level": "mandatory | preferred | not_required | unclear",
    "languages": [],
    "explanation": ""
  },

  "scheduleRequirement": {
    "dayShift": false,
    "eveningShift": false,
    "nightShift": false,
    "rotatingShift": false,
    "weekendWork": false,
    "holidayWork": false,
    "requirementLevel": "mandatory | preferred | not_required | unclear",
    "explanation": ""
  },

  "driversLicenceRequirement": {
    "required": false,
    "licenceClass": "",
    "preferred": false,
    "explanation": ""
  },

  "mobilityRequirement": {
    "travelRequired": false,
    "relocationRequired": false,
    "ownVehicleRequired": false,
    "explanation": ""
  },

  "softwareRequirements": [],
  "equipmentRequirements": [],
  "technicalSkillRequirements": [],
  "securityRequirements": [],

  "jobDetails": {
    "description": "",
    "responsibilities": [],
    "qualifications": [],
    "benefits": [],
    "salary": "",
    "schedule": "",
    "applyUrl": ""
  }
}

Rules:
- Detect the real job title.
- Detect the real company if available.
- Detect location if available.
- Detect employment type.
- Category should be broad, such as Aviation, Legal, Admin, Nanny, Cleaning, Trades, HR, IT, Healthcare, Retail, Food Service, Management, Government, etc.
- icon should be one emoji that matches the job.
- Set match to "--".
- Set requirementsMatched to 0.
- keywordCount must equal the number of keywords returned.
- This endpoint analyzes the job posting only and does not compare it with a candidate resume.
- keywords should include 5 to 8 important ATS keywords.
- summary should be 1-2 concise sentences.
- jobDetails.description should summarize the actual posting in 2-5 short paragraphs.
- jobDetails.responsibilities should include 3-10 actual duties or tasks from the posting.
- jobDetails.qualifications should include 3-10 requirements, skills, education, certificates, or experience items.
- jobDetails.benefits should include detected benefits only. If none are found, return [].
- jobDetails.salary should include wage or salary if available.
- jobDetails.schedule should include schedule, shifts, hours, or employment type if available.
- jobDetails.applyUrl must equal the Job URL.
- Ignore website menus, search filters, headers, footers, cookies, ads, and similar jobs.
- If this is a Job Bank posting, prioritize the actual title, employer, location, wage, employment type, education, experience, and tasks.

Canadian scope and job classification rules:

- Determine the country from the employer and job posting, not from the candidate's address.
- Career Élan currently supports only Canadian private-sector, provincial-government, and municipal-government postings.
- Canadian federal-government postings are not supported.

Set jobContext.country to:
- "Canada" when the posting is clearly for a Canadian position
- "Unknown" when Canada cannot be established from the posting

Set jobContext.sector to exactly one of:
- "private"
- "provincial"
- "municipal"
- "federal"
- "unknown"

Use "private" for:
- private companies
- non-profit organizations
- charities
- privately operated clinics, law firms, stores, manufacturers, contractors, and similar employers
unless the posting clearly identifies a provincial or municipal public employer

Use "provincial" for:
- a Canadian provincial government
- a provincial ministry
- a provincial agency, board, commission, or Crown body when the posting clearly belongs to the provincial public service

Use "municipal" for:
- a city
- town
- municipality
- regional municipality
- county
- local public authority when clearly operated as municipal government

Use "federal" for:
- Government of Canada
- GC Jobs
- Public Service Commission of Canada
- a federal department
- a federal agency
- a federal Crown employer when the posting is part of the federal public-service application process

For federal postings:
- jobContext.country must be "Canada"
- jobContext.sector must be "federal"
- jobContext.supportedByCareerElan must be false

For Canadian private, provincial, or municipal postings:
- jobContext.country must be "Canada"
- jobContext.supportedByCareerElan must be true

For unknown or non-Canadian postings:
- jobContext.supportedByCareerElan must be false

jobContext.province:
- Return the full Canadian province or territory name when identifiable.
- Otherwise return an empty string.

jobContext.municipality:
- Return the city, town, municipality, or regional municipality when identifiable.
- Otherwise return an empty string.

jobContext.classificationReason:
- Explain the classification in one concise factual sentence.
- Base the reason on the employer or posting.
- Do not refer to the candidate's address.

Requirement classification rules:

- Return the important job requirements in requirements.
- Do not put duties or benefits into requirements.
- Avoid duplicates.
- Each requirement must use exactly one category.

Use "mandatory" when the posting uses language such as:
- required
- must
- minimum
- mandatory
- shall
- condition of employment

Use "preferred" when the posting uses language such as:
- preferred
- asset
- desirable
- considered an advantage
- nice to have

Use "legal_or_regulated" when the requirement is a legally required or regulated qualification, including:
- professional licence
- provincial registration
- security guard licence
- nursing registration
- professional engineering registration
- teacher certification
- regulated legal status
- compulsory trade certification
- any licence or registration required by law or a provincial regulator

Do not classify ordinary employer preferences as legal_or_regulated.
Return approximately 3 to 12 important requirements, depending on the posting.

Detailed job-analysis rules:

Analyze the posting before summarizing it.

Identify:

- main business need
- major responsibilities
- mandatory requirements
- preferred requirements
- required years of experience
- education level
- required field of study
- certifications
- licences
- legally regulated status
- security screening or clearance
- bilingual or multilingual requirements
- day shift
- evening shift
- night shift
- rotating shift
- weekend work
- holiday work
- driver's licence
- vehicle requirements
- travel requirements
- relocation requirements
- software
- equipment
- technical skills
- repeated ATS keywords

Do not confuse duties with candidate requirements.

Do not classify a requirement as legal_or_regulated merely because the employer says it is required.

Use legal_or_regulated only when the credential, registration, licence, or status is legally controlled by a government or professional regulator.

For experienceRequirement.minimumYears:
- return the explicit minimum number when stated
- otherwise return null
- do not guess

For educationRequirement:
- separate the education level from the field of study
- preserve alternatives such as "degree or equivalent experience"
- do not make education mandatory unless the posting presents it as mandatory

For bilingualRequirement:
- distinguish mandatory from preferred
- return the exact languages mentioned
- do not infer bilingual requirements from the location

For scheduleRequirement:
- mark only schedules explicitly stated or clearly required
- distinguish mandatory availability from general business hours
- do not assume availability from employment type

For softwareRequirements and equipmentRequirements:
- include only tools explicitly mentioned in the posting
- do not infer common software

For securityRequirements:
- distinguish background checks from formal security clearances
- do not treat a criminal-record check as a security clearance

Job URL:
${finalUrl}

Page text:
${jobText}

Remember: Return ONLY valid JSON.
      `,
    });
    console.timeEnd("4 openai analyze");

    console.time("5 parse json");
    const json =
  extractJson(
    aiResponse.output_text
  ) as JobAnalysisResponse;

    json.jobDetails = {
      description: json.jobDetails?.description || "",
      responsibilities: Array.isArray(json.jobDetails?.responsibilities)
        ? json.jobDetails.responsibilities
        : [],
      qualifications: Array.isArray(json.jobDetails?.qualifications)
        ? json.jobDetails.qualifications
        : [],
      benefits: Array.isArray(json.jobDetails?.benefits)
        ? json.jobDetails.benefits
        : [],
      salary: json.jobDetails?.salary || "",
      schedule: json.jobDetails?.schedule || json.type || "",
      applyUrl: finalUrl,
    };
    json.jobContext = {
  country:
    json.jobContext?.country ===
      "Canada"
      ? "Canada"
      : "Unknown",

  sector: [
    "private",
    "provincial",
    "municipal",
    "federal",
    "unknown",
  ].includes(
    json.jobContext?.sector
  )
    ? json.jobContext.sector
    : "unknown",

  province:
    typeof json.jobContext
      ?.province === "string"
      ? json.jobContext.province.trim()
      : "",

  municipality:
    typeof json.jobContext
      ?.municipality === "string"
      ? json.jobContext.municipality.trim()
      : "",

  supportedByCareerElan:
    json.jobContext
      ?.supportedByCareerElan === true,

  classificationReason:
    typeof json.jobContext
      ?.classificationReason ===
      "string"
      ? json.jobContext
          .classificationReason
          .trim()
      : "",
};

if (
  json.jobContext.country !==
    "Canada" ||
  json.jobContext.sector ===
    "federal" ||
  json.jobContext.sector ===
    "unknown"
) {
  json.jobContext
    .supportedByCareerElan = false;
}

if (
  json.jobContext.country ===
    "Canada" &&
  [
    "private",
    "provincial",
    "municipal",
  ].includes(
    json.jobContext.sector
  )
) {
  json.jobContext
    .supportedByCareerElan = true;
}

const validRequirementKinds = [
  "experience",
  "education",
  "certification",
  "licence",
  "language",
  "software",
  "equipment",
  "technical_skill",
  "drivers_licence",
  "travel",
  "schedule",
  "security_screening",
  "work_authorization",
  "other",
] as const;

json.requirements = Array.isArray(
  json.requirements
)
  ? json.requirements
      .filter(
        (item: any) =>
          item &&
          typeof item === "object" &&
          typeof item.requirement === "string" &&
          item.requirement.trim()
      )
      .slice(0, 20)
      .map((item: any) => ({
        requirement:
          item.requirement.trim(),

        category:
          item.category === "preferred" ||
          item.category === "legal_or_regulated"
            ? item.category
            : "mandatory",

        kind:
          validRequirementKinds.includes(
            item.kind
          )
            ? item.kind
            : "other",

        regulated:
          item.category ===
            "legal_or_regulated" ||
          item.regulated === true,
      }))
  : [];
  json.experienceRequirement = {
  minimumYears:
    typeof json.experienceRequirement
      ?.minimumYears === "number" &&
    Number.isFinite(
      json.experienceRequirement.minimumYears
    )
      ? Math.max(
          0,
          json.experienceRequirement.minimumYears
        )
      : null,

  description:
    typeof json.experienceRequirement
      ?.description === "string"
      ? json.experienceRequirement.description.trim()
      : "",

  mandatory:
    json.experienceRequirement
      ?.mandatory === true,
};

json.educationRequirement = {
  level:
    typeof json.educationRequirement
      ?.level === "string"
      ? json.educationRequirement.level.trim()
      : "",

  fieldOfStudy:
    typeof json.educationRequirement
      ?.fieldOfStudy === "string"
      ? json.educationRequirement.fieldOfStudy.trim()
      : "",

  mandatory:
    json.educationRequirement
      ?.mandatory === true,

  explanation:
    typeof json.educationRequirement
      ?.explanation === "string"
      ? json.educationRequirement.explanation.trim()
      : "",
};

json.regulatedRole = {
  isRegulated:
    json.regulatedRole?.isRegulated === true,

  profession:
    typeof json.regulatedRole
      ?.profession === "string"
      ? json.regulatedRole.profession.trim()
      : "",

  jurisdiction:
    typeof json.regulatedRole
      ?.jurisdiction === "string"
      ? json.regulatedRole.jurisdiction.trim()
      : "",

  requiredLicence:
    typeof json.regulatedRole
      ?.requiredLicence === "string"
      ? json.regulatedRole.requiredLicence.trim()
      : "",

  requirementLevel: [
    "mandatory",
    "preferred",
    "not_required",
    "unclear",
  ].includes(
    json.regulatedRole?.requirementLevel
  )
    ? json.regulatedRole.requirementLevel
    : "unclear",
};

json.bilingualRequirement = {
  level: [
    "mandatory",
    "preferred",
    "not_required",
    "unclear",
  ].includes(
    json.bilingualRequirement?.level
  )
    ? json.bilingualRequirement.level
    : "unclear",

  languages: Array.isArray(
    json.bilingualRequirement?.languages
  )
    ? json.bilingualRequirement.languages
        .filter(
          (item: unknown) =>
            typeof item === "string" &&
            item.trim()
        )
        .map((item: string) =>
          item.trim()
        )
    : [],

  explanation:
    typeof json.bilingualRequirement
      ?.explanation === "string"
      ? json.bilingualRequirement.explanation.trim()
      : "",
};

json.scheduleRequirement = {
  dayShift:
    json.scheduleRequirement?.dayShift === true,

  eveningShift:
    json.scheduleRequirement?.eveningShift === true,

  nightShift:
    json.scheduleRequirement?.nightShift === true,

  rotatingShift:
    json.scheduleRequirement?.rotatingShift === true,

  weekendWork:
    json.scheduleRequirement?.weekendWork === true,

  holidayWork:
    json.scheduleRequirement?.holidayWork === true,

  requirementLevel: [
    "mandatory",
    "preferred",
    "not_required",
    "unclear",
  ].includes(
    json.scheduleRequirement?.requirementLevel
  )
    ? json.scheduleRequirement.requirementLevel
    : "unclear",

  explanation:
    typeof json.scheduleRequirement
      ?.explanation === "string"
      ? json.scheduleRequirement.explanation.trim()
      : "",
};
json.driversLicenceRequirement = {
  required:
    json.driversLicenceRequirement?.required === true,

  licenceClass:
    typeof json.driversLicenceRequirement?.licenceClass === "string"
      ? json.driversLicenceRequirement.licenceClass.trim()
      : "",

  preferred:
    json.driversLicenceRequirement?.preferred === true,

  explanation:
    typeof json.driversLicenceRequirement?.explanation === "string"
      ? json.driversLicenceRequirement.explanation.trim()
      : "",
};

json.mobilityRequirement = {
  travelRequired:
    json.mobilityRequirement?.travelRequired === true,

  relocationRequired:
    json.mobilityRequirement?.relocationRequired === true,

  ownVehicleRequired:
    json.mobilityRequirement?.ownVehicleRequired === true,

  explanation:
    typeof json.mobilityRequirement?.explanation === "string"
      ? json.mobilityRequirement.explanation.trim()
      : "",
};


json.softwareRequirements =
  normalizeStringList(
    json.softwareRequirements
  );

json.equipmentRequirements =
  normalizeStringList(
    json.equipmentRequirements
  );

json.technicalSkillRequirements =
  normalizeStringList(
    json.technicalSkillRequirements
  );

json.securityRequirements =
  normalizeStringList(
    json.securityRequirements
  );

    json.keywordCount = Array.isArray(json.keywords) ? json.keywords.length : 0;
    console.timeEnd("5 parse json");

    console.timeEnd("total analyze-job-url");
    json.keywords = normalizeStringList(
  json.keywords,
  8
);

json.keywordCount =
  json.keywords.length;

json.match = "--";
json.requirementsMatched = 0;
    return NextResponse.json(json);
  } catch (error) {
    console.timeEnd("total analyze-job-url");

    return toSafeResponse(error, {
      requestId,
      route: "/api/analyze-job-url",
    });
  }
}