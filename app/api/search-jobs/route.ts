import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { checkRateLimit } from "@/lib/security/rateLimiter";

type JSearchJob = {
  job_id?: string;
  job_title?: string;
  employer_name?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_employment_type?: string;
  job_description?: string;
  job_apply_link?: string;
  job_google_link?: string;
  job_posted_at_datetime_utc?: string;
  job_min_salary?: number;
  job_max_salary?: number;
  job_salary_currency?: string;
  job_publisher?: string;
  employer_logo?: string;
};

/*
  Career-wide category taxonomy (V1) - deterministic classification of the
  JOB POSTING itself, derived only from job_title/job_description already
  returned by JSearch. No OpenAI, no Career Memory, no external API, no DB.
  See the Find Jobs Category Taxonomy design audit for the full rationale
  behind these 16 categories and their signal lists - this is the V1
  implementation of that spec: STRONG title phrases score highest, MEDIUM
  title/STRONG description phrases score moderately, MEDIUM description
  words score lowest, and a category only qualifies for inclusion once its
  total score clears MIN_QUALIFYING_SCORE (this is what keeps a single
  generic word like "coordinator" or an incidental description mention
  from silently tagging a job). Deliberately excludes employer_name/
  location/employment_type as classification input - those describe the
  employer or logistics, not the occupation itself.
*/
type CategoryDefinition = {
  id: string;
  titleStrong: string[];
  titleMedium: string[];
  descriptionStrong: string[];
  descriptionMedium: string[];
};

