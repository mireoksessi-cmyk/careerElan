"use client";

import Image from "next/image";
import { ChangeEvent, useRef, useState } from "react";

type PasteMode = "url" | "description" | "file";

type JobAnalysis = {
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

type GeneratedPackage = {
  resume: string;
  coverLetter: string;
  emailDraft: string;
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

const emptyAnalysis: JobAnalysis = {
  title: "Job Posting",
  company: "Detected Company",
  location: "Canada",
  type: "Full-time",
  category: "General",
  icon: "💼",
  match: "--",
  keywordCount: 0,
  requirementsMatched: 0,
  keywords: [],
  summary: "Analyze a job posting to see the detected role, keywords, and match details.",
};

export default function PasteJobPage() {
  const [activeMode, setActiveMode] = useState<PasteMode>("url");
  const [jobUrl, setJobUrl] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [message, setMessage] = useState("");
  const [analysis, setAnalysis] = useState<JobAnalysis>(emptyAnalysis);
  const [analyzed, setAnalyzed] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedPreview, setSelectedPreview] = useState<
    "resume" | "coverLetter" | "emailDraft"
  >("resume");

  const [packageData, setPackageData] = useState<GeneratedPackage>({
    resume: "",
    coverLetter: "",
    emailDraft: "",
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function getCurrentJobText() {
    if (activeMode === "url") return jobUrl.trim();
    if (activeMode === "description") return jobDescription.trim();
    if (activeMode === "file") return fileText.trim() || selectedFileName.trim();
    return "";
  }

  async function handleAnalyze() {
    const jobText = getCurrentJobText();

    if (!jobText) {
      alert("Please add a job URL, job description, or upload a file first.");
      return;
    }

    setIsAnalyzing(true);
    setMessage("");
    setAnalyzed(false);
    setGenerated(false);

    try {
      const isUrlMode = activeMode === "url";

    const res = await fetch(isUrlMode ? "/api/analyze-job-url" : "/api/analyze-job", {
     method: "POST",
    headers: {
    "Content-Type": "application/json",
    },
    body: JSON.stringify(
    isUrlMode
      ? { jobUrl: jobText }
      : { jobText }
    ),
    });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to analyze job.");
      }

      setAnalysis({
        title: data.title || "Job Posting",
        company: data.company || "Detected Company",
        location: data.location || "Canada",
        type: data.type || "Full-time",
        category: data.category || "General",
        icon: data.icon || "💼",
        match: data.match || "80%",
        keywordCount: data.keywordCount || 0,
        requirementsMatched: data.requirementsMatched || 0,
        keywords: Array.isArray(data.keywords) ? data.keywords : [],
        summary: data.summary || "Job posting analyzed successfully.",
      });

      setAnalyzed(true);
      setMessage("Job posting analyzed successfully. You can now generate your package.");
    } catch (error) {
      console.error(error);
      alert("AI analysis failed. Check your API key and server console.");
      setMessage("AI analysis failed. Please check your API route and OpenAI key.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  function handleGeneratePackage() {
    if (!analyzed) {
      alert("Please analyze the job posting first.");
      return;
    }

    setIsGenerating(true);
    setMessage("");

    setTimeout(() => {
      const title = analysis.title || "this position";
      const company = analysis.company || "your company";
      const location = analysis.location || "Canada";
      const keywords =
        analysis.keywords?.length > 0
          ? analysis.keywords.join(", ")
          : "communication, organization, and attention to detail";

      setPackageData({
        resume: `Professional Summary

Detail-oriented candidate applying for ${title} at ${company}. Experienced in communication, organization, client support, document handling, and professional office tasks.

Relevant Skills
• ${analysis.keywords?.[0] || "Communication"}
• ${analysis.keywords?.[1] || "Organization"}
• ${analysis.keywords?.[2] || "Microsoft Office"}
• ${analysis.keywords?.[3] || "Client Service"}
• ${analysis.keywords?.[4] || "Attention to Detail"}

Target Role
${title}
${company}
${location}

Experience Highlights
• Supported client-facing communication and documentation.
• Organized files, records, and application materials.
• Managed administrative tasks with accuracy and professionalism.
• Demonstrated strong attention to detail and reliability.

ATS Keywords
${keywords}`,

        coverLetter: `Dear Hiring Manager,

I am writing to express my interest in the ${title} position at ${company}. After reviewing the job posting, I believe my background in administration, communication, document handling, and client support aligns well with the requirements of this role.

The posting emphasizes skills such as ${keywords}. These are areas where I can contribute through my experience, attention to detail, and ability to support professional office operations.

I am confident that my work ethic, communication skills, and willingness to learn would allow me to make a positive contribution to your team.

Thank you for your time and consideration. I would welcome the opportunity to discuss how my experience can support ${company}.

Sincerely,
David Kwak`,

        emailDraft: `Subject: Application for ${title}

Dear Hiring Manager,

I hope you are doing well.

Please find attached my resume and cover letter for the ${title} position at ${company}. I am very interested in this opportunity and would appreciate the chance to be considered.

Thank you for your time and consideration.

Best regards,
David Kwak`,
      });

      setGenerated(true);
      setIsGenerating(false);
      setMessage("Your application package is ready. Review each item before applying.");
    }, 700);
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    setAnalyzed(false);
    setGenerated(false);

    if (file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")) {
      const text = await file.text();
      setFileText(text);
      setMessage(`Selected file: ${file.name}. TXT content loaded. Click Analyze Uploaded File.`);
      return;
    }

    setFileText(file.name);
    setMessage(
      `Selected file: ${file.name}. File upload is selected. For PDF/DOCX/image extraction, connect server-side parsing later.`
    );
  }

  function copyPreviewText() {
    navigator.clipboard.writeText(packageData[selectedPreview]);
    setMessage("Copied to clipboard.");
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
                  item.label === "Paste Job"
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
              Unlock unlimited AI package generation.
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
                Create Package › Paste Job URL or Description
              </div>
              <h1 className="mt-2 text-3xl font-extrabold">
                Paste Job URL or Description
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Paste a job URL, description, or upload a file. We’ll analyze it and generate your full package.
              </p>
            </div>

            <a
              href="/create-package"
              className="rounded-xl border border-blue-100 bg-white px-5 py-3 text-sm font-bold text-gray-600 shadow-sm hover:bg-blue-50"
            >
              ← Back to Choose Method
            </a>
          </header>

          <div className="grid gap-6 xl:grid-cols-12">
            <section className="xl:col-span-8">
              <div className="rounded-2xl border border-blue-100 bg-white shadow-sm">
                <div className="grid grid-cols-3 border-b border-blue-100 bg-slate-50">
                  <button
                    onClick={() => setActiveMode("url")}
                    className={`px-5 py-4 text-sm font-extrabold ${
                      activeMode === "url"
                        ? "border-b-4 border-blue-600 bg-white text-blue-600"
                        : "text-gray-500 hover:bg-blue-50"
                    }`}
                  >
                    🔗 Paste URL
                  </button>

                  <button
                    onClick={() => setActiveMode("description")}
                    className={`px-5 py-4 text-sm font-extrabold ${
                      activeMode === "description"
                        ? "border-b-4 border-blue-600 bg-white text-blue-600"
                        : "text-gray-500 hover:bg-blue-50"
                    }`}
                  >
                    📄 Paste Description
                  </button>

                  <button
                    onClick={() => {
                      setActiveMode("file");
                      fileInputRef.current?.click();
                    }}
                    className={`px-5 py-4 text-sm font-extrabold ${
                      activeMode === "file"
                        ? "border-b-4 border-blue-600 bg-white text-blue-600"
                        : "text-gray-500 hover:bg-blue-50"
                    }`}
                  >
                    ☁️ Upload File
                  </button>
                </div>

                <div className="p-7">
                  {activeMode === "url" && (
                    <div>
                      <label className="text-sm font-bold">Job Posting URL</label>
                      <div className="mt-3 flex gap-3">
                        <input
                          value={jobUrl}
                          onChange={(e) => {
                            setJobUrl(e.target.value);
                            setMessage("");
                            setAnalyzed(false);
                            setGenerated(false);
                          }}
                          placeholder="https://www.linkedin.com/jobs/view/1234567890"
                          className="flex-1 rounded-xl border border-blue-100 px-5 py-3 text-sm outline-none focus:border-blue-500"
                        />
                        <button
                          onClick={handleAnalyze}
                          disabled={isAnalyzing}
                          className="rounded-xl bg-blue-600 px-7 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                          {isAnalyzing ? "Analyzing..." : "Analyze Job"}
                        </button>
                      </div>
                    </div>
                  )}

                  {activeMode === "description" && (
                    <div>
                      <label className="text-sm font-bold">Full Job Description</label>
                      <textarea
                        rows={9}
                        value={jobDescription}
                        onChange={(e) => {
                          setJobDescription(e.target.value);
                          setMessage("");
                          setAnalyzed(false);
                          setGenerated(false);
                        }}
                        placeholder="Paste the full job description here..."
                        className="mt-3 w-full resize-none rounded-xl border border-blue-100 px-5 py-4 text-sm outline-none focus:border-blue-500"
                      />
                      <button
                        onClick={handleAnalyze}
                        disabled={isAnalyzing}
                        className="mt-4 rounded-xl bg-blue-600 px-7 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                      >
                        {isAnalyzing ? "Analyzing..." : "Analyze Job"}
                      </button>
                    </div>
                  )}

                  {activeMode === "file" && (
                    <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-10 text-center">
                      <div className="text-5xl">☁️</div>
                      <h3 className="mt-4 text-xl font-extrabold">
                        Upload a job posting
                      </h3>
                      <p className="mt-2 text-sm text-gray-500">
                        Upload TXT, PDF, DOCX, PNG, JPG, or JPEG.
                      </p>

                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-6 rounded-xl bg-blue-600 px-8 py-3 text-sm font-bold text-white hover:bg-blue-700"
                      >
                        Choose File
                      </button>

                      {selectedFileName && (
                        <p className="mt-4 text-sm font-bold text-blue-600">
                          Attached: {selectedFileName}
                        </p>
                      )}

                      <button
                        onClick={handleAnalyze}
                        disabled={isAnalyzing}
                        className="mt-5 rounded-xl border border-blue-600 bg-white px-8 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50 disabled:opacity-60"
                      >
                        {isAnalyzing ? "Analyzing..." : "Analyze Uploaded File"}
                      </button>
                    </div>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.pdf,.docx,.png,.jpg,.jpeg"
                    className="hidden"
                    onChange={handleFileUpload}
                  />

                  {message && (
                    <p className="mt-5 rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
                      {message}
                    </p>
                  )}
                </div>
              </div>

              <section className="mt-6 rounded-2xl border border-blue-100 bg-white p-7 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-4xl">
                    {analysis.icon}
                  </div>
                  <div>
                    <h2 className="text-2xl font-extrabold">{analysis.title}</h2>
                    <p className="mt-1 text-sm text-gray-500">
                      {analysis.company} · {analysis.location} · {analysis.type}
                    </p>
                    <p className="mt-1 text-xs font-bold text-blue-600">
                      {analysis.category}
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-gray-100 p-5">
                    <h3 className="text-3xl font-extrabold text-green-600">
                      {analysis.match}
                    </h3>
                    <p className="mt-1 text-sm font-semibold text-gray-500">ATS Match</p>
                  </div>

                  <div className="rounded-2xl border border-gray-100 p-5">
                    <h3 className="text-3xl font-extrabold text-blue-600">
                      {analysis.keywordCount}
                    </h3>
                    <p className="mt-1 text-sm font-semibold text-gray-500">Keywords Found</p>
                  </div>

                  <div className="rounded-2xl border border-gray-100 p-5">
                    <h3 className="text-3xl font-extrabold text-purple-600">
                      {analysis.requirementsMatched}
                    </h3>
                    <p className="mt-1 text-sm font-semibold text-gray-500">Requirements Matched</p>
                  </div>
                </div>

                <div className="mt-6 rounded-2xl bg-slate-50 p-5">
                  <h3 className="font-extrabold">Detected Job Summary</h3>
                  <p className="mt-2 text-sm leading-7 text-gray-600">
                    {analysis.summary}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {analysis.keywords.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-blue-50 px-3 py-2 text-xs font-bold text-blue-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleGeneratePackage}
                  disabled={!analyzed || isGenerating}
                  className="mt-6 w-full rounded-xl bg-blue-600 px-7 py-4 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isGenerating
                    ? "Generating Package..."
                    : generated
                    ? "✅ Package Generated"
                    : "Generate Full Package ✨"}
                </button>
              </section>

              <section className="mt-6 rounded-2xl border border-blue-100 bg-white p-7 shadow-sm">
                <h2 className="text-xl font-extrabold">Generated Application Package</h2>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  {[
                    ["resume", "📄", "Resume"],
                    ["coverLetter", "✉️", "Cover Letter"],
                    ["emailDraft", "📧", "Email Draft"],
                  ].map(([key, icon, label]) => (
                    <button
                      key={key}
                      onClick={() => {
                        if (!generated) {
                          alert("Generate the package first.");
                          return;
                        }
                        setSelectedPreview(key as "resume" | "coverLetter" | "emailDraft");
                      }}
                      className={`rounded-2xl border p-5 text-left transition ${
                        generated && selectedPreview === key
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-100 bg-slate-50 hover:bg-blue-50"
                      }`}
                    >
                      <div className="text-3xl">{icon}</div>
                      <h3 className="mt-3 font-extrabold">{label}</h3>
                      <p className="mt-1 text-xs text-gray-500">
                        {generated ? "Ready to review" : "Generate to unlock"}
                      </p>
                    </button>
                  ))}
                </div>

                {generated && (
                  <div className="mt-6 rounded-2xl border border-blue-100 bg-white p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="font-extrabold">
                        {selectedPreview === "resume"
                          ? "Resume Preview"
                          : selectedPreview === "coverLetter"
                          ? "Cover Letter Preview"
                          : "Email Draft Preview"}
                      </h3>

                      <button
                        onClick={copyPreviewText}
                        className="rounded-lg border border-blue-100 px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
                      >
                        Copy
                      </button>
                    </div>

                    <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 p-5 text-sm leading-7 text-gray-700">
                      {packageData[selectedPreview]}
                    </pre>
                  </div>
                )}
              </section>
            </section>

            <aside className="xl:col-span-4">
              <div className="sticky top-6 rounded-2xl border border-blue-100 bg-white p-7 shadow-sm">
                <h2 className="text-2xl font-extrabold">What happens next?</h2>

                <div className="mt-8 space-y-6">
                  {[
                    ["1", "Analyze the job posting", "AI extracts role details, keywords, and requirements."],
                    ["2", "Match with your profile", "Career Élan checks how your background fits."],
                    ["3", "Generate full package", "Resume, cover letter, and email draft are created."],
                    ["4", "Apply directly", "You review, edit, and apply on the employer website."],
                  ].map(([num, title, desc]) => (
                    <div key={num} className="flex gap-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                        {num}
                      </div>
                      <div>
                        <h3 className="font-extrabold">{title}</h3>
                        <p className="mt-1 text-sm leading-6 text-gray-500">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}