"use client";
import { useLogin } from "@/lib/auth/LoginManager";
import Image from "next/image";
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
  category: string;
  match?: number;
  matched: string[];
  missing: string[];
  posted: string;
  url?: string;
  logo?: string;
  source?: string;
};

const menuItems = [
  { label: "Dashboard", href: "/dashboard", icon: "🏠" },
  { label: "Career Memory", href: "/career-memory", icon: "🧠" },
  { label: "Create Package", href: "/create-package", icon: "📦" },
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

function convertApiJob(job: SearchJob, hasCareerMemory: boolean): DisplayJob {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    type: job.type,
    mode: job.type?.toLowerCase().includes("remote") ? "Remote" : "On-site / Hybrid",
    category: job.category || "General",
    match: job.match,
    matched: hasCareerMemory
  ? [
      job.title?.toLowerCase().includes("admin")
        ? "Administrative experience"
        : "Relevant job title",
      job.description?.toLowerCase().includes("customer")
        ? "Customer service"
        : "Company posting",
      job.location ? "Canada-based role" : "Location available",
    ]
  : ["Upload resume or complete Career Memory for AI match"],

missing: hasCareerMemory
  ? [
      job.description?.toLowerCase().includes("french")
        ? "French may be required"
        : "Review full posting",
      job.description?.toLowerCase().includes("experience")
        ? "Check experience requirement"
        : "Confirm job details",
    ]
  : ["No resume analyzed yet"],
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
      const data = await searchJobs({
  query: query.trim(),
  country,
  state: province === "All" ? "" : province,
  city: city === "All" ? "" : city,
  jobType: jobType === "All" ? "" : jobType,
  page: nextPage,
});

      const jobs = data.jobs.map((job) => convertApiJob(job, hasCareerMemory));

      const nextTotalPages = jobs.length > 0 ? Math.max(nextPage + 1, 2) : nextPage;

      setExternalJobs(jobs);
      setExternalMode(true);
      setPage(nextPage);
      setExternalTotalPages(nextTotalPages);
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
  
    <main className="min-h-screen bg-[#f6fbff] text-gray-900">
      <div className="flex min-h-screen">
        <aside className="w-60 border-r border-blue-100 bg-white px-5 py-6">
          <div className="flex items-center justify-between">
            <a href="/dashboard">
              <Image src="/logo.png" alt="Career Élan" width={120} height={45} />
            </a>
            <span className="text-gray-400">‹</span>
          </div>

          <p className="mt-8 text-xs font-bold uppercase tracking-wider text-gray-400">
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
                    : "text-gray-600 hover:bg-blue-50 hover:text-blue-600"
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="mt-16 rounded-2xl bg-blue-50 p-5 text-center">
            <div className="text-3xl">👑</div>
            <h3 className="mt-3 font-extrabold">Upgrade to Pro</h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Unlock unlimited AI job matching and package generation.
            </p>
            <button className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white">
              Upgrade Now
            </button>
          </div>
        </aside>

        <section className="flex-1 px-8 py-6">
          <header className="mb-8 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-blue-600">
                Create Package › Find Jobs in Career Élan
              </div>
              <h1 className="mt-2 text-3xl font-extrabold">
                Find Jobs in Career Élan
              </h1>
              <p className="mt-1 text-sm text-gray-500">
               Search jobs across Canada, the United States, the United Kingdom, and Australia.
              </p>
            </div>

            <a
              href="/create-package"
              className="rounded-xl border border-blue-100 bg-white px-5 py-3 text-sm font-bold text-gray-600 shadow-sm hover:bg-blue-50"
            >
              ← Back to Choose Method
            </a>
          </header>

          <section className="rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
            <div className="grid gap-3 lg:grid-cols-12">
              <input
  value={query}
  onChange={(e) => {
    setQuery(e.target.value);
    clearSearchResults();
  }}
  placeholder="Search job title, company, or keyword..."
  className="rounded-xl border border-blue-100 px-5 py-3 text-sm outline-none focus:border-blue-500 lg:col-span-4"
/>

            <div className="rounded-xl border border-blue-100 bg-slate-50 px-4 py-3 text-sm text-gray-700 lg:col-span-2">
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
  className="rounded-xl border border-blue-100 px-4 py-3 text-sm outline-none focus:border-blue-500 lg:col-span-2"
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
    className="w-full rounded-xl border border-blue-100 px-4 py-3 text-sm outline-none focus:border-blue-500"
  />

  {isSearchingCities && (
    <div className="absolute right-4 top-3.5 text-xs font-semibold text-gray-400">
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
              sessionStorage.removeItem(
                "findJobsState"
              );
            }}
            className="block w-full px-4 py-3 text-left hover:bg-blue-50"
          >
            <p className="text-sm font-bold text-gray-800">
              {suggestion.name}
            </p>

            {suggestion.region && (
              <p className="mt-1 text-xs text-gray-500">
                {suggestion.region}
              </p>
            )}
          </button>
        ))}

        <div className="border-t border-gray-100 px-4 pt-2 text-right text-[10px] font-semibold text-gray-400">
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
                className="rounded-xl border border-blue-100 px-4 py-3 text-sm outline-none focus:border-blue-500 lg:col-span-2"
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
                className="rounded-xl border border-blue-100 px-4 py-3 text-sm outline-none focus:border-blue-500 lg:col-span-2"
              >
                <option>All</option>
                <option>Administration</option>
                <option>Legal</option>
                <option>Office</option>
                <option>Customer Service</option>
              </select>

              <button
                onClick={() => handleSearch(1)}
                disabled={isSearching}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 lg:col-span-2"
              >
                {isSearching ? "Searching..." : "Search"}
              </button>
            </div>

            {message && (
              <p className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
                {message}
              </p>
            )}
          </section>

          <section className="mt-6 rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-extrabold">
                  {externalMode
                   ? `${countryNameByCode[country]} Job Search Results`
                    : hasCareerMemory
                    ? "AI Matched Jobs"
                    : "Recommended Jobs"}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {externalMode
                    ? "Live job listings powered by JSearch. Select a job to generate your package."
                    : hasCareerMemory
                    ? "These jobs are ranked based on your Career Memory and profile."
                    : "General recommendations. Upload your resume or complete Career Memory for AI matches."}
                </p>
              </div>

              <div className="text-right">
                <p className="text-sm font-bold text-gray-600">
                  Showing {jobsToShow.length} jobs
                </p>
                <p className="text-xs text-gray-400">
                  Page {page} of {totalPages}
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {jobsToShow.map((job, index) => (
                <div
                  key={`${job.id}-${index}`}
                  className="flex min-h-[310px] flex-col rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
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

                    {job.match ? (
                      <div className="text-right">
                        {index === 0 && page === 1 && (
                          <span className="rounded-full bg-green-100 px-2 py-1 text-[10px] font-bold text-green-700">
                            Best
                          </span>
                        )}
                        <p className="mt-2 text-sm font-extrabold text-green-600">
                          {job.match}% Match
                        </p>
                      </div>
                    ) : (
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600">
                        General
                      </span>
                    )}
                  </div>

                  <h3 className="mt-5 line-clamp-2 text-sm font-extrabold">
                    {job.title}
                  </h3>
                  <p className="mt-1 line-clamp-1 text-xs font-semibold text-gray-500">
                    {job.company}
                  </p>
                  <p className="mt-1 line-clamp-1 text-xs text-gray-400">
                    {job.location}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-bold text-blue-600">
                      {job.type}
                    </span>
                    <span className="rounded-full bg-slate-50 px-3 py-1 text-[10px] font-bold text-gray-500">
                      {job.category}
                    </span>
                  </div>

                  <div className="mt-4">
                    <h4 className="text-[11px] font-extrabold text-gray-700">
                      Why this matches you
                    </h4>
                    <div className="mt-2 space-y-1">
                      {job.matched.slice(0, 3).map((item) => (
                        <p
                          key={item}
                          className="text-[11px] font-semibold text-green-700"
                        >
                          ✓ {item}
                        </p>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3">
                    <h4 className="text-[11px] font-extrabold text-gray-700">
                      Missing
                    </h4>
                    <div className="mt-2 space-y-1">
                      {job.missing.slice(0, 2).map((item) => (
                        <p
                          key={item}
                          className="text-[11px] font-semibold text-red-500"
                        >
                          × {item}
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
                      <p className="mt-2 text-center text-[10px] font-semibold text-gray-400">
                        Source: {job.source}
                      </p>
                    )}
                  </div>
                </div>
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
          </section>
        </section>
     </div>
    </main>
  
  );
}