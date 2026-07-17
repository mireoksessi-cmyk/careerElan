"use client";


import { exportDocx, exportPdf } from "@/lib/exportDocument";

import { useLogin } from "@/lib/auth/LoginManager";
import { supabase } from "@/lib/supabase";
import Image from "next/image";
import A4Preview from "../job-tracker/A4Preview";
import { useRouter } from "next/navigation";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import CareerMemoryGuard from "@/components/CareerMemoryGuard";
type PasteMode = "url" | "description" | "file";

type PreviewType = "resume" | "coverLetter" | "emailDraft";
type SavedApplicationMaterial = {
  resume: {
    sourceType:
      | "career_memory"
      | "upload";
    id: string | null;
    name: string;
    text: string;
  };

  coverLetter: {
    sourceType:
      | "upload"
      | "automatic";
    id: string | null;
    name: string;
    text: string;
  };
};

type SavedPreviewType =
  | "resume"
  | "coverLetter"
  | null;
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
  jobContext: {
  country:
    | "Canada"
    | "Unknown";

  sector:
    | "private"
    | "provincial"
    | "municipal"
    | "federal"
    | "unknown";

  province: string;
  municipality: string;

  supportedByCareerElan: boolean;
  classificationReason: string;
};

requirements: {
  requirement: string;

  category:
    | "mandatory"
    | "preferred"
    | "legal_or_regulated";
}[];
};

type PackageAnalysis = {
  overallMatch: number;

  matchLevel:
    | "strong"
    | "moderate"
    | "low"
    | "critical_mismatch";

  keyChanges: {
    section: string;
    original: string;
    revised: string;
    reason: string;
  }[];

  mismatch: {
    summary: string;
    missingRequirements: string[];
    unsupportedClaims: string[];
  };

  matches: {
    strongMatches: string[];
    transferableSkills: string[];
  };

  recommendation: {
    summary: string;

    applyRecommendation:
      | "recommended"
      | "consider"
      | "not_recommended";

    nextSteps: string[];
  };

  verification: {
    jobContext: {
      country:
        | "Canada"
        | "Unknown";

      sector:
        | "private"
        | "provincial"
        | "municipal"
        | "federal"
        | "unknown";

      province: string;
      municipality: string;

      supportedByCareerElan: boolean;
      classificationReason: string;
    };

    requirements: {
      requirement: string;

      category:
        | "mandatory"
        | "preferred"
        | "legal_or_regulated";

      evidenceStatus:
        | "supported"
        | "partially_supported"
        | "not_supported";

      sourceEvidence: string;

      source:
        | "primary_resume"
        | "career_memory"
        | "none";

      regulated: boolean;
    }[];

    documentClaims: {
      document:
        | "resume"
        | "cover_letter"
        | "email";

      claim: string;

      category:
        | "experience"
        | "achievement"
        | "education"
        | "certification"
        | "licence"
        | "language"
        | "project"
        | "career_goal"
        | "work_authorization"
        | "citizenship"
        | "security_clearance"
        | "software"
        | "other";

      sourceEvidence: string;

      source:
        | "primary_resume"
        | "career_memory";
    }[];

    regulatedRole: {
      isRegulated: boolean;
      profession: string;
      jurisdiction: string;
      requiredLicence: string;
      licenceEvidence: string;

      licenceStatus:
        | "verified"
        | "missing"
        | "not_required"
        | "unclear";
    };

    bilingualRequirement: {
      level:
        | "mandatory"
        | "preferred"
        | "not_required"
        | "unclear";

      languages: string[];
      evidence: string;

      status:
        | "verified"
        | "partially_verified"
        | "missing"
        | "not_required";
    };
  };
};

type GeneratedPackage = {
  resume: string;
  coverLetter: string;
  emailDraft: string;
  packageAnalysis: PackageAnalysis | null;
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
  summary:
    "Analyze a job posting to see the detected role, keywords, and match details.",

  jobDetails: {
    description: "",
    responsibilities: [],
    qualifications: [],
    benefits: [],
    salary: "",
    schedule: "",
    applyUrl: "",
  },

  jobContext: {
    country: "Unknown",
    sector: "unknown",
    province: "",
    municipality: "",
    supportedByCareerElan: false,
    classificationReason:
      "The job posting has not been analyzed yet.",
  },

  requirements: [],
};

