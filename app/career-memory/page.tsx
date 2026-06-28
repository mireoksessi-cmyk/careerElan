"use client";

import Image from "next/image";
import { useState } from "react";

const steps = [
  {
    title: "Personal Information",
    description:
      "Your contact information and professional summary used across every application.",
  },
  {
    title: "Education",
    description:
      "Schools, degrees, GPA, coursework, and academic achievements that strengthen your profile.",
  },
  {
    title: "Work Experience",
    description:
      "Add your employment history. AI will rewrite your responsibilities into professional resume bullet points.",
  },
  {
    title: "Volunteer Experience",
    description:
      "Community service, internships, leadership, and unpaid experience that demonstrate your skills.",
  },
  {
    title: "Skills",
    description:
      "Technical skills, software, legal knowledge, customer service, and other professional abilities.",
  },
  {
    title: "Languages",
    description:
      "Languages you speak and your proficiency level, such as English, French, or Korean.",
  },
  {
    title: "Certifications",
    description:
      "Professional certifications, licenses, awards, and completed training.",
  },
  {
    title: "Projects",
    description:
      "School, personal, volunteer, or professional projects that showcase your experience.",
  },
  {
    title: "Career Goals",
    description:
      "Tell AI your target industry, preferred roles, locations, salary expectations, and long-term goals.",
  },
];

