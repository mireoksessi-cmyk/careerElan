"use client";

import { searchJobs } from "@/lib/services/search";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ReactNode,
  useEffect,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import { useLogin } from "@/lib/auth/LoginManager";
import CareerMemoryGuard from "@/components/CareerMemoryGuard";
const FREE_PACKAGE_LIMIT = 10;
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



const defaultCareerFairs = [
  { title: "Toronto Career Fair", date: "Jul 12", location: "Metro Toronto Convention Centre", icon: "🎓", tags: ["General", "Toronto"], match: "", why: ["Open to multiple industries", "Good for entry-level roles"] },
  { title: "Legal Career Expo", date: "Jul 18", location: "North York Civic Centre", icon: "⚖️", tags: ["Legal", "Law Clerk"], match: "", why: ["Useful for legal and office roles", "Good networking opportunity"] },
  { title: "Government Hiring Fair", date: "Aug 2", location: "Mississauga Convention Centre", icon: "🏛️", tags: ["Government", "Public Sector"], match: "", why: ["Public sector opportunities", "Good for administrative roles"] },
];

const personalizedCareerFairs = [
  { title: "Toronto Legal Career Expo", date: "May 22", location: "Metro Toronto Convention Centre", icon: "⚖️", tags: ["Legal", "Law Clerk", "Toronto"], match: "95%", why: ["Matches your target role: Law Clerk", "Legal industry focused", "Location preference: Toronto"] },
  { title: "Administrative & Office Career Fair", date: "Jun 5", location: "Beanfield Centre", icon: "💼", tags: ["Administrative", "Office", "Entry Level"], match: "89%", why: ["Matches your skills and experience", "Entry-level friendly", "Great for career growth"] },
  { title: "Government & Public Sector Expo", date: "Jun 18", location: "Enercare Centre", icon: "🏛️", tags: ["Government", "Public Sector", "Toronto"], match: "85%", why: ["Government roles in high demand", "Stable career opportunities", "Matches your goals"] },
];

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

type InsightItem = {
  name: string;
  level: "Recommended" | "Worth Adding" | "Nice to Have";
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
  refresh,
} = useLogin();
  
  

  const careerMemoryCompleted =
careerMemory?.required_completed ?? false;
  const memoryStrength =
careerMemory?.profile_strength ?? 0;

const [selectedResume, setSelectedResume] = useState("");
const [selectedCoverLetter, setSelectedCoverLetter] = useState("");
const [previewAsset, setPreviewAsset] =
  useState<PreviewAsset>(null);
const [deletingAsset, setDeletingAsset] = useState<
  "resume" | "cover-letter" | null
