"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CareerFairCard from "@/components/careerFairs/CareerFairCard";
import ProvinceSelect from "@/components/careerFairs/ProvinceSelect";
import type { CareerFair, EventMode } from "@/lib/careerFairs/types";

const MODE_OPTIONS: { value: EventMode | ""; label: string }[] = [
  { value: "", label: "Any format" },
  { value: "in_person", label: "In-person" },
  { value: "online", label: "Online" },
  { value: "hybrid", label: "Hybrid" },
];

const AUDIENCE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any audience" },
  { value: "public", label: "Public" },
  { value: "newcomers", label: "Newcomers" },
  { value: "alumni", label: "Alumni" },
  { value: "students_only", label: "Students only" },
];

const EVENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All opportunities" },
  { value: "career_fair", label: "Career fairs" },
  { value: "job_fair", label: "Job fairs" },
  { value: "hiring_event", label: "Hiring events" },
  { value: "recruitment_event", label: "Recruitment events" },
  { value: "career_expo", label: "Career expos" },
  { value: "employer_information_session", label: "Employer sessions" },
  { value: "networking_event", label: "Networking events" },
  { value: "industry_night", label: "Industry nights" },
  { value: "graduate_fair", label: "Graduate fairs" },
  { value: "volunteer_fair", label: "Volunteer fairs" },
  { value: "career_workshop", label: "Career workshops" },
  { value: "interview_event", label: "Interview events" },
  { value: "open_house", label: "Recruiting open houses" },
];

type SearchResponse = {
  fairs: CareerFair[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

function CareerFairsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const province = searchParams.get("province") || "";
  const city = searchParams.get("city") || "";
  const mode = searchParams.get("mode") || "";
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";
  const keyword = searchParams.get("keyword") || "";
  const audience = searchParams.get("audience") || "";
  const eventType = searchParams.get("eventType") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);

  const [cityInput, setCityInput] = useState(city);
  const [keywordInput, setKeywordInput] = useState(keyword);

  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  /*
    Every filter is kept in the URL's own query params (not component
    state as the source of truth) so a shared link or a page refresh
    always reproduces the exact same filtered result - this is a
    deliberate deviation from this repo's other listing page
    (app/find-jobs/page.tsx), which only persists its filters to
    sessionStorage and has no URL sync at all; that approach can't
    satisfy this feature's own "shareable/refreshable filters"
    requirement, so this page intentionally does it differently.
  */
  function updateParam(updates: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in updates)) next.delete("page");
    router.push(`/career-fairs?${next.toString()}`);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErrored(false);

      try {
        const params = new URLSearchParams();
        if (province) params.set("province", province);
        if (city) params.set("city", city);
        if (mode) params.set("mode", mode);
        if (dateFrom) params.set("dateFrom", dateFrom);
        if (dateTo) params.set("dateTo", dateTo);
        if (keyword) params.set("keyword", keyword);
        if (audience) params.set("audience", audience);
        if (eventType) params.set("eventType", eventType);
        params.set("page", String(page));

        const res = await fetch(`/api/career-fairs/search?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load career fairs.");

        const data: SearchResponse = await res.json();
        if (!cancelled) setResult(data);
      } catch {
        if (!cancelled) setErrored(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [province, city, mode, dateFrom, dateTo, keyword, audience, eventType, page]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <a
            href="/dashboard"
            className="text-sm font-bold text-blue-600 hover:underline"
          >
            ← Back to Dashboard
          </a>
          <h1 className="mt-3 text-3xl font-black text-slate-950">
            Career Fairs Across Canada
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Browse real, upcoming career fairs by province, city, and format.
          </p>
        </div>

        <div className="mb-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
          <ProvinceSelect
            value={province}
            onChange={(value) => updateParam({ province: value })}
          />

          <input
            type="text"
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
            onBlur={() => updateParam({ city: cityInput })}
            onKeyDown={(e) => {
              if (e.key === "Enter") updateParam({ city: cityInput });
            }}
            placeholder="City"
            aria-label="City"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
          />

          <select
            value={mode}
            onChange={(e) => updateParam({ mode: e.target.value })}
            aria-label="Event format"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => updateParam({ dateFrom: e.target.value })}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            aria-label="From date"
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => updateParam({ dateTo: e.target.value })}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            aria-label="To date"
          />

          <input
            type="text"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onBlur={() => updateParam({ keyword: keywordInput })}
            onKeyDown={(e) => {
              if (e.key === "Enter") updateParam({ keyword: keywordInput });
            }}
            placeholder="Keyword (e.g. tech, government)"
            aria-label="Keyword search"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 sm:col-span-2 lg:col-span-2"
          />

          <select
            value={audience}
            onChange={(e) => updateParam({ audience: e.target.value })}
            aria-label="Audience"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
          >
            {AUDIENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={eventType}
            onChange={(e) => updateParam({ eventType: e.target.value })}
            aria-label="Event type"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
          >
            {EVENT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {(province || city || mode || dateFrom || dateTo || keyword || audience || eventType) && (
            <button
              type="button"
              onClick={() => {
                setCityInput("");
                setKeywordInput("");
                router.push("/career-fairs");
              }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-500 hover:bg-slate-50"
            >
              Clear filters
            </button>
          )}
        </div>

        {loading ? (
          <div
            role="status"
            aria-live="polite"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <span className="sr-only">Loading career fairs…</span>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                aria-hidden="true"
                className="h-44 animate-pulse rounded-2xl bg-slate-100"
              />
            ))}
          </div>
        ) : errored ? (
          <div
            role="alert"
            className="rounded-xl border border-red-100 bg-red-50 p-8 text-center text-sm font-semibold text-red-600"
          >
            Couldn&apos;t load career fairs right now. Please try again later.
          </div>
        ) : !result || result.fairs.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            No career fairs match these filters right now.
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm font-semibold text-slate-500">
              {result.total} upcoming career fair
              {result.total === 1 ? "" : "s"}
            </p>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {result.fairs.map((fair) => (
                <CareerFairCard key={fair.id} fair={fair} />
              ))}
            </div>

            {result.totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => updateParam({ page: String(page - 1) })}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ← Prev
                </button>

                <span className="text-sm font-semibold text-slate-500">
                  Page {result.page} of {result.totalPages}
                </span>

                <button
                  type="button"
                  disabled={page >= result.totalPages}
                  onClick={() => updateParam({ page: String(page + 1) })}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function CareerFairsPage() {
  return (
    <Suspense fallback={null}>
      <CareerFairsPageInner />
    </Suspense>
  );
}
