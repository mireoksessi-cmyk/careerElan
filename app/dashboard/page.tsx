"use client";

import { searchJobs } from "@/lib/services/search";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import { useLogin } from "@/lib/auth/LoginManager";
import ResumePreviewRenderer from "@/components/resume/ResumePreviewRenderer";
import CoverLetterPreviewRenderer from "@/components/coverLetter/CoverLetterPreviewRenderer";
import CareerMemoryTemplatePreview, {
  mapCareerMemoryRowToPreviewData,
} from "@/components/resume/CareerMemoryTemplatePreview";
import CareerFairCard from "@/components/careerFairs/CareerFairCard";
import ProvinceSelect from "@/components/careerFairs/ProvinceSelect";
import { useUserLocation } from "@/lib/careerFairs/useUserLocation";
import type { RecommendedCareerFair } from "@/lib/careerFairs/types";
import CanonicalTemplatePicker from "@/components/canonicalGeneratePackage/CanonicalTemplatePicker";

const FREE_PACKAGE_LIMIT = 3;
const menuItems = [
  "Dashboard",
  "Career Memory",
  "Find Jobs",
  "Create Package",
  "Job Tracker",
  "Analytics",
  "Settings",
];


type JobItem = {
  title: string;
  company: string;
  location: string;
  type: string;
  tags: string[];
  match?: string;
  matched?: string[];
  missing?: string[];
  fallback?: boolean;
};

type PreviewAsset =
  | {
      type: "career-memory-resume";
    }
  | {
      type: "uploaded-resume";
      item: any;
    }
  | {
      type: "cover-letter";
      item: any;
    }
  | null;



function getMenuHref(item: string) {
  if (item === "Dashboard") return "/dashboard";
  if (item === "Career Memory") return "/career-memory";
  if (item === "Find Jobs") return "/find-jobs";
  if (item === "Create Package") return "/create-package";
  if (item === "Job Tracker") return "/job-tracker";
  if (item === "Analytics") return "/analytics";
  if (item === "Settings") return "/settings";
  return "#";
}

function getMenuIcon(item: string) {
  if (item === "Dashboard") return "🏠";
  if (item === "Career Memory") return "🧠";
  if (item === "Find Jobs") return "🔍";
  if (item === "Create Package") return "📦";
  if (item === "Job Tracker") return "💼";
  if (item === "Analytics") return "📊";
  return "⚙️";
}
function formatInterviewDate(
  interviewDate: string
) {
  if (!interviewDate) {
    return "";
  }

  const dateOnly =
    interviewDate.slice(0, 10);

  const [year, month, day] =
    dateOnly
      .split("-")
      .map(Number);

  if (
    !year ||
    !month ||
    !day
  ) {
    return interviewDate;
  }

  /*
    YYYY-MM-DD를 로컬 날짜로 생성한다.
    new Date("YYYY-MM-DD")의 UTC 변환 문제를 방지한다.
  */
  const date = new Date(
    year,
    month - 1,
    day
  );

  const now = new Date();

  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  const interviewStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );

  const dayDifference = Math.round(
    (
      interviewStart.getTime() -
      todayStart.getTime()
    ) /
      (1000 * 60 * 60 * 24)
  );

  if (dayDifference === 0) {
    return "Today";
  }

  if (dayDifference === 1) {
    return "Tomorrow";
  }

  return date.toLocaleDateString(
    "en-CA",
    {
      weekday: "short",
      month: "short",
      day: "numeric",
      year:
        date.getFullYear() !==
        now.getFullYear()
          ? "numeric"
          : undefined,
    }
  );
}
type InsightItem = {
  name: string;
  level:
    | "Recommended"
    | "Worth Adding"
    | "Nice to Have";
  reason: string;
};

type DashboardStats = {
  packages: number;
  applications: number;
  interviews: number;
  packagesThisMonth: number;
  applicationsThisMonth: number;
  interviewsThisMonth: number;
};

type UpcomingInterview = {
  id: string;
  company: string;
  jobTitle: string;
  interviewDate: string;
};

function hasArrayItems(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}
function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number") {
    return true;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.some(hasMeaningfulValue);
  }

  if (value && typeof value === "object") {
    return Object.values(value).some(
      hasMeaningfulValue
    );
  }

  return false;
}

function hasMeaningfulArrayItems(
  value: unknown
): boolean {
  return (
    Array.isArray(value) &&
    value.some((item) =>
      hasMeaningfulValue(item)
    )
  );
}
function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function getExperienceDescription(experience: any) {
  return [
    experience?.description,
    experience?.responsibilities,
    experience?.achievements,
    experience?.details,
    experience?.bullets,
  ]
    .flat()
    .filter(Boolean)
    .join(" ");
}

function hasMeasurableAchievement(experiences: any[]) {
  return experiences.some((experience) => {
    const text = getExperienceDescription(experience);

    return /\d+|%|\$|CAD|USD|increased|reduced|improved|saved|grew|generated/i.test(
      text
    );
  });
}

function hasToolsOrSoftware(data: any) {
  const skills = Array.isArray(data?.skills)
    ? data.skills
    : Array.isArray(data?.technicalSkills)
      ? data.technicalSkills
      : [];

  const text = skills
    .map((skill: any) =>
      typeof skill === "string"
        ? skill
        : skill?.name || skill?.skill || ""
    )
    .join(" ");

  return /excel|word|powerpoint|outlook|google|microsoft|salesforce|canva|quickbooks|slack|teams|crm|software|system/i.test(
    text
  );
}

function normalizeToArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;

  if (
    typeof value === "string" &&
    value.trim().length > 0
  ) {
    return [value];
  }

  return [];
}

function getResumeText(data: any) {
  return [
    data?.original_text,
    data?.summary,
    data?.professionalSummary,
    data?.professional_summary,
    data?.headline,
    data?.jobTitle,
    data?.targetRole,
    data?.target_role,
    data?.skills,
    data?.technicalSkills,
    data?.coreSkills,
    data?.experience,
    data?.workExperience,
    data?.work_experience,
    data?.education,
    data?.languages,
    data?.certifications,
  ]
    .flat(Infinity)
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (
        item &&
        typeof item === "object"
      ) {
        return Object.values(item)
          .flat(Infinity)
          .filter(
            (value) =>
              typeof value === "string"
          )
          .join(" ");
      }

      return "";
    })
    .filter(Boolean)
    .join(" ");
}

type ResumeInsightSource =
  | "career_memory"
  | "uploaded_resume";

type ResumeScores = {
  memoryCompleted: number;
  aiPersonalization: number;
};

function calculateResumeScores(
  data: any,
  source:
    | "career_memory"
    | "uploaded_resume"
): ResumeScores {
  if (!data) {
    return {
      memoryCompleted: 0,
      aiPersonalization: 0,
    };
  }

  const experiences =
    normalizeToArray(
      data.experience ||
        data.workExperience ||
        data.work_experience
    );

  const education =
    normalizeToArray(
      data.education ||
        data.educations
    );

  const languages =
    normalizeToArray(
      data.languages ||
        data.languageSkills
    );

  const certifications =
    normalizeToArray(
      data.certifications ||
        data.certificates ||
        data.licenses
    );

  const projects =
    normalizeToArray(
      data.projects
    );

  const targetRoles =
    normalizeToArray(
      data.target_roles ||
        data.targetRoles ||
        data.targetRole
    );

  const skillsValue =
    data.skills ||
    data.technicalSkills ||
    data.coreSkills ||
    [];

  const skills =
    Array.isArray(skillsValue)
      ? skillsValue
      : typeof skillsValue === "string"
        ? skillsValue
            .split(",")
            .map((skill) =>
              skill.trim()
            )
            .filter(Boolean)
        : [];

  const firstName =
    data.first_name ||
    data.firstName ||
    "";

  const lastName =
    data.last_name ||
    data.lastName ||
    "";

  const email =
    data.email || "";

  const phone =
    data.phone || "";

  const location =
    data.location || "";

  const linkedin =
    data.linkedin || "";

  const headline =
    data.headline ||
    data.jobTitle ||
    data.job_title ||
    "";

  const summary =
    data.summary ||
    data.professionalSummary ||
    data.professional_summary ||
    "";

  const targetIndustry =
    data.target_industry ||
    data.targetIndustry ||
    "";

  const targetLocation =
    data.target_location ||
    data.targetLocation ||
    "";

  const careerGoalSummary =
    data.career_goal_summary ||
    data.careerGoalSummary ||
    "";

  /*
    Memory Completed
    기본적인 이력서 내용 완성도
  */
  let memoryScore = 0;

/*
  1. Personal Information: 15%
*/
if (
  (hasText(firstName) || hasText(lastName)) &&
  hasText(email)
) {
  memoryScore += 15;
}

/*
  2. Education: 10%
*/
if (
  hasMeaningfulArrayItems(education)
) {
  memoryScore += 10;
}

/*
  3. Experience: 20%
*/
if (
  hasMeaningfulArrayItems(experiences)
) {
  memoryScore += 20;
}

/*
  4. Skills: 15%
*/
if (skills.length > 0) {
  memoryScore += 15;
}

/*
  5. Languages: 10%
*/
if (
  hasMeaningfulArrayItems(languages)
) {
  memoryScore += 10;
}

/*
  6. Certifications: 10%
*/
if (
  hasMeaningfulArrayItems(certifications)
) {
  memoryScore += 10;
}

/*
  7. Projects: 10%
*/
if (
  hasMeaningfulArrayItems(projects)
) {
  memoryScore += 10;
}

/*
  8. Career Goals: 10%
*/
if (
  targetRoles.length > 0 ||
  hasText(targetIndustry) ||
  hasText(targetLocation) ||
  hasText(careerGoalSummary)
) {
  memoryScore += 10;
}
  /*
    AI Personalization
    Career Élan이 사용자를 얼마나 세밀하게
    이해하고 맞춤 생성할 수 있는지
  */
  let personalizationScore = 0;

  if (
    hasMeaningfulArrayItems(
      experiences
    )
  ) {
    personalizationScore += 25;
  }

  if (
    hasMeasurableAchievement(
      experiences
    )
  ) {
    personalizationScore += 15;
  }

  if (skills.length >= 3) {
    personalizationScore += 20;
  } else if (skills.length > 0) {
    personalizationScore += 10;
  }

  if (hasToolsOrSoftware(data)) {
    personalizationScore += 10;
  }

  if (
    hasText(headline) ||
    targetRoles.length > 0
  ) {
    personalizationScore += 10;
  }

  if (
    hasText(targetIndustry) ||
    hasText(targetLocation) ||
    hasText(careerGoalSummary)
  ) {
    personalizationScore += 10;
  }

  if (hasText(summary)) {
    personalizationScore += 5;
  }

  if (
    hasMeaningfulArrayItems(
      education
    ) ||
    hasMeaningfulArrayItems(
      certifications
    ) ||
    hasMeaningfulArrayItems(
      projects
    ) ||
    hasMeaningfulArrayItems(
      languages
    )
  ) {
    personalizationScore += 5;
  }

  /*
    Career Memory에 이미 저장된 profile_strength가 있으면
    직접 작성 Resume의 Memory Completed에는 그 값을 사용
  */
  

  return {
  memoryCompleted: Math.min(
    100,
    Math.max(0, memoryScore)
  ),

  aiPersonalization: Math.min(
    100,
    Math.max(0, personalizationScore)
  ),
};
}
  

