"use client";
import { useLogin } from "@/lib/auth/LoginManager";
import CareerElanFooter from "@/components/marketing/CareerElanFooter";
import MobileNav from "@/components/job-layout/MobileNav";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { searchJobs, type SearchJob } from "@/lib/services/search";
import { countries } from "@/lib/job-search/countries";
import { provinces } from "@/lib/job-search/provinces";
import {
  searchCities,
  type CitySuggestion,
} from "@/lib/job-search/cities";


type Job = {
  id: number;
  title: string;
  company: string;
  location: string;
  type: string;
  mode: string;
  category: string;
  match?: number;
  matched: string[];
  missing: string[];
  posted: string;
};

type DisplayJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  type: string;
  mode: string;
  categories: string[];
  match?: number;
  relevantExperience: string;
  keyRequirements: string[];
  thingsToCheck: string[];
  posted: string;
  url?: string;
  logo?: string;
  source?: string;
};

const menuItems = [
  { label: "Dashboard", href: "/dashboard", icon: "🏠" },
  { label: "Career Memory", href: "/career-memory", icon: "🧠" },
  { label: "Generate Package", href: "/create-package", icon: "📦" },
  { label: "Find Jobs", href: "/find-jobs", icon: "🔍" },
  { label: "Paste Job", href: "/paste-job", icon: "📋" },
  { label: "Job Tracker", href: "/job-tracker", icon: "💼" },
  { label: "Analytics", href: "/analytics", icon: "📊" },
  { label: "Settings", href: "/settings", icon: "⚙️" },
];

const statesByCountry = {
  Canada: [
    "Ontario",
    "British Columbia",
    "Alberta",
    "Quebec",
    "Manitoba",
    "Saskatchewan",
    "Nova Scotia",
    "New Brunswick",
    "Newfoundland and Labrador",
    "Prince Edward Island",
  ],

  "United States": [
    "California",
    "Texas",
    "Florida",
    "New York",
    "Ohio",
    "Illinois",
    "Washington",
  ],

  "United Kingdom": [
    "England",
    "Scotland",
    "Wales",
    "Northern Ireland",
  ],

  Australia: [
    "New South Wales",
    "Victoria",
    "Queensland",
    "Western Australia",
    "South Australia",
  ],
};

const countryNameByCode: Record<string, keyof typeof provinces> = {
  CA: "Canada",
  
};

/*
  Find Jobs category taxonomy (V1) - fixed ids/display names, must stay in
  sync with the identical list in app/api/search-jobs/route.ts. Order here
  is also the dropdown's display order ("All Jobs" first).
*/
const JOB_CATEGORIES: { id: string; display: string }[] = [
  { id: "business-finance-admin", display: "Business, Finance & Administration" },
  { id: "legal", display: "Legal" },
  { id: "customer-retail-sales", display: "Customer Service, Retail & Sales" },
  { id: "technology-it", display: "Technology & IT" },
  { id: "engineering", display: "Engineering" },
  { id: "science-research", display: "Science & Research" },
  { id: "healthcare", display: "Healthcare" },
  { id: "education-social-community", display: "Education & Social/Community Services" },
  { id: "skilled-trades-construction", display: "Skilled Trades & Construction" },
  { id: "manufacturing-production", display: "Manufacturing & Production" },
  { id: "transportation-logistics", display: "Transportation & Logistics" },
  { id: "agriculture-forestry-fishing", display: "Agriculture, Forestry & Fishing" },
  { id: "natural-resources-mining", display: "Natural Resources & Mining" },
  { id: "hospitality-food-service", display: "Hospitality & Food Service" },
  { id: "security-cleaning-general-labour", display: "Security, Cleaning & General Labour" },
  { id: "arts-culture-recreation", display: "Arts, Culture & Recreation" },
];

const JOB_CATEGORY_DISPLAY_BY_ID: Record<string, string> = Object.fromEntries(
  JOB_CATEGORIES.map((cat) => [cat.id, cat.display])
);