function buildCareerMemoryResumeText(
  memory: any
): string {
  if (!memory) return "";

  const lines: string[] = [];

  const fullName = [
    memory.first_name,
    memory.last_name,
  ]
    .filter(Boolean)
    .join(" ");

  if (fullName) {
    lines.push(fullName);
  }

  const contact = [
    memory.location,
    memory.phone,
    memory.email,
    memory.linkedin,
  ]
    .filter(
      (item) =>
        typeof item === "string" &&
        item.trim()
    )
    .join(" | ");

  if (contact) {
    lines.push(contact);
  }

  if (memory.headline?.trim()) {
    lines.push("", memory.headline.trim());
  }

  if (memory.summary?.trim()) {
    lines.push(
      "",
      "PROFESSIONAL SUMMARY",
      memory.summary.trim()
    );
  }

  const skills = Array.isArray(
    memory.skills
  )
    ? memory.skills.filter(
        (item: unknown) =>
          typeof item === "string" &&
          item.trim()
      )
    : [];

  if (skills.length > 0) {
    lines.push(
      "",
      "SKILLS",
      ...skills.map(
        (skill: string) =>
          `• ${skill.trim()}`
      )
    );
  }

  const experiences = Array.isArray(
    memory.experience
  )
    ? memory.experience
    : [];

  const meaningfulExperiences =
    experiences.filter(
      (item: any) =>
        item &&
        [
          item.company,
          item.organization,
          item.jobTitle,
          item.job_title,
          item.role,
          item.title,
          item.dates,
          item.description,
        ].some(
          (value) =>
            typeof value === "string" &&
            value.trim()
        )
    );

  if (
    meaningfulExperiences.length > 0
  ) {
    lines.push(
      "",
      "PROFESSIONAL EXPERIENCE"
    );

    meaningfulExperiences.forEach(
      (item: any) => {
        const title =
          item.jobTitle ||
          item.job_title ||
          item.role ||
          item.title ||
          "";

        const employer =
          item.company ||
          item.organization ||
          item.employer ||
          "";

        const dates =
          item.dates ||
          [
            item.startDate ||
              item.start_date,
            item.endDate ||
              item.end_date,
          ]
            .filter(Boolean)
            .join(" – ");

        lines.push(
          "",
          [
            title,
            employer,
            dates,
          ]
            .filter(Boolean)
            .join(" | ")
        );

        const descriptions = [
          item.description,
          item.responsibilities,
          item.achievements,
          item.details,
          item.bullets,
        ]
          .flat()
          .filter(
            (value) =>
              typeof value ===
                "string" &&
              value.trim()
          );

        descriptions.forEach(
          (description) => {
            lines.push(
              `• ${description.trim()}`
            );
          }
        );
      }
    );
  }

  const education = Array.isArray(
    memory.education
  )
    ? memory.education.filter(
        (item: any) =>
          item &&
          [
            item.school,
            item.institution,
            item.program,
            item.degree,
            item.dates,
          ].some(
            (value) =>
              typeof value ===
                "string" &&
              value.trim()
          )
      )
    : [];

  if (education.length > 0) {
    lines.push("", "EDUCATION");

    education.forEach((item: any) => {
      lines.push(
        [
          item.program ||
            item.degree,
          item.school ||
            item.institution,
          item.dates,
        ]
          .filter(Boolean)
          .join(" | ")
      );
    });
  }

  const languages = Array.isArray(
    memory.languages
  )
    ? memory.languages.filter(
        (item: any) =>
          typeof item === "string"
            ? item.trim()
            : item?.language?.trim()
      )
    : [];

  if (languages.length > 0) {
    lines.push("", "LANGUAGES");

    languages.forEach((item: any) => {
      if (typeof item === "string") {
        lines.push(`• ${item}`);
        return;
      }

      lines.push(
        `• ${[
          item.language,
          item.proficiency ||
            item.level,
        ]
          .filter(Boolean)
          .join(" — ")}`
      );
    });
  }

  const certifications = Array.isArray(
    memory.certifications
  )
    ? memory.certifications.filter(
        (item: any) =>
          typeof item === "string"
            ? item.trim()
            : (
                item?.name ||
                item?.title ||
                item?.certification
              )?.trim()
      )
    : [];

  if (certifications.length > 0) {
    lines.push(
      "",
      "CERTIFICATIONS"
    );

    certifications.forEach(
      (item: any) => {
        lines.push(
          `• ${
            typeof item === "string"
              ? item
              : item.name ||
                item.title ||
                item.certification
          }`
        );
      }
    );
  }

  return lines.join("\n").trim();
}

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
 const isSupportedJob =
  analysis?.jobContext
    ?.supportedByCareerElan === true;
  const [
  savedApplicationMaterial,
  setSavedApplicationMaterial,
] =
  useState<SavedApplicationMaterial | null>(
    null
  );

const [
  savedPreviewType,
  setSavedPreviewType,
] =
  useState<SavedPreviewType>(null);

const [
  generationProgress,
  setGenerationProgress,
] = useState(0);  
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
  packageAnalysis: null,
});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoAnalyzeStartedRef = useRef(false);
  
useEffect(() => {
  if (loading) return;
  if (!user) return;

  void loadSelectedApplicationMaterials();
}, [loading, user]);
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
packageAnalysis: null,
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
  title:
    data.title || "Job Posting",

  company:
    data.company ||
    "Detected Company",

  location:
    data.location || "Canada",

  type:
    data.type || "Full-time",

  category:
    data.category || "General",

  icon:
    data.icon || "💼",

  match:
    data.match || "--",

  keywordCount:
    typeof data.keywordCount ===
    "number"
      ? data.keywordCount
      : Array.isArray(data.keywords)
        ? data.keywords.length
        : 0,

  requirementsMatched:
    typeof data.requirementsMatched ===
    "number"
      ? data.requirementsMatched
      : 0,

  keywords:
    Array.isArray(data.keywords)
      ? data.keywords.filter(
          (
            item: unknown
          ): item is string =>
            typeof item ===
              "string" &&
            item.trim().length > 0
        )
      : [],

  summary:
    data.summary ||
    "Job posting analyzed successfully.",

  jobDetails:
    normalizeJobDetails(
      data,
      isUrlMode
        ? jobText
        : jobUrl.trim()
    ),

  jobContext: {
    country:
      data.jobContext?.country ===
      "Canada"
        ? "Canada"
        : "Unknown",

    sector: [
      "private",
      "provincial",
      "municipal",
      "federal",
      "unknown",
    ].includes(
      data.jobContext?.sector
    )
      ? data.jobContext.sector
      : "unknown",

    province:
      typeof data.jobContext
        ?.province === "string"
        ? data.jobContext.province
        : "",

    municipality:
      typeof data.jobContext
        ?.municipality === "string"
        ? data.jobContext
            .municipality
        : "",

    supportedByCareerElan:
      data.jobContext
        ?.supportedByCareerElan ===
      true,

    classificationReason:
      typeof data.jobContext
        ?.classificationReason ===
      "string"
        ? data.jobContext
            .classificationReason
        : "",
  },

  requirements:
    Array.isArray(
      data.requirements
    )
      ? data.requirements
          .filter(
            (item: unknown) =>
              Boolean(item) &&
              typeof item ===
                "object" &&
              typeof (
                item as {
                  requirement?: unknown;
                }
              ).requirement ===
                "string"
          )
          .map((item: any) => ({
            requirement:
              item.requirement.trim(),

            category:
              item.category ===
                "preferred" ||
              item.category ===
                "legal_or_regulated"
                ? item.category
                : "mandatory",
          }))
      : [],
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

