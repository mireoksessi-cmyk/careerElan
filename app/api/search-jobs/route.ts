import { NextResponse } from "next/server";

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
    match: Math.floor(Math.random() * 16) + 80,
  };
}

export async function GET(req: Request) {
  try {
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

    return NextResponse.json({
      jobs,
      count: jobs.length,
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