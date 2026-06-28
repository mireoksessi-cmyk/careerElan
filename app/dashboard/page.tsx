"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const menuItems = [
  "Dashboard",
  "Career Memory",
  "Application Center",
  "Job Tracker",
  "Analytics",
  "Settings",
];

const progressCards = [
  { title: "Career Memory", value: "82%", change: "+6%", note: "profile improved this week", icon: "🧠" },
  { title: "Application Packages", value: "14", change: "+3", note: "new packages created this week", icon: "📦" },
  { title: "Applications Sent", value: "27", change: "+5", note: "applications submitted this month", icon: "📤" },
  { title: "Interviews", value: "8", change: "+2", note: "interviews scheduled", icon: "🗓️" },
];

const neutralJobs = [
  { title: "Administrative Assistant", company: "Office Support Role", type: "Full-time", tags: ["Office", "Admin"] },
  { title: "Customer Service Representative", company: "Client Service Role", type: "Part-time", tags: ["Customer Service", "Communication"] },
  { title: "Office Clerk", company: "Entry-Level Office Role", type: "Full-time", tags: ["Data Entry", "Organization"] },
];

const personalizedJobs = [
  { title: "Legal Assistant", company: "Toronto Legal Group", type: "Full-time", tags: ["Legal", "Admin"], match: "87%" },
  { title: "Administrative Assistant", company: "North York Office", type: "Part-time", tags: ["Office", "Client Service"], match: "76%" },
  { title: "Law Clerk Intern", company: "Downtown Firm", type: "Internship", tags: ["Law Clerk", "Research"], match: "91%" },
];

const defaultCareerFairs = [
  {
    title: "Toronto Career Fair",
    date: "Jul 12",
    location: "Metro Toronto Convention Centre",
    icon: "🎓",
    tags: ["General", "Toronto"],
    match: "",
    why: ["Open to multiple industries", "Good for entry-level roles"],
  },
  {
    title: "Legal Career Expo",
    date: "Jul 18",
    location: "North York Civic Centre",
    icon: "⚖️",
    tags: ["Legal", "Law Clerk"],
    match: "",
    why: ["Useful for legal and office roles", "Good networking opportunity"],
  },
  {
    title: "Government Hiring Fair",
    date: "Aug 2",
    location: "Mississauga Convention Centre",
    icon: "🏛️",
    tags: ["Government", "Public Sector"],
    match: "",
    why: ["Public sector opportunities", "Good for administrative roles"],
  },
];

const personalizedCareerFairs = [
  {
    title: "Toronto Legal Career Expo",
    date: "May 22",
    location: "Metro Toronto Convention Centre",
    icon: "⚖️",
    tags: ["Legal", "Law Clerk", "Toronto"],
    match: "95%",
    why: ["Matches your target role: Law Clerk", "Legal industry focused", "Location preference: Toronto"],
  },
  {
    title: "Administrative & Office Career Fair",
    date: "Jun 5",
    location: "Beanfield Centre",
    icon: "💼",
    tags: ["Administrative", "Office", "Entry Level"],
    match: "89%",
    why: ["Matches your skills and experience", "Entry-level friendly", "Great for career growth"],
  },
  {
    title: "Government & Public Sector Expo",
    date: "Jun 18",
    location: "Enercare Centre",
    icon: "🏛️",
    tags: ["Government", "Public Sector", "Toronto"],
    match: "85%",
    why: ["Government roles in high demand", "Stable career opportunities", "Matches your goals"],
  },
];

function getMenuHref(item: string) {
  if (item === "Dashboard") return "/dashboard";
  if (item === "Career Memory") return "/career-memory";
  if (item === "Application Center") return "/application-center";
  if (item === "Job Tracker") return "/job-tracker";
  if (item === "Analytics") return "/analytics";
  if (item === "Settings") return "/settings";
  return "#";
}