async function loadSelectedApplicationMaterials() {
  const applicationData =
    await getApplicationData();

  if (!applicationData) {
    setSavedApplicationMaterial(null);
    return null;
  }

  const {
    memory,
    resumes,
    covers,
  } = applicationData;

  /*
    Supabase 응답은 null일 수 있으므로
    항상 배열로 정규화
  */
  const resumeList =
    resumes ?? [];

  const coverList =
    covers ?? [];

  let selectedResumeMaterial:
    SavedApplicationMaterial["resume"];

  /*
    Dashboard에서 업로드 Resume 선택
  */
  if (
    memory?.selected_resume_type ===
    "upload"
  ) {
    const uploadedResume =
      resumeList.find(
        (item: any) =>
          item.id ===
          memory.selected_resume_id
      );

    /*
      선택 ID가 있지만 실제 Resume가
      삭제되었거나 조회되지 않은 경우
      Career Memory Resume로 안전하게 대체
    */
    if (uploadedResume) {
      selectedResumeMaterial = {
        sourceType: "upload",
        id: uploadedResume.id,
        name:
          uploadedResume.file_name ||
          "Selected Uploaded Resume",
        text:
          uploadedResume.original_text ||
          "",
      };
    } else {
      selectedResumeMaterial = {
        sourceType:
          "career_memory",
        id: null,
        name:
          memory?.resume_name ||
          "Career Memory Resume",
        text:
          buildCareerMemoryResumeText(
            memory
          ),
      };
    }
  } else {
    /*
      Dashboard에서 Career Memory Resume 선택
      또는 선택값이 없는 경우
    */
    selectedResumeMaterial = {
      sourceType:
        "career_memory",
      id: null,
      name:
        memory?.resume_name ||
        "Career Memory Resume",
      text:
        buildCareerMemoryResumeText(
          memory
        ),
    };
  }

  /*
    Dashboard에서 선택한 Cover Letter 조회
  */
  const selectedCover =
    coverList.find(
      (item: any) =>
        item.id ===
        memory?.selected_cover_letter_id
    );

  const selectedCoverMaterial:
    SavedApplicationMaterial["coverLetter"] =
    selectedCover
      ? {
          sourceType: "upload",
          id: selectedCover.id,
          name:
            selectedCover.file_name ||
            "Selected Cover Letter",
          text:
            selectedCover.original_text ||
            "",
        }
      : {
          sourceType:
            "automatic",
          id: null,
          name:
            "Automatic Cover Letter",
          text:
            "No saved cover letter is selected. Career Élan will generate a new job-specific cover letter.",
        };

  const result:
    SavedApplicationMaterial = {
    resume:
      selectedResumeMaterial,
    coverLetter:
      selectedCoverMaterial,
  };

  setSavedApplicationMaterial(
    result
  );

  return result;
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
    alert(
      "Please analyze the job posting first."
    );
    return;
  }

  let progressTimer:
    | ReturnType<
        typeof setInterval
      >
    | undefined;

  const generationStartedAt =
    Date.now();

  try {
    setIsGenerating(true);
    setGenerationProgress(10);
    setMessage("");

    /*
      실제 API의 세부 진행 상황은
      전달받을 수 없으므로 예상 진행률을
      10 → 30 → 50 → 70으로 표시한다.

      API 완료 시에만 100이 된다.
    */
    progressTimer = setInterval(
      () => {
        const elapsed =
          Date.now() -
          generationStartedAt;

       if (elapsed >= 45000) {
  setGenerationProgress(85);
} else if (elapsed >= 30000) {
  setGenerationProgress(70);
} else if (elapsed >= 15000) {
  setGenerationProgress(50);
} else if (elapsed >= 6000) {
  setGenerationProgress(30);
} else {
  setGenerationProgress(10);
}
      },
      1000
    );

    const applicationData =
      await getApplicationData();

    const response = await fetch(
      "/api/generate-package",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          analysis,
          jobText:
            getOriginalJobSnippet(),
          applicationData,
        }),
      }
    );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data.details ||
          data.error ||
          "Failed to generate package."
      );
    }

    setGenerationProgress(100);

    setPackageData({
      resume: data.resume,
      coverLetter:
        data.coverLetter,
      emailDraft:
        data.emailDraft,
      packageAnalysis:
        data.packageAnalysis ||
        null,
    });

    setSelectedPreview("resume");
    setGenerated(true);

   if (user) {
  const originalJobDescription =
    getOriginalJobSnippet();

  const { error: insertError } =
    await supabase
      .from("applications")
      .insert({
        user_id: user.id,

        company: analysis.company,
        job_title: analysis.title,

        status: "package_generated",

        applied_date: new Date()
          .toISOString()
          .split("T")[0],

        job_url: jobUrl.trim(),

        job_description:
          originalJobDescription,

        location: analysis.location,
        job_type: analysis.type,

        resume_text: data.resume,
        cover_letter_text:
          data.coverLetter,
        email_draft:
          data.emailDraft,

        job_analysis: analysis,

        ai_insight:
          data.packageAnalysis
            ? {
                mismatch:
                  data.packageAnalysis
                    .mismatch,

                matches:
                  data.packageAnalysis
                    .matches,

                recommendation:
                  data.packageAnalysis
                    .recommendation,
              }
            : null,
      });

  if (insertError) {
    throw new Error(
      insertError.message
    );
  }
}

    setMessage(
      "Your AI-tailored application package has been generated successfully."
    );

    /*
      100%가 화면에 잠시 보이도록 함
    */
    await new Promise(
      (resolve) =>
        setTimeout(resolve, 500)
    );
  } catch (error: any) {
    console.error(
      "PACKAGE GENERATION ERROR =",
      error
    );

    setGenerationProgress(0);

    alert(
      error?.message ||
        "Failed to generate package."
    );
  } finally {
    if (progressTimer) {
      clearInterval(
        progressTimer
      );
    }

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
  const materials =
    savedApplicationMaterial ||
    (await loadSelectedApplicationMaterials());

  if (!materials) {
    return {
      resume: "",
      coverLetter: "",
    };
  }

  return {
    resume:
      materials.resume.text,

    coverLetter:
      materials.coverLetter
        .sourceType === "upload"
        ? materials.coverLetter.text
        : "",
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
  resume:
    hasCompleteResume
      ? resume
      : prev.resume ||
        "No complete saved resume found.",

  coverLetter:
    hasCompleteCoverLetter
      ? coverLetter
      : prev.coverLetter ||
        "No complete saved cover letter found.",

  emailDraft:
    prev.emailDraft ||
    `Subject: Application for ${analysis.title}

Dear Hiring Manager,

I hope you are doing well.

I would like to apply for the ${analysis.title} position at ${analysis.company}. Please find my application materials attached.

Best regards,
David Kwak`,

  packageAnalysis: prev.packageAnalysis,
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
  job_url: jobUrl.trim(),

  job_description:
    getOriginalJobSnippet(),

  location: analysis.location,
  job_type: analysis.type,

  resume_text: packageData.resume,

  cover_letter_text:
    packageData.coverLetter,

  email_draft:
    packageData.emailDraft,

  job_analysis: analysis,

  ai_insight:
    packageData.packageAnalysis
      ? {
          mismatch:
            packageData.packageAnalysis
              .mismatch,

          matches:
            packageData.packageAnalysis
              .matches,

          recommendation:
            packageData.packageAnalysis
              .recommendation,
        }
      : null,

  updated_at:
    new Date().toISOString(),
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
  <CareerMemoryGuard>
    <>
      {savedPreviewType && savedApplicationMaterial && (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/60 px-4 py-8 backdrop-blur-sm">
          <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-3xl bg-slate-100 shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-blue-600">
                  Saved Application Preview
                </p>

                <h2 className="mt-1 text-xl font-black text-slate-950">
                  {savedPreviewType === "resume"
                    ? savedApplicationMaterial.resume.name
                    : savedApplicationMaterial.coverLetter.name}
                </h2>
              </div>

              <button
                type="button"
                onClick={() =>
                  setSavedPreviewType(null)
                }
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-2xl text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
                aria-label="Close preview"
              >
                ×
              </button>
            </div>

            <div className="p-4 sm:p-8">
              <div className="mx-auto min-h-[900px] max-w-[794px] bg-white p-10 shadow">
                <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-slate-700">
                  {savedPreviewType === "resume"
                    ? savedApplicationMaterial.resume.text
                    : savedApplicationMaterial.coverLetter.text}
                </pre>
              </div>
            </div>

            <div className="sticky bottom-0 flex justify-end border-t border-slate-200 bg-white px-6 py-4">
              <button
                type="button"
                onClick={() =>
                  setSavedPreviewType(null)
                }
                className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white transition hover:bg-blue-700"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      
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
                    <div className="rounded-2xl border border-gray-100 p-5">
  <h3 className="text-3xl font-extrabold text-green-600">
    {generated ? analysis.match : "✨"}
  </h3>

  <p className="mt-1 text-sm font-semibold text-gray-500">
    {generated
      ? "ATS Match"
      : "Generate Full Package to see your ATS Match"}
  </p>
</div>
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
  {/* 선택된 Resume */}
  <div className="rounded-2xl border border-gray-100 bg-white p-5">
    <div className="flex items-start gap-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-2xl">
        📄
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-600">
          Selected Resume
        </p>

        <h4 className="mt-1 truncate font-extrabold">
          {savedApplicationMaterial?.resume.name ||
            "Loading selected resume..."}
        </h4>

        <p className="mt-2 text-sm leading-6 text-gray-500">
          {savedApplicationMaterial?.resume.sourceType === "upload"
            ? "The uploaded resume selected on your Dashboard will be used."
            : "Your Career Memory Resume selected on the Dashboard will be used."}
        </p>

        <button
          type="button"
         disabled={
  !savedApplicationMaterial?.resume.text?.trim()
}
          onClick={() =>
            setSavedPreviewType("resume")
          }
          className="mt-3 rounded-xl border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          👁 Preview
        </button>
      </div>
    </div>
  </div>

  {/* 선택된 Cover Letter */}
  <div className="rounded-2xl border border-gray-100 bg-white p-5">
    <div className="flex items-start gap-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-2xl">
        ✉️
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-wide text-purple-600">
          Selected Cover Letter
        </p>

        <h4 className="mt-1 truncate font-extrabold">
          {savedApplicationMaterial?.coverLetter.name ||
            "Loading cover letter..."}
        </h4>

        <p className="mt-2 text-sm leading-6 text-gray-500">
          {savedApplicationMaterial?.coverLetter.sourceType === "upload"
            ? "The uploaded cover letter selected on your Dashboard will be used as a writing reference."
            : "No uploaded cover letter is selected. A new job-specific cover letter will be generated automatically."}
        </p>

        <button
          type="button"
          disabled={
  savedApplicationMaterial?.coverLetter.sourceType !==
    "upload" ||
  !savedApplicationMaterial?.coverLetter.text?.trim()
}
          onClick={() =>
            setSavedPreviewType("coverLetter")
          }
          className="mt-3 rounded-xl border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          👁 Preview
        </button>
      </div>
    </div>
  </div>
   </div>
                    {analyzed &&
  analysis.jobContext.sector ===
    "federal" && (
    <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <p className="font-extrabold text-amber-800">
        Federal government
        applications are not
        currently supported.
      </p>

      <p className="mt-2 text-sm leading-6 text-amber-700">
        Career Élan currently
        supports Canadian
        private-sector,
        provincial-government,
        and municipal-government
        job postings.
      </p>
    </div>
  )}

  {analyzed &&
  analysis.jobContext
    .supportedByCareerElan ===
    false &&
  analysis.jobContext.sector !==
    "federal" && (
    <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <p className="font-extrabold text-amber-800">
        This posting is outside
        the currently supported
        scope.
      </p>

      <p className="mt-2 text-sm leading-6 text-amber-700">
        Career Élan could not
        confirm this as a Canadian
        private-sector,
        provincial-government, or
        municipal-government job
        posting.
      </p>

      {analysis.jobContext
        .classificationReason && (
        <p className="mt-2 text-xs leading-5 text-amber-700">
          {
            analysis.jobContext
              .classificationReason
          }
        </p>
      )}
    </div>
  )}

                  {showDefaultApplication && (
                    <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm font-semibold text-blue-700">
                      Your saved application is ready. You can continue to the employer website or generate a stronger AI-tailored package first.
                    </div>
                  )}

                  <button
  type="button"
  onClick={handleGeneratePackage}
  disabled={
    !analyzed ||
    isGenerating ||
    !isSupportedJob
  }
  className="mt-6 flex w-full items-center justify-between rounded-2xl bg-gradient-to-r from-purple-600 to-violet-700 px-6 py-5 text-left text-white shadow-sm transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
>
  <div className="flex min-w-0 items-center gap-4">
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/95 text-2xl text-purple-700">
      ✨
    </div>

    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
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
        {isGenerating
          ? "Package generation usually takes about 30 seconds to 1 minute."
          : "Generate a tailored resume, cover letter, and email draft so you’re ready to apply in minutes."}
      </p>

      {isGenerating ? (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-4 text-xs font-bold text-white">
            <span>
              Creating your application package...
            </span>

            <span>
              {generationProgress}%
            </span>
          </div>

          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-white transition-all duration-700"
              style={{
                width: `${generationProgress}%`,
              }}
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-white/75">
            <span>
              {generationProgress <= 10
  ? "Preparing selected resume"
  : generationProgress <= 30
    ? "Analyzing job requirements"
    : generationProgress <= 50
      ? "Tailoring resume content"
      : generationProgress <= 70
        ? "Creating cover letter and email"
        : generationProgress <= 85
          ? "Verifying claims and match analysis"
          : "Finalizing package"}
            </span>

            <span className="whitespace-nowrap">
              Estimated: 30–60 seconds
            </span>
          </div>
        </div>
      ) : (
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
      )}
    </div>
  </div>

  <span className="ml-4 shrink-0 text-3xl">
    ›
  </span>
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
            </section>

            {/* 오른쪽 위: 스크롤을 따라오지 않는 안내 카드 */}
            <aside className="self-start xl:col-span-4">
              <div className="rounded-2xl border border-blue-100 bg-white p-7 shadow-sm">
                <h2 className="text-2xl font-extrabold">
                  What happens next?
                </h2>

                <div className="mt-8 space-y-6">
                  {[
                    [
                      "1",
                      "Analyze the job posting",
                      "AI extracts role details, keywords, and requirements.",
                    ],
                    [
                      "2",
                      "Match with your profile",
                      "Career Élan checks how your background fits.",
                    ],
                    [
                      "3",
                      "Generate full package",
                      "AI creates a tailored resume, cover letter, and email draft.",
                    ],
                    [
                      "4",
                      "You’re ready to apply",
                      "Review, edit, and apply on the employer website in minutes.",
                    ],
                  ].map(([num, title, desc]) => (
                    <div
                      key={num}
                      className="flex gap-4"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                        {num}
                      </div>

                      <div>
                        <h3 className="font-extrabold">
                          {title}
                        </h3>

                        <p className="mt-1 text-sm leading-6 text-gray-500">
                          {desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-8 rounded-2xl bg-blue-50 p-5">
                  <h3 className="font-extrabold text-blue-700">
                    💡 Tip
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-gray-600">
                    A tailored application can help you apply faster and present a stronger profile.
                  </p>
                </div>
              </div>
            </aside>

            {/* 아래: 전체 12칸을 사용하는 Generated Package */}
            <section className="xl:col-span-12 rounded-2xl border border-blue-100 bg-white p-7 shadow-sm">
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
  <div className="mt-6 grid items-start gap-5 xl:grid-cols-12">
    {/* 왼쪽: 원본 채용공고 */}
    <aside className="xl:col-span-3">
      <div className="h-full rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-2xl">
              📋
            </div>

            <div>
              <h3 className="font-extrabold">
                Original Job Posting
              </h3>

              <p className="text-xs font-semibold text-gray-400">
                Extracted from website
              </p>
            </div>
          </div>
        </div>

        <div className="max-h-[900px] overflow-y-auto p-5">
          <h4 className="text-lg font-extrabold">
            {analysis.title}
          </h4>

          <p className="mt-1 text-sm font-semibold text-gray-500">
            {analysis.company}
          </p>

          <p className="mt-1 text-xs text-gray-400">
            {analysis.location} · {analysis.type} ·{" "}
            {analysis.category}
          </p>

          {jobUrl && (
            <a
              href={
                analysis.jobDetails.applyUrl ||
                jobUrl
              }
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex rounded-xl border border-blue-100 px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
            >
              View original posting ↗
            </a>
          )}

          <div className="mt-6 rounded-2xl bg-slate-50 p-4">
            <h5 className="text-sm font-extrabold">
              About the Role
            </h5>

            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-gray-600">
              {getOriginalJobSnippet()}
            </p>
          </div>

          {hasJobDetails() && (
            <div className="mt-5 space-y-5">
              {analysis.jobDetails
                .responsibilities.length >
                0 && (
                <div className="rounded-2xl border border-gray-100 bg-white p-4">
                  <h5 className="text-sm font-extrabold">
                    Key Responsibilities
                  </h5>

                  <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
                    {analysis.jobDetails.responsibilities.map(
                      (item) => (
                        <li
                          key={item}
                          className="flex gap-2"
                        >
                          <span className="font-bold text-green-600">
                            ✓
                          </span>

                          <span>{item}</span>
                        </li>
                      )
                    )}
                  </ul>
                </div>
              )}

              {analysis.jobDetails
                .qualifications.length >
                0 && (
                <div className="rounded-2xl border border-gray-100 bg-white p-4">
                  <h5 className="text-sm font-extrabold">
                    Qualifications
                  </h5>

                  <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
                    {analysis.jobDetails.qualifications.map(
                      (item) => (
                        <li
                          key={item}
                          className="flex gap-2"
                        >
                          <span className="font-bold text-green-600">
                            ✓
                          </span>

                          <span>{item}</span>
                        </li>
                      )
                    )}
                  </ul>
                </div>
              )}

              {analysis.jobDetails.benefits
                .length > 0 && (
                <div className="rounded-2xl border border-gray-100 bg-white p-4">
                  <h5 className="text-sm font-extrabold">
                    Benefits
                  </h5>

                  <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
                    {analysis.jobDetails.benefits.map(
                      (item) => (
                        <li
                          key={item}
                          className="flex gap-2"
                        >
                          <span className="font-bold text-green-600">
                            ✓
                          </span>

                          <span>{item}</span>
                        </li>
                      )
                    )}
                  </ul>
                </div>
              )}

              {(analysis.jobDetails.salary ||
                analysis.jobDetails
                  .schedule) && (
                <div className="grid gap-3">
                  {analysis.jobDetails
                    .salary && (
                    <div className="rounded-2xl border border-gray-100 bg-white p-4">
                      <h5 className="text-sm font-extrabold">
                        Salary / Wage
                      </h5>

                      <p className="mt-2 text-sm leading-6 text-gray-600">
                        {
                          analysis.jobDetails
                            .salary
                        }
                      </p>
                    </div>
                  )}

                  {analysis.jobDetails
                    .schedule && (
                    <div className="rounded-2xl border border-gray-100 bg-white p-4">
                      <h5 className="text-sm font-extrabold">
                        Schedule
                      </h5>

                      <p className="mt-2 text-sm leading-6 text-gray-600">
                        {
                          analysis.jobDetails
                            .schedule
                        }
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-5">
            <h5 className="text-sm font-extrabold">
              Keywords Detected
            </h5>

            <div className="mt-3 flex flex-wrap gap-2">
              {(analysis.keywords.length >
              0
                ? analysis.keywords
                : [
                    "Communication",
                    "Organization",
                    "Attention to Detail",
                  ]
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

    {/* 가운데: 생성된 Resume / Cover Letter / Email */}
    <section className="xl:col-span-5">
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-5">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-extrabold">
                Your Generated Application Package
              </h3>

              <span className="rounded-full bg-purple-50 px-3 py-1 text-[11px] font-bold text-purple-700">
                AI-tailored
              </span>
            </div>

            <p className="mt-1 text-xs font-semibold text-gray-400">
              Click Resume, Cover Letter, or
              Email Draft, then edit the
              content directly.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={copyPreviewText}
              className="rounded-xl border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
            >
              Copy
            </button>

            {selectedPreview ===
            "emailDraft" ? (
              <button
                onClick={() =>
                  downloadSelected("txt")
                }
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
            [
              "coverLetter",
              "✉️",
              "Cover Letter",
            ],
            [
              "emailDraft",
              "📧",
              "Email Draft",
            ],
          ].map(([key, icon, label]) => (
            <button
              key={key}
              onClick={() =>
                setSelectedPreview(
                  key as PreviewType
                )
              }
              className={`flex items-center gap-3 px-5 py-4 text-left transition ${
                selectedPreview === key
                  ? "bg-blue-50 text-blue-700"
                  : "bg-white text-gray-600 hover:bg-slate-50"
              }`}
            >
              <span className="text-2xl">
                {icon}
              </span>

              <div>
                <p className="font-extrabold">
                  {label}
                </p>

                <p className="text-xs font-semibold text-gray-400">
                  {selectedPreview === key
                    ? "Viewing now"
                    : "Click to preview"}
                </p>
              </div>
            </button>
          ))}
        </div>

        <div className="h-[900px] overflow-y-auto bg-gray-100 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-2xl">
                {getPreviewIcon()}
              </div>

              <div>
                <h3 className="font-extrabold">
                  {getPreviewLabel()}
                </h3>

                <p className="text-xs font-semibold text-gray-400">
                  Tailored for{" "}
                  {analysis.title} at{" "}
                  {analysis.company}
                </p>
              </div>
            </div>
          </div>

          {selectedPreview ===
          "emailDraft" ? (
            <textarea
              value={
                packageData.emailDraft
              }
              onChange={(event) =>
                setPackageData(
                  (previous) => ({
                    ...previous,
                    emailDraft:
                      event.target.value,
                  })
                )
              }
              className="min-h-[520px] w-full resize-y rounded-2xl border border-gray-100 bg-slate-50 p-6 text-sm leading-7 text-gray-700 outline-none"
            />
          ) : (
            <div className="flex justify-center">
              <A4Preview
                text={
                  packageData[
                    selectedPreview
                  ]
                }
                onChange={(value) =>
                  setPackageData(
                    (previous) => ({
                      ...previous,
                      [selectedPreview]:
                        value,
                    })
                  )
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

            {selectedPreview ===
            "emailDraft" ? (
              <button
                onClick={() =>
                  downloadSelected("txt")
                }
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

    {/* 오른쪽: AI 분석 카드 */}
    <aside className="xl:col-span-4">
      <PackageAnalysisPanel
        analysis={
          packageData.packageAnalysis
        }
      />
    </aside>
  </div>
)}
              </section>
            
        </div>
        </section>
      </div>
    </main>
    </>
  </CareerMemoryGuard>
);
}
function PackageAnalysisPanel({
  analysis,
}: {
  analysis: PackageAnalysis | null;
}) {
  if (!analysis) {
    return (
      <div className="sticky top-6 rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-extrabold">
          Package Analysis
        </h2>

        <p className="mt-3 text-sm leading-6 text-gray-500">
          AI analysis will appear here after the package is generated.
        </p>
      </div>
    );
  }

  const matchClass =
    analysis.matchLevel === "strong"
      ? "border-green-100 bg-green-50 text-green-700"
      : analysis.matchLevel === "moderate"
        ? "border-blue-100 bg-blue-50 text-blue-700"
        : analysis.matchLevel === "low"
          ? "border-amber-100 bg-amber-50 text-amber-700"
          : "border-red-100 bg-red-50 text-red-700";

  const scoreClass =
    analysis.overallMatch >= 85
      ? "text-green-600"
      : analysis.overallMatch >= 65
        ? "text-blue-600"
        : analysis.overallMatch >= 40
          ? "text-amber-600"
          : "text-red-600";

  const recommendationClass =
    analysis.recommendation
      .applyRecommendation ===
    "recommended"
      ? "border-green-100 bg-green-50 text-green-700"
      : analysis.recommendation
            .applyRecommendation ===
          "not_recommended"
        ? "border-red-100 bg-red-50 text-red-700"
        : "border-purple-100 bg-purple-50 text-purple-700";

  const recommendationLabel =
    analysis.recommendation
      .applyRecommendation ===
    "recommended"
      ? "Recommended"
      : analysis.recommendation
            .applyRecommendation ===
          "not_recommended"
        ? "Not Recommended"
        : "Consider Applying";

  return (
    <div className="sticky top-6 space-y-5">
      {/* Overall Match */}
      <div className="rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-wide text-blue-600">
          AI Package Analysis
        </p>

        <div className="mt-4 flex items-end justify-between gap-4">
          <div>
            <p
              className={`text-5xl font-black ${scoreClass}`}
            >
              {analysis.overallMatch}%
            </p>

            <p className="mt-1 text-sm font-bold text-gray-500">
              Overall Match
            </p>
          </div>

          <span
            className={`rounded-full border px-3 py-1 text-xs font-black capitalize ${matchClass}`}
          >
            {analysis.matchLevel.replaceAll(
              "_",
              " "
            )}
          </span>
        </div>
      </div>

      {/* Card 1: Key Changes */}
      <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-xl">
            ✦
          </div>

          <div>
            <h3 className="font-extrabold">
              Key Changes
            </h3>

            <p className="text-xs font-semibold text-gray-400">
              Where, how, and why the resume was changed
            </p>
          </div>
        </div>

        {analysis.keyChanges.length >
        0 ? (
          <div className="mt-4 space-y-4">
            {analysis.keyChanges
              .slice(0, 4)
              .map((change, index) => (
                <div
                  key={`${change.section}-${index}`}
                  className="rounded-xl bg-slate-50 p-4"
                >
                  <p className="text-xs font-black uppercase tracking-wide text-blue-600">
                    {change.section ||
                      "Resume Section"}
                  </p>

                  {change.original && (
                    <div className="mt-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                        Before
                      </p>

                      <p className="mt-1 text-xs leading-5 text-gray-500">
                        {change.original}
                      </p>
                    </div>
                  )}

                  {change.revised && (
                    <div className="mt-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                        After
                      </p>

                      <p className="mt-1 text-xs font-semibold leading-5 text-gray-700">
                        {change.revised}
                      </p>
                    </div>
                  )}

                  {change.reason && (
                    <div className="mt-3 border-t border-slate-200 pt-3">
                      <p className="text-xs leading-5 text-blue-700">
                        {change.reason}
                      </p>
                    </div>
                  )}
                </div>
              ))}
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-gray-400">
            No meaningful resume changes were returned.
          </p>
        )}
      </div>

      {/* Card 2: Mismatch */}
      <div className="rounded-2xl border border-red-100 bg-red-50 p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-xl text-red-600">
            !
          </div>

          <div>
            <h3 className="font-extrabold text-red-700">
              Mismatch & Missing Requirements
            </h3>

            <p className="text-xs font-semibold text-red-500">
              Important gaps that were not hidden
            </p>
          </div>
        </div>

        {analysis.mismatch.summary ? (
          <p className="mt-4 text-sm leading-6 text-red-700">
            {analysis.mismatch.summary}
          </p>
        ) : (
          <p className="mt-4 text-sm leading-6 text-red-400">
            No serious mismatch was identified.
          </p>
        )}

        {analysis.mismatch
          .missingRequirements.length >
          0 && (
          <div className="mt-4">
            <p className="text-xs font-black uppercase tracking-wide text-red-600">
              Missing Requirements
            </p>

            <div className="mt-3 space-y-2">
              {analysis.mismatch
                .missingRequirements
                .slice(0, 5)
                .map((item, index) => (
                  <div
                    key={`${item}-${index}`}
                    className="flex gap-2 text-sm leading-6 text-red-700"
                  >
                    <span className="font-black">
                      ×
                    </span>

                    <span>{item}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {analysis.mismatch
          .unsupportedClaims.length >
          0 && (
          <div className="mt-5 border-t border-red-200 pt-4">
            <p className="text-xs font-black uppercase tracking-wide text-amber-700">
              Claims Not Added
            </p>

            <p className="mt-1 text-xs leading-5 text-amber-700">
              These claims were excluded because the source material did not support them.
            </p>

            <div className="mt-3 space-y-2">
              {analysis.mismatch
                .unsupportedClaims
                .slice(0, 4)
                .map((item, index) => (
                  <div
                    key={`${item}-${index}`}
                    className="flex gap-2 text-sm leading-6 text-amber-800"
                  >
                    <span className="font-black">
                      •
                    </span>

                    <span>{item}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Card 3: Matches */}
      <div className="rounded-2xl border border-green-100 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 text-xl text-green-600">
            ✓
          </div>

          <div>
            <h3 className="font-extrabold">
              Match Strengths
            </h3>

            <p className="text-xs font-semibold text-gray-400">
              Direct matches and realistic transferable skills
            </p>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs font-black uppercase tracking-wide text-green-600">
            Strong Matches
          </p>

          {analysis.matches
            .strongMatches.length >
          0 ? (
            <div className="mt-3 space-y-2">
              {analysis.matches
                .strongMatches
                .slice(0, 5)
                .map((item, index) => (
                  <div
                    key={`${item}-${index}`}
                    className="flex gap-2 text-sm leading-6 text-green-700"
                  >
                    <span className="font-black text-green-600">
                      ✓
                    </span>

                    <span>{item}</span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-gray-400">
              No strong direct matches were identified.
            </p>
          )}
        </div>

        <div className="mt-5 border-t border-gray-100 pt-4">
          <p className="text-xs font-black uppercase tracking-wide text-blue-600">
            Transferable Skills
          </p>

          {analysis.matches
            .transferableSkills.length >
          0 ? (
            <div className="mt-3 space-y-2">
              {analysis.matches
                .transferableSkills
                .slice(0, 4)
                .map((item, index) => (
                  <div
                    key={`${item}-${index}`}
                    className="flex gap-2 text-sm leading-6 text-blue-700"
                  >
                    <span className="font-black text-blue-600">
                      ↗
                    </span>

                    <span>{item}</span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-gray-400">
              No transferable skills were identified.
            </p>
          )}
        </div>
      </div>

      {/* Card 4: Recommendation */}
      <div
        className={`rounded-2xl border p-5 shadow-sm ${recommendationClass}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-extrabold">
              AI Recommendation
            </h3>

            <p className="mt-1 text-xs font-semibold opacity-80">
              Final application decision
            </p>
          </div>

          <span className="rounded-full border border-current/20 bg-white/60 px-3 py-1 text-[11px] font-black">
            {recommendationLabel}
          </span>
        </div>

        {analysis.recommendation
          .summary ? (
          <p className="mt-4 text-sm leading-6">
            {
              analysis.recommendation
                .summary
            }
          </p>
        ) : (
          <p className="mt-4 text-sm leading-6 opacity-70">
            No recommendation summary was returned.
          </p>
        )}

        {analysis.recommendation
          .nextSteps.length > 0 && (
          <div className="mt-4 border-t border-current/10 pt-4">
            <p className="text-xs font-black uppercase tracking-wide">
              Next Steps
            </p>

            <div className="mt-3 space-y-2">
              {analysis.recommendation
                .nextSteps
                .slice(0, 3)
                .map((item, index) => (
                  <div
                    key={`${item}-${index}`}
                    className="flex gap-2 text-sm leading-6"
                  >
                    <span className="font-black">
                      {index + 1}.
                    </span>

                    <span>{item}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AnalysisListCard({
  title,
  icon,
  items,
  emptyText,
  itemClassName,
  iconClassName,
}: {
  title: string;
  icon: string;
  items: string[];
  emptyText: string;
  itemClassName: string;
  iconClassName: string;
}) {
  return (
    <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
      <h3 className="font-extrabold">
        {title}
      </h3>

      <div className="mt-4 space-y-2">
        {items.length > 0 ? (
          items.map((item, index) => (
            <div
              key={`${item}-${index}`}
              className="flex gap-2 text-sm leading-6"
            >
              <span
                className={`font-black ${iconClassName}`}
              >
                {icon}
              </span>

              <span className={itemClassName}>
                {item}
              </span>
            </div>
          ))
        ) : (
          <p className="text-sm leading-6 text-gray-400">
            {emptyText}
          </p>
        )}
      </div>
    </div>
  );
}