function buildResumeInsights(
  data: any,
  source: ResumeInsightSource
): InsightItem[] {
  const insights: InsightItem[] = [];

  const experiences = Array.isArray(data?.experience)
    ? data.experience
    : Array.isArray(data?.workExperience)
      ? data.workExperience
      : Array.isArray(data?.work_experience)
        ? data.work_experience
        : [];

  const education = Array.isArray(data?.education)
    ? data.education
    : Array.isArray(data?.educations)
      ? data.educations
      : [];

  const skills = Array.isArray(data?.skills)
    ? data.skills
    : Array.isArray(data?.technicalSkills)
      ? data.technicalSkills
      : Array.isArray(data?.coreSkills)
        ? data.coreSkills
        : [];

  const languages = Array.isArray(data?.languages)
    ? data.languages
    : Array.isArray(data?.languageSkills)
      ? data.languageSkills
      : [];

  const certifications = Array.isArray(
    data?.certifications
  )
    ? data.certifications
    : Array.isArray(data?.licenses)
      ? data.licenses
      : Array.isArray(data?.certificates)
        ? data.certificates
        : [];

  const targetRoles = Array.isArray(
    data?.target_roles
  )
    ? data.target_roles
    : Array.isArray(data?.targetRoles)
      ? data.targetRoles
      : [];

  const summary =
    data?.summary ||
    data?.professionalSummary ||
    data?.professional_summary ||
    "";

  const headline =
    data?.headline ||
    data?.jobTitle ||
    data?.job_title ||
    data?.title ||
    "";

  const originalText =
    typeof data?.original_text === "string"
      ? data.original_text
      : "";

  /*
    Career Memory는 실제 입력된 필드만 검사한다.
    Summary에 "English", "certification"이 있어도
    Languages나 Certifications 섹션이 작성된 것으로 보지 않는다.
  */
  const hasExperience =
  hasMeaningfulArrayItems(experiences);

const hasSkills =
  hasMeaningfulArrayItems(skills);

const hasEducation =
  source === "career_memory"
    ? hasMeaningfulArrayItems(education)
    : hasMeaningfulArrayItems(education) ||
      /\beducation\b|\bcollege\b|\buniversity\b|\bdegree\b|\bdiploma\b/i.test(
        originalText
      );

const hasLanguages =
  source === "career_memory"
    ? hasMeaningfulArrayItems(languages)
    : hasMeaningfulArrayItems(languages) ||
      /\blanguages?\b|\benglish\b|\bfrench\b|\bkorean\b|\bspanish\b|\bmandarin\b/i.test(
        originalText
      );

const hasCertifications =
  source === "career_memory"
    ? hasMeaningfulArrayItems(
        certifications
      )
    : hasMeaningfulArrayItems(
        certifications
      ) ||
      /\bcertifications?\b|\blicen[cs]e\b|\bcertificate\b|\bcredential\b|\bDELF\b/i.test(
        originalText
      );

if (!hasText(summary)) {
  insights.push({
    name: "Add a professional summary",
    level: "Recommended",
    reason:
      "A focused summary helps recruiters understand your experience and value quickly.",
  });
}

if (
  !hasText(headline) &&
  !hasMeaningfulArrayItems(targetRoles)
) {
  insights.push({
    name: "Clarify your target role",
    level: "Recommended",
    reason:
      "A clear headline or target role makes the resume easier to understand and tailor.",
  });
}

if (!hasExperience) {
  insights.push({
    name: "Add work or volunteer experience",
    level: "Recommended",
    reason:
      "Experience is needed to create stronger job-specific applications.",
  });
} else if (
  !hasMeasurableAchievement(experiences)
) {
  insights.push({
    name: "Add measurable achievements",
    level: "Recommended",
    reason:
      "Numbers and results make your experience more specific and credible.",
  });
}

if (!hasSkills) {
  insights.push({
    name: "Add relevant skills",
    level: "Worth Adding",
    reason:
      "Skills help Career Élan match your resume to job requirements.",
  });
} else if (!hasToolsOrSoftware(data)) {
  insights.push({
    name: "Add tools or software",
    level: "Worth Adding",
    reason:
      "Employers often search for specific software and technical keywords.",
  });
}

if (!hasEducation) {
  insights.push({
    name: "Add education details",
    level: "Worth Adding",
    reason:
      "Education can help satisfy job requirements and improve ATS matching.",
  });
}

if (!hasLanguages) {
  insights.push({
    name: "Add language skills",
    level: "Worth Adding",
    reason:
      "Language skills can strengthen customer-facing and international applications.",
  });
}

if (!hasCertifications) {
  insights.push({
    name: "Add certifications or licences",
    level: "Nice to Have",
    reason:
      "Relevant credentials can strengthen your resume and support your qualifications.",
  });
}

if (insights.length === 0) {
  insights.push({
    name: "Your resume profile looks strong",
    level: "Nice to Have",
    reason:
      "Keep your experience, achievements, and skills updated as your career develops.",
  });
  
}

return insights.slice(0, 4);
}
type SelectedResumePayload = {
  sourceType:
    | "career_memory"
    | "upload";

  resumeId: string | null;
  resumeName: string;
  resumeText: string;
  resumeData: any;
};

function buildSelectedResumePayload(
  careerMemory: any,
  resumes: any[],
  selectedResume: string
): SelectedResumePayload | null {
  /*
    Career Memory Resume 선택
  */
  if (
    selectedResume ===
    "career_memory"
  ) {
    if (!careerMemory) {
      return null;
    }

    return {
      sourceType:
        "career_memory",

      resumeId: null,

      resumeName:
        careerMemory.resume_name ||
        "Career Memory Resume",

      resumeText:
        getResumeText(
          careerMemory
        ),

      resumeData:
        careerMemory,
    };
  }

  /*
    업로드 Resume 선택
  */
  const uploadedResume =
    resumes.find(
      (resume: any) =>
        resume.id ===
        selectedResume
    );

  if (!uploadedResume) {
    return null;
  }

  let parsedData =
    uploadedResume.parsed_data ||
    {};

  /*
    parsed_data가 JSON 문자열로
    저장된 경우 객체로 변환
  */
  if (
    typeof parsedData ===
    "string"
  ) {
    try {
      parsedData =
        JSON.parse(parsedData);
    } catch {
      parsedData = {};
    }
  }

  const resumeData = {
    ...parsedData,

    original_text:
      uploadedResume.original_text ||
      "",
  };

  return {
    sourceType: "upload",

    resumeId:
      uploadedResume.id,

    resumeName:
      uploadedResume.file_name ||
      "Uploaded Resume",

    /*
      업로드 이력서는 원문을
      최우선으로 사용
    */
    resumeText:
      uploadedResume.original_text ||
      getResumeText(
        resumeData
      ),

    resumeData,
  };
}

