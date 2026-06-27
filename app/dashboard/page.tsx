import Image from "next/image";

const menuItems = [
  "Dashboard",
  "Profile",
  "Career Memory",
  "Resume Center",
  "Cover Letter",
  "Job Tracker",
  "Analytics",
  "Settings",
];

const progressCards = [
  {
    title: "Applications Submitted",
    value: "105",
    change: "+24%",
    note: "24 applications submitted today",
    icon: "📤",
  },
  {
    title: "Applications Reviewed",
    value: "68",
    change: "+18%",
    note: "18 applications reviewed today",
    icon: "📄",
  },
  {
    title: "Interviews Scheduled",
    value: "23",
    change: "+15%",
    note: "Interviews scheduled today",
    icon: "🗓️",
  },
];

const jobRecommendations = [
  {
    title: "Legal Assistant",
    company: "Toronto Legal Group",
    type: "Full-time",
    tags: ["Legal", "Admin"],
    match: "87%",
  },
  {
    title: "Administrative Assistant",
    company: "North York Office",
    type: "Part-time",
    tags: ["Office", "Client Service"],
    match: "76%",
  },
  {
    title: "Law Clerk Intern",
    company: "Downtown Firm",
    type: "Internship",
    tags: ["Law Clerk", "Research"],
    match: "91%",
  },
];

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-[#f6fbff] text-gray-900">
      <div className="flex min-h-screen">
        <aside className="w-60 border-r border-blue-100 bg-white px-5 py-6">
          <div className="flex items-center justify-between">
            <Image src="/logo.png" alt="Career Élan" width={120} height={45} />
            <span className="text-gray-400">‹</span>
          </div>

          <p className="mt-8 text-xs font-bold uppercase tracking-wider text-gray-400">
            Overview
          </p>

          <nav className="mt-4 space-y-2">
            {menuItems.map((item) => (
              <a
                key={item}
                href="#"
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  item === "Dashboard"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-gray-600 hover:bg-blue-50 hover:text-blue-600"
                }`}
              >
                <span>{item === "Dashboard" ? "🏠" : item === "Profile" ? "👤" : item === "Career Memory" ? "🧠" : item === "Resume Center" ? "📄" : item === "Cover Letter" ? "✉️" : item === "Job Tracker" ? "💼" : item === "Analytics" ? "📊" : "⚙️"}</span>
                {item}
              </a>
            ))}
          </nav>
        </aside>

        <section className="flex-1">
          <header className="flex items-center justify-between px-8 py-6">
            <h1 className="text-2xl font-extrabold">Dashboard</h1>

            <input
              type="text"
              placeholder="Search jobs..."
              className="w-80 rounded-xl border border-blue-100 bg-white px-5 py-3 text-sm outline-none focus:border-blue-500"
            />

            <div className="flex items-center gap-4">
              <button className="rounded-full bg-white p-3 shadow-sm">🔔</button>
              <button className="rounded-full bg-white p-3 shadow-sm">💬</button>

              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 font-bold text-white">
                  D
                </div>
                <div>
                  <p className="text-sm font-bold">David Kwak</p>
                  <p className="text-xs text-gray-500">Career Élan User</p>
                </div>
              </div>
            </div>
          </header>

          <div className="grid grid-cols-12 gap-6 px-8 pb-8">
            <section className="col-span-12 space-y-6 xl:col-span-9">
              <div>
                <h2 className="mb-4 text-lg font-bold">Application Progress</h2>

                <div className="grid gap-5 md:grid-cols-3">
                  {progressCards.map((card) => (
                    <div
                      key={card.title}
                      className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-semibold text-gray-500">
                            {card.title}
                          </p>
                          <h3 className="mt-3 text-3xl font-extrabold">
                            {card.value}
                          </h3>
                        </div>

                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-xl">
                          {card.icon}
                        </div>
                      </div>

                      <p className="mt-3 text-xs text-gray-500">
                        <span className="font-bold text-green-600">
                          {card.change}
                        </span>{" "}
                        {card.note}
                      </p>

                      <div className="mt-5 flex items-center justify-between text-sm">
                        <a href="#" className="font-bold text-blue-600">
                          View Report
                        </a>
                        <span>→</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                  <h2 className="text-lg font-bold">Interview Opportunities</h2>

                  <div className="mt-5 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-500">
                        Interview Invitations
                      </p>
                      <h3 className="mt-2 text-3xl font-extrabold">20</h3>
                      <p className="mt-1 text-xs font-bold text-green-600">
                        +17%
                      </p>
                    </div>

                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-100 text-2xl">
                      💼
                    </div>
                  </div>

                  <a href="#" className="mt-5 inline-block text-sm font-bold text-blue-600">
                    View All Interviews
                  </a>
                </div>

                <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                  <h2 className="text-lg font-bold">
                    Connection and Network Growth
                  </h2>

                  <div className="mt-5 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-500">
                        New Connections
                      </p>
                      <h3 className="mt-2 text-3xl font-extrabold">73</h3>
                      <p className="mt-1 text-xs font-bold text-green-600">
                        +12%
                      </p>
                    </div>

                    <div>
                      <p className="text-sm font-semibold text-gray-500">
                        Network Growth
                      </p>
                      <h3 className="mt-2 text-3xl font-extrabold">2,765</h3>
                      <p className="mt-1 text-xs font-bold text-green-600">
                        +35%
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 h-16 rounded-xl bg-gradient-to-r from-blue-50 to-purple-50 p-3">
                    <div className="h-full rounded-lg bg-white/60" />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="text-lg font-bold">Job Recommendations</h2>
                  <a href="#" className="text-sm font-bold text-blue-600">
                    View All Jobs
                  </a>
                </div>

                <div className="grid gap-5 md:grid-cols-3">
                  {jobRecommendations.map((job) => (
                    <div
                      key={job.title}
                      className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
                    >
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
                          <span
                            key={tag}
                            className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>

                      <div className="mt-5">
                        <div className="flex justify-between text-xs font-bold text-gray-500">
                          <span>{job.match} match with your profile</span>
                        </div>
                        <div className="mt-2 h-2 rounded-full bg-gray-100">
                          <div
                            className="h-2 rounded-full bg-blue-600"
                            style={{ width: job.match }}
                          />
                        </div>
                      </div>

                      <button className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white">
                        Apply Now
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <aside className="col-span-12 space-y-6 xl:col-span-3">
              <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold">Profile Strength</h2>

                <div className="mt-5 flex justify-center">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full border-8 border-blue-100 bg-blue-50 text-3xl">
                    👤
                  </div>
                </div>

                <div className="mt-6 space-y-4">
                  <div>
                    <div className="flex justify-between text-xs font-bold text-gray-500">
                      <span>Profile Completed</span>
                      <span>90%</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-gray-100">
                      <div className="h-2 w-[90%] rounded-full bg-blue-600" />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-bold text-gray-500">
                      <span>Profile Strength</span>
                      <span>70%</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-gray-100">
                      <div className="h-2 w-[70%] rounded-full bg-cyan-500" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold">Skill Development</h2>

                <div className="mt-5 space-y-4">
                  {[
                    ["Resume Optimization", "73%"],
                    ["Job Matching", "89%"],
                  ].map(([name, percent]) => (
                    <div key={name} className="rounded-xl bg-slate-50 p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold">{name}</p>
                        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-600">
                          {percent}
                        </span>
                      </div>
                      <a href="#" className="mt-2 block text-xs font-bold text-blue-600">
                        Continue Course
                      </a>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold">AI Usage</h2>
                <p className="mt-2 text-sm text-gray-500">
                  Monthly AI generation usage.
                </p>

                <div className="mt-5">
                  <div className="flex justify-between text-xs font-bold text-gray-500">
                    <span>Used</span>
                    <span>41 / 100</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-gray-100">
                    <div className="h-2 w-[41%] rounded-full bg-green-500" />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold">Next Suggestion</h2>
                <p className="mt-3 text-sm leading-6 text-gray-600">
                  Add your latest resume so Career Élan can create stronger
                  job-specific applications.
                </p>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}