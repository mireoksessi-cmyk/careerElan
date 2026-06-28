"use client";

import Image from "next/image";
import { ChangeEvent, useRef, useState } from "react";

const menuItems = [
  "Dashboard",
  "Career Memory",
  "Application Center",
  "Job Tracker",
  "Analytics",
  "Settings",
];

const applicantItems = [
  { title: "Resume", description: "Ready to review and send", icon: "📄" },
  { title: "Cover Letter", description: "Tailored to this job", icon: "✉️" },
  { title: "Email Draft", description: "Copy or send from Career Élan", icon: "📧" },
];

const privateItems = [
  { title: "Interview Prep", description: "Private practice", icon: "🎤" },
  { title: "Company Summary", description: "Private research", icon: "🏢" },
  { title: "ATS Match Report", description: "Private feedback", icon: "📊" },
];

type JobData = {
  title: string;
  company: string;
  location: string;
  type: string;
  category: string;
  icon: string;
  match: string;
  keywordCount: number;
  requirementsMatched: number;
  keywords: string[];
  summary: string;
};

const defaultJobData: JobData = {
  title: "Job Posting",
  company: "Detected Company",
  location: "Canada",
  type: "Full-time",
  category: "General",
  icon: "💼",
  match: "78%",
  keywordCount: 12,
  requirementsMatched: 8,
  keywords: [
    "Communication",
    "Organization",
    "Customer Service",
    "Problem Solving",
    "Teamwork",
    "+4 more",
  ],
  summary:
    "Paste a job posting and Career Élan will analyze the role, company, keywords, requirements, and ATS match.",
};

function getMenuHref(item: string) {
  if (item === "Dashboard") return "/dashboard";
  if (item === "Career Memory") return "/career-memory";
  if (item === "Application Center") return "/application-center";
  if (item === "Job Tracker") return "/job-tracker";
  if (item === "Analytics") return "/analytics";
  if (item === "Settings") return "/settings";
  return "#";
}

function isLikelyUrl(text: string) {
  return /^https?:\/\//i.test(text.trim()) || text.trim().startsWith("www.");
}

function isLikelyOnlyUrl(text: string) {
  const trimmed = text.trim();
  return isLikelyUrl(trimmed) && !/\s/.test(trimmed);
}