const CATEGORY_TAXONOMY: CategoryDefinition[] = [
  {
    id: "business-finance-admin",
    titleStrong: [
      "administrative assistant", "executive assistant", "office administrator",
      "office manager", "accountant", "bookkeeper", "human resources",
      "hr coordinator", "hr generalist", "payroll", "data entry clerk",
      "receptionist", "administrative coordinator", "office clerk",
    ],
    titleMedium: ["administrative", "admin", "bookkeeping"],
    descriptionStrong: ["accounts payable", "accounts receivable", "human resources"],
    descriptionMedium: ["administrative duties", "office support", "data entry"],
  },
  {
    id: "legal",
    titleStrong: [
      "law clerk", "paralegal", "legal assistant", "legal administrative assistant",
      "legal counsel", "litigation assistant", "notary public", "articling student",
    ],
    titleMedium: ["legal", "litigation", "notary"],
    descriptionStrong: ["law clerk", "paralegal", "litigation support"],
    descriptionMedium: ["legal documents", "legal research"],
  },
  {
    id: "customer-retail-sales",
    titleStrong: [
      "customer service representative", "retail sales associate", "sales associate",
      "customer service", "call centre agent", "call center agent", "account executive",
      "sales representative", "cashier",
    ],
    titleMedium: ["customer service", "retail", "sales", "cashier"],
    descriptionStrong: ["customer service", "point of sale"],
    descriptionMedium: ["retail experience", "sales targets"],
  },
  {
    id: "technology-it",
    titleStrong: [
      "software developer", "software engineer", "web developer", "full stack developer",
      "front end developer", "back end developer", "it support", "systems administrator",
      "data analyst", "data scientist", "devops engineer", "qa engineer", "network administrator",
    ],
    titleMedium: ["developer", "programmer", "software", "sysadmin"],
    descriptionStrong: ["software development", "programming languages"],
    descriptionMedium: ["coding", "javascript", "python"],
  },
  {
    id: "engineering",
    titleStrong: [
      "mechanical engineer", "civil engineer", "electrical engineer", "structural engineer",
      "engineering technician", "engineering technologist", "process engineer", "sales engineer",
    ],
    titleMedium: ["engineer", "engineering"],
    descriptionStrong: ["engineering design", "cad drawings"],
    descriptionMedium: ["blueprint", "technical drawings"],
  },
  {
    id: "science-research",
    titleStrong: [
      "research scientist", "laboratory technician", "lab technician", "research assistant",
      "biologist", "chemist", "medical laboratory technologist", "clinical research",
    ],
    titleMedium: ["scientist", "researcher", "laboratory"],
    descriptionStrong: ["laboratory experiments", "research study"],
    descriptionMedium: ["scientific method", "data collection"],
  },
  {
    id: "healthcare",
    titleStrong: [
      "registered nurse", "registered practical nurse", "personal support worker",
      "physician", "pharmacist", "dental hygienist", "medical laboratory technologist",
      "occupational therapist", "physiotherapist", "nurse practitioner",
    ],
    titleMedium: ["nurse", "nursing", "healthcare", "medical", "clinical", "dental", "psw"],
    descriptionStrong: ["patient care", "clinical setting"],
    descriptionMedium: ["healthcare facility", "hospital"],
  },
  {
    id: "education-social-community",
    titleStrong: [
      "early childhood educator", "elementary teacher", "high school teacher", "social worker",
      "youth worker", "community support worker", "teaching assistant", "school counsellor",
    ],
    titleMedium: ["teacher", "educator", "social work", "counsellor"],
    descriptionStrong: ["classroom instruction", "case management"],
    descriptionMedium: ["curriculum", "community outreach"],
  },
  {
    id: "skilled-trades-construction",
    titleStrong: [
      "electrician", "plumber", "carpenter", "welder", "hvac technician",
      "construction labourer", "construction worker", "millwright", "pipefitter",
      "heavy equipment mechanic", "farm equipment mechanic", "equipment mechanic",
    ],
    titleMedium: ["electrician", "plumbing", "carpentry", "welding", "construction", "mechanic", "trade"],
    descriptionStrong: ["red seal certification", "trade certification"],
    descriptionMedium: ["construction site", "apprenticeship"],
  },
  {
    id: "manufacturing-production",
    titleStrong: [
      "machine operator", "production worker", "assembler", "factory worker",
      "production supervisor", "quality control inspector", "fish plant worker",
    ],
    titleMedium: ["manufacturing", "production", "assembly", "factory", "plant worker"],
    descriptionStrong: ["production line", "assembly line"],
    descriptionMedium: ["quality control", "manufacturing facility"],
  },
  {
    id: "transportation-logistics",
    titleStrong: [
      "truck driver", "delivery driver", "warehouse associate", "forklift operator",
      "courier", "dispatcher", "logistics coordinator", "class 1 driver", "az driver",
    ],
    titleMedium: ["driver", "warehouse", "logistics", "delivery", "courier"],
    descriptionStrong: ["commercial driver's licence", "warehouse operations"],
    descriptionMedium: ["shipping and receiving", "inventory management"],
  },
  {
    id: "agriculture-forestry-fishing",
    titleStrong: [
      "farm worker", "farmer", "agricultural worker", "forestry worker", "logger",
      "commercial fisher", "fish plant worker", "fisher", "farmhand",
    ],
    titleMedium: ["farm", "agricultural", "forestry", "fishing", "fisher"],
    descriptionStrong: ["crop production", "livestock"],
    descriptionMedium: ["harvest season", "farming operations"],
  },
  {
    id: "natural-resources-mining",
    titleStrong: [
      "miner", "mining equipment operator", "drilling operator", "mine worker",
      "oil and gas technician",
    ],
    titleMedium: ["mining", "drilling", "quarry"],
    descriptionStrong: ["mining operations", "underground mine"],
    descriptionMedium: ["extraction", "mineral processing"],
  },
  {
    id: "hospitality-food-service",
    titleStrong: [
      "cook", "chef", "server", "bartender", "hotel front desk", "kitchen helper",
      "line cook", "sous chef", "barista",
    ],
    titleMedium: ["cook", "chef", "server", "hospitality", "kitchen", "hotel"],
    descriptionStrong: ["food preparation", "kitchen environment"],
    descriptionMedium: ["food safety", "restaurant experience"],
  },
  {
    id: "security-cleaning-general-labour",
    titleStrong: [
      "security guard", "cleaner", "janitor", "custodian", "general labourer",
      "housekeeping attendant", "general labour",
    ],
    titleMedium: ["security", "cleaning", "custodial", "housekeeping", "labourer"],
    descriptionStrong: ["security patrol", "janitorial duties"],
    descriptionMedium: ["cleaning duties", "physical labour"],
  },
  {
    id: "arts-culture-recreation",
    titleStrong: [
      "graphic designer", "photographer", "fitness instructor", "event coordinator",
      "videographer", "art director", "personal trainer",
    ],
    titleMedium: ["designer", "photographer", "fitness", "instructor", "artist"],
    descriptionStrong: ["creative portfolio", "design software"],
    descriptionMedium: ["adobe creative", "photography"],
  },
];

const MIN_QUALIFYING_SCORE = 3;

function classifyJobCategories(title: string, description: string): string[] {
  const titleLower = (title || "").toLowerCase();
  const descriptionLower = (description || "").toLowerCase();

  const scores = CATEGORY_TAXONOMY.map((def, order) => {
    let score = 0;

    for (const phrase of def.titleStrong) {
      if (titleLower.includes(phrase)) {
        score += 10;
      }
    }

    for (const word of def.titleMedium) {
      if (titleLower.includes(word)) {
        score += 3;
      }
    }

    for (const phrase of def.descriptionStrong) {
      if (descriptionLower.includes(phrase)) {
        score += 4;
      }
    }

    for (const word of def.descriptionMedium) {
      if (descriptionLower.includes(word)) {
        score += 1;
      }
    }

    return { id: def.id, score, order };
  });

  return scores
    .filter((entry) => entry.score >= MIN_QUALIFYING_SCORE)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.order - b.order))
    .slice(0, 2)
    .map((entry) => entry.id);
}

