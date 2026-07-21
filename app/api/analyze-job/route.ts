import OpenAI from "openai";
import { NextResponse } from "next/server";
import { toSafeResponse } from "@/lib/errors/publicError";
import { JOB_ANALYSIS_MODEL } from "@/lib/config/aiModels";
import { createClient } from "@/lib/supabase-server";
import { checkRateLimit, resolveOptionalUserId } from "@/lib/security/rateLimiter";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type RequirementCategory =
  | "mandatory"
  | "preferred"
  | "legal_or_regulated";

type AnalyzedRequirement = {
  requirement: string;
  category: RequirementCategory;
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

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    /*
      Guest-allowed endpoint - having no session never blocks the request,
      it only decides which rate-limit bucket applies. resolveOptionalUserId
      distinguishes a genuine "no session" from an auth-service failure,
      so a real logged-in user is never silently downgraded to the shared
      guest IP bucket just because the session check itself had trouble.
      Never trust a client-supplied user id here.
    */
    const supabase = await createClient();
    const userId = await resolveOptionalUserId(supabase);

    const rateLimitResult = await checkRateLimit("analyze-job", {
      userId,
      requestHeaders: req.headers,
    });

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: "Too many analysis requests. Please try again shortly.",
          requestId,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimitResult.retryAfterSeconds),
          },
        }
      );
    }

    const { jobText } = await req.json();

    if (!jobText || typeof jobText !== "string") {
      return NextResponse.json(
        { error: "Job text is required." },
        { status: 400 }
      );
    }

    const response = await client.responses.create({
      model: JOB_ANALYSIS_MODEL,
      input: `
Analyze this job posting and return ONLY valid JSON.

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
    "country": "Canada",
    "sector": "private",
    "province": "",
    "municipality": "",
    "supportedByCareerElan": true,
    "classificationReason": ""
  },

  "requirements": [
    {
      "requirement": "",
      "category": "mandatory"
    }
  ]
}

Rules:
- Detect the real job title.
- Detect the company if available.
- Detect location if available.
- Detect employment type.
- Category should be broad, such as Aviation, Legal, Admin, Nanny, Cleaning, Trades, HR, IT, Healthcare, Retail, Food Service, Management, Government, etc.
- icon should be one emoji that matches the job.
- match should be a percentage string like "86%".
- keywordCount must equal the number of keywords returned.
- requirementsMatched should be a realistic number from 1 to 10.
- keywords should include 5 to 8 important ATS keywords.
- summary should be 1-2 concise sentences.

Job posting:
${jobText}
      `,
    });

    const json =
  extractJson(
    response.output_text
  ) as JobAnalysisResponse;

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
      ? json.jobContext
          .municipality
          .trim()
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

json.requirements = Array.isArray(
  json.requirements
)
  ? json.requirements
      .filter(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof item.requirement ===
            "string" &&
          item.requirement.trim()
            .length > 0
      )
      .slice(0, 12)
      .map((item) => ({
        requirement:
          item.requirement.trim(),

        category:
          item.category ===
            "preferred" ||
          item.category ===
            "legal_or_regulated"
            ? item.category
            : "mandatory",
      }))
  : [];

json.keywords =
  Array.isArray(json.keywords)
    ? json.keywords
        .filter(
          (item) =>
            typeof item ===
              "string" &&
            item.trim().length > 0
        )
        .slice(0, 8)
    : [];

json.keywordCount =
  json.keywords.length;

return NextResponse.json(json);
  } catch (error) {
    return toSafeResponse(error, {
      requestId,
      route: "/api/analyze-job",
    });
  }
}