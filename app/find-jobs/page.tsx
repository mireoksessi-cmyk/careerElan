"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

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

const menuItems = [
  { label: "Dashboard", href: "/dashboard", icon: "🏠" },
  { label: "Career Memory", href: "/career-memory", icon: "🧠" },
  { label: "Create Package", href: "/create-package", icon: "📦" },
  { label: "Find Jobs", href: "/create-package/find-jobs", icon: "🔍" },
  { label: "Paste Job", href: "/paste-job", icon: "📋" },
  { label: "Job Tracker", href: "/job-tracker", icon: "💼" },
  { label: "Analytics", href: "/analytics", icon: "📊" },
  { label: "Settings", href: "/settings", icon: "⚙️" },
];

const neutralJobs: Job[] = [
  { id: 1, title: "Administrative Assistant", company: "Office Support Role", location: "Toronto, ON", type: "Full-time", mode: "On-site", category: "Administration", matched: ["Communication", "Organization", "Microsoft Office"], missing: ["Upload resume for deeper match"], posted: "Today" },
  { id: 2, title: "Customer Service Representative", company: "Client Service Role", location: "Toronto, ON", type: "Part-time", mode: "On-site", category: "Customer Service", matched: ["Customer service", "Phone support", "Problem solving"], missing: ["Add work history"], posted: "1 day ago" },
  { id: 3, title: "Office Clerk", company: "Entry-Level Office Role", location: "Toronto, ON", type: "Full-time", mode: "Hybrid", category: "Office", matched: ["Data entry", "Filing", "Document organization"], missing: ["Add skills"], posted: "2 days ago" },
  { id: 4, title: "Receptionist", company: "Front Desk Role", location: "North York, ON", type: "Part-time", mode: "On-site", category: "Reception", matched: ["Greeting clients", "Scheduling", "Email communication"], missing: ["Add language skills"], posted: "3 days ago" },
  { id: 5, title: "Data Entry Clerk", company: "General Office Role", location: "Remote", type: "Remote", mode: "Remote", category: "Data Entry", matched: ["Typing accuracy", "File organization", "Attention to detail"], missing: ["Upload resume"], posted: "4 days ago" },
  { id: 6, title: "Legal Assistant", company: "Entry-Level Legal Role", location: "Toronto, ON", type: "Full-time", mode: "Hybrid", category: "Legal", matched: ["Document handling", "Client communication", "Office support"], missing: ["Add education details"], posted: "5 days ago" },
  { id: 7, title: "Program Assistant", company: "Non-Profit Organization", location: "Toronto, ON", type: "Part-time", mode: "Hybrid", category: "Non-profit", matched: ["Event support", "Volunteer coordination", "Client service"], missing: ["Add project details"], posted: "6 days ago" },
  { id: 8, title: "HR Assistant", company: "Human Resources Role", location: "Toronto, ON", type: "Contract", mode: "Hybrid", category: "HR", matched: ["Email communication", "Organization", "Admin support"], missing: ["Add HR experience"], posted: "1 week ago" },
  { id: 9, title: "Client Intake Assistant", company: "Community Service Role", location: "Toronto, ON", type: "Full-time", mode: "On-site", category: "Client Intake", matched: ["Client communication", "Documentation", "Customer service"], missing: ["Add intake experience"], posted: "1 week ago" },
  { id: 10, title: "Library Assistant", company: "Public Library Role", location: "Toronto, ON", type: "Part-time", mode: "On-site", category: "Public Service", matched: ["Organization", "Customer service", "Data entry"], missing: ["Library system experience"], posted: "1 week ago" },
  { id: 11, title: "Records Clerk", company: "Records Office Role", location: "Toronto, ON", type: "Full-time", mode: "On-site", category: "Office", matched: ["Filing", "Accuracy", "Document handling"], missing: ["Records software"], posted: "2 weeks ago" },
  { id: 12, title: "Office Coordinator", company: "Small Business Office", location: "Toronto, ON", type: "Full-time", mode: "Hybrid", category: "Administration", matched: ["Scheduling", "Email", "Coordination"], missing: ["Calendar tools"], posted: "2 weeks ago" },
  { id: 13, title: "Call Centre Agent", company: "Client Support Centre", location: "Toronto, ON", type: "Full-time", mode: "Remote", category: "Customer Service", matched: ["Phone support", "Problem solving", "Communication"], missing: ["Call centre software"], posted: "2 weeks ago" },
  { id: 14, title: "Office Support Worker", company: "General Admin Team", location: "Mississauga, ON", type: "Part-time", mode: "On-site", category: "Office", matched: ["Office support", "Teamwork", "Documentation"], missing: ["More work details"], posted: "3 weeks ago" },
  { id: 15, title: "Junior Admin Clerk", company: "Entry Admin Role", location: "Toronto, ON", type: "Full-time", mode: "Hybrid", category: "Administration", matched: ["Data entry", "Organization", "Email"], missing: ["Upload resume"], posted: "3 weeks ago" },
];

const aiJobs: Job[] = neutralJobs.map((job, index) => ({
  ...job,
  match: 94 - index * 2,
  company:
    index === 0
      ? "TD Bank"
      : index === 1
      ? "Blakes Law Firm"
      : index === 2
      ? "RBC"
      : index === 3
      ? "Toronto Legal Clinic"
      : index === 4
      ? "Government of Ontario"
      : index === 5
      ? "CIBC"
      : job.company,
}));