export default function CareerMemoryPage() {
  const [mode, setMode] = useState<"start" | "import" | "build">("start");

  return (
    <main className="min-h-screen bg-[#f6fbff] text-gray-900">
      <div className="flex min-h-screen">
        <aside className="w-60 border-r border-blue-100 bg-white px-5 py-6">
          <Image src="/logo.png" alt="Career Élan" width={120} height={45} />

          <p className="mt-8 text-xs font-bold uppercase tracking-wider text-gray-400">
            Overview
          </p>

          <nav className="mt-4 space-y-2">
            {[
              "Dashboard",
              "Career Memory",
              "Application Center",
              "Job Tracker",
              "Analytics",
              "Settings",
            ].map((item) => (
              <a
                key={item}
                href={
                item === "Dashboard"
                ? "/dashboard"
                : item === "Career Memory"
                ? "/career-memory"
                : item === "Application Center"
                ? "/application-center"
                : "#"
}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  item === "Career Memory"
                    ? "bg-blue-600 text-white"
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
        </aside>

        <section className="flex-1 px-8 py-6">
          <header className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-extrabold">Career Memory</h1>
              <p className="mt-1 text-sm text-gray-500">
                Your career database. AI uses this information to create
                company-specific application packages.
              </p>
            </div>

            {mode !== "start" && (
              <button className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white">
                Save Memory
              </button>
            )}
          </header>

          {mode === "start" && (
            <div className="grid gap-6 md:grid-cols-2">
              <button
                onClick={() => setMode("import")}
                className="rounded-2xl border border-blue-100 bg-white p-10 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="text-6xl">📄</div>
                <h2 className="mt-6 text-3xl font-extrabold">
                  Import Existing Resume
                </h2>
                <p className="mt-4 text-sm leading-6 text-gray-500">
                  Upload your PDF or DOCX resume. Career Élan will extract your
                  experience, education, skills, and certifications
                  automatically.
                </p>
                <div className="mt-8 inline-block rounded-xl bg-blue-600 px-6 py-3 font-bold text-white">
                  Import Resume
                </div>
              </button>

              <button
                onClick={() => setMode("build")}
                className="rounded-2xl border border-blue-100 bg-white p-10 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="text-6xl">✨</div>
                <h2 className="mt-6 text-3xl font-extrabold">
                  Build From Scratch
                </h2>
                <p className="mt-4 text-sm leading-6 text-gray-500">
                  Create your career profile step by step with AI guidance and
                  bullet point suggestions.
                </p>
                <div className="mt-8 inline-block rounded-xl border border-blue-600 px-6 py-3 font-bold text-blue-600">
                  Start Building
                </div>
              </button>
            </div>
          )}

          {mode === "import" && (
            <div className="rounded-2xl border border-blue-100 bg-white p-10 shadow-sm">
              <button
                onClick={() => setMode("start")}
                className="mb-6 font-bold text-blue-600"
              >
                ← Back
              </button>

              <h2 className="text-3xl font-extrabold">Import Resume</h2>
              <p className="mt-3 text-gray-500">
                Upload your existing resume to auto-fill your Career Memory.
              </p>

              <div className="mt-8 rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50 p-16 text-center">
                <div className="text-6xl">📄</div>
                <h3 className="mt-5 text-xl font-bold">
                  Drop your resume here
                </h3>
                <p className="mt-2 text-sm text-gray-500">
                  Supported formats: PDF, DOCX
                </p>

                <button className="mt-6 rounded-xl bg-blue-600 px-6 py-3 font-bold text-white">
                  Browse Files
                </button>
              </div>
            </div>
          )}

          {mode === "build" && (
            <>
              <div className="mb-8 rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
                <button
                  onClick={() => setMode("start")}
                  className="mb-4 font-bold text-blue-600"
                >
                  ← Back
                </button>

                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold">Profile Progress</h2>
                    <p className="text-sm text-gray-500">
                      Step 1 of 9 · Personal Information
                    </p>
                  </div>

                  <span className="rounded-full bg-blue-100 px-4 py-2 text-sm font-bold text-blue-700">
                    11% Complete
                  </span>
                </div>

                <div className="mt-5 h-3 rounded-full bg-gray-100">
                  <div className="h-3 w-[11%] rounded-full bg-blue-600" />
                </div>
              </div>

              <div className="grid grid-cols-12 gap-6">
                <aside className="col-span-12 rounded-2xl border border-blue-100 bg-white p-5 shadow-sm xl:col-span-3">
                  <h2 className="text-lg font-bold">Steps</h2>

                  <div className="mt-5 space-y-2">
                    {steps.map((step, index) => (
                      <button
                        key={step.title}
                        className={`w-full rounded-xl px-4 py-3 text-left transition ${
                          index === 0
                            ? "bg-blue-600 text-white"
                            : "text-gray-600 hover:bg-blue-50"
                        }`}
                      >
                        <p className="text-sm font-bold">
                          {index + 1}. {step.title}
                        </p>
                        <p
                          className={`mt-1 text-xs leading-5 ${
                            index === 0 ? "text-blue-100" : "text-gray-400"
                          }`}
                        >
                          {step.description}
                        </p>
                      </button>
                    ))}
                  </div>
                </aside>

                <section className="col-span-12 space-y-6 xl:col-span-6">
                  <div className="rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
                    <h2 className="text-xl font-bold">
                      Personal Information
                    </h2>

                    <p className="mt-2 text-sm text-gray-500">
                      Your contact information and professional summary used
                      across every application.
                    </p>

                    <div className="mt-6 grid gap-5 md:grid-cols-2">
                      <input
                        type="text"
                        placeholder="First Name"
                        className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600"
                      />

                      <input
                        type="text"
                        placeholder="Last Name"
                        className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600"
                      />

                      <input
                        type="email"
                        placeholder="Email"
                        className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600"
                      />

                      <input
                        type="text"
                        placeholder="Phone"
                        className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600"
                      />

                      <input
                        type="text"
                        placeholder="Location"
                        className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600"
                      />

                      <input
                        type="text"
                        placeholder="LinkedIn"
                        className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600"
                      />

                      <input
                        type="text"
                        placeholder="Professional Headline"
                        className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600 md:col-span-2"
                      />

                      <textarea
                        rows={5}
                        placeholder="Career Summary"
                        className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600 md:col-span-2"
                      />
                    </div>

                    <div className="mt-8 flex justify-end">
                      <button className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white">
                        Save & Continue →
                      </button>
                    </div>
                  </div>
                </section>

                <aside className="col-span-12 space-y-6 xl:col-span-3">
                  <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                    <h2 className="text-lg font-bold">Memory Strength</h2>
                    <p className="mt-2 text-sm text-gray-500">
                      More complete information creates better AI results.
                    </p>

                    <div className="mt-5 h-2 rounded-full bg-gray-100">
                      <div className="h-2 w-[11%] rounded-full bg-blue-600" />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                    <h2 className="text-lg font-bold">AI Suggestions</h2>
                    <ul className="mt-4 space-y-3 text-sm text-gray-600">
                      <li>• Add measurable achievements.</li>
                      <li>• Add at least 3 experiences.</li>
                      <li>• Add skills and language levels.</li>
                      <li>• Add certifications or awards.</li>
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                    <h2 className="text-lg font-bold">This Memory Powers</h2>
                    <div className="mt-4 space-y-3 text-sm font-semibold text-gray-600">
                      <p>📦 Application Packages</p>
                      <p>📄 Resume Generation</p>
                      <p>✉️ Cover Letter Generation</p>
                      <p>🎯 Job URL Analysis</p>
                    </div>
                  </div>
                </aside>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}