function formatPosted(posted: string) {
  if (!posted) return "Recently posted";
  const date = new Date(posted);
  if (Number.isNaN(date.getTime())) return posted;
  return date.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/*
  Trust/integrity fix: these three helpers describe the JOB POSTING itself
  (title/description/location text already returned by /api/search-jobs),
  never the user - Career Memory skills/experience/education are not read
  here, and none of this is AI-generated. Purely deterministic keyword
  inspection of the posting text, same lightweight pattern the previous
  matched/missing fields used, just reframed so the labels never claim a
  personal comparison that was never actually performed.
*/
function deriveRelevantExperience(job: SearchJob): string {
  const description = job.description?.toLowerCase() || "";
  const title = job.title?.toLowerCase() || "";

  const yearsMatch = description.match(/\b(\d+)\+?\s*(?:years?|yrs?)\b/);
  if (yearsMatch) {
    return `${yearsMatch[1]}+ years of experience mentioned in the posting`;
  }

  if (title.includes("admin")) {
    return "Administrative or office support experience may be relevant for this role";
  }

  if (description.includes("customer")) {
    return "Customer-facing or service experience may be relevant for this role";
  }

  return "Review the posting for experience requirements";
}

function deriveKeyRequirements(job: SearchJob): string[] {
  const description = job.description?.toLowerCase() || "";
  const title = job.title?.toLowerCase() || "";
  const requirements: string[] = [];

  if (description.includes("customer")) {
    requirements.push("Customer service");
  }

  if (/microsoft office|excel|word|powerpoint/.test(description)) {
    requirements.push("Microsoft Office proficiency mentioned");
  }

  if (description.includes("communication")) {
    requirements.push("Communication skills mentioned");
  }

  if (title.includes("admin") || description.includes("administrative")) {
    requirements.push("Administrative support");
  }

  if (description.includes("legal")) {
    requirements.push("Legal support experience mentioned");
  }

  return requirements.length > 0
    ? requirements.slice(0, 3)
    : ["Review the full posting for specific requirements"];
}

function deriveThingsToCheck(job: SearchJob): string[] {
  const description = job.description?.toLowerCase() || "";
  const checks: string[] = [];

  if (description.includes("french")) {
    checks.push("French is mentioned in the posting");
  }

  if (description.includes("experience")) {
    checks.push("Check the experience requirement");
  }

  if (
    description.includes("driver") ||
    description.includes("licence") ||
    description.includes("license")
  ) {
    checks.push("Driver's licence may be required");
  }

  if (description.includes("hybrid")) {
    checks.push("Hybrid work arrangement listed");
  } else if (description.includes("remote")) {
    checks.push("Remote work arrangement listed");
  } else if (description.includes("on-site") || description.includes("onsite")) {
    checks.push("On-site work arrangement listed");
  }

  if (description.includes("certif")) {
    checks.push("Certification may be mentioned in the posting");
  }

  return checks.length > 0
    ? checks.slice(0, 4)
    : ["Review the full posting for details to verify"];
}

function convertApiJob(job: SearchJob, hasCareerMemory: boolean): DisplayJob {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    type: job.type,
    mode: job.type?.toLowerCase().includes("remote") ? "Remote" : "On-site / Hybrid",
    categories: job.categories ?? [],
    match: job.match,
    relevantExperience: deriveRelevantExperience(job),
    keyRequirements: deriveKeyRequirements(job),
    thingsToCheck: deriveThingsToCheck(job),
    posted: formatPosted(job.posted),
    url: job.url,
    logo: job.logo,
    source: job.source,
  };
}