export default function DashboardPage() {
  const [careerMemoryCompleted, setCareerMemoryCompleted] = useState(false);
  const [careerFairLocation, setCareerFairLocation] = useState("Toronto, ON");
  const [careerFairs, setCareerFairs] = useState(defaultCareerFairs);

  useEffect(() => {
    const saved = localStorage.getItem("careerMemoryData");

    if (saved) {
      const parsed = JSON.parse(saved);
      const hasMemory =
        parsed.firstName ||
        parsed.summary ||
        parsed.skills ||
        parsed.targetRoles ||
        parsed.education?.[0]?.school ||
        parsed.workExperience?.[0]?.company;

      if (hasMemory) {
        setCareerMemoryCompleted(true);
        setCareerFairs(personalizedCareerFairs);
      }
    }
  }, []);

  function handleCareerFairSearch() {
    if (careerMemoryCompleted) {
      setCareerFairs(personalizedCareerFairs);
    } else {
      setCareerFairs(defaultCareerFairs);
    }
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
                key={item}
                href={getMenuHref(item)}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  item === "Dashboard"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-gray-600 hover:bg-blue-50 hover:text-blue-600"
                }`}
              >
                <span>
                  {item === "Dashboard"
                    ? "🏠"
                    : item === "Career Memory"
                    ? "🧠"
                    : item === "Application Center"
                    ? "📦"
                    : item === "Job Tracker"
                    ? "💼"
                    : item === "Analytics"
                    ? "📊"
                    : "⚙️"}
                </span>
                {item}
              </a>
            ))}
          </nav>

          <div className="mt-64 rounded-2xl bg-blue-50 p-5 text-center">
            <div className="text-3xl">👑</div>
            <h3 className="mt-3 font-extrabold">Upgrade to Pro</h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Unlock unlimited AI features and boost your job search.
            </p>
            <button className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white">
              Upgrade Now
            </button>
          </div>
        </aside>

        <section className="flex-1">
          <header className="flex items-center justify-between px-8 py-6">
            <div>
              <h1 className="text-2xl font-extrabold">Good morning, David! 👋</h1>
              <p className="mt-1 text-sm text-gray-500">
                Let’s make today another step closer to your dream career.
              </p>
            </div>

            <input
              type="text"
              placeholder="Search jobs, packages..."
              className="w-80 rounded-xl border border-blue-100 bg-white px-5 py-3 text-sm outline-none focus:border-blue-500"
            />

            <div className="flex items-center gap-4">
              <button className="rounded-full bg-white p-3 shadow-sm">🔔</button>
              <button className="rounded-full bg-white p-3 shadow-sm">💬</button>

              <a href="/settings" className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-blue-50">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 font-bold text-white">
                  D
                </div>
                <div>
                  <p className="text-sm font-bold">David Kwak</p>
                  <p className="text-xs text-gray-500">Career Élan User</p>
                </div>
              </a>
            </div>
          </header>

          <div className="grid grid-cols-12 gap-6 px-8 pb-8">
            <section className="col-span-12 space-y-6 xl:col-span-9">
              <div>
                <h2 className="mb-4 text-lg font-bold">Overview</h2>

                <div className="grid gap-5 md:grid-cols-4">
                  {progressCards.map((card) => (
                    <div key={card.title} className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-semibold text-gray-500">{card.title}</p>
                          <h3 className="mt-3 text-3xl font-extrabold">{card.value}</h3>
                        </div>
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-xl">
                          {card.icon}
                        </div>
                      </div>

                      <p className="mt-3 text-xs text-gray-500">
                        <span className="font-bold text-green-600">{card.change}</span>{" "}
                        {card.note}
                      </p>

                      <div className="mt-5 flex items-center justify-between text-sm">
                        <a href="#" className="font-bold text-blue-600">View Details</a>
                        <span>→</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-5">
                {[
                  ["🔗", "Analyze Job URL", "Get AI insights", "/application-center"],
                  ["📄", "Generate Resume", "Tailored to job", "/application-center"],
                  ["✉️", "Generate Cover Letter", "Personalized letter", "/application-center"],
                  ["🚀", "Draft Follow-up Email", "After applying", "/application-center"],
                  ["➕", "Add Application", "Track application", "/job-tracker"],
                ].map(([icon, title, desc, href]) => (
                  <a key={title} href={href} className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
                    <div className="text-3xl">{icon}</div>
                    <h3 className="mt-3 font-extrabold">{title}</h3>
                    <p className="mt-1 text-sm text-gray-500">{desc}</p>
                  </a>
                ))}
              </div>

              <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold">Job Recommendations</h2>
                    {!careerMemoryCompleted && (
                      <p className="mt-1 text-sm text-gray-500">
                        Complete Career Memory to unlock personalized match scores.
                      </p>
                    )}
                  </div>
                  <a href="#" className="text-sm font-bold text-blue-600">View All Jobs</a>
                </div>

                <div className="grid gap-5 md:grid-cols-3">
                  {(careerMemoryCompleted ? personalizedJobs : neutralJobs).map((job) => (
                    <div key={job.title} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                      <div className="flex items-start justify-between">
                        <div className="text-3xl">💼</div>
                        <span className="rounded-full border border-blue-100 px-3 py-1 text-xs font-bold text-blue-600">
                          {job.type}
                        </span>
                      </div>

                      <h3 className="mt-4 text-lg font-extrabold">{job.title}</h3>
                      <p className="mt-1 text-sm text-gray-500">{job.company}</p>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {job.tags.map((tag) => (
                          <span key={tag} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
                            {tag}
                          </span>
                        ))}
                      </div>

                      {careerMemoryCompleted && "match" in job ? (
                        <div className="mt-5">
                          <div className="flex justify-between text-xs font-bold text-gray-500">
                            <span>{job.match} match with your Career Memory</span>
                          </div>
                          <div className="mt-2 h-2 rounded-full bg-gray-100">
                            <div className="h-2 rounded-full bg-blue-600" style={{ width: job.match }} />
                          </div>
                        </div>
                      ) : (
                        <p className="mt-5 rounded-xl bg-slate-50 p-3 text-xs font-semibold text-gray-500">
                          General recommendation. Add your resume to personalize.
                        </p>
                      )}

                      <button className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white">
                        Create Package
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold">🎪 Career Fair Search</h2>
                    <p className="mt-1 text-sm text-gray-500">
                      {careerMemoryCompleted
                        ? "AI finds career fairs that match your profile and goals."
                        : "Search career fairs by location. Add Career Memory for AI matching."}
                    </p>
                  </div>
                  <button className="text-sm font-bold text-blue-600 hover:underline">View All</button>
                </div>

                <div className="mb-6 flex items-center gap-3">
                  <span className="text-xl">📍</span>
                  <input
                    type="text"
                    value={careerFairLocation}
                    onChange={(e) => setCareerFairLocation(e.target.value)}
                    placeholder="Toronto, ON"
                    className="w-80 rounded-xl border border-gray-300 px-4 py-2 outline-none focus:border-blue-600"
                  />
                  <button
                    onClick={handleCareerFairSearch}
                    className="rounded-xl bg-blue-600 px-8 py-2 font-semibold text-white hover:bg-blue-700"
                  >
                    Search
                  </button>
                </div>

                <div className="space-y-4">
                  {careerFairs.map((fair) => (
                    <div key={fair.title} className="grid gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm md:grid-cols-12">
                      <div className="col-span-12 flex items-center gap-4 md:col-span-7">
                        <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-blue-50 text-4xl">
                          {fair.icon}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            {fair.match && (
                              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-700">
                                {fair.match} Match
                              </span>
                            )}
                            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">
                              {fair.date}
                            </span>
                          </div>
                          <h3 className="mt-2 text-lg font-extrabold">{fair.title}</h3>
                          <p className="mt-1 text-sm text-gray-500">{fair.location}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {fair.tags.map((tag) => (
                              <span key={tag} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="col-span-12 rounded-xl bg-green-50 p-4 md:col-span-5">
                        <h4 className="font-bold text-green-700">
                          {careerMemoryCompleted ? "Why this match?" : "Why this event?"}
                        </h4>
                        <div className="mt-2 space-y-1">
                          {fair.why.map((reason) => (
                            <p key={reason} className="text-sm text-green-700">✓ {reason}</p>
                          ))}
                        </div>
                        <button className="mt-3 rounded-lg bg-white px-4 py-2 text-sm font-bold text-blue-600">
                          View Details
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <aside className="col-span-12 space-y-6 xl:col-span-3">
              <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold">Career Memory</h2>

                <div className="mt-5 flex justify-center">
                  <div className="flex h-28 w-28 items-center justify-center rounded-full border-8 border-blue-200 bg-blue-50 text-4xl">
                    🧠
                  </div>
                </div>

                <div className="mt-6 space-y-4">
                  <div>
                    <div className="flex justify-between text-xs font-bold text-gray-500">
                      <span>Memory Completed</span>
                      <span>{careerMemoryCompleted ? "82%" : "11%"}</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-gray-100">
                      <div className="h-2 rounded-full bg-blue-600" style={{ width: careerMemoryCompleted ? "82%" : "11%" }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-bold text-gray-500">
                      <span>AI Personalization</span>
                      <span>{careerMemoryCompleted ? "70%" : "0%"}</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-gray-100">
                      <div className="h-2 rounded-full bg-cyan-500" style={{ width: careerMemoryCompleted ? "70%" : "0%" }} />
                    </div>
                  </div>
                </div>

                <a
                  href="/career-memory"
                  className="mt-5 block rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-bold text-white"
                >
                  {careerMemoryCompleted ? "Improve Your Memory →" : "Complete Career Memory →"}
                </a>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold">AI Suggestions</h2>

                <div className="mt-5 space-y-4">
                  {[
                    ["Add your GPA information", "High"],
                    ["Add French language level", "Medium"],
                    ["Add more volunteer details", "Medium"],
                    ["Add certifications or licenses", "Low"],
                  ].map(([name, level]) => (
                    <div key={name} className="rounded-xl bg-slate-50 p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold">{name}</p>
                        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-600">
                          {level}
                        </span>
                      </div>
                      <a href="/career-memory" className="mt-2 block text-xs font-bold text-blue-600">
                        Review
                      </a>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold">AI Usage</h2>
                <p className="mt-2 text-sm text-gray-500">Monthly AI generation usage.</p>

                <div className="mt-5">
                  <div className="flex justify-between text-xs font-bold text-gray-500">
                    <span>Used</span>
                    <span>41 / 100</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-gray-100">
                    <div className="h-2 w-[41%] rounded-full bg-green-500" />
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between">
                  <p className="text-sm font-bold text-gray-600">Plan: Free</p>
                  <button className="rounded-xl bg-blue-50 px-4 py-2 text-sm font-bold text-blue-600">
                    ⚡ Upgrade to Pro
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold">Upcoming Interview</h2>
                <p className="mt-3 text-sm font-bold">TD Bank</p>
                <p className="text-sm text-gray-500">Law Clerk Interview</p>
                <p className="mt-2 text-sm font-bold text-blue-600">Tomorrow · 2:00 PM</p>
                <button className="mt-4 w-full rounded-xl bg-blue-50 px-4 py-3 text-sm font-bold text-blue-600">
                  Prepare Now
                </button>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}