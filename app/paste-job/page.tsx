"use client";


import { exportDocx, exportPdf } from "@/lib/exportDocument";

import { useLogin } from "@/lib/auth/LoginManager";
import { supabase } from "@/lib/supabase";
import Image from "next/image";
import A4Preview from "../job-tracker/A4Preview";
import { useRouter } from "next/navigation";
import { ChangeEvent, useEffect, useRef, useState } from "react";

type PasteMode = "url" | "description" | "file";

type PreviewType = "resume" | "coverLetter" | "emailDraft";

type JobDetails = {
  description: string;
  responsibilities: string[];
  qualifications: string[];
  benefits: string[];
  salary: string;
  schedule: string;
  applyUrl: string;
};

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
  jobDetails: JobDetails;
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
  jobDetails: {
    description: "",
    responsibilities: [],
    qualifications: [],
    benefits: [],
    salary: "",
    schedule: "",
    applyUrl: "",
  },
};


export default function PasteJobPage() {
  const { user, loading } = useLogin();
  async function getApplicationData() {
  

  if (!user) return null;

  const { data: memory } = await supabase
    .from("career_memory")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const { data: resumes } = await supabase
    .from("resumes")
    .select("*")
    .eq("user_id", user.id);

  const { data: covers } = await supabase
    .from("cover_letters")
    .select("*")
    .eq("user_id", user.id);

  return {
    memory,
    resumes,
    covers,
  };
}
  const router = useRouter();
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
  const [selectedPreview, setSelectedPreview] = useState<PreviewType>("resume");
  const [showDefaultApplication, setShowDefaultApplication] = useState(false);

  const [packageData, setPackageData] = useState<GeneratedPackage>({
    resume: "",
    coverLetter: "",
    emailDraft: "",
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoAnalyzeStartedRef = useRef(false);
  

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const url = params.get("url");
    const title = params.get("title");

    if (url) {
      setActiveMode("url");
      setJobUrl(url);
      setAnalyzed(false);
      setGenerated(false);
      setMessage("Analyzing this job posting automatically...");

      if (!autoAnalyzeStartedRef.current) {
        autoAnalyzeStartedRef.current = true;
        setTimeout(() => {
          void analyzeJob(url, "url", "Analysis completed automatically from Find Jobs.");
        }, 0);
      }
    }

    if (title) {
      setAnalysis((prev) => ({
        ...prev,
        title,
      }));
    }
  }, []);

  function getCurrentJobText() {
    if (activeMode === "url") return jobUrl.trim();
    if (activeMode === "description") return jobDescription.trim();
    if (activeMode === "file") return fileText.trim() || selectedFileName.trim();
    return "";
  }

  function normalizeStringArray(value: unknown) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  }

  function normalizeJobDetails(data: any, fallbackUrl = ""): JobDetails {
    const details = data?.jobDetails || {};

    return {
      description:
        details.description ||
        data?.about ||
        data?.description ||
        data?.summary ||
        "",
      responsibilities: normalizeStringArray(
        details.responsibilities || data?.responsibilities || data?.tasks
      ),
      qualifications: normalizeStringArray(
        details.qualifications || data?.qualifications || data?.requirements
      ),
      benefits: normalizeStringArray(details.benefits || data?.benefits),
      salary: details.salary || data?.salary || data?.wage || "",
      schedule: details.schedule || data?.schedule || data?.type || "",
      applyUrl: details.applyUrl || fallbackUrl || "",
    };
  }

  function buildGeneratedPackage(nextAnalysis: JobAnalysis): GeneratedPackage {
    const title = nextAnalysis.title || "this position";
    const company = nextAnalysis.company || "your company";
    const location = nextAnalysis.location || "Canada";
    const keywords =
      nextAnalysis.keywords?.length > 0
        ? nextAnalysis.keywords.join(", ")
        : "communication, organization, and attention to detail";

    return {
      resume: `Professional Summary

Detail-oriented candidate applying for ${title} at ${company}. Experienced in communication, organization, client support, document handling, and professional office tasks.

Relevant Skills
• ${nextAnalysis.keywords?.[0] || "Communication"}
• ${nextAnalysis.keywords?.[1] || "Organization"}
• ${nextAnalysis.keywords?.[2] || "Microsoft Office"}
• ${nextAnalysis.keywords?.[3] || "Client Service"}
• ${nextAnalysis.keywords?.[4] || "Attention to Detail"}

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
    };
  }

  async function analyzeJob(
    jobText: string,
    mode: PasteMode,
    successMessage = "Job posting analyzed successfully. Your application package is ready."
  ) {
    if (!jobText.trim()) {
      alert("Please add a job URL, job description, or upload a file first.");
      return;
    }

    setIsAnalyzing(true);
    setMessage("Analyzing job posting...");

    try {
      const isUrlMode = mode === "url";

      const res = await fetch(
        isUrlMode ? "/api/analyze-job-url" : "/api/analyze-job",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(isUrlMode ? { jobUrl: jobText } : { jobText }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to analyze job.");
      }

      const nextAnalysis: JobAnalysis = {
        title: data.title || "Job Posting",
        company: data.company || "Detected Company",
        location: data.location || "Canada",
        type: data.type || "Full-time",
        category: data.category || "General",
        icon: data.icon || "💼",
        match: data.match || "80%",
        keywordCount: data.keywordCount || (Array.isArray(data.keywords) ? data.keywords.length : 0),
        requirementsMatched: data.requirementsMatched || 0,
        keywords: Array.isArray(data.keywords) ? data.keywords : [],
        summary: data.summary || "Job posting analyzed successfully.",
        jobDetails: normalizeJobDetails(data, isUrlMode ? jobText : jobUrl.trim()),
      };

      setAnalysis(nextAnalysis);
    setAnalyzed(true);
    setGenerated(false);
    setMessage(successMessage);
    } catch (error: any) {
      console.error(error);

      alert(
        error?.message ||
          "This website couldn't be analyzed automatically. Please paste the job description or upload a PDF, DOCX, or screenshot."
      );

      setMessage(
        error?.message ||
          "This website couldn't be analyzed automatically. Please paste the job description or upload a PDF, DOCX, or screenshot."
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleAnalyze() {
    const jobText = getCurrentJobText();

    await analyzeJob(
      jobText,
      activeMode,
      "Job posting analyzed successfully. Your application package has been refreshed."
    );
  }

  async function handleGeneratePackage() {
  if (!analyzed) {
    alert("Please analyze the job posting first.");
    return;
  }

  try {
    setIsGenerating(true);
    setMessage("");
    const applicationData =
await getApplicationData();
    const response = await fetch("/api/generate-package", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        analysis,
        jobText: getOriginalJobSnippet(),
        applicationData,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to generate package.");
    }

    setPackageData({
      resume: data.resume,
      coverLetter: data.coverLetter,
      emailDraft: data.emailDraft,
    });

    setSelectedPreview("resume");
    setGenerated(true);
    

   if (user) {
   await supabase.from("applications").insert({
    user_id: user.id,
    company: analysis.company,
    job_title: analysis.title,
    status: "package_generated",
    applied_date: new Date().toISOString().split("T")[0],
    });
   }

    setMessage(
      "Your AI-tailored application package has been generated successfully."
    );
  } catch (error: any) {
    alert(error.message || "Failed to generate package.");
  } finally {
    setIsGenerating(false);
  }
}

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);

    if (file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")) {
      const text = await file.text();
      setFileText(text);
      setMessage("Ready to analyze your new job posting. Click Analyze Uploaded File to update the page.");
      return;
    }

    setFileText(file.name);
    setMessage(
      "Ready to analyze your new job posting. Click Analyze Uploaded File to update the page. For PDF/DOCX/image extraction, connect server-side parsing later."
    );
  }

  function copyPreviewText() {
    navigator.clipboard.writeText(packageData[selectedPreview]);
    setMessage("Copied to clipboard.");
  }

  function getSavedTextByKeys(source: unknown, keys: string[]): string {
    if (!source || typeof source !== "object") return "";

    const objectValue = source as Record<string, unknown>;

    for (const [key, value] of Object.entries(objectValue)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");

      if (
        keys.some((targetKey) =>
          normalizedKey.includes(targetKey.toLowerCase().replace(/[^a-z]/g, ""))
        ) &&
        typeof value === "string" &&
        value.trim().length > 0
      ) {
        return value.trim();
      }
    }

    for (const value of Object.values(objectValue)) {
      if (value && typeof value === "object") {
        const nested = getSavedTextByKeys(value, keys);
        if (nested) return nested;
      }
    }

    return "";
  }

  function isCompleteApplicationMaterial(text: string) {
    const cleaned = text.trim();

    if (cleaned.length < 80) return false;

    const incompletePhrases = [
      "upload resume",
      "add resume",
      "complete your resume",
      "no saved resume",
      "no resume",
      "no saved cover",
      "no cover letter",
      "placeholder",
      "example only",
      "draft only",
    ];

    return !incompletePhrases.some((phrase) =>
      cleaned.toLowerCase().includes(phrase)
    );
  }

  async function getSavedApplicationMaterials() {
  const applicationData = await getApplicationData();

  if (!applicationData) {
    return {
      resume: "",
      coverLetter: "",
    };
  }

  const { memory, resumes, covers } = applicationData;

  const selectedResume = resumes?.find(
    (r) => r.id === memory?.selected_resume_id
  );

  const selectedCover = covers?.find(
    (c) => c.id === memory?.selected_cover_letter_id
  );

  return {
    resume: selectedResume?.original_text || "",
    coverLetter: selectedCover?.original_text || "",
  };
}

   
  

  async function handleApplyNow() {
    const { resume, coverLetter } =
  await getSavedApplicationMaterials();
    const hasCompleteResume = isCompleteApplicationMaterial(resume);
    const hasCompleteCoverLetter = isCompleteApplicationMaterial(coverLetter);

    if (!hasCompleteResume && !hasCompleteCoverLetter) {
      const shouldGoToCareerMemory = window.confirm(
        "Your saved resume or cover letter is missing or incomplete. Go to Career Memory to complete it now?"
      );

      if (shouldGoToCareerMemory) {
        router.push("/career-memory");
      } else {
        setMessage(
          "Your saved application materials are missing or incomplete. Complete Career Memory before using this option."
        );
      }

      return;
    }

    setPackageData((prev) => ({
      resume: hasCompleteResume ? resume : prev.resume || "No complete saved resume found.",
      coverLetter: hasCompleteCoverLetter
        ? coverLetter
        : prev.coverLetter || "No complete saved cover letter found.",
      emailDraft:
        prev.emailDraft ||
        `Subject: Application for ${analysis.title}

Dear Hiring Manager,

I hope you are doing well.

I would like to apply for the ${analysis.title} position at ${analysis.company}. Please find my application materials attached.

Best regards,
David Kwak`,
    }));

    setSelectedPreview(hasCompleteResume ? "resume" : "coverLetter");
    setGenerated(true);
    setShowDefaultApplication(true);
    setMessage(
      hasCompleteResume && hasCompleteCoverLetter
        ? "Your saved resume and cover letter are ready. Preview, edit, save, or continue to the employer website."
        : "One complete saved application material was found. You can preview, edit, save, or continue to the employer website."
    );
  }

  function continueToApply() {
    const targetUrl = analysis.jobDetails.applyUrl || jobUrl.trim();

    if (!targetUrl) {
      alert("No employer apply link is available. Paste the job URL first.");
      return;
    }

    window.open(targetUrl, "_blank", "noopener,noreferrer");
  }
  
async function downloadPdf() {
  await exportPdf(
    packageData[selectedPreview],
    `${getFileBaseName()}_${selectedPreview}`
  );
}


async function downloadDocx() {
  await exportDocx(
    packageData[selectedPreview],
    `${getFileBaseName()}_${selectedPreview}`
  );
}

  async function savePackage() {
  

  if (!user) return;

  const { error } = await supabase
    .from("applications")
    .update({
      job_url: jobUrl,
      location: analysis.location,
      job_type: analysis.type,

      resume_text: packageData.resume,
      cover_letter_text: packageData.coverLetter,
      email_draft: packageData.emailDraft,

      job_analysis: analysis,

      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("company", analysis.company)
    .eq("job_title", analysis.title);

  if (error) {
    alert(error.message);
    return;
  }

  alert("Application package has been saved successfully!");

  setMessage("Application package saved to cloud.");
}

  function sanitizeFileName(value: string) {
    return value
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 70)
      .toLowerCase();
  }

  function getFileBaseName() {
    const company = sanitizeFileName(analysis.company || "company");
    const title = sanitizeFileName(analysis.title || "job_application");
    return `${company}_${title}`;
  }

  function downloadTextFile(fileName: string, text: string, mimeType = "text/plain;charset=utf-8") {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadSelected(extension: "docx" | "pdf" | "txt") {
    if (!generated) {
      alert("Generate the package first.");
      return;
    }

    const labelMap: Record<PreviewType, string> = {
      resume: "resume",
      coverLetter: "cover_letter",
      emailDraft: "email_draft",
    };

    const mimeMap = {
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pdf: "application/pdf",
      txt: "text/plain;charset=utf-8",
    };

    downloadTextFile(
      `${getFileBaseName()}_${labelMap[selectedPreview]}.${extension}`,
      packageData[selectedPreview],
      mimeMap[extension]
    );
  }

  function getPreviewLabel() {
    if (selectedPreview === "resume") return "Resume Preview";
    if (selectedPreview === "coverLetter") return "Cover Letter Preview";
    return "Email Draft Preview";
  }

  function getPreviewIcon() {
    if (selectedPreview === "resume") return "📄";
    if (selectedPreview === "coverLetter") return "✉️";
    return "📧";
  }

  function getOriginalJobSnippet() {
    if (analysis.jobDetails.description.trim()) return analysis.jobDetails.description.trim();
    if (jobDescription.trim()) return jobDescription.trim();
    if (fileText.trim() && fileText !== selectedFileName) return fileText.trim();
    return analysis.summary;
  }

  function hasJobDetails() {
    return (
      Boolean(analysis.jobDetails.description) ||
      analysis.jobDetails.responsibilities.length > 0 ||
      analysis.jobDetails.qualifications.length > 0 ||
      analysis.jobDetails.benefits.length > 0 ||
      Boolean(analysis.jobDetails.salary) ||
      Boolean(analysis.jobDetails.schedule)
    );
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

            <button
              onClick={() => router.back()}
              className="rounded-xl border border-blue-100 bg-white px-5 py-3 text-sm font-bold text-gray-600 shadow-sm hover:bg-blue-50"
            >
              ← Back to Results
            </button>
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
                            setMessage("New job detected. Click Analyze Job to update the page.");
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
                          setMessage("Ready to analyze your new job posting. Click Analyze Job to update the page.");
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

                <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-6">
                  <h3 className="text-xl font-extrabold">Your Saved Application</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-600">
                    We&apos;ll use your saved Career Memory materials. Generate a tailored package below if you want a stronger version for this specific job.
                  </p>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-gray-100 bg-white p-5">
                      <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-2xl">
                          📄
                        </div>
                        <div>
                          <h4 className="font-extrabold">Saved Resume</h4>
                          <p className="mt-2 text-sm leading-6 text-gray-500">
                            Your default resume from Career Memory will be used for this application.
                          </p>
                          <button className="mt-3 rounded-xl border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50">
                            👁 Preview
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-gray-100 bg-white p-5">
                      <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-2xl">
                          ✉️
                        </div>
                        <div>
                          <h4 className="font-extrabold">Saved Cover Letter</h4>
                          <p className="mt-2 text-sm leading-6 text-gray-500">
                            Your default cover letter from Career Memory will be used for this application.
                          </p>
                          <button className="mt-3 rounded-xl border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50">
                            👁 Preview
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {showDefaultApplication && (
                    <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm font-semibold text-blue-700">
                      Your saved application is ready. You can continue to the employer website or generate a stronger AI-tailored package first.
                    </div>
                  )}

                  <button
                    onClick={handleGeneratePackage}
                    disabled={!analyzed || isGenerating}
                    className="mt-6 flex w-full items-center justify-between rounded-2xl bg-gradient-to-r from-purple-600 to-violet-700 px-6 py-5 text-left text-white shadow-sm transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/95 text-2xl text-purple-700">
                        ✨
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xl font-extrabold">
                            {isGenerating
                              ? "Generating Package..."
                              : generated
                              ? "✅ Package Generated"
                              : "Generate Full Package ✨"}
                          </h3>
                          <span className="rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold text-white">
                            Recommended
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-semibold text-white/90">
                          Generate a tailored resume, cover letter, and email draft so you&apos;re ready to apply in minutes.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold text-white">
                            Tailored to this job
                          </span>
                          <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold text-white">
                            AI-optimized content
                          </span>
                          <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold text-white">
                            Apply in minutes
                          </span>
                        </div>
                      </div>
                    </div>
                    <span className="text-3xl">›</span>
                  </button>

                  <button
                    onClick={handleApplyNow}
                    className="mt-4 flex w-full items-center justify-between rounded-2xl border border-blue-200 bg-white px-6 py-5 text-left shadow-sm transition hover:border-blue-400 hover:bg-blue-50"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-2xl">
                        🛩️
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xl font-extrabold text-gray-900">
                            Apply with Saved Resume
                          </h3>
                          <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-bold text-blue-600">
                            Quick
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-semibold text-gray-500">
                          Apply using your saved Career Memory resume and cover letter.
                        </p>
                      </div>
                    </div>
                    <span className="text-3xl text-gray-500">›</span>
                  </button>

                  <button
                    onClick={continueToApply}
                    className="mt-4 flex w-full items-center justify-between rounded-2xl border border-gray-200 bg-white px-6 py-5 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-2xl">
                        🌐
                      </div>
                      <div>
                        <h3 className="text-xl font-extrabold text-gray-900">
                          Apply on Employer Website ↗
                        </h3>
                        <p className="mt-1 text-sm font-semibold text-gray-500">
                          Review the original job posting and complete your application on the employer's website.
                        </p>
                      </div>
                    </div>
                    <span className="text-3xl text-gray-500">›</span>
                  </button>
                </div>
              </section>

              <section className="mt-6 rounded-2xl border border-blue-100 bg-white p-7 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-extrabold">Generated Application Package</h2>
                      {generated && (
                        <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-bold text-purple-700">
                          AI-tailored
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                      Review the original job posting beside your AI-generated application materials.
                    </p>
                  </div>

                  {generated && (
                    <button
                      onClick={savePackage}
                      className="rounded-xl border border-blue-200 bg-white px-5 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50"
                    >
                      Save Package
                    </button>
                  )}
                </div>

                {!generated && (
                  <div className="mt-6 rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-8 text-center">
                    <div className="text-4xl">✨</div>
                    <h3 className="mt-3 text-lg font-extrabold">Generate to unlock the preview workspace</h3>
                    <p className="mt-2 text-sm text-gray-500">
                      Your original job posting, tailored resume, cover letter, email draft, and download buttons will appear here.
                    </p>
                  </div>
                )}

                {generated && (
                  <div className="mt-6 grid gap-5 xl:grid-cols-12">
                    <aside className="xl:col-span-4">
                      <div className="h-full rounded-2xl border border-gray-100 bg-white shadow-sm">
                        <div className="border-b border-gray-100 p-5">
                          <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-2xl">
                              📋
                            </div>
                            <div>
                              <h3 className="font-extrabold">Original Job Posting</h3>
                              <p className="text-xs font-semibold text-gray-400">Extracted from website</p>
                            </div>
                          </div>
                        </div>

                        <div className="max-h-[760px] overflow-y-auto p-5">
                          <h4 className="text-lg font-extrabold">{analysis.title}</h4>
                          <p className="mt-1 text-sm font-semibold text-gray-500">{analysis.company}</p>
                          <p className="mt-1 text-xs text-gray-400">
                            {analysis.location} · {analysis.type} · {analysis.category}
                          </p>

                          {jobUrl && (
                            <a
                              href={analysis.jobDetails.applyUrl || jobUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-4 inline-flex rounded-xl border border-blue-100 px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
                            >
                              View original posting ↗
                            </a>
                          )}

                          <div className="mt-6 rounded-2xl bg-slate-50 p-4">
                            <h5 className="text-sm font-extrabold">About the Role</h5>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-gray-600">
                              {getOriginalJobSnippet()}
                            </p>
                          </div>

                          {hasJobDetails() && (
                            <div className="mt-5 space-y-5">
                              {analysis.jobDetails.responsibilities.length > 0 && (
                                <div className="rounded-2xl border border-gray-100 bg-white p-4">
                                  <h5 className="text-sm font-extrabold">Key Responsibilities</h5>
                                  <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
                                    {analysis.jobDetails.responsibilities.map((item) => (
                                      <li key={item} className="flex gap-2">
                                        <span className="font-bold text-green-600">✓</span>
                                        <span>{item}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {analysis.jobDetails.qualifications.length > 0 && (
                                <div className="rounded-2xl border border-gray-100 bg-white p-4">
                                  <h5 className="text-sm font-extrabold">Qualifications</h5>
                                  <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
                                    {analysis.jobDetails.qualifications.map((item) => (
                                      <li key={item} className="flex gap-2">
                                        <span className="font-bold text-green-600">✓</span>
                                        <span>{item}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {analysis.jobDetails.benefits.length > 0 && (
                                <div className="rounded-2xl border border-gray-100 bg-white p-4">
                                  <h5 className="text-sm font-extrabold">Benefits</h5>
                                  <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
                                    {analysis.jobDetails.benefits.map((item) => (
                                      <li key={item} className="flex gap-2">
                                        <span className="font-bold text-green-600">✓</span>
                                        <span>{item}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {(analysis.jobDetails.salary || analysis.jobDetails.schedule) && (
                                <div className="grid gap-3 md:grid-cols-2">
                                  {analysis.jobDetails.salary && (
                                    <div className="rounded-2xl border border-gray-100 bg-white p-4">
                                      <h5 className="text-sm font-extrabold">Salary / Wage</h5>
                                      <p className="mt-2 text-sm leading-6 text-gray-600">
                                        {analysis.jobDetails.salary}
                                      </p>
                                    </div>
                                  )}

                                  {analysis.jobDetails.schedule && (
                                    <div className="rounded-2xl border border-gray-100 bg-white p-4">
                                      <h5 className="text-sm font-extrabold">Schedule</h5>
                                      <p className="mt-2 text-sm leading-6 text-gray-600">
                                        {analysis.jobDetails.schedule}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          <div className="mt-5">
                            <h5 className="text-sm font-extrabold">Keywords Detected</h5>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {(analysis.keywords.length > 0
                                ? analysis.keywords
                                : ["Communication", "Organization", "Attention to Detail"]
                              ).map((keyword) => (
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
                      </div>
                    </aside>

                    <section className="xl:col-span-8">
                      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-5">
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-lg font-extrabold">Your Generated Application Package</h3>
                              <span className="rounded-full bg-purple-50 px-3 py-1 text-[11px] font-bold text-purple-700">
                                AI-tailored
                              </span>
                            </div>
                            <p className="mt-1 text-xs font-semibold text-gray-400">
                              Click Resume, Cover Letter, or Email Draft, then edit the content directly.
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={copyPreviewText}
                              className="rounded-xl border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
                            >
                              Copy
                            </button>

                            {selectedPreview === "emailDraft" ? (
                              <button
                                onClick={() => downloadSelected("txt")}
                                className="rounded-xl border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
                              >
                                Download TXT
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={downloadDocx}
                                  className="rounded-xl border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
                                >
                                  Download DOCX
                                </button>
                                <button
                                  onClick={downloadPdf}
                                  className="rounded-xl border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
                                >
                                  Download PDF
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="grid border-b border-gray-100 md:grid-cols-3">
                          {[
                            ["resume", "📄", "Resume"],
                            ["coverLetter", "✉️", "Cover Letter"],
                            ["emailDraft", "📧", "Email Draft"],
                          ].map(([key, icon, label]) => (
                            <button
                              key={key}
                              onClick={() => setSelectedPreview(key as PreviewType)}
                              className={`flex items-center gap-3 px-5 py-4 text-left transition ${
                                selectedPreview === key
                                  ? "bg-blue-50 text-blue-700"
                                  : "bg-white text-gray-600 hover:bg-slate-50"
                              }`}
                            >
                              <span className="text-2xl">{icon}</span>
                              <div>
                                <p className="font-extrabold">{label}</p>
                                <p className="text-xs font-semibold text-gray-400">
                                  {selectedPreview === key ? "Viewing now" : "Click to preview"}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>

                        <div className="h-[900px] overflow-y-auto p-6 bg-gray-100">
                          <div className="mb-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-2xl">
                                {getPreviewIcon()}
                              </div>
                              <div>
                                <h3 className="font-extrabold">{getPreviewLabel()}</h3>
                                <p className="text-xs font-semibold text-gray-400">
                                  Tailored for {analysis.title} at {analysis.company}
                                </p>
                              </div>
                            </div>
                          </div>

                          {selectedPreview === "emailDraft" ? (

  <textarea
    value={packageData.emailDraft}
    onChange={(e) =>
      setPackageData((prev) => ({
        ...prev,
        emailDraft: e.target.value,
      }))
    }
    className="min-h-[520px] w-full resize-y rounded-2xl border border-gray-100 bg-slate-50 p-6 text-sm leading-7 text-gray-700 outline-none"
  />

) : (

  <div className="flex justify-center">
    <A4Preview
        text={packageData[selectedPreview]}
        onChange={(value)=>
            setPackageData(prev=>({
                ...prev,
                [selectedPreview]: value,
            }))
        }
    />
</div>

)}

                          <div className="mt-5 grid gap-3 md:grid-cols-3">
                            <button
                              onClick={copyPreviewText}
                              className="rounded-xl border border-blue-200 bg-white px-5 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50"
                            >
                              Copy
                            </button>

                            {selectedPreview === "emailDraft" ? (
                              <button
                                onClick={() => downloadSelected("txt")}
                                className="rounded-xl border border-blue-200 bg-white px-5 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50 md:col-span-2"
                              >
                                Download Email Draft
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={downloadDocx}
                                  className="rounded-xl border border-blue-200 bg-white px-5 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50"
                                >
                                  Download DOCX
                                </button>
                                <button
                                  onClick={downloadPdf}
                                  className="rounded-xl border border-blue-200 bg-white px-5 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50"
                                >
                                  Download PDF
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        <button
                          onClick={savePackage}
                          className="rounded-xl border border-blue-200 bg-white px-5 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50"
                        >
                          Save Package
                        </button>

                        <button
                          onClick={continueToApply}
                          className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700"
                        >
                          Apply on Employer Website ↗
                        </button>
                      </div>
                    </section>
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
                    ["3", "Generate full package", "AI creates a tailored resume, cover letter, and email draft."],
                    ["4", "You’re ready to apply", "Review, edit, and apply on the employer website in minutes."],
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

                <div className="mt-8 rounded-2xl bg-blue-50 p-5">
                  <h3 className="font-extrabold text-blue-700">💡 Tip</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-600">
                    A tailored application can help you apply faster and present a stronger profile.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
