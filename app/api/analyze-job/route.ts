import OpenAI from "openai";
import { NextResponse } from "next/server";
import { toSafeResponse } from "@/lib/errors/publicError";
import { JOB_ANALYSIS_MODEL } from "@/lib/config/aiModels";
import { createClient } from "@/lib/supabase-server";
import { checkRateLimit, resolveOptionalUserId } from "@/lib/security/rateLimiter";
import { validateSpecificJobPosting } from "@/lib/jobPosting/postingValidation";
import { classifyCanadaJobScope } from "@/lib/jobPosting/canadaScopeClassifier";
import { isE2eAiModeActive, wrapOpenAiClientForE2eSafety } from "@/lib/testing/e2eAiIsolation";
import { buildE2eJobAnalysisResponseText } from "@/lib/testing/e2eFakeResponses";
import { logOperationalEvent, elapsedMs } from "@/lib/observability/logger";

/*
  Phase 6I.6.34 - this was the one OpenAI call site in the codebase
  with no explicit maxRetries/timeout/maxDuration at all, so it
  silently inherited the openai SDK's own defaults (maxRetries=2,
  timeout=600_000ms) instead of this codebase's deliberate, narrow
  "maxRetries:0 + typed, bounded retry only where a wrapper decides
  to" policy used everywhere else (generateCore.ts,
  resumeAnalysisCore.ts, canonicalGeneratePackageService.ts). A bad
  request here (malformed job posting reliably producing a non-JSON
  response, or a persistent OpenAI 5xx) would silently retry twice
  using the SDK's own opaque backoff, and the whole route had no
  execution-time ceiling of its own. maxRetries:0 + an explicit
  per-call timeout below, plus `maxDuration` (matching
  analyze-cover-letter/route.ts's own precedent), closes that gap -
  no retry loop is added here since Analyze Job has never had one and
  a single deterministic-failure job posting must not be retried
  (Part AI/AK of that phase).
*/
const JOB_ANALYSIS_TIMEOUT_MS = 55_000;

export const maxDuration = 60;

const client = wrapOpenAiClientForE2eSafety(
  new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 0,
  })
);

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

  /*
    Phase 6I.6.22 - the authoritative 3-state classification (lib/
    jobPosting/canadaScopeClassifier.ts), computed deterministically
    from jobText below - never asked of the AI, never collapsed into
    just `supportedByCareerElan`. UNKNOWN is a real, distinct outcome
    (Part B) - the client must not treat it the same as UNSUPPORTED.
  */
  canadaScope: "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN";
  canadaScopeReason: string;

  /*
    Kept for existing-client compatibility, but now DERIVED from
    canadaScope (true only when canadaScope === "SUPPORTED") rather
    than independently AI-decided - a boolean cannot represent UNKNOWN,
    so this field alone must never be used to decide whether generation
    is allowed (see paste-job/page.tsx's isSupportedJob, which now reads
    canadaScope directly instead).
  */
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
  const startedAt = Date.now();

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

    /*
      Phase 6I.6.35 - E2E AI isolation: when isE2eAiModeActive(), return
      a deterministic synthetic response text instead of ever
      constructing the real prompt / calling client.responses.create().
      classifyCanadaJobScope(jobText) below is real, deterministic
      code (not AI) and still runs unchanged against whatever jobText
      the E2E test actually pasted, exactly as it does in production.
    */
    const responseOutputText = isE2eAiModeActive()
      ? buildE2eJobAnalysisResponseText()
      : (
          await client.responses.create({
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
          }, { timeout: JOB_ANALYSIS_TIMEOUT_MS, maxRetries: 0 })
        ).output_text;

    const json =
  extractJson(
    responseOutputText
  ) as JobAnalysisResponse;

/*
  Phase 6I.6.22 - country/canadaScope is now the deterministic
  classifyCanadaJobScope(jobText) result (lib/jobPosting/
  canadaScopeClassifier.ts), the SAME function legacy's
  generateCore.ts and canonical's canonicalGenerateDispatchService.ts
  call on this exact request's job text - never the AI's own guess at
  country (Part I: same evidence must produce the same classification
  everywhere). `sector` stays AI-derived (province/municipality/sector
  classification is a separate concern this phase doesn't change).
*/
const canadaScope = classifyCanadaJobScope(jobText);

json.jobContext = {
  country:
    canadaScope.status === "SUPPORTED"
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

  canadaScope: canadaScope.status,
  canadaScopeReason: canadaScope.reason,

  supportedByCareerElan:
    canadaScope.status === "SUPPORTED",

  classificationReason:
    typeof json.jobContext
      ?.classificationReason ===
      "string" &&
    json.jobContext.classificationReason.trim()
      ? json.jobContext
          .classificationReason
          .trim()
      : canadaScope.reason,
};

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

const postingValidation = validateSpecificJobPosting({
  title: json.title,
  company: json.company,
  requirements: json.requirements,
});

if (!postingValidation.valid) {
  return NextResponse.json(
    {
      success: false,
      supported: false,
      code: postingValidation.code,
      error: postingValidation.error,
    },
    { status: 422 }
  );
}

logOperationalEvent({ domain: "analyze_job", event: "succeeded", route: "analyze-job", latencyMs: elapsedMs(startedAt) });
return NextResponse.json({ ...json, success: true });
  } catch (error) {
    logOperationalEvent({ domain: "analyze_job", event: "failed", route: "analyze-job", errorCode: error instanceof Error ? error.constructor.name : "unknown", latencyMs: elapsedMs(startedAt) });
    return toSafeResponse(error, {
      requestId,
      route: "/api/analyze-job",
    });
  }
}