function normalizeJob(job: JSearchJob) {
  const location = [job.job_city, job.job_state, job.job_country]
    .filter(Boolean)
    .join(", ");

  return {
    id: job.job_id || crypto.randomUUID(),
    title: job.job_title || "Untitled Job",
    company: job.employer_name || "Unknown Company",
    location: location || "Unknown location",
    type: job.job_employment_type || "Not specified",
    category: "General",
    categories: classifyJobCategories(job.job_title || "", job.job_description || ""),
    description: job.job_description || "",
    url: job.job_apply_link || job.job_google_link || "",
    posted: job.job_posted_at_datetime_utc || "",
    salary:
      job.job_min_salary || job.job_max_salary
        ? `${job.job_salary_currency || ""} ${Math.round(
            job.job_min_salary || 0
          )} - ${Math.round(job.job_max_salary || 0)}`
        : "Not listed",
    source: job.job_publisher || "JSearch",
    logo: job.employer_logo || "",
  };
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Unauthorized." },
        { status: 401 }
      );
    }

    const rateLimitResult = await checkRateLimit("search-jobs", {
      userId: user.id,
      requestHeaders: req.headers,
    });

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: "Too many search requests. Please try again shortly.",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimitResult.retryAfterSeconds),
          },
        }
      );
    }

    const { searchParams } = new URL(req.url);

    const query = searchParams.get("q") || "administrative assistant";

    const countryCode = (
  searchParams.get("country") || "CA"
).toUpperCase();

const province =
  searchParams.get("province")?.trim() || "";

const city =
  searchParams.get("city")?.trim() || "";

const countryNameMap: Record<string, string> = {
  CA: "Canada",
  US: "United States",
  GB: "United Kingdom",
  AU: "Australia",
};

const countryName =
  countryNameMap[countryCode] || "Canada";

    const page = searchParams.get("page") || "1";

    const jobType = searchParams.get("jobType") || "";
    const datePosted = searchParams.get("datePosted") || "";
    const categoryFilter = searchParams.get("category") || "";

    const apiKey = process.env.RAPIDAPI_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Missing RAPIDAPI_KEY. Add it to .env.local and Vercel environment variables.",
        },
        { status: 500 }
      );
    }

    

    const parts = [query.trim() || "administrative assistant"];

if (jobType) {
  parts.push(jobType);
}

parts.push("jobs");

if (city) {
  parts.push("in", city);
}

if (province) {
  parts.push(province);
}

parts.push(countryName);

const searchQuery = parts.join(" ");

   

    const url = new URL("https://jsearch.p.rapidapi.com/search-v2");

    url.searchParams.set("query", searchQuery);
    url.searchParams.set("page", page);
    url.searchParams.set("num_pages", "1");
    url.searchParams.set(
  "country",
  countryCode.toLowerCase()
);

    if (datePosted) {
      url.searchParams.set("date_posted", datePosted);
    }

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": "jsearch.p.rapidapi.com",
      },
      cache: "no-store",
    });

    if (res.status === 429) {
      return NextResponse.json(
        {
          error:
            "Job search service is temporarily unavailable because the monthly search limit has been reached.",
        },
        { status: 429 }
      );
    }

    if (!res.ok) {
      const errorText = await res.text();

      return NextResponse.json(
        {
          error: errorText,
          status: res.status,
        },
        { status: res.status }
      );
    }

    const data = await res.json();

    const rawJobs = Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.data?.jobs)
      ? data.data.jobs
      : Array.isArray(data.jobs)
      ? data.jobs
      : [];

    const jobs = Array.from(
      new Map(
        rawJobs
          .map(normalizeJob)
          .map((job: any) => [
            `${job.title}-${job.company}-${job.location}`.toLowerCase(),
            job,
          ])
      ).values()
    );

    /*
      V1 category filtering applies only to the currently fetched provider
      page; pagination enrichment is intentionally deferred (see the
      taxonomy design audit's pagination analysis - fetching additional
      provider pages to backfill a sparse category filter is a deliberate
      V2+ improvement, out of scope here). The category is never appended
      to the provider "query" string above - it is applied only to the
      already-normalized/classified results, so the user's own search
      intent is never rewritten.
    */
    const filteredJobs =
      categoryFilter && categoryFilter !== "All" && categoryFilter !== "All Jobs"
        ? jobs.filter((job: any) =>
            Array.isArray(job.categories) && job.categories.includes(categoryFilter)
          )
        : jobs;

    return NextResponse.json({
      jobs: filteredJobs,
      count: filteredJobs.length,
      page: Number(page),
      source: `JSearch ${countryName}`,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Failed to search jobs.",
      },
      {
        status: 500,
      }
    );
  }
}