export default function FindJobsPage() {
  
  const router = useRouter();
const { careerMemory } = useLogin();
  const [query, setQuery] = useState("");
 const country = "CA";
 const [province, setProvince] = useState("All");
const [city, setCity] = useState("All");
const [cityInput, setCityInput] = useState("");
const [citySuggestions, setCitySuggestions] =
  useState<CitySuggestion[]>([]);
const [isSearchingCities, setIsSearchingCities] =
  useState(false);
const [showCitySuggestions, setShowCitySuggestions] =
  useState(false);
  const [jobType, setJobType] = useState("All");
  const [category, setCategory] = useState("All");
  const [page, setPage] = useState(1);
 const hasCareerMemory =
  careerMemory?.required_completed ?? false;

  const [externalJobs, setExternalJobs] = useState<DisplayJob[]>([]);
  const [externalMode, setExternalMode] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [externalTotalPages, setExternalTotalPages] = useState(1);
  /*
    Pagination Enrichment V2 - the ONLY server-authoritative signal this
    page tracks about pagination: the highest provider page the last
    successful response actually consumed (route.ts's own
    providerPageThrough). Used ONLY to build the providerPageAfter hint
    for a genuine one-step-forward Next click (see handleSearch below) -
    never for Previous, never for jumping to an arbitrary page number,
    and never carried into a brand-new search. A missing/stale value here
    simply means the next request falls back to the server's own exact
    V1 single-page behavior - never guessed, never invented.
  */
  const [providerPageThrough, setProviderPageThrough] = useState<number | null>(null);
useEffect(() => {
  const trimmedInput = cityInput.trim();

  if (trimmedInput.length < 3) {
    setCitySuggestions([]);
    setIsSearchingCities(false);
    return;
  }

  const controller = new AbortController();

  const timer = window.setTimeout(async () => {
    try {
      setIsSearchingCities(true);

      const results = await searchCities(
        trimmedInput,
        country
      );

      if (!controller.signal.aborted) {
        setCitySuggestions(results);
        setShowCitySuggestions(true);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error(error);
        setCitySuggestions([]);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsSearchingCities(false);
      }
    }
  }, 400);

  return () => {
    controller.abort();
    window.clearTimeout(timer);
  };
}, [cityInput, country]);
 
  useEffect(() => {
    const saved = sessionStorage.getItem("findJobsState");
    if (!saved) return;

    try {
      const state = JSON.parse(saved);

      setQuery(state.query || "");

setProvince(state.province || "All");
setCity(state.city || "All");
setCityInput(state.cityInput || "");
setJobType(state.jobType || "All");
setCategory(state.category || "All");

      setPage(state.page || 1);
      setExternalJobs(Array.isArray(state.jobs) ? state.jobs : []);
      setExternalMode(Boolean(state.externalMode));
      setExternalTotalPages(state.externalTotalPages || 1);
      setProviderPageThrough(
        typeof state.providerPageThrough === "number" ? state.providerPageThrough : null
      );
    } catch (error) {
      console.error(error);
      sessionStorage.removeItem("findJobsState");
    }
  }, []);

  
    

  
  const jobsPerPage = 10;

  
  const activeJobs = externalJobs;

  const totalPages = externalTotalPages;

  const jobsToShow = activeJobs;

  async function handleSearch(nextPage = 1) {
    setIsSearching(true);
    setMessage("");

    try {
      /*
        Pagination Enrichment V2 - the providerPageAfter hint is only ever
        forwarded for a genuine one-step-forward Next click (nextPage is
        literally the page immediately after the one currently displayed)
        AND only when the prior response actually returned a hint. Every
        other navigation - Previous, jumping to a specific page number,
        or a brand-new Search - intentionally omits it, which makes the
        server fall back to its own exact V1 single-page behavior for
        that request (see the pagination design audit's Part P/Q).
      */
      const shouldSendHint = nextPage === page + 1 && providerPageThrough !== null;

      const data = await searchJobs({
  query: query.trim(),
  country,
  state: province === "All" ? "" : province,
  city: city === "All" ? "" : city,
  jobType: jobType === "All" ? "" : jobType,
  category: category === "All" ? "" : category,
  page: nextPage,
  providerPageAfter: shouldSendHint ? providerPageThrough! : undefined,
});

      const jobs = data.jobs.map((job) => convertApiJob(job, hasCareerMemory));

      const nextTotalPages = jobs.length > 0 ? Math.max(nextPage + 1, 2) : nextPage;
      const nextProviderPageThrough =
        typeof data.providerPageThrough === "number" ? data.providerPageThrough : null;

      setExternalJobs(jobs);
      setExternalMode(true);
      setPage(nextPage);
      setExternalTotalPages(nextTotalPages);
      setProviderPageThrough(nextProviderPageThrough);
      setMessage(jobs.length > 0 ? "" : "No jobs found. Try another keyword or location.");

      sessionStorage.setItem(
  "findJobsState",
  JSON.stringify({
    query,
    country,
    province,
    city,
    cityInput,
    jobType,
    category,
    page: nextPage,
    jobs,
    externalMode: true,
    externalTotalPages: nextTotalPages,
    providerPageThrough: nextProviderPageThrough,
  })
);
    } catch (error: any) {
      console.error(error);
      setMessage(
        error?.message ||
          "Job search service is temporarily unavailable. Please try again later."
      );
    } finally {
      setIsSearching(false);
    }
  }

  function clearSearchResults() {
  setExternalMode(false);
  setExternalJobs([]);
  setPage(1);
  setMessage("");
  setExternalTotalPages(1);
  setProviderPageThrough(null);
  sessionStorage.removeItem("findJobsState");
}

  function goToPage(nextPage: number) {
    if (nextPage < 1) return;

    window.scrollTo({ top: 0, behavior: "smooth" });

    handleSearch(nextPage);
  }



  function saveCurrentSearchState() {
  sessionStorage.setItem(
    "findJobsState",
    JSON.stringify({
      query,
      country,
      province,
      city,
      cityInput,
      jobType,
      category,
      page,
      jobs: externalJobs,
      externalMode,
      externalTotalPages,
      providerPageThrough,
    })
  );
}


  function getPackageHref(job: DisplayJob) {
    if (job.url) {
      return `/paste-job?from=find-jobs&url=${encodeURIComponent(job.url)}&title=${encodeURIComponent(job.title)}`;
    }

    return `/paste-job?from=find-jobs&job=${job.id}`;
  }

  function openJobDetails(job: DisplayJob) {
    saveCurrentSearchState();
    router.push(getPackageHref(job));
  }

  return (
  
    <main className="flex min-h-screen flex-col bg-[#f6fbff] text-slate-900">
      <MobileNav active="Find Jobs" />
      <div className="flex flex-1">
        <aside className="hidden border-r border-blue-100 bg-white px-5 py-6 md:block md:w-60">
          <div className="flex items-center justify-between">
            <a href="/dashboard">
              <Image src="/logo.png" alt="Career Élan" width={120} height={45} />
            </a>
            <span className="text-slate-400">‹</span>
          </div>

          <p className="mt-8 text-xs font-bold uppercase tracking-wider text-slate-400">
            Overview
          </p>

          <nav className="mt-4 space-y-2">
            {menuItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  item.label === "Find Jobs"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-slate-600 hover:bg-blue-50 hover:text-blue-600"
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="mt-16 rounded-2xl bg-blue-50 p-5 text-center">
            <div className="text-3xl">👑</div>
            <h3 className="mt-3 font-extrabold">Career Élan Pro</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              More capacity and premium features are coming soon.
            </p>
            <Link href="/pricing" className="mt-4 block w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white">
              Coming Soon
            </Link>
          </div>
        </aside>

        <section className="min-w-0 flex-1 px-8 py-6">
          <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-blue-600">
                Create Package › Find Jobs in Career Élan
              </div>
              <h1 className="mt-2 text-3xl font-extrabold">
                Find Jobs in Career Élan
              </h1>
              <p className="mt-1 text-sm text-slate-500">
               Find jobs across Canada.
              </p>
            </div>

            <a
              href="/create-package"
              className="rounded-xl border border-blue-100 bg-white px-5 py-3 text-sm font-bold text-slate-600 shadow-sm hover:bg-blue-50"
            >
              ← Back to Choose Method
            </a>
          </header>

          <Card padding="md">
            <div className="grid gap-3 lg:grid-cols-12">
              <input
  value={query}
  onChange={(e) => {
    setQuery(e.target.value);
    clearSearchResults();
  }}
  placeholder="Search job title, company, or keyword..."
  className="w-full min-w-0 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 lg:col-span-4"
/>

            <div className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700 lg:col-span-2">
  Canada
</div>

  <select
  value={province}
  onChange={(e) => {
    setProvince(e.target.value);
    setCity("All");
    setCityInput("");
    setCitySuggestions([]);
    clearSearchResults();
  }}
  className="w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 lg:col-span-2"
>
  <option value="All">Province / Territory</option>

  {provinces.Canada.map((provinceName) => (
    <option
      key={provinceName}
      value={provinceName}
    >
      {provinceName}
    </option>
  ))}
</select>

<div className="relative lg:col-span-2">
  <input
    value={cityInput}
    onChange={(e) => {
  const value = e.target.value;

  setCityInput(value);
  setCity("All");
  setShowCitySuggestions(true);
  clearSearchResults();
}}
    onFocus={() => {
      if (citySuggestions.length > 0) {
        setShowCitySuggestions(true);
      }
    }}
    placeholder="Search city..."
    autoComplete="off"
    className="w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
  />

  {isSearchingCities && (
    <div className="absolute right-4 top-3.5 text-xs font-semibold text-slate-400">
      Searching...
    </div>
  )}

  {showCitySuggestions &&
    citySuggestions.length > 0 && (
      <div className="absolute z-50 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-blue-100 bg-white py-2 shadow-xl">
        {citySuggestions.map((suggestion) => (
          <button
            key={suggestion.id}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();

              setCity(suggestion.name);
              setCityInput(suggestion.label);
              setCitySuggestions([]);
              setShowCitySuggestions(false);
              setPage(1);
              setExternalJobs([]);
              setExternalMode(false);
              setMessage("");
              setProviderPageThrough(null);
              sessionStorage.removeItem(
                "findJobsState"
              );
            }}
            className="block w-full px-4 py-3 text-left hover:bg-blue-50"
          >
            <p className="text-sm font-bold text-slate-800">
              {suggestion.name}
            </p>

            {suggestion.region && (
              <p className="mt-1 text-xs text-slate-500">
                {suggestion.region}
              </p>
            )}
          </button>
        ))}

        <div className="border-t border-slate-100 px-4 pt-2 text-right text-[10px] font-semibold text-slate-400">
          Powered by Google
        </div>
      </div>
    )}
</div>

              <select
                value={jobType}
                onChange={(e) => {
  setJobType(e.target.value);
  clearSearchResults();
}}
                className="w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 lg:col-span-2"
              >
                <option>All</option>
                <option>Full-time</option>
                <option>Part-time</option>
                <option>Contract</option>
                <option>Remote</option>
              </select>

              <select
                value={category}
                onChange={(e) => {
  setCategory(e.target.value);
  clearSearchResults();
}}
                className="w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 lg:col-span-2"
              >
                <option value="All">All Jobs</option>
                {JOB_CATEGORIES.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.display}
                  </option>
                ))}
              </select>

              <Button
                onClick={() => handleSearch(1)}
                disabled={isSearching}
                className="lg:col-span-2"
              >
                {isSearching ? "Searching..." : "Search"}
              </Button>
            </div>

            {message && (
              <p className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
                {message}
              </p>
            )}
          </Card>

          <Card padding="md" className="mt-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-extrabold">
                  {externalMode
                   ? `${countryNameByCode[country]} Job Search Results`
                    : "Job Listings"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {externalMode
                    ? "Live job listings powered by JSearch. Select a job to generate your package."
                    : "Live job listings based on your search."}
                </p>
              </div>

              <div className="text-right">
                <p className="text-sm font-bold text-slate-600">
                  Showing {jobsToShow.length} jobs
                </p>
                <p className="text-xs text-slate-400">
                  Page {page} of {totalPages}
                </p>
              </div>
            </div>

            {jobsToShow.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
                <p className="text-sm font-semibold text-slate-500">
                  No jobs to display yet.
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Use the search bar above to find opportunities.
                </p>
              </div>
            )}

            <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-5">
              {jobsToShow.map((job, index) => (
                <Card
                  key={`${job.id}-${index}`}
                  padding="sm"
                  className="flex min-h-[310px] min-w-0 flex-col transition hover:-translate-y-1 hover:shadow-lg"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-blue-50 text-2xl">
                      {job.logo ? (
                        <img
                          src={job.logo}
                          alt={job.company}
                          className="h-full w-full object-contain p-1"
                        />
                      ) : (
                        "💼"
                      )}
                    </div>

                    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600">
                      General
                    </span>
                  </div>

                  <h3 className="mt-5 line-clamp-2 text-sm font-extrabold">
                    {job.title}
                  </h3>
                  <p className="mt-1 line-clamp-1 text-xs font-semibold text-slate-500">
                    {job.company}
                  </p>
                  <p className="mt-1 line-clamp-1 text-xs text-slate-400">
                    {job.location}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="min-w-0 max-w-full break-words rounded-full bg-blue-50 px-3 py-1 text-[10px] font-bold text-blue-600">
                      {job.type}
                    </span>
                    {job.categories.slice(0, 2).map((categoryId) => (
                      <span
                        key={categoryId}
                        className="min-w-0 max-w-full break-words rounded-full bg-slate-50 px-3 py-1 text-[10px] font-bold text-slate-500"
                      >
                        {JOB_CATEGORY_DISPLAY_BY_ID[categoryId] || categoryId}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4">
                    <h4 className="text-[11px] font-extrabold text-slate-700">
                      Relevant Experience
                    </h4>
                    <p className="mt-2 text-[11px] font-semibold text-slate-600">
                      {job.relevantExperience}
                    </p>
                  </div>

                  <div className="mt-3">
                    <h4 className="text-[11px] font-extrabold text-slate-700">
                      Key Requirements
                    </h4>
                    <div className="mt-2 space-y-1">
                      {job.keyRequirements.map((item) => (
                        <p
                          key={item}
                          className="text-[11px] font-semibold text-blue-700"
                        >
                          • {item}
                        </p>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3">
                    <h4 className="text-[11px] font-extrabold text-slate-700">
                      Things to Check
                    </h4>
                    <div className="mt-2 space-y-1">
                      {job.thingsToCheck.map((item) => (
                        <p
                          key={item}
                          className="text-[11px] font-semibold text-amber-600"
                        >
                          • {item}
                        </p>
                      ))}
                    </div>
                  </div>

                  <div className="mt-auto pt-4">
                    <button
                      onClick={() => openJobDetails(job)}
                      className="block w-full rounded-xl bg-blue-600 px-4 py-3 text-center text-xs font-bold text-white hover:bg-blue-700"
                    >
                      View Job Details →
                    </button>

                    {job.source && (
                      <p className="mt-2 break-words text-center text-[10px] font-semibold text-slate-400">
                        Source: {job.source}
                      </p>
                    )}
                  </div>
                </Card>
              ))}
            </div>

            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1 || isSearching}
                className="h-10 w-10 rounded-xl border border-blue-100 bg-white text-sm font-bold text-blue-600 hover:bg-blue-50 disabled:opacity-40"
              >
                ‹
              </button>

              {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => {
                const pageNumber = i + 1;

                return (
                  <button
                    key={pageNumber}
                    onClick={() => goToPage(pageNumber)}
                    disabled={isSearching}
                    className={`h-10 w-10 rounded-xl text-sm font-bold ${
                      page === pageNumber
                        ? "bg-blue-600 text-white"
                        : "border border-blue-100 bg-white text-blue-600 hover:bg-blue-50"
                    }`}
                  >
                    {pageNumber}
                  </button>
                );
              })}

              <button
                onClick={() => goToPage(page + 1)}
                disabled={isSearching}
                className="h-10 w-10 rounded-xl border border-blue-100 bg-white text-sm font-bold text-blue-600 hover:bg-blue-50 disabled:opacity-40"
              >
                ›
              </button>
            </div>
          </Card>
        </section>
     </div>
    <CareerElanFooter />
    </main>
  
  );
}