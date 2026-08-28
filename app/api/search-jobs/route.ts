import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { checkRateLimit } from "@/lib/security/rateLimiter";
import {
  recordExternalApiUsage,
  classifyExternalHttpStatus,
} from "@/lib/externalApi/usageTelemetry";
import {
  buildJobSearchLookupKey,
  readJobSearchLookup,
  writeJobSearchLookup,
} from "@/lib/jobSearch/lookupCache";

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

    /*
      The label the UI shows on this page. Echoed back untouched and never
      used to address the provider - /search-v2 has no page-number
      pagination (proven: `page` is not echoed in its parameters and a
      page=2 request returned the same postings as page=1). Position in the
      result set is carried entirely by `cursor` below.
    */
    const page = searchParams.get("page") || "1";

    /*
      The provider's own continuation token, handed back exactly as it was
      received from a previous response. Empty means "start at the
      beginning", which is expressed upstream by sending no cursor at all.
      Never parsed, decoded or arithmetically advanced here.
    */
    const requestCursor = searchParams.get("cursor")?.trim() || "";

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

   

    /*
      fetchJSearchProviderPage() is the single fetch this route has always
      made, extracted so category enrichment can reach one further page
      within a single request - by cursor, never by page number.
      dedupeNormalizedJobs()/extractRawJobs() are the unchanged dedup key
      (title-company-location) and rawJobs-shape detection, pulled out so
      they can run once against a single page and, when enrichment triggers,
      again against the merged [primary, enrichment] array.
    */
    const resolvedApiKey = apiKey;

    /*
      A plain occupation query with no city, filter or date is the same
      question however many people ask it - see lib/jobSearch/lookupCache.ts.
      A hit here is the difference between six upstream calls per cold
      dashboard and none. null means the request carries something personal
      or narrowing and must go upstream as it always did.
    */
    const rootLookupKey = () =>
      buildJobSearchLookupKey({
        query,
        countryCode,
        city,
        province,
        jobType,
        category: categoryFilter,
        datePosted,
      });

    /*
      One upstream request. `cursor` is null for the first page of a search,
      in which case none is sent - that omission is what asks the provider
      for the beginning of the result set. No page number and no num_pages
      are sent for pagination: the provider ignores the former and defaults
      the latter, and supplying either would only re-create the page-number
      model that was proven not to advance the results.
    */
    const fetchJSearchProviderPage = async (cursor: string | null) => {
      const pageUrl = new URL("https://jsearch.p.rapidapi.com/search-v2");

      pageUrl.searchParams.set("query", searchQuery);
      pageUrl.searchParams.set("country", countryCode.toLowerCase());

      if (cursor) {
        pageUrl.searchParams.set("cursor", cursor);
      }

      if (datePosted) {
        pageUrl.searchParams.set("date_posted", datePosted);
      }

      /*
        API-C1 - recorded here rather than at the route entry, because this
        is what RapidAPI actually bills. One Career Élan search can call
        this function more than once (see the pagination-enrichment note
        above), and each of those is a separate upstream request that will
        appear on the invoice - so each writes its own row.

        The URL is never passed to telemetry: it carries the user's search
        text. Only the fact of the request, its outcome and how long it took
        are recorded.
      */
      const startedAt = Date.now();

      try {
        const response = await fetch(pageUrl.toString(), {
          method: "GET",
          headers: {
            "x-rapidapi-key": resolvedApiKey,
            "x-rapidapi-host": "jsearch.p.rapidapi.com",
          },
          cache: "no-store",
        });

        await recordExternalApiUsage({
          provider: "rapidapi_jsearch",
          operation: "JOB_SEARCH",
          status: response.ok ? "success" : "error",
          httpStatusClass: classifyExternalHttpStatus(response.status),
          durationMs: Date.now() - startedAt,
          userId: user.id,
        });

        return response;
      } catch (requestError) {
        /*
          The request left this process and did not come back with a status -
          a network failure or timeout. Still counted, because whether
          RapidAPI billed for it is not knowable from here and quietly
          dropping it would understate usage. Rethrown unchanged so the
          route's own error handling is untouched.
        */
        await recordExternalApiUsage({
          provider: "rapidapi_jsearch",
          operation: "JOB_SEARCH",
          status: "error",
          httpStatusClass: "network",
          durationMs: Date.now() - startedAt,
          userId: user.id,
        });

        throw requestError;
      }
    };

    /*
      The provider page, from the shared cache when the request is one of the
      plain personless ones and a fresh entry exists, otherwise upstream as
      before. A cache hit costs no upstream call and writes no telemetry row,
      because no upstream request happened - the usage figures stay a record
      of what the provider was actually asked, not of what this route served.

      Failures are returned rather than thrown so the caller's existing 429
      and non-2xx handling stays exactly as it was.
    */
    const loadProviderPage = async (
      cursor: string | null
    ): Promise<
      | { ok: true; data: any; cached: boolean }
      | { ok: false; status: number; body: string }
    > => {
      /*
        Only the first page of a search is ever shared between people. A
        cursor is a continuation token the provider issued to one request,
        and nothing has been established about whether it can be replayed
        by a different session, by a different person, or half an hour
        later - so a request carrying one goes upstream every time rather
        than resting on an assumption that has not been tested.
      */
      const lookupKey = cursor ? null : rootLookupKey();

      if (lookupKey) {
        const cached = await readJobSearchLookup(lookupKey);
        if (cached) return { ok: true, data: cached, cached: true };
      }

      const response = await fetchJSearchProviderPage(cursor);

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          body: await response.text(),
        };
      }

      const data = await response.json();

      if (lookupKey) {
        await writeJobSearchLookup(lookupKey, data);
      }

      return { ok: true, data, cached: false };
    };

    function extractRawJobs(data: any): JSearchJob[] {
      return Array.isArray(data.data)
        ? data.data
        : Array.isArray(data.data?.jobs)
        ? data.data.jobs
        : Array.isArray(data.jobs)
        ? data.jobs
        : [];
    }

    function dedupeNormalizedJobs(rawJobs: JSearchJob[]) {
      return Array.from(
        new Map(
          rawJobs
            .map(normalizeJob)
            .map((job: any) => [
              `${job.title}-${job.company}-${job.location}`.toLowerCase(),
              job,
            ])
        ).values()
      );
    }

    /*
      The provider's continuation token for the page after the one in a
      given response, or null when it did not offer one. The only place a
      cursor is ever read from - the shape was confirmed against two live
      responses (data.cursor, an opaque ~590-character string).
    */
    function extractNextCursor(data: any): string | null {
      const cursor = data?.data?.cursor;
      return typeof cursor === "string" && cursor.trim() ? cursor : null;
    }

    const res = await loadProviderPage(requestCursor || null);

    if (!res.ok && res.status === 429) {
      return NextResponse.json(
        {
          error:
            "Job search service is temporarily unavailable because the monthly search limit has been reached.",
        },
        { status: 429 }
      );
    }

    if (!res.ok) {
      return NextResponse.json(
        {
          error: res.body,
          status: res.status,
        },
        { status: res.status }
      );
    }

    const data = res.data;
    const primaryRawJobs = extractRawJobs(data);

    const categoryActive =
      Boolean(categoryFilter) && categoryFilter !== "All" && categoryFilter !== "All Jobs";

    let jobs = dedupeNormalizedJobs(primaryRawJobs);
    let filteredJobs = categoryActive
      ? jobs.filter((job: any) =>
          Array.isArray(job.categories) && job.categories.includes(categoryFilter)
        )
      : jobs;
    let nextCursor = extractNextCursor(data);

    /*
      Category filtering can only work on postings already in hand, so when a
      category is active and this page yielded few matches, exactly ONE extra
      provider page may be pulled in. That page is now reached the only way
      the provider actually supports - the cursor this response returned -
      rather than by asking for the next page number, which never advanced
      the results.

      Strictly one extra request: no loop, and no chasing cursors until some
      target count is reached. When there is no cursor to follow, enrichment
      is simply skipped. The category is still never appended to the provider
      query string - it only ever filters already-normalized results.

      The enrichment page is consumed here, so the cursor handed back to the
      client advances past it. Returning the primary page's cursor instead
      would send the person's next click to postings they were already shown.
    */
    if (categoryActive && nextCursor && filteredJobs.length < 5) {
      try {
        const enrichRes = await fetchJSearchProviderPage(nextCursor);

        if (enrichRes.ok) {
          const enrichData = await enrichRes.json();
          const enrichRawJobs = extractRawJobs(enrichData);

          jobs = dedupeNormalizedJobs([...primaryRawJobs, ...enrichRawJobs]);
          filteredJobs = jobs.filter((job: any) =>
            Array.isArray(job.categories) && job.categories.includes(categoryFilter)
          );
          nextCursor = extractNextCursor(enrichData);
        }
        // Enrichment fetch returned a non-ok status - fall through and
        // return the already-successful primary-page results below,
        // exactly as if enrichment had never been attempted.
      } catch (enrichError) {
        console.error(enrichError);
        // Enrichment fetch failed outright - same graceful degradation:
        // keep the primary-page results, no user-facing error, no retry.
      }
    }

    return NextResponse.json({
      jobs: filteredJobs,
      count: filteredJobs.length,
      page: Number(page),
      source: `JSearch ${countryName}`,
      nextCursor,
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