>(null);
const [
  resettingCareerMemory,
  setResettingCareerMemory,
] = useState(false);
  const [careerFairLocation, setCareerFairLocation] = useState("Toronto, ON");
 const [stats, setStats] = useState<DashboardStats>({
  packages: 0,
  applications: 0,
  interviews: 0,
  packagesThisMonth: 0,
  applicationsThisMonth: 0,
  interviewsThisMonth: 0,
});
  const [careerFairs, setCareerFairs] = useState(defaultCareerFairs);
  const [showTour, setShowTour] = useState(false);
  const [visibleJobs, setVisibleJobs] = useState(6);
  const [recommendedJobs, setRecommendedJobs] =
  useState<JobItem[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
 const [insightItems, setInsightItems] = useState<InsightItem[]>([]);
 const selectedResumeLabel =
  selectedResume === "career_memory"
    ? careerMemory?.resume_name || "Career Memory Resume"
    : resumes.find((resume: any) => resume.id === selectedResume)
        ?.file_name || "Selected Resume";
   const aiUsageUsed = stats.packagesThisMonth;
const aiUsageLimit = 10;

const aiUsagePercent = Math.min(
  100,
  Math.round(
    (aiUsageUsed / aiUsageLimit) * 100
  )
);

const aiUsageRemaining = Math.max(
  0,
  aiUsageLimit - aiUsageUsed
);
  const [showPackageChoice, setShowPackageChoice] = useState(false);
  const router = useRouter();

  

async function saveSelection(
  resumeType: string,
  resumeId: string | null,
  coverLetterId: string | null
) {
  

  if (!user) return;

  await supabase
    .from("career_memory")
    .update({
      selected_resume_type: resumeType,
      selected_resume_id: resumeId,
      selected_cover_letter_id: coverLetterId,
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




  

 


  setCareerFairs(defaultCareerFairs);

  if (
    !cachedJobs ||
    !cachedTime ||
    Date.now() - Number(cachedTime) > 1000 * 60 * 60
  ) {
    console.log("12. setLoadingJobs(true)");
    setLoadingJobs(true);
  }

  console.log("13. FETCH START");

  fetch("/api/recommend-jobs", {
  method: "POST",

  headers: {
    "Content-Type":
      "application/json",
  },

  body: JSON.stringify({
    sourceType:
      selectedPayload.sourceType,

    resumeId:
      selectedPayload.resumeId,

    resumeName:
      selectedPayload.resumeName,

    resumeText:
      selectedPayload.resumeText,

    /*
      선택된 이력서 데이터만 전달
    */
    resumeData:
      selectedPayload.resumeData,
  }),
})

  // ↓↓↓ 여기부터는 네 기존 .then(...) 코드 그대로 ↓↓↓
  
  .then(async (res) => {
    const data = await res.json();

    if (!data.jobs?.length) return;

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

    setRecommendedJobs(realJobs);

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
  setLoadingJobs(false);
});
}




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

  setCareerFairs(
    defaultCareerFairs
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
        status,
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
      현재 구조에서는 applications 행이
      패키지를 생성할 때 만들어지므로 전체 행 수를 사용
    */
    const packageRows = normalizedRows;

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

    console.log(
      "DASHBOARD APPLICATION ROWS =",
      normalizedRows
    );
  }

  loadStats();
}, [loading, user]);
  
  

  function closeTour() {
    localStorage.setItem("careerElanTourSeen", "true");
    setShowTour(false);
  }

  function handleCareerFairSearch() {
    setCareerFairs(careerMemoryCompleted ? personalizedCareerFairs : defaultCareerFairs);
  }
   
function renderPreviewContent() {
  if (!previewAsset) return null;

  /*
    Career Memory에서 직접 작성한 Resume
  */
  if (previewAsset.type === "career-memory-resume") {
    return (
      <div className="mx-auto max-w-[800px] bg-white p-8 text-slate-800">
        <div className="border-b border-slate-300 pb-5">
          <h1 className="text-3xl font-black text-slate-950">
            {careerMemory?.first_name || ""}{" "}
            {careerMemory?.last_name || ""}
          </h1>

          {careerMemory?.headline && (
            <p className="mt-2 font-bold text-blue-600">
              {careerMemory.headline}
            </p>
          )}

          <p className="mt-3 text-sm text-slate-500">
            {[
              careerMemory?.email,
              careerMemory?.phone,
              careerMemory?.location,
              careerMemory?.linkedin,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        {careerMemory?.summary && (
          <PreviewSection title="Professional Summary">
            <p className="whitespace-pre-wrap">
              {careerMemory.summary}
            </p>
          </PreviewSection>
        )}

        {Array.isArray(careerMemory?.experience) &&
          careerMemory.experience.length > 0 && (
            <PreviewSection title="Experience">
              {careerMemory.experience.map(
                (experience: any, index: number) => (
                  <div
                    key={index}
                    className="mb-6"
                  >
                    <div className="flex justify-between gap-4">
                      <p className="font-bold text-slate-950">
                        {experience.jobTitle ||
                          experience.job_title ||
                          experience.role ||
                          ""}
                      </p>

                      <p className="text-sm text-slate-500">
                        {experience.dates || ""}
                      </p>
                    </div>

                    <p className="font-semibold text-slate-600">
                      {experience.company ||
                        experience.organization ||
                        ""}
                    </p>

                    {experience.description && (
                      <p className="mt-2 whitespace-pre-wrap">
                        {experience.description}
                      </p>
                    )}
                  </div>
                )
              )}
            </PreviewSection>
          )}

        {Array.isArray(careerMemory?.education) &&
          careerMemory.education.length > 0 && (
            <PreviewSection title="Education">
              {careerMemory.education.map(
                (education: any, index: number) => (
                  <div
                    key={index}
                    className="mb-5"
                  >
                    <div className="flex justify-between gap-4">
                      <p className="font-bold text-slate-950">
                        {education.program ||
                          education.degree ||
                          ""}
                      </p>

                      <p className="text-sm text-slate-500">
                        {education.dates || ""}
                      </p>
                    </div>

                    <p className="font-semibold text-slate-600">
                      {education.school || ""}
                    </p>

                    {education.coursework && (
                      <p className="mt-2 whitespace-pre-wrap">
                        {education.coursework}
                      </p>
                    )}
                  </div>
                )
              )}
            </PreviewSection>
          )}

        {Array.isArray(careerMemory?.skills) &&
          careerMemory.skills.length > 0 && (
            <PreviewSection title="Skills">
              <div className="flex flex-wrap gap-2">
                {careerMemory.skills.map(
                  (skill: string, index: number) => (
                    <span
                      key={`${skill}-${index}`}
                      className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700"
                    >
                      {skill}
                    </span>
                  )
                )}
              </div>
            </PreviewSection>
          )}

        {Array.isArray(careerMemory?.languages) &&
          careerMemory.languages.length > 0 && (
            <PreviewSection title="Languages">
              {careerMemory.languages.map(
                (language: any, index: number) => (
                  <p key={index}>
                    <span className="font-semibold">
                      {language.language}
                    </span>

                    {language.level ||
                    language.proficiency
                      ? ` — ${
                          language.level ||
                          language.proficiency
                        }`
                      : ""}
                  </p>
                )
              )}
            </PreviewSection>
          )}
      </div>
    );
  }

  /*
    업로드한 Resume
  */
  if (previewAsset.type === "uploaded-resume") {
    const resume = previewAsset.item;
    const parsed = resume.parsed_data || {};

    return (
      <div className="mx-auto max-w-[800px] bg-white p-8 text-slate-800">
        <div className="border-b border-slate-300 pb-5">
          <p className="text-sm font-black uppercase tracking-wide text-blue-600">
            Uploaded Resume
          </p>

          <h1 className="mt-2 text-2xl font-black">
            {resume.file_name ||
              "Uploaded Resume"}
          </h1>
        </div>

        {resume.original_text ? (
          <pre className="mt-6 whitespace-pre-wrap font-sans text-sm leading-7 text-slate-700">
            {resume.original_text}
          </pre>
        ) : (
          <div className="mt-6">
            <h2 className="text-2xl font-black">
              {parsed.firstName || ""}{" "}
              {parsed.lastName || ""}
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              {[
                parsed.email,
                parsed.phone,
                parsed.location,
                parsed.linkedin,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>

            {parsed.summary && (
              <PreviewSection title="Summary">
                <p className="whitespace-pre-wrap">
                  {parsed.summary}
                </p>
              </PreviewSection>
            )}

            {Array.isArray(parsed.workExperience) &&
              parsed.workExperience.length > 0 && (
                <PreviewSection title="Experience">
                  {parsed.workExperience.map(
                    (
                      experience: any,
                      index: number
                    ) => (
                      <div
                        key={index}
                        className="mb-6"
                      >
                        <div className="flex justify-between gap-4">
                          <p className="font-bold text-slate-950">
                            {experience.jobTitle ||
                              experience.title ||
                              ""}
                          </p>

                          <p className="text-sm text-slate-500">
                            {experience.dates || ""}
                          </p>
                        </div>

                        <p className="font-semibold text-slate-600">
                          {experience.company || ""}
                        </p>

                        <p className="mt-2 whitespace-pre-wrap">
                          {experience.description || ""}
                        </p>
                      </div>
                    )
                  )}
                </PreviewSection>
              )}
          </div>
        )}
      </div>
    );
  }

  /*
    업로드한 Cover Letter
  */
  if (previewAsset.type === "cover-letter") {
    const coverLetter = previewAsset.item;
    const parsed = coverLetter.parsed_data || {};

    return (
      <div className="mx-auto max-w-[800px] bg-white p-10 text-slate-800">
        <div className="border-b border-slate-300 pb-5">
          <p className="text-sm font-black uppercase tracking-wide text-blue-600">
            Uploaded Cover Letter
          </p>

          <h1 className="mt-2 text-2xl font-black">
            {coverLetter.file_name ||
              "Uploaded Cover Letter"}
          </h1>
        </div>

        {coverLetter.original_text ? (
          <pre className="mt-8 whitespace-pre-wrap font-sans text-sm leading-8 text-slate-700">
            {coverLetter.original_text}
          </pre>
        ) : (
          <div className="mt-8 text-sm leading-8">
            {parsed.recipient && (
              <p>{parsed.recipient}</p>
            )}

            {parsed.company && (
              <p>{parsed.company}</p>
            )}

            {parsed.jobTitle && (
              <p>{parsed.jobTitle}</p>
            )}

            {parsed.greeting && (
              <p className="mt-8">
                {parsed.greeting}
              </p>
            )}

            {parsed.body && (
              <p className="mt-6 whitespace-pre-wrap">
                {parsed.body}
              </p>
            )}

            {parsed.closing && (
              <p className="mt-8">
                {parsed.closing}
              </p>
            )}

            {parsed.signature && (
              <p className="mt-4 font-bold">
                {parsed.signature}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}
  
  return (
  <CareerMemoryGuard>
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

      <div className="flex min-h-screen">
        <aside className="w-60 border-r border-blue-100 bg-white px-5 py-6">
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

        <section className="flex-1">
          <header className="flex items-center justify-between px-8 py-6">
            <div>
             <h1 className="text-2xl font-extrabold">
  Good morning, {profile?.full_name || "Guest"}! 👋
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
  {(profile?.full_name || "Guest").charAt(0).toUpperCase()}
</div>
                <div>
                  <p className="text-sm font-bold">{profile?.full_name || "Guest"}</p>
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
          Career Memory
        </p>

        <h3 className="mt-3 text-3xl font-extrabold">
          {memoryStrength}%
        </h3>
      </div>

      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-xl">
        🧠
      </div>
    </div>

    <p className="mt-3 text-xs text-gray-500">
      {careerMemoryCompleted
        ? "Profile ready for personalized applications"
        : "Complete your profile to improve results"}
    </p>

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

  {careerMemory?.required_completed && (
    <div
      className={`mb-3 flex items-center gap-3 rounded-xl border p-3 transition ${
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
            Career Memory Resume
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
      className={`mb-3 flex items-center gap-3 rounded-xl border p-3 transition ${
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
              "upload",
              resume.id,
              selectedCoverLetter || null
            );
          }}
        />

        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            Uploaded Resume
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
    </div>
  ))}
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
: "upload",

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
    className={`mb-3 flex items-center gap-3 rounded-xl border p-3 transition ${
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
              : "upload",

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
                      {careerMemoryCompleted
                        ? "Based on your Career Memory and profile."
                        : "General recommendations. Upload your resume to unlock personalized matches."}
                    </p>
                  </div>
                  <a href="/find-jobs" className="text-sm font-bold text-blue-600">View All Jobs</a>
                </div>

                <div className="grid gap-5 md:grid-cols-3">
                  {loadingJobs ? (

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
                  <button onClick={handleCareerFairSearch} className="rounded-xl bg-blue-600 px-8 py-2 font-semibold text-white hover:bg-blue-700">
                    Search
                  </button>
                </div>

                <div className="space-y-4">
                  {careerFairs.map((fair) => (
                    <div key={fair.title} className="grid gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm md:grid-cols-12">
                      <div className="col-span-12 flex items-center gap-4 md:col-span-7">
                        <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-blue-50 text-4xl">{fair.icon}</div>
                        <div>
                          <div className="flex items-center gap-2">
                            {fair.match && <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-700">{fair.match} Match</span>}
                            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">{fair.date}</span>
                          </div>
                          <h3 className="mt-2 text-lg font-extrabold">{fair.title}</h3>
                          <p className="mt-1 text-sm text-gray-500">{fair.location}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {fair.tags.map((tag) => (
                              <span key={tag} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">{tag}</span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="col-span-12 rounded-xl bg-green-50 p-4 md:col-span-5">
                        <h4 className="font-bold text-green-700">{careerMemoryCompleted ? "Why this match?" : "Why this event?"}</h4>
                        <div className="mt-2 space-y-1">
                          {fair.why.map((reason) => (
                            <p key={reason} className="text-sm text-green-700">✓ {reason}</p>
                          ))}
                        </div>
                        <button className="mt-3 rounded-lg bg-white px-4 py-2 text-sm font-bold text-blue-600">View Details</button>
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
                  <div className="flex h-28 w-28 items-center justify-center rounded-full border-8 border-blue-200 bg-blue-50 text-4xl">🧠</div>
                </div>

                <div className="mt-6 space-y-4">
                  <div>
                    <div className="flex justify-between text-xs font-bold text-gray-500">
                      <span>Memory Completed</span>
                      <span>{memoryStrength}%</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-gray-100">
                      <div className="h-2 rounded-full bg-blue-600" style={{ width: `${memoryStrength}%`}} />
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

                <a href="/career-memory" className="mt-5 block rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-bold text-white">
                  {careerMemoryCompleted ? "Improve My Profile →" : "Complete Career Memory →"}
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
        Monthly package generation usage.
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
        Resets at the beginning of each month
      </p>

      <p className="whitespace-nowrap text-xs font-bold text-gray-500">
        {aiUsageRemaining} remaining
      </p>
    </div>
  </div>

  {aiUsageUsed >= aiUsageLimit && (
    <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
      <p className="text-xs font-bold text-red-600">
        You have reached your monthly package limit.
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
  </CareerMemoryGuard>
  );
}
function PreviewSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-7 text-sm leading-7 text-slate-700">
      <h2 className="mb-4 border-b border-slate-200 pb-2 text-sm font-black uppercase tracking-[0.14em] text-slate-950">
        {title}
      </h2>

      {children}
    </section>
  );
}