export default function DashboardPage() {
const {
  user,
  loading,
  profile,
  careerMemory,
  resumes,
  coverLetters,
  hasResumeData,
  refresh,
} = useLogin();
  
  

 const careerMemoryCompleted =
  careerMemory?.required_completed ?? false;

/*
  Never "Guest" - profiles row can still be loading/absent even once
  `user` itself is resolved (e.g. a brand-new OAuth signup whose
  `profiles` trigger hasn't run yet), so fall back through the OAuth
  provider's own metadata name, then the email's local part, before
  finally landing on a neutral "Account" - never a fabricated identity.
*/
const displayName =
  profile?.full_name ||
  user?.user_metadata?.full_name ||
  user?.user_metadata?.name ||
  (user?.email ? user.email.split("@")[0] : "") ||
  "Account";

const [selectedResume, setSelectedResume] = useState("");
const [selectedCoverLetter, setSelectedCoverLetter] = useState("");

/*
  Phase 6I.1 - Canonical Resume Import trigger. Shown only when the
  local Stage 1 canary's template selector flag is on AND the user has
  no Canonical Career Memory profile/version yet (per this round's own
  "no automatic merge" rule - once a profile exists, this bridge no
  longer offers to import a second resume from here). Both checks hit
  dev-only routes that 404 in real Netlify production
  (withCanonicalAuth's own isNetlifyRuntime() gate), so this trigger is
  simply invisible there - no separate production flag needed.
*/
const [canonicalImportEligible, setCanonicalImportEligible] = useState(false);
const [importingResumeId, setImportingResumeId] = useState<string | null>(null);
const [canonicalImportMessage, setCanonicalImportMessage] = useState<string | null>(null);

/*
  Phase 6I.2 - the hard gate (spec section 13): once a canonical
  profile exists, `default_template_id` is either a real value
  ("selected") or NULL ("needs-selection", which blocks navigation-like
  actions until resolved). "not-applicable" covers both "flag off" and
  "no canonical profile yet" - both mean nothing to render here.
*/
const [templateGateStatus, setTemplateGateStatus] = useState<"loading" | "not-applicable" | "needs-selection" | "selected">("loading");
const [availableTemplates, setAvailableTemplates] = useState<Array<{ id: string; name: string; description: string; previewAsset: string }>>([]);
const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
const [savingTemplate, setSavingTemplate] = useState(false);
const [templateSaveError, setTemplateSaveError] = useState<string | null>(null);

async function checkTemplateGate() {
  try {
    const prefRes = await fetch("/api/internal/canonical-career-memory/template-preference");
    if (!prefRes.ok) {
      setTemplateGateStatus("not-applicable");
      return;
    }
    const prefData = await prefRes.json();
    if (prefData.defaultTemplateId) {
      setSelectedTemplateId(prefData.defaultTemplateId);
      setTemplateGateStatus("selected");
      return;
    }

    const profileRes = await fetch("/api/internal/canonical-career-memory/profile");
    if (profileRes.status === 404) {
      setTemplateGateStatus("not-applicable");
      return;
    }

    const templatesRes = await fetch("/api/internal/canonical-career-memory/templates");
    const templatesData = templatesRes.ok ? await templatesRes.json() : { templates: [] };
    setAvailableTemplates(templatesData.templates ?? []);
    setTemplateGateStatus("needs-selection");
  } catch {
    setTemplateGateStatus("not-applicable");
  }
}

useEffect(() => {
  let cancelled = false;

  async function checkEligibility() {
    try {
      const configRes = await fetch("/api/internal/canonical-generate-package/config");
      const configData = configRes.ok ? await configRes.json() : { templateSelectorEnabled: false };
      if (!configData.templateSelectorEnabled) {
        if (!cancelled) {
          setCanonicalImportEligible(false);
          setTemplateGateStatus("not-applicable");
        }
        return;
      }

      const profileRes = await fetch("/api/internal/canonical-career-memory/profile");
      if (cancelled) return;
      setCanonicalImportEligible(profileRes.status === 404);
      await checkTemplateGate();
    } catch {
      if (!cancelled) {
        setCanonicalImportEligible(false);
        setTemplateGateStatus("not-applicable");
      }
    }
  }

  checkEligibility();
  return () => {
    cancelled = true;
  };
}, []);

async function selectDefaultTemplate(templateId: string) {
  setSavingTemplate(true);
  setTemplateSaveError(null);
  try {
    const res = await fetch("/api/internal/canonical-career-memory/template-preference", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setTemplateSaveError(data?.error?.message || "Could not save your template selection.");
      return;
    }
    setSelectedTemplateId(data.defaultTemplateId);
    setTemplateGateStatus("selected");
  } catch {
    setTemplateSaveError("Could not save your template selection.");
  } finally {
    setSavingTemplate(false);
  }
}

async function prepareResumeForCanonicalTemplates(resumeId: string) {
  setImportingResumeId(resumeId);
  setCanonicalImportMessage(null);
  try {
    const res = await fetch("/api/internal/canonical-career-memory/import-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resumeId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setCanonicalImportMessage(data?.error?.message || "Could not prepare this resume for Canonical Templates.");
      return;
    }
    setCanonicalImportEligible(false);
    setCanonicalImportMessage("This resume is ready for Canonical Templates. Choose a template below.");
    await checkTemplateGate();
  } catch {
    setCanonicalImportMessage("Could not prepare this resume for Canonical Templates.");
  } finally {
    setImportingResumeId(null);
  }
}
const [
  selectedResumeScores,
  setSelectedResumeScores,
] = useState<ResumeScores>({
  memoryCompleted: 0,
  aiPersonalization: 0,
});
const memoryStrength =
  selectedResumeScores.memoryCompleted;

const aiPersonalization =
  selectedResumeScores.aiPersonalization;
const [previewAsset, setPreviewAsset] =
  useState<PreviewAsset>(null);
const [deletingAsset, setDeletingAsset] = useState<
  "resume" | "cover-letter" | null
>(null);
const [
  resettingCareerMemory,
  setResettingCareerMemory,
] = useState(false);
  const userLocation = useUserLocation();
  const [manualProvince, setManualProvince] = useState("");
  const [manualCity, setManualCity] = useState("");
  const [careerFairsLoading, setCareerFairsLoading] = useState(true);
  const [careerFairsError, setCareerFairsError] = useState(false);
  const [careerFairsHasLocation, setCareerFairsHasLocation] = useState(false);
 const [stats, setStats] = useState<DashboardStats>({
  packages: 0,
  applications: 0,
  interviews: 0,
  packagesThisMonth: 0,
  applicationsThisMonth: 0,
  interviewsThisMonth: 0,
});
const [
  upcomingInterview,
  setUpcomingInterview,
] = useState<UpcomingInterview | null>(null);
  /*
    Server-authoritative Generate Package quota (same read-only endpoint
    already used by app/paste-job/page.tsx) - GENERATE_PACKAGE_LIFETIME_LIMIT
    is a lifetime, Production-only cap tracked in its own
    generate_package_usage ledger, completely separate from
    stats.packagesThisMonth below (a client-computed count of ALL
    applications rows created this calendar month, including failed/pending
    generation attempts, never enforced by the server). The AI Usage card
    must show this real value whenever it's available so "N remaining"/
    "limit reached" always matches what an actual Generate Package click
    would do - not just this month's raw attempt count.
  */
  const [generatePackageQuota, setGeneratePackageQuota] = useState<{
    enforced: boolean;
    limit: number;
    used: number | null;
    remaining: number | null;
  } | null>(null);
  const [careerFairs, setCareerFairs] = useState<RecommendedCareerFair[]>([]);

  /*
    manualCity is bound directly to the input's onChange for instant
    visual feedback as the user types, but effectiveCity (and the fetch
    effect below keyed on it) uses this debounced copy instead - without
    it, every keystroke in "City (optional)" would fire its own
    /api/career-fairs/recommend request (confirmed during production
    performance QA, spec section 11's explicit "no per-keystroke request
    while typing a city" requirement).
  */
  const [debouncedManualCity, setDebouncedManualCity] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedManualCity(manualCity), 400);
    return () => clearTimeout(timer);
  }, [manualCity]);

  const effectiveCity = userLocation.city || debouncedManualCity || null;
  const effectiveProvince = userLocation.province || manualProvince || null;

  useEffect(() => {
    let cancelled = false;

    async function loadCareerFairs() {
      setCareerFairsLoading(true);
      setCareerFairsError(false);

      try {
        const params = new URLSearchParams();
        if (effectiveCity) params.set("city", effectiveCity);
        if (effectiveProvince) params.set("province", effectiveProvince);

        const res = await fetch(`/api/career-fairs/recommend?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load career fairs.");

        const data = await res.json();
        if (cancelled) return;

        setCareerFairs(data.fairs || []);
        setCareerFairsHasLocation(Boolean(data.hasLocation));
      } catch {
        if (!cancelled) setCareerFairsError(true);
      } finally {
        if (!cancelled) setCareerFairsLoading(false);
      }
    }

    loadCareerFairs();

    return () => {
      cancelled = true;
    };
  }, [effectiveCity, effectiveProvince]);
  const [showTour, setShowTour] = useState(false);
  const [visibleJobs, setVisibleJobs] = useState(6);
  const [recommendedJobs, setRecommendedJobs] =
  useState<JobItem[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [recommendedJobsProgress, setRecommendedJobsProgress] = useState(0);
  const recommendedJobsTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
 const [insightItems, setInsightItems] = useState<InsightItem[]>([]);
 const selectedResumeLabel =
  selectedResume === "career_memory"
    ? careerMemory?.resume_name || "Career Memory Resume"
    : resumes.find((resume: any) => resume.id === selectedResume)
        ?.file_name || "Selected Resume";
 const selectedResumeTypeLabel =
  selectedResume === "career_memory"
    ? "Created Resume"
    : selectedResume
      ? "Imported Resume"
      : "No Resume Selected";       
   /*
     When the server-authoritative quota is available and enforced
     (Production only), it always wins over the client-computed monthly
     application count - that count includes failed/timed-out generation
     attempts the real quota already excludes (see the state comment
     above), which is exactly what previously let this card show a used
     count higher than the real lifetime limit while the account was
     nowhere near actually exhausted. Outside Production (enforced:false,
     used/remaining null), nothing is actually capped server-side, so the
     existing monthly-count display is kept as a soft, informal stat.
   */
   const aiUsageUsed =
     generatePackageQuota?.enforced &&
     typeof generatePackageQuota.used === "number"
       ? generatePackageQuota.used
       : stats.packagesThisMonth;

const aiUsageLimit =
  generatePackageQuota?.enforced
    ? generatePackageQuota.limit
    : FREE_PACKAGE_LIMIT;

const aiUsagePercent = Math.min(
  100,
  Math.round(
    (aiUsageUsed / aiUsageLimit) * 100
  )
);

const aiUsageRemaining =
  generatePackageQuota?.enforced &&
  typeof generatePackageQuota.remaining === "number"
    ? generatePackageQuota.remaining
    : Math.max(0, aiUsageLimit - aiUsageUsed);
  const [showPackageChoice, setShowPackageChoice] = useState(false);
  const router = useRouter();

  

async function saveSelection(
  resumeType: string,
  resumeId: string | null,
  coverLetterId: string | null
) {


  if (!user) return;

  /*
    resumeId/coverLetterId can arrive as "" (React state's unselected
    default) from callers that pass selectedResume/selectedCoverLetter
    straight through - normalize to null so these uuid columns never
    receive an empty string (Postgres 22P02).
  */
  await supabase
    .from("career_memory")
    .update({
      selected_resume_type: resumeType,
      selected_resume_id: resumeId || null,
      selected_cover_letter_id: coverLetterId || null,
    })
    .eq("user_id", user.id);
}

async function deleteSelectedResume() {
  if (!user) {
    alert("Please sign in.");
    return;
  }

  if (!selectedResume) {
    alert("Please select a resume first.");
    return;
  }

  // Career Memory Resume는 사용자당 1개인 기본 이력서이므로 삭제 불가
  if (selectedResume === "career_memory") {
  alert(
    "Career Memory Resume cannot be deleted. You can edit it from Career Memory."
  );
  return;
}

  const resume = resumes.find(
    (item: any) => item.id === selectedResume
  );

  if (!resume) {
    alert("The selected resume could not be found.");
    return;
  }

  const confirmed = window.confirm(
    `Delete "${resume.file_name || "Uploaded Resume"}"?\n\nThis action cannot be undone.`
  );

  if (!confirmed) return;

  setDeletingAsset("resume");

  try {
    /*
      1. Storage 파일 삭제
    */
    if (resume.storage_path) {
      const { error: storageError } =
        await supabase.storage
          .from("resumes")
          .remove([resume.storage_path]);

      if (storageError) {
        console.error(
          "RESUME STORAGE DELETE ERROR =",
          storageError
        );

        alert(
          `Unable to delete the resume file: ${storageError.message}`
        );
        return;
      }
    }

    /*
      2. resumes 테이블 행 삭제
    */
    const {
      data: deletedResume,
      error: databaseError,
    } = await supabase
      .from("resumes")
      .delete()
      .eq("id", resume.id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (databaseError) {
      console.error(
        "RESUME DATABASE DELETE ERROR =",
        databaseError
      );

      alert(
        `Unable to delete the resume record: ${databaseError.message}`
      );
      return;
    }

    if (!deletedResume) {
      alert(
        "The resume could not be deleted. Please check the resumes table DELETE policy."
      );
      return;
    }

    /*
      3. 삭제 후 Career Memory Resume로 선택 변경
    */
    const { error: selectionError } =
      await supabase
        .from("career_memory")
        .update({
          selected_resume_type: "career_memory",
          selected_resume_id: null,
        })
        .eq("user_id", user.id);

    if (selectionError) {
      console.error(
        "RESUME SELECTION RESET ERROR =",
        selectionError
      );
    }

    setSelectedResume("career_memory");

    /*
      4. LoginManager 목록 새로고침
    */
    await refresh();

    alert("Resume deleted successfully.");
  } catch (error) {
    console.error(
      "DELETE RESUME ERROR =",
      error
    );

    alert("Unable to delete this resume.");
  } finally {
    setDeletingAsset(null);
  }
}

async function deleteSelectedCoverLetter() {
  if (!user) {
    alert("Please sign in.");
    return;
  }

  /*
    빈 문자열은 None 옵션
  */
  if (!selectedCoverLetter) {
    alert(
      'The "None" option cannot be deleted because it is the automatic cover letter generation option.'
    );
    return;
  }

  const coverLetter = coverLetters.find(
    (item: any) =>
      item.id === selectedCoverLetter
  );

  if (!coverLetter) {
    alert(
      "The selected cover letter could not be found."
    );
    return;
  }

  const confirmed = window.confirm(
    `Delete "${coverLetter.file_name || "Uploaded Cover Letter"}"?\n\nThis action cannot be undone.`
  );

  if (!confirmed) return;

  setDeletingAsset("cover-letter");

  try {
    /*
      1. Storage 파일 삭제
    */
    if (coverLetter.storage_path) {
      const { error: storageError } =
        await supabase.storage
          .from("cover-letters")
          .remove([
            coverLetter.storage_path,
          ]);

      if (storageError) {
        console.error(
          "COVER LETTER STORAGE DELETE ERROR =",
          storageError
        );

        alert(
          `Unable to delete the cover letter file: ${storageError.message}`
        );
        return;
      }
    }

    /*
      2. cover_letters 테이블 행 삭제
    */
    const {
      data: deletedCoverLetter,
      error: databaseError,
    } = await supabase
      .from("cover_letters")
      .delete()
      .eq("id", coverLetter.id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (databaseError) {
      console.error(
        "COVER LETTER DATABASE DELETE ERROR =",
        databaseError
      );

      alert(
        `Unable to delete the cover letter record: ${databaseError.message}`
      );
      return;
    }

    if (!deletedCoverLetter) {
      alert(
        "The cover letter could not be deleted. Please check the cover_letters table DELETE policy."
      );
      return;
    }

    /*
      3. 삭제 후 None으로 선택 변경
    */
    const { error: selectionError } =
      await supabase
        .from("career_memory")
        .update({
          selected_cover_letter_id: null,
        })
        .eq("user_id", user.id);

    if (selectionError) {
      console.error(
        "COVER LETTER SELECTION RESET ERROR =",
        selectionError
      );
    }

    setSelectedCoverLetter("");

    /*
      4. LoginManager 목록 새로고침
    */
    await refresh();

    alert(
      "Cover letter deleted successfully."
    );
  } catch (error) {
    console.error(
      "DELETE COVER LETTER ERROR =",
      error
    );

    alert(
      "Unable to delete this cover letter."
    );
  } finally {
    setDeletingAsset(null);
  }
}

async function resetCareerMemoryResume() {
  if (!user) {
    alert("Please sign in.");
    return;
  }

  const confirmed = window.confirm(
    "Reset your Career Memory Resume?\n\n" +
      "This will remove the information entered in Career Memory, including personal information, experience, skills, education, languages, certifications, projects, and career goals.\n\n" +
      "Your uploaded resumes and uploaded cover letters will not be deleted."
  );

  if (!confirmed) return;

  setResettingCareerMemory(true);

  try {
    const { error } = await supabase
      .from("career_memory")
      .update({
        first_name: "",
        last_name: "",
        email: "",
        phone: "",
        location: "",
        linkedin: "",
        headline: "",
        summary: "",

        target_roles: [],
        target_industry: "",
        target_location: "",
        salary_expectation: "",
        career_goal_summary: "",

        skills: [],
        education: [],
        experience: [],
        languages: [],
        certifications: [],
        projects: [],

        profile_strength: 0,
        required_completed: false,

        selected_resume_type: null,
        selected_resume_id: null,

        resume_name: "Career Memory Resume",
      })
      .eq("user_id", user.id);

    if (error) {
      console.error(
        "CAREER MEMORY RESET ERROR =",
        error
      );

      alert(error.message);
      return;
    }

    setSelectedResume("");

    await refresh();

    alert(
      "Career Memory Resume has been reset."
    );

    router.replace("/career-memory");
    router.refresh();
  } catch (error) {
    console.error(
      "RESET CAREER MEMORY ERROR =",
      error
    );

    alert(
      "Unable to reset your Career Memory Resume."
    );
  } finally {
    setResettingCareerMemory(false);
  }
}

function getRecommendedJobsPhaseLabel(progress: number) {
  if (progress >= 90) return "Preparing your recommendations";
  if (progress >= 50) return "Identifying suitable job roles";
  if (progress >= 25) return "Reviewing your skills and experience";
  return "Analyzing your selected resume";
}

async function loadDashboard() {

  

 const cacheKey = `recommendedJobs:${selectedResume}`;
const cacheTimeKey = `recommendedJobsTime:${selectedResume}`;

const cachedJobs = sessionStorage.getItem(cacheKey);
const cachedTime = sessionStorage.getItem(cacheTimeKey);

  if (cachedJobs) {
    setRecommendedJobs(JSON.parse(cachedJobs));
  }

  if (!user) {
    console.log("❌ NO USER");
    return;
  }

  console.log("3. USER ID =", user.id);

 
const selectedPayload =
  buildSelectedResumePayload(
    careerMemory,
    resumes,
    selectedResume
  );

if (!selectedPayload) {
  console.log(
    "No selected resume source."
  );

  setRecommendedJobs([]);
  setLoadingJobs(false);

  return;
}




  

 


  const isCacheStale =
    !cachedJobs ||
    !cachedTime ||
    Date.now() - Number(cachedTime) > 1000 * 60 * 60;

  if (!isCacheStale) {
    return;
  }

  setLoadingJobs(true);

  if (recommendedJobsTimerRef.current) {
    clearInterval(recommendedJobsTimerRef.current);
  }

  const jobsFetchStartedAt = Date.now();

  setRecommendedJobsProgress(5);

  /*
    실제 API의 세부 진행 상황은 전달받을 수 없으므로
    경과 시간 기준의 예상 진행률만 표시한다.
    응답이 도착하기 전에는 90%를 넘지 않는다.
  */
  recommendedJobsTimerRef.current = setInterval(() => {
    const elapsed = Date.now() - jobsFetchStartedAt;

    if (elapsed >= 14000) {
      setRecommendedJobsProgress(90);
    } else if (elapsed >= 9000) {
      setRecommendedJobsProgress(75);
    } else if (elapsed >= 5000) {
      setRecommendedJobsProgress(50);
    } else if (elapsed >= 2000) {
      setRecommendedJobsProgress(25);
    }
  }, 1000);

  fetch("/api/recommend-jobs", {
  method: "POST",

  headers: {
    "Content-Type":
      "application/json",
  },

  body: JSON.stringify({
    selectedResumeSource:
      selectedPayload.sourceType === "upload"
        ? "uploaded"
        : "career_memory",

    selectedResumeId:
      selectedPayload.resumeId,
  }),
})

  // ↓↓↓ 여기부터는 네 기존 .then(...) 코드 그대로 ↓↓↓
  
  .then(async (res) => {
    const data = await res.json();

    if (!data.jobs?.length) {
      if (recommendedJobsTimerRef.current) {
        clearInterval(recommendedJobsTimerRef.current);
        recommendedJobsTimerRef.current = null;
      }

      setRecommendedJobsProgress(0);
      setLoadingJobs(false);

      return;
    }

    const realJobs = (
      await Promise.all(
        data.jobs.slice(0, 6).map(async (aiJob: any) => {
          try {
            const result = await searchJobs({
  query: aiJob.title,
  country: "CA",
  state: "",
  city: "",
  jobType: "",
  page: 1,
});

            if (!result.jobs.length) {
  return {
    title: aiJob.title,
    company: "No live posting found",
    location: aiJob.location || "Canada",
    type: "Recommended",
    tags: ["AI"],
    match: aiJob.match,
    matched: aiJob.matched,
    missing: aiJob.missing,
    url: "",
    fallback: true,
  };
}

            const real = result.jobs[0];

            return {
              title: real.title,
              company: real.company,
              location: real.location,
              type: real.type,
              tags: [real.category],
              match: aiJob.match,
              matched: aiJob.matched,
              missing: aiJob.missing,
              url: real.url,
              logo: real.logo,
              source: real.source,
            };
          } catch (err) {
            console.error(err);
            return null;
          }
        })
      )
    ).filter(Boolean);

    if (recommendedJobsTimerRef.current) {
      clearInterval(recommendedJobsTimerRef.current);
      recommendedJobsTimerRef.current = null;
    }

    setRecommendedJobsProgress(100);
    setRecommendedJobs(realJobs);

    /*
      100%가 잠깐 보이도록 한 뒤 실제 추천 결과를 표시한다.
    */
    await new Promise((resolve) => setTimeout(resolve, 400));

    setLoadingJobs(false);

     sessionStorage.setItem(
  cacheKey,
  JSON.stringify(realJobs)
);

sessionStorage.setItem(
  cacheTimeKey,
  Date.now().toString()
);
  })
  .catch((err) => {
  console.error(err);

  if (recommendedJobsTimerRef.current) {
    clearInterval(recommendedJobsTimerRef.current);
    recommendedJobsTimerRef.current = null;
  }

  setLoadingJobs(false);
});
}

/*
  unmount 시 진행률 타이머 누수 방지
*/
useEffect(() => {
  return () => {
    if (recommendedJobsTimerRef.current) {
      clearInterval(recommendedJobsTimerRef.current);
      recommendedJobsTimerRef.current = null;
    }
  };
}, []);


/*
  최초 Dashboard 초기화
*/
useEffect(() => {
  if (loading) return;
  if (!user) return;
  if (!careerMemory) return;

  const initialResume =
    careerMemory
      .selected_resume_type ===
    "career_memory"
      ? "career_memory"
      : careerMemory
          .selected_resume_id ||
        "";

  setSelectedResume(
    initialResume
  );

  setSelectedCoverLetter(
    careerMemory
      .selected_cover_letter_id ||
      ""
  );

  const tourSeen =
    localStorage.getItem(
      "careerElanTourSeen"
    );

  if (!tourSeen) {
    setShowTour(true);
  }
}, [
  loading,
  user,
  careerMemory,
]);

/*
  선택된 Resume가 바뀔 때마다
  해당 Resume만 이용하여 추천 갱신
*/
useEffect(() => {
  if (loading) return;
  if (!user) return;
  if (!careerMemory) return;
  if (!selectedResume) return;

  loadDashboard();
}, [
  loading,
  user,
  careerMemory,
  resumes,
  selectedResume,
]);

useEffect(() => {
  if (!careerMemory) {
    setInsightItems([]);
    return;
  }

  /*
    Career Memory Resume가 선택된 경우
  */
  if (selectedResume === "career_memory") {
  setInsightItems(
    buildResumeInsights(
      careerMemory,
      "career_memory"
    )
  );

  return;
}

  /*
    업로드 Resume가 선택된 경우
  */
  const uploadedResume = resumes.find(
    (resume: any) =>
      resume.id === selectedResume
  );

  if (uploadedResume) {
    const uploadedResumeData = {
      ...(uploadedResume.parsed_data || {}),
      original_text:
        uploadedResume.original_text || "",
    };

    setInsightItems(
  buildResumeInsights(
    uploadedResumeData,
    "uploaded_resume"
  )
);
    return;
  }

  /*
    아무 이력서도 선택되지 않은 경우
  */
  setInsightItems([
    {
      name: "Select a resume",
      level: "Recommended",
      reason:
        "Select a resume to receive personalized improvement suggestions.",
    },
  ]);
}, [
  selectedResume,
  careerMemory,
  resumes,
]);

useEffect(() => {
  /*
    아직 Resume가 선택되지 않은 경우
  */
  if (!selectedResume) {
    setSelectedResumeScores({
      memoryCompleted: 0,
      aiPersonalization: 0,
    });

    return;
  }

  /*
    Career Memory Resume 선택
  */
  if (
    selectedResume ===
    "career_memory"
  ) {
    setSelectedResumeScores(
      calculateResumeScores(
        careerMemory,
        "career_memory"
      )
    );

    return;
  }

  /*
    업로드 Resume 선택
  */
  const uploadedResume =
    resumes.find(
      (resume: any) =>
        resume.id ===
        selectedResume
    );

  if (!uploadedResume) {
    setSelectedResumeScores({
      memoryCompleted: 0,
      aiPersonalization: 0,
    });

    return;
  }

  let parsedData =
    uploadedResume.parsed_data ||
    {};

  /*
    parsed_data가 문자열 JSON인 경우 처리
  */
  if (
    typeof parsedData === "string"
  ) {
    try {
      parsedData =
        JSON.parse(parsedData);
    } catch {
      parsedData = {};
    }
  }

  const uploadedResumeData = {
    ...parsedData,

    original_text:
      uploadedResume.original_text ||
      "",
  };

  setSelectedResumeScores(
    calculateResumeScores(
      uploadedResumeData,
      "uploaded_resume"
    )
  );
}, [
  selectedResume,
  careerMemory,
  resumes,
]);

useEffect(() => {
  if (loading) return;
  if (!user) return;

  async function loadStats() {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

   const { data, error } = await supabase
  .from("applications")
  .select(`
    id,
    company,
    job_title,
    status,
    generation_status,
    created_at,
    applied_date,
    interview_date
  `)
  .eq("user_id", user.id);

    if (error) {
      console.error(
        "DASHBOARD STATS ERROR =",
        error
      );
      return;
    }

    const rows = data ?? [];

    const normalizedRows = rows.map((row) => ({
      ...row,
      normalizedStatus: String(
        row.status || ""
      )
        .trim()
        .toLowerCase(),
    }));

    /*
      패키지 수:
      AI Usage 위젯(get_generate_package_usage RPC)과 동일한 기준 -
      generation_status='failed'인 행만 제외. pending/processing/
      succeeded, 그리고 AI 생성이 아닌 quick-apply 행(null)은 그대로 포함.
    */
    const packageRows = normalizedRows.filter(
      (row) => row.generation_status !== "failed"
    );

    /*
      실제 지원 수:
      package_generated를 제외하고 상태를 변경한 모든 지원서
      applied, interview, offer, accepted, rejected 포함
    */
    const applicationRows =
      normalizedRows.filter(
        (row) =>
          row.normalizedStatus !==
            "package_generated" &&
          row.normalizedStatus !== ""
      );

    /*
      인터뷰 수:
      현재 인터뷰 상태이거나 interview_date가 입력된 지원서
    */
    const interviewRows =
      normalizedRows.filter(
        (row) =>
          row.normalizedStatus ===
            "interview" ||
          Boolean(row.interview_date)
      );

    const isCreatedThisMonth = (
      createdAt: string | null
    ) => {
      if (!createdAt) return false;

      return (
        new Date(createdAt).getTime() >=
        monthStart.getTime()
      );
    };

    const isAppliedThisMonth = (
      appliedDate: string | null
    ) => {
      if (!appliedDate) return false;

      return (
        new Date(appliedDate).getTime() >=
        monthStart.getTime()
      );
    };

    const isInterviewThisMonth = (
      interviewDate: string | null
    ) => {
      if (!interviewDate) return false;

      return (
        new Date(interviewDate).getTime() >=
        monthStart.getTime()
      );
    };

    setStats({
      packages: packageRows.length,

      applications:
        applicationRows.length,

      interviews:
        interviewRows.length,

      packagesThisMonth:
        packageRows.filter((row) =>
          isCreatedThisMonth(row.created_at)
        ).length,

      applicationsThisMonth:
        applicationRows.filter((row) =>
          isAppliedThisMonth(row.applied_date)
        ).length,

      interviewsThisMonth:
        interviewRows.filter((row) =>
          row.interview_date
            ? isInterviewThisMonth(
                row.interview_date
              )
            : isCreatedThisMonth(
                row.created_at
              )
        ).length,
    });

/*
  오늘 이후에 예정된 인터뷰 중
  가장 가까운 인터뷰 1개 선택
*/
const today = new Date();

today.setHours(
  0,
  0,
  0,
  0
);

function getLocalDateTime(
  value: string | null
) {
  if (!value) {
    return null;
  }

  const dateOnly =
    value.slice(0, 10);

  const [year, month, day] =
    dateOnly
      .split("-")
      .map(Number);

  if (
    !year ||
    !month ||
    !day
  ) {
    return null;
  }

  return new Date(
    year,
    month - 1,
    day
  ).getTime();
}

const futureInterviews =
  normalizedRows
    .filter((row) => {
      /*
        인터뷰 상태이면서 날짜가 있는 행만 표시
      */
      if (
        row.normalizedStatus !==
          "interview" ||
        !row.interview_date
      ) {
        return false;
      }

      const interviewTime =
        getLocalDateTime(
          row.interview_date
        );

      return (
        interviewTime !== null &&
        interviewTime >=
          today.getTime()
      );
    })
    .sort((a, b) => {
      const firstTime =
        getLocalDateTime(
          a.interview_date
        ) ?? Infinity;

      const secondTime =
        getLocalDateTime(
          b.interview_date
        ) ?? Infinity;

      return (
        firstTime -
        secondTime
      );
    });

const nextInterview =
  futureInterviews[0];

if (nextInterview) {
  setUpcomingInterview({
    id: nextInterview.id,

    company:
      nextInterview.company ||
      "Company",

    jobTitle:
      nextInterview.job_title ||
      "Interview",

    interviewDate:
      nextInterview.interview_date!,
  });
} else {
  setUpcomingInterview(null);
}

    console.log(
      "DASHBOARD APPLICATION ROWS =",
      normalizedRows
    );
  }

  loadStats();
}, [loading, user]);

useEffect(() => {
  if (loading) return;
  if (!user) return;

  let cancelled = false;

  (async () => {
    try {
      const res = await fetch("/api/generate-package/usage");

      if (!res.ok) return;

      const data = await res.json();

      if (!cancelled) {
        setGeneratePackageQuota({
          enforced: Boolean(data.enforced),
          limit: data.limit,
          used: data.used ?? null,
          remaining: data.remaining ?? null,
        });
      }
    } catch (error) {
      console.error(
        "GENERATE PACKAGE USAGE ERROR =",
        error
      );
    }
  })();

  return () => {
    cancelled = true;
  };
}, [loading, user]);

/*
  Only redirect once the auth check has actually finished (loading ===
  false) - redirecting while loading is still true would fire on every
  page load/refresh before the session has had a chance to hydrate,
  incorrectly bouncing a genuinely logged-in user to the homepage.
*/
useEffect(() => {
  if (loading) return;
  if (!user) {
    router.replace("/");
  }
}, [loading, user, router]);



  function closeTour() {
    localStorage.setItem("careerElanTourSeen", "true");
    setShowTour(false);
  }

function renderPreviewContent() {
  if (!previewAsset) return null;

  if (previewAsset.type === "career-memory-resume") {
    return (
      <CareerMemoryTemplatePreview
        data={mapCareerMemoryRowToPreviewData(careerMemory)}
      />
    );
  }

  /*
    업로드한 Resume
  */
  if (previewAsset.type === "uploaded-resume") {
    return <ResumePreviewRenderer resume={previewAsset.item} />;
  }

  /*
    업로드한 Cover Letter - 이력서의 uploaded-resume 분기와 동일하게, 원본
    파일 인식 공유 렌더러에 위임한다. 레거시(원본 파일 처리 파이프라인이
    없던 시절) 커버레터와 처리 실패/대기 상태는 CoverLetterPreviewRenderer
    내부의 CareerElanCoverLetterPreview 폴백이 예전과 동일하게 처리한다.
  */
  if (previewAsset.type === "cover-letter") {
    return <CoverLetterPreviewRenderer coverLetter={previewAsset.item} />;
  }

  return null;
}

/*
  While the auth check is still in flight, never render the real
  dashboard (which would show fallback/"Guest"-style content for a split
  second) - a full-page skeleton instead. Once loading has finished and
  there is genuinely no user, render nothing here; the redirect effect
  above sends the browser to "/" (the existing login flow) on the same
  tick React commits this state, so no dashboard content is ever shown
  to an unauthenticated visitor.
*/
if (loading) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6fbff]">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
    </main>
  );
}

if (!user) {
  return null;
}

  return (

    <main className="min-h-screen bg-[#f6fbff] text-gray-900">
     {previewAsset && (
  <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/50 px-4 py-8 backdrop-blur-sm">
    <div className="mx-auto w-full max-w-5xl rounded-3xl bg-slate-100 shadow-2xl">
      <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-3xl border-b border-slate-200 bg-white px-6 py-4">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-blue-600">
            Document Preview
          </p>

          <h2 className="mt-1 text-xl font-black text-slate-950">
            {previewAsset.type ===
            "career-memory-resume"
              ? "Career Memory Resume"
              : previewAsset.type ===
                "uploaded-resume"
              ? previewAsset.item.file_name ||
                "Uploaded Resume"
              : previewAsset.item.file_name ||
                "Uploaded Cover Letter"}
          </h2>
        </div>

        <button
          type="button"
          onClick={() => setPreviewAsset(null)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-2xl text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
        >
          ×
        </button>
      </div>

      <div className="p-4 sm:p-8">
        <div className="rounded-2xl bg-white shadow">
          {renderPreviewContent()}
        </div>
      </div>

      <div className="sticky bottom-0 flex justify-end rounded-b-3xl border-t border-slate-200 bg-white px-6 py-4">
        <button
          type="button"
          onClick={() => setPreviewAsset(null)}
          className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white transition hover:bg-blue-700"
        >
          Close Preview
        </button>
      </div>
    </div>
  </div>
)}

      {showPackageChoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-8 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-3xl font-extrabold">Create Full Package</h2>
                <p className="mt-2 text-sm text-gray-500">
                  Choose how you want to create your company-specific application package.
                </p>
              </div>
              <button onClick={() => setShowPackageChoice(false)} className="text-2xl text-gray-400 hover:text-gray-700">
                ×
              </button>
            </div>

            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <a
                href="/find-jobs"
                className="rounded-2xl border border-blue-200 bg-blue-50/50 p-6 transition hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-4xl shadow-sm">🔍</div>
                <h3 className="mt-5 text-xl font-extrabold">Find Jobs in Career Élan</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  Search jobs matched to your Career Memory, choose a posting, then generate a tailored resume, cover letter, and email draft.
                </p>
                <p className="mt-5 font-bold text-blue-600">Find Jobs →</p>
              </a>

              <a
                href="/create-package"
                className="rounded-2xl border border-blue-200 bg-white p-6 transition hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-4xl shadow-sm">📦</div>
                <h3 className="mt-5 text-xl font-extrabold">Paste Job URL or Description</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  Already found a job on LinkedIn, Indeed, Job Bank, or a company website? Paste it here and generate your full package.
                </p>
                <p className="mt-5 font-bold text-blue-600">Create Package →</p>
              </a>
            </div>

            <p className="mt-7 rounded-2xl bg-green-50 px-5 py-4 text-center text-sm font-bold text-green-700">
              You apply directly. Career Élan prepares your resume, cover letter, and email draft in minutes.
            </p>
          </div>
        </div>
      )}

      {showTour && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-8 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-3xl font-extrabold">Welcome to Career Élan! 👋</h2>
                <p className="mt-2 text-sm text-gray-500">Take a quick 3-step tour to get started.</p>
              </div>
              <button onClick={closeTour} className="text-2xl text-gray-400 hover:text-gray-700">×</button>
            </div>

            <div className="mt-8 grid gap-5 md:grid-cols-3">
              <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5 text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-white text-4xl shadow-sm">🧠</div>
                <span className="mt-5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">1</span>
                <h3 className="mt-4 font-extrabold">Build Your Career Memory</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">Save your experience, education, skills, and goals once.</p>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5 text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-white text-4xl shadow-sm">🔍</div>
                <span className="mt-5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">2</span>
                <h3 className="mt-4 font-extrabold">Find or Paste a Job</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">Use Career Élan Search or paste a job URL/description.</p>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5 text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-white text-4xl shadow-sm">📦</div>
                <span className="mt-5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">3</span>
                <h3 className="mt-4 font-extrabold">Generate Your Package</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">Create a tailored resume, cover letter, and email draft.</p>
              </div>
            </div>

            <p className="mt-7 rounded-2xl bg-green-50 px-5 py-4 text-center text-sm font-bold text-green-700">
              You apply. Career Élan prepares. 🚀
            </p>

            <div className="mt-7 flex justify-center gap-3">
              <a href="/career-memory" onClick={() => localStorage.setItem("careerElanTourSeen", "true")} className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white">
                Start with Career Memory
              </a>
              <button onClick={closeTour} className="rounded-xl border border-gray-200 px-6 py-3 text-sm font-bold text-gray-600">
                Skip for now
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="w-full border-r border-blue-100 bg-white px-5 py-6 md:w-60">
          <div className="flex items-center justify-between">
            <a href="/dashboard">
              <Image src="/logo.png" alt="Career Élan" width={120} height={45} />
            </a>
            <span className="text-gray-400">‹</span>
          </div>

          <p className="mt-8 text-xs font-bold uppercase tracking-wider text-gray-400">Overview</p>

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
                <span>{getMenuIcon(item)}</span>
                {item}
              </a>
            ))}
          </nav>

          <div className="mt-64 rounded-2xl bg-blue-50 p-5 text-center">
            <div className="text-3xl">👑</div>
            <h3 className="mt-3 font-extrabold">Upgrade to Pro</h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">Unlock unlimited AI features and boost your job search.</p>
            <button className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white">Upgrade Now</button>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center justify-between gap-4 px-8 py-6">
            <div>
             <h1 className="text-2xl font-extrabold">
  Good morning, {displayName}! 👋
</h1>
              <p className="mt-1 text-sm text-gray-500">
                Find jobs faster. Generate a tailored package in minutes.{" "}
                <span className="font-bold text-blue-600">You apply. We prepare.</span>
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
  {displayName.charAt(0).toUpperCase()}
</div>
                <div>
                  <p className="text-sm font-bold">{displayName}</p>
                 <p className="text-sm text-gray-500">
  User
</p>
                </div>
              </a>
            </div>
          </header>

          <div className="grid grid-cols-12 gap-6 px-8 pb-8">
            <section className="col-span-12 space-y-6 xl:col-span-9">
              <div>
                <h2 className="mb-4 text-lg font-bold">Overview</h2>

                <div className="grid gap-5 md:grid-cols-4">
  <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm font-semibold text-gray-500">
            Create Resume & Import Resume
        </p>

        <h3 className="mt-3 text-3xl font-extrabold">
          {memoryStrength}%
        </h3>
      </div>

      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-xl">
        🧠
      </div>
    </div>

    <div className="mt-3">
  <p className="text-xs font-bold text-blue-600">
    {selectedResumeTypeLabel}
  </p>

  <p className="mt-1 truncate text-xs text-gray-500">
    {selectedResumeLabel}
  </p>
</div>

    <div className="mt-5 flex items-center justify-between text-sm">
      <a
        href="/career-memory"
        className="font-bold text-blue-600"
      >
        Improve Profile
      </a>

      <span>→</span>
    </div>
  </div>

  <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm font-semibold text-gray-500">
          Application Packages
        </p>

        <h3 className="mt-3 text-3xl font-extrabold">
          {stats.packages}
        </h3>
      </div>

      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-xl">
        📦
      </div>
    </div>

    <p className="mt-3 text-xs text-gray-500">
      <span className="font-bold text-green-600">
        +{stats.packagesThisMonth}
      </span>{" "}
      generated this month
    </p>

    <div className="mt-5 flex items-center justify-between text-sm">
      <a
        href="/job-tracker"
        className="font-bold text-blue-600"
      >
        View Packages
      </a>

      <span>→</span>
    </div>
  </div>

  <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm font-semibold text-gray-500">
          Applications Sent
        </p>

        <h3 className="mt-3 text-3xl font-extrabold">
          {stats.applications}
        </h3>
      </div>

      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-xl">
        📤
      </div>
    </div>

    <p className="mt-3 text-xs text-gray-500">
      <span className="font-bold text-green-600">
        +{stats.applicationsThisMonth}
      </span>{" "}
      submitted this month
    </p>

    <div className="mt-5 flex items-center justify-between text-sm">
      <a
        href="/job-tracker"
        className="font-bold text-blue-600"
      >
        View Applications
      </a>

      <span>→</span>
    </div>
  </div>

  <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm font-semibold text-gray-500">
          Interviews
        </p>

        <h3 className="mt-3 text-3xl font-extrabold">
          {stats.interviews}
        </h3>
      </div>

      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-xl">
        🗓️
      </div>
    </div>

    <p className="mt-3 text-xs text-gray-500">
      <span className="font-bold text-green-600">
        +{stats.interviewsThisMonth}
      </span>{" "}
      added this month
    </p>

    <div className="mt-5 flex items-center justify-between text-sm">
      <a
        href="/job-tracker"
        className="font-bold text-blue-600"
      >
        View Interviews
      </a>

      <span>→</span>
    </div>
  </div>
</div>
              </div>
                 
                <div className="mb-6 rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">

<h2 className="text-lg font-bold">
Resume & Cover Letter
</h2>

<p className="mt-1 text-sm text-gray-500">
Choose which resume and cover letter will be used when generating your application package.
</p>

<div className="mt-6 grid gap-8 md:grid-cols-2">

  {/* Resume column */}
  <div>
    <div className="mb-3 flex items-center justify-between gap-3">
    <h3 className="font-bold">
      Resume <span className="text-red-500">*</span>
    </h3>

    <button
      type="button"
      onClick={deleteSelectedResume}
      disabled={
        deletingAsset !== null ||
        !selectedResume ||
        selectedResume === "career_memory"
      }
      title={
        selectedResume === "career_memory"
          ? "Career Memory Resume cannot be deleted."
          : "Delete selected uploaded resume"
      }
      className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
        deletingAsset !== null ||
        !selectedResume ||
        selectedResume === "career_memory"
          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
          : "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
      }`}
    >
      {deletingAsset === "resume"
        ? "Deleting..."
        : "🗑 Delete"}
    </button>
  </div>

  {careerMemory && (
    <div
      className={`mb-3 flex flex-wrap items-center gap-3 rounded-xl border p-3 transition ${
        selectedResume === "career_memory"
          ? "border-blue-500 bg-blue-50/40"
          : "border-slate-200 bg-white"
      }`}
    >
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
        <input
          type="radio"
          name="resume"
          checked={selectedResume === "career_memory"}
          onChange={async () => {
            setSelectedResume("career_memory");

            await saveSelection(
              "career_memory",
              null,
              selectedCoverLetter || null
            );
          }}
        />

        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            Create Resume
          </p>

          <p className="truncate text-sm text-gray-500">
            {careerMemory.resume_name ||
              "Career Memory Resume"}
          </p>
        </div>
      </label>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() =>
            setPreviewAsset({
              type: "career-memory-resume",
            })
          }
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
        >
          Preview
        </button>

        <button
          type="button"
          onClick={() =>
            router.push("/career-memory")
          }
          className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-600 transition hover:bg-blue-100"
        >
          Edit
        </button>

        <button
          type="button"
          onClick={resetCareerMemoryResume}
          disabled={resettingCareerMemory}
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {resettingCareerMemory
            ? "Resetting..."
            : "Reset"}
        </button>
      </div>
    </div>
  )}

  {resumes.map((resume: any) => (
    <div
      key={resume.id}
      className={`mb-3 flex flex-wrap items-center gap-3 rounded-xl border p-3 transition ${
        selectedResume === resume.id
          ? "border-blue-500 bg-blue-50/40"
          : "border-slate-200 bg-white"
      }`}
    >
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
        <input
          type="radio"
          name="resume"
          checked={selectedResume === resume.id}
          onChange={async () => {
            setSelectedResume(resume.id);

            await saveSelection(
              "uploaded",
              resume.id,
              selectedCoverLetter || null
            );
          }}
        />

        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            Import Resume
          </p>

          <p className="truncate text-sm text-gray-500">
            {resume.file_name}
          </p>
        </div>
      </label>

      <button
        type="button"
        onClick={() =>
          setPreviewAsset({
            type: "uploaded-resume",
            item: resume,
          })
        }
        className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
      >
        Preview
      </button>

      {canonicalImportEligible && (
        <button
          type="button"
          onClick={() => prepareResumeForCanonicalTemplates(resume.id)}
          disabled={importingResumeId === resume.id}
          className="shrink-0 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-bold text-purple-600 transition hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {importingResumeId === resume.id ? "Preparing..." : "Prepare this resume for Canonical Templates"}
        </button>
      )}
    </div>
  ))}

  {canonicalImportMessage && (
    <p className="mt-2 text-xs font-semibold text-slate-600">{canonicalImportMessage}</p>
  )}

  {templateGateStatus === "needs-selection" && (
    <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
      <p className="mb-1 text-sm font-bold text-slate-900">Choose your resume template</p>
      <p className="mb-3 text-xs text-slate-600">
        Pick one of the 4 Canonical Templates. This becomes your default design everywhere — Dashboard, Paste Job, and generated
        packages — until you change it.
      </p>
      {templateSaveError && <p className="mb-3 text-xs font-semibold text-red-600">{templateSaveError}</p>}
      <CanonicalTemplatePicker
        templates={availableTemplates as any}
        selectedTemplateId={selectedTemplateId as any}
        onSelect={(templateId) => selectDefaultTemplate(templateId)}
        disabled={savingTemplate}
        livePreviewUrl={(templateId) => `/api/internal/canonical-career-memory/resume-preview?templateId=${templateId}&format=html&variant=thumbnail`}
      />
    </div>
  )}

  {templateGateStatus === "selected" && selectedTemplateId && (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold text-slate-600">
        Default template: <span className="text-slate-900">{selectedTemplateId}</span>
      </p>
      <button
        type="button"
        onClick={async () => {
          try {
            const templatesRes = await fetch("/api/internal/canonical-career-memory/templates");
            const templatesData = templatesRes.ok ? await templatesRes.json() : { templates: [] };
            setAvailableTemplates(templatesData.templates ?? []);
            setTemplateSaveError(null);
            setTemplateGateStatus("needs-selection");
          } catch {
            setTemplateSaveError("Could not load templates.");
          }
        }}
        className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-100"
      >
        Change Template
      </button>
    </div>
  )}
</div>
<div>

<div className="mb-3 flex items-center justify-between gap-3">
  <h3 className="font-bold">
    Cover Letter
    <span className="ml-2 text-xs text-gray-500">
      (Optional)
    </span>
  </h3>

  <button
    type="button"
    onClick={deleteSelectedCoverLetter}
    disabled={
      deletingAsset !== null ||
      !selectedCoverLetter
    }
    title={
      !selectedCoverLetter
        ? 'The "None" option cannot be deleted.'
        : "Delete selected uploaded cover letter"
    }
    className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
      deletingAsset !== null ||
      !selectedCoverLetter
        ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
        : "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
    }`}
  >
    {deletingAsset === "cover-letter"
      ? "Deleting..."
      : "🗑 Delete"}
  </button>
</div>

<label className="mb-3 flex cursor-pointer items-center gap-3 rounded-xl border p-3">

<input
type="radio"
name="cover"
checked={selectedCoverLetter===""}
onChange={async()=>{

setSelectedCoverLetter("");

await saveSelection(
selectedResume==="career_memory"
? "career_memory"
: "uploaded",

selectedResume==="career_memory"
? null
: selectedResume,

null
);

}}
/>

<div>

<p className="font-semibold">
None
</p>

<p className="text-sm text-gray-500">
Generate automatically
</p>

</div>

</label>

{coverLetters.map((cover: any) => (
  <div
    key={cover.id}
    className={`mb-3 flex flex-wrap items-center gap-3 rounded-xl border p-3 transition ${
      selectedCoverLetter === cover.id
        ? "border-blue-500 bg-blue-50/40"
        : "border-slate-200 bg-white"
    }`}
  >
    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
      <input
        type="radio"
        name="cover"
        checked={
          selectedCoverLetter === cover.id
        }
        onChange={async () => {
          setSelectedCoverLetter(cover.id);

          await saveSelection(
            selectedResume ===
              "career_memory"
              ? "career_memory"
              : "uploaded",

            selectedResume ===
              "career_memory"
              ? null
              : selectedResume,

            cover.id
          );
        }}
      />

      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          Uploaded Cover Letter
        </p>

        <p className="truncate text-sm text-gray-500">
          {cover.file_name}
        </p>
      </div>
    </label>

    <button
      type="button"
      onClick={() =>
        setPreviewAsset({
          type: "cover-letter",
          item: cover,
        })
      }
      className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
    >
      Preview
    </button>
  </div>
))}
</div>

</div>

</div> 

              <div>
                <h2 className="mb-4 text-lg font-bold">Quick Actions</h2>

                <div className="grid gap-4 md:grid-cols-4">
                  <a href="/find-jobs" className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
                    <div className="text-3xl">🔍</div>
                    <h3 className="mt-3 font-extrabold">Find Jobs</h3>
                    <p className="mt-1 text-sm text-gray-500">Search jobs matched to your Career Memory.</p>
                    <span className="mt-8 block text-right text-xl">→</span>
                  </a>

                  <button
                    onClick={() => setShowPackageChoice(true)}
                    className="rounded-2xl border border-blue-300 bg-white p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg md:col-span-2"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-3xl">📦</div>
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-600">CORE FEATURE</span>
                    </div>

                    <h3 className="mt-4 text-lg font-extrabold">Create Full Package</h3>
                    <p className="mt-2 text-sm leading-6 text-gray-600">
                      Generate a tailored resume, cover letter, and email draft for any job in minutes.
                    </p>

                    <div className="mt-4 space-y-2 text-sm font-semibold text-gray-600">
                      <p>✓ Find jobs in Career Élan</p>
                      <p>✓ Paste job URL or description</p>
                      <p>✓ Generate full application package</p>
                    </div>

                    <div className="mt-5 flex items-center justify-between">
                      <span className="text-sm font-bold text-blue-600">Choose Package Method</span>
                      <span className="text-xl">→</span>
                    </div>
                  </button>

                  <a href="/job-tracker" className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
                    <div className="text-3xl">📊</div>
                    <h3 className="mt-3 font-extrabold">Job Tracker</h3>
                    <p className="mt-1 text-sm text-gray-500">Track every application and interview.</p>
                    <span className="mt-8 block text-right text-xl">→</span>
                  </a>
                </div>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold">Recommended Jobs</h2>
                    <p className="mt-1 text-sm text-gray-500">
                      {hasResumeData
                        ? "Based on your Career Memory and profile."
                        : "General recommendations. Upload your resume to unlock personalized matches."}
                    </p>
                  </div>
                  <a href="/find-jobs" className="text-sm font-bold text-blue-600">View All Jobs</a>
                </div>

                {!hasResumeData && (
                  <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                    Write or upload a resume to get recommendations tailored to your profile.{" "}
                    <a href="/career-memory" className="font-bold underline">
                      Add your resume
                    </a>
                  </div>
                )}

                <div className="grid gap-5 md:grid-cols-3">
                  {loadingJobs ? (
                    <>
                      <div className="col-span-full rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                        <p className="text-sm font-bold text-blue-800">
                          Finding jobs that fit your resume
                        </p>
                        <p className="mt-1 text-xs text-blue-700">
                          Analyzing {selectedResumeLabel} · {getRecommendedJobsPhaseLabel(recommendedJobsProgress)}
                        </p>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                          <div
                            className="h-full rounded-full bg-blue-600 transition-all duration-500"
                            style={{ width: `${recommendedJobsProgress}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[10px] font-semibold text-blue-400">
                          Estimated progress · {recommendedJobsProgress}%
                        </p>
                      </div>
                      {

Array.from({ length: 6 }).map((_, index) => (
  // Array.from({ length: 6 }).map((_, index) => (
  <div
    key={index}
    className="animate-pulse rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
  >
    <div className="h-8 w-8 rounded bg-gray-200"></div>

    <div className="mt-4 h-5 rounded bg-gray-200"></div>

    <div className="mt-2 h-4 w-2/3 rounded bg-gray-100"></div>

    <div className="mt-4 h-4 rounded bg-gray-100"></div>

    <div className="mt-2 h-4 rounded bg-gray-100"></div>

    <div className="mt-5 h-10 rounded-xl bg-gray-200"></div>
  </div>
))
                      }
                    </>
) : (

recommendedJobs.slice(0, visibleJobs).map((job) => (
  <div
    key={`${job.title}-${job.company}`}
    className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
  >
    <div className="flex items-start justify-between">
      <div className="text-3xl">💼</div>
      <div className="text-right">
        {job.match && (
          <p className="text-2xl font-extrabold text-green-600">{job.match}</p>
        )}
        {job.match && (
          <p className="text-xs font-bold text-gray-500">Match</p>
        )}
      </div>
    </div>

    <h3 className="mt-4 text-lg font-extrabold">{job.title}</h3>
    <p className="mt-1 text-sm text-gray-500">
      {job.company} · {job.location}
    </p>

    <div className="mt-4 flex flex-wrap gap-2">
      <span className="rounded-full border border-blue-100 px-3 py-1 text-xs font-bold text-blue-600">
        {job.type}
      </span>

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
      <h4 className="text-xs font-extrabold text-gray-700">
        Why this matches you
      </h4>

      <div className="mt-2 space-y-1">
        {job.matched?.map((item) => (
          <p key={item} className="text-xs font-semibold text-green-700">
            ✓ {item}
          </p>
        ))}
      </div>
    </div>

    <div className="mt-4">
      <h4 className="text-xs font-extrabold text-gray-700">Missing</h4>

      <div className="mt-2 space-y-1">
        {job.missing?.map((item) => (
          <p key={item} className="text-xs font-semibold text-red-500">
            × {item}
          </p>
        ))}
      </div>
    </div>

    {job.fallback ? (
  <button
    onClick={() => router.push("/find-jobs")}
    className="mt-5 block w-full rounded-xl border border-blue-600 bg-white px-4 py-3 text-center text-sm font-bold text-blue-600"
  >
    Search Again →
  </button>
) : (
  <button
    onClick={() => {
      sessionStorage.setItem(
        "recommendedJobs",
        JSON.stringify(recommendedJobs)
      );

      router.push(
        `/paste-job?url=${encodeURIComponent((job as any).url || "")}`
      );
    }}
    className="mt-5 block w-full rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-bold text-white"
  >
    Generate Package →
  </button>
)}
  </div>
))

)}
</div>