export default function ApplicationCenterPage() {
  const [jobInput, setJobInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [jobData, setJobData] = useState<JobData>(defaultJobData);
  const [inputMessage, setInputMessage] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function analyzeText(jobText: string) {
    const res = await fetch("/api/analyze-job", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jobText }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to analyze job.");
    }

    setJobData(data);
    setAnalyzed(true);
  }

  async function handleAnalyzeJob() {
    if (!jobInput.trim()) {
      alert("Please paste a job URL, job description, or upload a job posting first.");
      return;
    }

    setIsAnalyzing(true);
    setAnalyzed(false);
    setInputMessage("");

    try {
      if (isLikelyOnlyUrl(jobInput)) {
        setInputMessage(
          "Trying to read this job URL. If the page blocks access, paste the job description or upload a PDF, DOCX, or screenshot."
        );

        const res = await fetch("/api/analyze-job-url", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ jobUrl: jobInput.trim() }),
        });

        const data = await res.json();

        if (!res.ok) {
          setInputMessage(
            "Career Élan could not read this URL automatically. Please paste the job description or upload the job posting as a PDF, DOCX, or screenshot."
          );
          alert(
            "Could not read this job URL. Please paste the job description or upload a PDF, DOCX, or screenshot."
          );
          return;
        }

        setJobData(data);
        setAnalyzed(true);
        setInputMessage("URL successfully analyzed.");
        return;
      }

      await analyzeText(jobInput);
      setInputMessage("Job description successfully analyzed.");
    } catch (error) {
      console.error(error);
      alert("Something went wrong while analyzing the job.");
      setInputMessage(
        "Analysis failed. Please try pasting the job description directly or upload a PDF, DOCX, or screenshot."
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    setSelectedFileName(file.name);
    setInputMessage(`Selected file: ${file.name}. Upload analysis is ready to connect.`);
    setAnalyzed(false);

    const fileType = file.type;
    const fileName = file.name.toLowerCase();

    if (fileType === "text/plain" || fileName.endsWith(".txt")) {
      const text = await file.text();
      setJobInput(text);
      setInputMessage("TXT file loaded. Click Analyze Job to continue.");
      return;
    }

    if (fileName.endsWith(".pdf") || fileName.endsWith(".docx")) {
      setInputMessage(
        "PDF/DOCX selected. Next step: connect server-side text extraction, then Analyze Job."
      );
      return;
    }

    if (
      fileType.startsWith("image/") ||
      fileName.endsWith(".png") ||
      fileName.endsWith(".jpg") ||
      fileName.endsWith(".jpeg")
    ) {
      setInputMessage(
        "Screenshot selected. Next step: connect image reading/OCR, then Analyze Job."
      );
      return;
    }

    setInputMessage("Unsupported file type. Please upload TXT, PDF, DOCX, PNG, JPG, or JPEG.");
  }

  return (
    <main className="min-h-screen bg-[#f6fbff] text-gray-900">
      <div className="flex min-h-screen">
        <aside className="w-60 border-r border-blue-100 bg-white px-5 py-6">
          <Image src="/logo.png" alt="Career Élan" width={120} height={45} />

          <p className="mt-8 text-xs font-bold uppercase tracking-wider text-gray-400">
            Overview
          </p>

          <nav className="mt-4 space-y-2">
            {menuItems.map((item) => (
              <a
                key={item}
                href={getMenuHref(item)}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  item === "Application Center"
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
        </aside>

        <section className="flex-1 px-8 py-6">
          <header className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-extrabold">Application Center</h1>
              <p className="mt-1 text-sm text-gray-500">
                Create a company-specific application package for any job in minutes.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button className="rounded-full bg-white p-3 shadow-sm">🔔</button>
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 font-bold text-white">
                D
              </div>
            </div>
          </header>

          <section className="rounded-2xl border border-blue-100 bg-white p-7 shadow-sm">
            <h2 className="text-xl font-extrabold">Add a job to get started</h2>
            <p className="mt-1 text-sm text-gray-500">
              Paste a job URL, job description, or upload a job posting.
            </p>

            <div className="mt-6 rounded-2xl border-2 border-blue-300 bg-blue-50/40 p-6">
              <div className="flex items-center gap-4">
                <div className="text-3xl">✨</div>

                <div className="flex-1">
                  <textarea
                    rows={4}
                    value={jobInput}
                    onChange={(e) => {
                      setJobInput(e.target.value);
                      setInputMessage("");
                    }}
                    placeholder="Paste a job URL, job description, or drop a file here..."
                    className="w-full resize-none bg-transparent text-lg font-semibold outline-none placeholder:text-gray-500"
                  />
                  <p className="mt-2 text-sm text-gray-500">
                    Career Élan will use AI to detect the real job title, category, keywords, and requirements.
                  </p>

                  {inputMessage && (
                    <p className="mt-3 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-blue-700">
                      {inputMessage}
                    </p>
                  )}

                  {selectedFileName && (
                    <p className="mt-2 text-xs font-bold text-gray-500">
                      Attached: {selectedFileName}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-3xl transition hover:scale-110"
                  title="Upload job posting"
                >
                  📎
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.pdf,.docx,.png,.jpg,.jpeg"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
            </div>

            <div className="my-6 flex items-center gap-4">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-sm font-bold text-gray-400">OR</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              <button
                onClick={() => {
                  setJobInput("");
                  setInputMessage("Paste a job URL above, then click Analyze Job. If URL reading fails, paste the job description or upload a file.");
                }}
                className="rounded-2xl border border-gray-200 bg-white p-5 text-left transition hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-3xl">
                    🔗
                  </div>
                  <div>
                    <h3 className="font-extrabold">Paste Job URL</h3>
                    <p className="mt-1 text-sm leading-6 text-gray-500">
                      Indeed, LinkedIn, company career page, etc.
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => {
                  setJobInput("");
                  setInputMessage("Paste the full job description above, then click Analyze Job.");
                }}
                className="rounded-2xl border border-gray-200 bg-white p-5 text-left transition hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-50 text-3xl">
                    📋
                  </div>
                  <div>
                    <h3 className="font-extrabold">Paste Job Description</h3>
                    <p className="mt-1 text-sm leading-6 text-gray-500">
                      Copy and paste any posting directly.
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="rounded-2xl border border-gray-200 bg-white p-5 text-left transition hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 text-3xl">
                    ☁️
                  </div>
                  <div>
                    <h3 className="font-extrabold">Upload Job Posting</h3>
                    <p className="mt-1 text-sm leading-6 text-gray-500">
                      TXT now. PDF, DOCX, or screenshot next.
                    </p>
                  </div>
                </div>
              </button>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <p className="text-sm text-gray-500">🔒 Your data is secure and private.</p>

              <button
                onClick={handleAnalyzeJob}
                disabled={isAnalyzing}
                className="rounded-xl bg-blue-600 px-7 py-3 font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAnalyzing ? "Analyzing..." : "Analyze Job →"}
              </button>
            </div>
          </section>

          {isAnalyzing && (
            <section className="mt-6 rounded-2xl border border-blue-100 bg-white p-7 shadow-sm">
              <h2 className="text-xl font-extrabold">Analyzing Job...</h2>
              <div className="mt-5 space-y-4 text-sm font-semibold text-gray-600">
                <p>🔍 Reading job posting...</p>
                <p>🏢 Detecting company, role, and category...</p>
                <p>🧠 Matching with Career Memory...</p>
                <p>📊 Extracting ATS keywords...</p>
              </div>
            </section>
          )}

          <section className="mt-6 rounded-2xl border border-blue-100 bg-white p-7 shadow-sm">
            <div className="mb-5 flex items-center gap-3">
              <h2 className="text-xl font-extrabold">
                {analyzed ? "Job Analysis Result" : "Job Analysis Preview"}
              </h2>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  analyzed
                    ? "bg-blue-100 text-blue-700"
                    : "bg-green-100 text-green-700"
                }`}
              >
                {analyzed ? "Analyzed" : "Example"}
              </span>
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-4xl">
                    {jobData.icon}
                  </div>
                  <div>
                    <h3 className="text-2xl font-extrabold">{jobData.title}</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      {jobData.company} · {jobData.location} · {jobData.type}
                    </p>
                    <p className="mt-1 text-xs font-bold text-blue-600">
                      {jobData.category}
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-gray-100 p-5">
                    <h4 className="text-3xl font-extrabold text-green-600">
                      {jobData.match}
                    </h4>
                    <p className="mt-1 text-sm font-semibold text-gray-500">ATS Match</p>
                    <div className="mt-3 h-2 rounded-full bg-gray-100">
                      <div
                        className="h-2 rounded-full bg-green-500"
                        style={{ width: jobData.match }}
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-100 p-5">
                    <h4 className="text-3xl font-extrabold text-blue-600">
                      {jobData.keywordCount}
                    </h4>
                    <p className="mt-1 text-sm font-semibold text-gray-500">Keywords Found</p>
                    <div className="mt-3 h-2 rounded-full bg-gray-100">
                      <div className="h-2 w-[65%] rounded-full bg-blue-600" />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-100 p-5">
                    <h4 className="text-3xl font-extrabold text-purple-600">
                      {jobData.requirementsMatched}
                    </h4>
                    <p className="mt-1 text-sm font-semibold text-gray-500">Requirements Matched</p>
                    <div className="mt-3 h-2 rounded-full bg-gray-100">
                      <div className="h-2 w-[70%] rounded-full bg-purple-600" />
                    </div>
                  </div>
                </div>

                <div className="mt-6">
                  <h4 className="text-sm font-extrabold">Top Skills & Keywords</h4>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {jobData.keywords.map((keyword) => (
                      <span
                        key={keyword}
                        className="rounded-full bg-blue-50 px-3 py-2 text-xs font-bold text-blue-600"
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 p-6">
                <h3 className="font-extrabold">Job Summary</h3>
                <p className="mt-4 text-sm leading-7 text-gray-600">
                  {jobData.summary}
                </p>

                <button className="mt-5 font-bold text-blue-600">
                  View full analysis →
                </button>
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-blue-100 bg-white p-7 shadow-sm">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h2 className="text-xl font-extrabold">
                  Generate Application Materials
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Create employer-ready materials and private AI support for this job.
                </p>
              </div>

              <button
                disabled={!analyzed}
                className="rounded-xl bg-blue-600 px-7 py-3 font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ✨ Generate Materials
              </button>
            </div>

            {!analyzed && (
              <p className="mt-4 text-sm font-semibold text-gray-500">
                Analyze a job first to unlock material generation.
              </p>
            )}

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-extrabold uppercase tracking-wide text-gray-500">
                  Applicant Package
                </h3>
                <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-700">
                  Can be sent to employer
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {applicantItems.map((item) => (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-gray-100 bg-slate-50 p-4"
                  >
                    <div className="text-2xl">{item.icon}</div>
                    <h3 className="mt-3 text-sm font-extrabold">{item.title}</h3>
                    <p className="mt-1 text-xs text-gray-500">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-extrabold uppercase tracking-wide text-gray-500">
                  Private AI Tools
                </h3>
                <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-bold text-yellow-700">
                  Not sent to employer
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {privateItems.map((item) => (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-gray-100 bg-white p-4"
                  >
                    <div className="text-2xl">{item.icon}</div>
                    <h3 className="mt-3 text-sm font-extrabold">{item.title}</h3>
                    <p className="mt-1 text-xs text-gray-500">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}