export default function FindJobsPage() {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("Toronto, ON");
  const [jobType, setJobType] = useState("All");
  const [category, setCategory] = useState("All");
  const [visibleCount, setVisibleCount] = useState(6);
  const [page, setPage] = useState(1);
  const [hasCareerMemory, setHasCareerMemory] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("careerMemoryData");
    setHasCareerMemory(Boolean(saved));
  }, []);

  const baseJobs = hasCareerMemory ? aiJobs : neutralJobs;

  const filteredJobs = useMemo(() => {
    return baseJobs.filter((job) => {
      const q = query.toLowerCase();

      const matchesQuery =
        !q ||
        job.title.toLowerCase().includes(q) ||
        job.company.toLowerCase().includes(q) ||
        job.category.toLowerCase().includes(q);

      const matchesLocation =
        location === "All" ||
        job.location.includes(location.replace(", ON", ""));

      const matchesType = jobType === "All" || job.type === jobType;
      const matchesCategory = category === "All" || job.category === category;

      return matchesQuery && matchesLocation && matchesType && matchesCategory;
    });
  }, [query, location, jobType, category, baseJobs]);

  const jobsPerPage = 15;
  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / jobsPerPage));
  const pagedJobs = filteredJobs.slice(
    (page - 1) * jobsPerPage,
    page * jobsPerPage
  );
  const jobsToShow = pagedJobs.slice(0, visibleCount);

  function resetList() {
    setVisibleCount(6);
    setPage(1);
  }

  function handleMoreJobs() {
    setVisibleCount((prev) => Math.min(prev + 3, jobsPerPage));
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
                Search jobs matched to your profile. Select a job to create your full application package.
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
                  resetList();
                }}
                placeholder="Search job title, company, or keyword..."
                className="rounded-xl border border-blue-100 px-5 py-3 text-sm outline-none focus:border-blue-500 lg:col-span-4"
              />

              <select
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  resetList();
                }}
                className="rounded-xl border border-blue-100 px-4 py-3 text-sm outline-none focus:border-blue-500 lg:col-span-2"
              >
                <option>Toronto, ON</option>
                <option>North York, ON</option>
                <option>Mississauga, ON</option>
                <option>All</option>
              </select>

              <select
                value={jobType}
                onChange={(e) => {
                  setJobType(e.target.value);
                  resetList();
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
                  resetList();
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
                onClick={resetList}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white lg:col-span-2"
              >
                Search
              </button>
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-extrabold">
                  {hasCareerMemory ? "AI Matched Jobs" : "Recommended Jobs"}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {hasCareerMemory
                    ? "These jobs are ranked based on your Career Memory and profile."
                    : "General recommendations. Upload your resume or complete Career Memory for AI matches."}
                </p>
              </div>

              <div className="text-right">
                <p className="text-sm font-bold text-gray-600">
                  Showing {jobsToShow.length} of {filteredJobs.length}
                </p>
                <p className="text-xs text-gray-400">
                  Page {page} of {totalPages}
                </p>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {jobsToShow.map((job, index) => (
                <div
                  key={job.id}
                  className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-2xl">
                      💼
                    </div>

                    {job.match ? (
                      <div className="text-right">
                        {index === 0 && page === 1 && (
                          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-700">
                            Best Match
                          </span>
                        )}
                        <p className="mt-2 text-lg font-extrabold text-green-600">
                          {job.match}% Match
                        </p>
                      </div>
                    ) : (
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600">
                        General
                      </span>
                    )}
                  </div>

                  <h3 className="mt-5 text-lg font-extrabold">{job.title}</h3>
                  <p className="mt-1 text-sm text-gray-500">{job.company}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {job.location} · {job.mode} · {job.posted}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600">
                      {job.type}
                    </span>
                    <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-bold text-gray-500">
                      {job.category}
                    </span>
                  </div>

                  <div className="mt-5">
                    <h4 className="text-xs font-extrabold text-gray-700">
                      Why this matches you
                    </h4>
                    <div className="mt-2 space-y-1">
                      {job.matched.map((item) => (
                        <p
                          key={item}
                          className="text-xs font-semibold text-green-700"
                        >
                          ✓ {item}
                        </p>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4">
                    <h4 className="text-xs font-extrabold text-gray-700">
                      Missing
                    </h4>
                    <div className="mt-2 space-y-1">
                      {job.missing.map((item) => (
                        <p
                          key={item}
                          className="text-xs font-semibold text-red-500"
                        >
                          × {item}
                        </p>
                      ))}
                    </div>
                  </div>

                  <a
                    href={`/paste-job?job=${job.id}`}
                    className="mt-5 block w-full rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-bold text-white hover:bg-blue-700"
                  >
                    Generate Package →
                  </a>
                </div>
              ))}
            </div>

            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              {visibleCount < Math.min(jobsPerPage, pagedJobs.length) && (
                <button
                  onClick={handleMoreJobs}
                  className="rounded-xl border border-blue-200 bg-white px-8 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50"
                >
                  + More Jobs
                </button>
              )}

              <div className="flex items-center gap-2">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setPage(i + 1);
                      setVisibleCount(6);
                    }}
                    className={`h-10 w-10 rounded-xl text-sm font-bold ${
                      page === i + 1
                        ? "bg-blue-600 text-white"
                        : "border border-blue-100 bg-white text-blue-600 hover:bg-blue-50"
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}

                <button
                  onClick={() => {
                    setPage((prev) => Math.min(prev + 1, totalPages));
                    setVisibleCount(6);
                  }}
                  className="h-10 w-10 rounded-xl border border-blue-100 bg-white text-sm font-bold text-blue-600 hover:bg-blue-50"
                >
                  ›
                </button>
              </div>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}