{visibleJobs < recommendedJobs.length && (
  <div className="mt-6 flex justify-center">
    <button
      onClick={() =>
        setVisibleJobs((prev) =>
          Math.min(prev + 3, recommendedJobs.length)
        )
      }
      className="rounded-xl border border-blue-200 bg-white px-8 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50"
    >
      More Jobs +
    </button>
  </div>
)}

                 
              <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
  <div className="mb-5 flex items-center justify-between gap-3">
    <div>
      <h2 className="text-lg font-bold">🎪 Career Fair Search</h2>

      <p className="mt-1 text-sm text-gray-500">
        {careerFairsHasLocation
          ? "Career fairs near you."
          : "Upcoming across Canada."}
      </p>
    </div>

    <a
      href="/career-fairs"
      className="text-sm font-bold text-blue-600 hover:underline"
    >
      View All
    </a>
  </div>

  <div className="mb-6 flex flex-wrap items-center gap-3">
    <span className="text-xl">📍</span>

    {userLocation.status === "granted" &&
    (userLocation.city || userLocation.province) ? (
      <span className="text-sm font-semibold text-slate-600">
        Using your location:{" "}
        {userLocation.city ? `${userLocation.city}, ` : ""}
        {userLocation.province || ""}
      </span>
    ) : (
      <>
        <button
          type="button"
          onClick={userLocation.requestLocation}
          disabled={userLocation.status === "requesting"}
          className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-600 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {userLocation.status === "requesting"
            ? "Locating..."
            : "📍 Use my location"}
        </button>

        <span className="text-sm text-slate-400">or choose</span>

        <ProvinceSelect
          value={manualProvince}
          onChange={setManualProvince}
        />

        <input
          type="text"
          value={manualCity}
          onChange={(e) => setManualCity(e.target.value)}
          placeholder="City (optional)"
          aria-label="City (optional)"
          className="min-w-0 flex-1 rounded-xl border border-gray-300 px-4 py-2 text-sm outline-none focus:border-blue-400"
        />
      </>
    )}
  </div>

  {careerFairsLoading ? (
    <div
      role="status"
      aria-live="polite"
      className="grid gap-4 md:grid-cols-3"
    >
      <span className="sr-only">Loading career fairs…</span>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          className="h-40 animate-pulse rounded-2xl bg-slate-100"
        />
      ))}
    </div>
  ) : careerFairsError ? (
    <div
      role="alert"
      className="rounded-xl border border-red-100 bg-red-50 p-6 text-center text-sm font-semibold text-red-600"
    >
      Couldn&apos;t load career fairs right now. Please try again later.
    </div>
  ) : careerFairs.length === 0 ? (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-6 text-center text-sm text-slate-500">
      No upcoming career fairs found right now. Check back soon.
    </div>
  ) : (
    <>
      {/*
        The recommend API already ranks public/newcomers/alumni ahead of
        students_only within each location tier - but when literally
        every result is students_only (or eligibility is unknown), that
        ranking alone doesn't tell a non-student job seeker anything.
        This banner makes that explicit instead of silently showing a
        wall of events they likely can't attend.
      */}
      {careerFairs.every(
        (fair) =>
          fair.audience === "students_only" ||
          fair.audience === "employer_invite_only" ||
          fair.audience === "unknown" ||
          !fair.audience
      ) && (
        <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs font-semibold text-amber-700">
          These upcoming fairs are mostly student/alumni-focused or have
          unclear eligibility - check each event&apos;s badge before attending
          if you&apos;re not a current student.
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {careerFairs.map((fair) => (
          <CareerFairCard
            key={fair.id}
            fair={fair}
            matchTier={fair.matchTier}
          />
        ))}
      </div>
    </>
  )}
</div>

              </div>
            </section>

            <aside className="col-span-12 space-y-6 xl:col-span-3">
  <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-bold"> Create Resume & Import Resume</h2>

    <div className="mt-5 flex justify-center">
      <div className="flex h-28 w-28 items-center justify-center rounded-full border-8 border-blue-200 bg-blue-50 text-4xl">
        🧠
      </div>
    </div>

    <div className="mt-6 space-y-4">
      {/* Memory Completed */}
      <div>
        <div className="flex justify-between text-xs font-bold text-gray-500">
          <span>Memory Completed</span>
          <span>{memoryStrength}%</span>
        </div>

        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-2 rounded-full bg-blue-600 transition-all duration-500"
            style={{
              width: `${memoryStrength}%`,
            }}
          />
        </div>
      </div>

      {/* AI Personalization */}
      <div>
        <div className="flex justify-between text-xs font-bold text-gray-500">
          <span>AI Personalization</span>
          <span>{aiPersonalization}%</span>
        </div>

        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-2 rounded-full bg-cyan-500 transition-all duration-500"
            style={{
              width: `${aiPersonalization}%`,
            }}
          />
        </div>
      </div>
    </div>

    <a
      href="/career-memory"
      className="mt-5 block rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-bold text-white"
    >
      Improve My Profile →
    </a>
  </div>

  <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-bold">Career Insights</h2>

    <p className="mt-1 text-sm text-gray-500">
      Suggestions based on{" "}
      <span className="font-bold text-blue-600">
        {selectedResumeLabel}
      </span>
      .
    </p>

    <div className="mt-5 space-y-4">
      {insightItems.map((item) => (
        <div
          key={`${item.name}-${item.reason}`}
          className="rounded-xl bg-slate-50 p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-bold">
              {item.name}
            </p>

            <span
              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${
                item.level === "Recommended"
                  ? "bg-red-100 text-red-600"
                  : item.level === "Worth Adding"
                  ? "bg-blue-100 text-blue-600"
                  : "bg-slate-200 text-slate-600"
              }`}
            >
              {item.level}
            </span>
          </div>

          <p className="mt-2 text-xs leading-5 text-slate-500">
            {item.reason}
          </p>
        </div>
      ))}
    </div>
  


                
              </div>

              <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold">New here?</h2>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  Take a 30-second tour to see how Career Élan helps you build better applications.
                </p>
                <button onClick={() => setShowTour(true)} className="mt-4 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white">
                  Start Tour →
                </button>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
  <div className="flex items-start justify-between gap-3">
    <div>
      <h2 className="text-lg font-bold">
        AI Usage
      </h2>

      <p className="mt-2 text-sm text-gray-500">
        {generatePackageQuota?.enforced
          ? "Lifetime package generation usage."
          : "Monthly package generation usage."}
      </p>
    </div>

    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-xl">
      ⚡
    </div>
  </div>

  <div className="mt-5">
    <div className="flex items-center justify-between text-xs font-bold text-gray-500">
      <span>Packages Generated</span>

      <span
        className={
          aiUsageUsed >= aiUsageLimit
            ? "text-red-600"
            : aiUsagePercent >= 80
              ? "text-amber-600"
              : "text-gray-600"
        }
      >
        {aiUsageUsed} / {aiUsageLimit}
      </span>
    </div>

    <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
      <div
        className={`h-full rounded-full transition-all duration-500 ${
          aiUsageUsed >= aiUsageLimit
            ? "bg-red-500"
            : aiUsagePercent >= 80
              ? "bg-amber-500"
              : "bg-green-500"
        }`}
        style={{
          width: `${aiUsagePercent}%`,
        }}
      />
    </div>

    <div className="mt-3 flex items-center justify-between gap-3">
      <p className="text-xs font-semibold text-gray-400">
        {generatePackageQuota?.enforced
          ? "One-time limit per account"
          : "Resets at the beginning of each month"}
      </p>

      <p className="whitespace-nowrap text-xs font-bold text-gray-500">
        {aiUsageRemaining} remaining
      </p>
    </div>
  </div>

  {aiUsageUsed >= aiUsageLimit && (
    <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
      <p className="text-xs font-bold text-red-600">
        {generatePackageQuota?.enforced
          ? "You have reached your account's package generation limit."
          : "You have reached your monthly package limit."}
      </p>
    </div>
  )}

  <div className="mt-5 flex items-center justify-between gap-3">
    <p className="text-sm font-bold text-gray-600">
      Plan: Free Beta
    </p>

    <button
      type="button"
      className="rounded-xl bg-blue-50 px-4 py-2 text-sm font-bold text-blue-600 transition hover:bg-blue-100"
    >
      ⚡ Upgrade to Pro
    </button>
  </div>
</div>

              <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
  <div className="flex items-start justify-between gap-3">
    <div>
      <h2 className="text-lg font-bold">
        Upcoming Interview
      </h2>

      <p className="mt-1 text-xs text-gray-400">
        Your nearest scheduled interview
      </p>
    </div>

    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-xl">
      🗓️
    </div>
  </div>

  {upcomingInterview ? (
    <>
      <p className="mt-5 text-sm font-bold text-slate-900">
        {upcomingInterview.company}
      </p>

      <p className="mt-1 text-sm text-gray-500">
        {upcomingInterview.jobTitle}
      </p>

      <p className="mt-3 text-sm font-bold text-blue-600">
        {formatInterviewDate(
          upcomingInterview.interviewDate
        )}
      </p>

      <button
        type="button"
        onClick={() =>
          router.push(
            `/job-tracker?application=${encodeURIComponent(
              upcomingInterview.id
            )}`
          )
        }
        className="mt-5 w-full rounded-xl bg-blue-50 px-4 py-3 text-sm font-bold text-blue-600 transition hover:bg-blue-100"
      >
        Prepare Now
      </button>
    </>
  ) : (
    <>
      <div className="mt-5 rounded-xl bg-slate-50 px-4 py-5 text-center">
        <p className="text-2xl">
          📅
        </p>

        <p className="mt-2 text-sm font-bold text-slate-700">
          No upcoming interviews
        </p>

        <p className="mt-1 text-xs leading-5 text-slate-400">
          Add an interview date in Job Tracker and it will appear here.
        </p>
      </div>

      <button
        type="button"
        onClick={() =>
          router.push("/job-tracker")
        }
        className="mt-4 w-full rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm font-bold text-blue-600 transition hover:bg-blue-50"
      >
        Open Job Tracker →
      </button>
    </>
  )}
</div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  
  );
}
