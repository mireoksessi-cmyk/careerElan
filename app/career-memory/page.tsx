"use client";

import Image from "next/image";
import { ChangeEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLogin } from "@/lib/auth/LoginManager";
const DRAFT_KEY = "career-memory-draft";
const steps = [
  {
    title: "Personal Information",
    description:
      "Required. Your contact information and professional summary used across every application.",
    required: true,
  },
  {
    title: "Skills",
    description:
      "Required. Technical skills, software, legal knowledge, customer service, and other professional abilities.",
    required: true,
  },
  {
    title: "Experience",
    description:
      "Required. Add work, volunteer, internship, co-op, or other relevant experience. Career Élan uses this to build stronger resume bullets.",
    required: true,
  },
  {
    title: "Projects",
    description:
      "Optional. School, personal, volunteer, or professional projects that showcase your experience.",
    required: false,
  },
  {
    title: "Education",
    description:
      "Optional. Schools, degrees, GPA, coursework, and academic achievements that strengthen your profile.",
    required: false,
  },
  {
    title: "Languages",
    description:
      "Optional. Languages you speak and your proficiency level, such as English, French, or Korean.",
    required: false,
  },
  {
    title: "Certifications",
    description:
      "Optional. Professional certifications, licenses, awards, and completed training.",
    required: false,
  },
  {
    title: "Career Goals",
    description:
      "Optional. Tell AI your target industry, preferred roles, locations, salary expectations, and long-term goals.",
    required: false,
  },
  {
    title: "Review & Templates",
    description:
      "Review your Career Memory and choose resume and cover letter styles.",
    required: false,
  },
];

const resumeTemplates = ["Classic",  "Professional",  "Creative"];
const coverLetterTemplates = ["Classic Letter", "Modern Letter", "Executive", "Government Style", "Minimal Letter"];
const themeColors = ["Blue", "Green", "Navy", "Black", "Gray"];
const fonts = ["Arial", "Calibri", "Helvetica", "Times New Roman", "Georgia"];
const textSizes = ["Small", "Standard", "Large"];
const tones = ["Formal", "Warm", "Confident", "Government", "Concise"];

type EducationItem = {
  school: string;
  program: string;
  startDate: string;
  endDate: string;
  gpa: string;
  coursework: string;
};

type WorkItem = {
  company: string;
  jobTitle: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  description: string;
};

type VolunteerItem = {
  organization: string;
  role: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  description: string;
};

type LanguageItem = {
  language: string;
  level: string;
};
type CertificationItem = { name: string; issuer: string; date: string; description: string };
type ProjectItem = { name: string; role: string; dates: string; description: string };

type CareerMemoryData = {
  firstName: string; lastName: string; email: string; phone: string; location: string; linkedin: string; headline: string; summary: string;
  education: EducationItem[]; workExperience: WorkItem[]; volunteerExperience: VolunteerItem[]; skills: string; languages: LanguageItem[]; certifications: CertificationItem[]; projects: ProjectItem[];
  targetRoles: string; targetIndustry: string; targetLocation: string; salaryExpectation: string; careerGoalSummary: string;
  uploadedResumeName: string; uploadedResumeText: string; resumeSource: "uploaded" | "built";
  resumeTemplate: string; coverLetterTemplate: string; themeColor: string; font: string; textSize: string; coverLetterTone: string; applySameStyleToCoverLetter: boolean;
  uploadedCoverLetterName: string;
 uploadedCoverLetterText: string;
 coverLetterSource: "uploaded" | "generated";
 recipient: string;
company: string;
jobTitle: string;
greeting: string;
body: string;
closing: string;
signature: string;
};

const emptyEducation: EducationItem = {
  school: "",
  program: "",
  startDate: "",
  endDate: "",
  gpa: "",
  coursework: "",
};
const languageLevels = [
  "Beginner",
  "Intermediate",
  "Advanced",
  "Fluent",
  "Native",
] as const;

function formatMonth(value?: string) {
  if (!value) return "";

  const [year, month] = value.split("-");

  if (!year || !month) {
    return value;
  }

  return new Date(
    Number(year),
    Number(month) - 1,
    1
  ).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
  });
}

function formatExperienceDates(item: {
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
}) {
  const start = formatMonth(item.startDate);

  const end = item.isCurrent
    ? "Present"
    : formatMonth(item.endDate);

  return [start, end]
    .filter(Boolean)
    .join(" – ");
}

function formatEducationDates(item: {
  startDate?: string;
  endDate?: string;
}) {
  return [
    formatMonth(item.startDate),
    formatMonth(item.endDate),
  ]
    .filter(Boolean)
    .join(" – ");
}
const emptyWork: WorkItem = {
  company: "",
  jobTitle: "",
  location: "",
  startDate: "",
  endDate: "",
  isCurrent: false,
  description: "",
};

const emptyVolunteer: VolunteerItem = {
  organization: "",
  role: "",
  location: "",
  startDate: "",
  endDate: "",
  isCurrent: false,
  description: "",
};

const emptyLanguage: LanguageItem = {
  language: "",
  level: "",
};
const emptyCertification = { name: "", issuer: "", date: "", description: "" };
const emptyProject = { name: "", role: "", dates: "", description: "" };

const defaultMemoryData: CareerMemoryData = {
  firstName: "", lastName: "", email: "", phone: "", location: "", linkedin: "", headline: "", summary: "",
  education: [emptyEducation], workExperience: [emptyWork], volunteerExperience: [emptyVolunteer], skills: "", languages: [emptyLanguage], certifications: [emptyCertification], projects: [emptyProject],
  targetRoles: "", targetIndustry: "", targetLocation: "", salaryExpectation: "", careerGoalSummary: "",
  uploadedResumeName: "", uploadedResumeText: "", resumeSource: "built",
  resumeTemplate: "Professional", coverLetterTemplate: "Classic Letter", themeColor: "Navy", font: "Calibri", textSize: "Standard", coverLetterTone: "Formal", applySameStyleToCoverLetter: true,
  uploadedCoverLetterName: "",
  uploadedCoverLetterText: "",
  coverLetterSource: "generated",
  recipient: "",
company: "",
jobTitle: "",
greeting: "",
body: "",
closing: "",
signature: "",
};

type ImportStage = "idle" | "uploaded" | "parsing" | "parsed" | "preview";
type UploadedResumeKind = "none" | "pdf" | "txt" | "docx" | "other";

export default function CareerMemoryPage() {
  const { user, loading } = useLogin();
  const router = useRouter();
  const [mode, setMode] = useState<"start" | "import" | "build">("start");
  const [currentStep, setCurrentStep] = useState(0);
  const [memoryData, setMemoryData] = useState<CareerMemoryData>(defaultMemoryData);
  const [coverLetterUploadProgress, setCoverLetterUploadProgress] =
  useState(0);
 const [resumeUploadError, setResumeUploadError] = useState("");
 const [coverLetterUploadError, setCoverLetterUploadError] =
  useState("");
const [isResumeDragging, setIsResumeDragging] = useState(false);
  const [coverLetterImportStage, setCoverLetterImportStage] =
  useState<
    "idle" | "uploaded" | "parsing" | "parsed"
  >("idle");
  const [coverLetterPreview, setCoverLetterPreview] =
  useState(false);
  const [coverLetterImportMessage, setCoverLetterImportMessage] =
  useState("");
  const [importMessage, setImportMessage] = useState("");
  const [lockedMessage, setLockedMessage] = useState("");
  const [importStage, setImportStage] = useState<ImportStage>("idle");
  const [uploadedResumeUrl, setUploadedResumeUrl] = useState("");
  const [uploadedResumeKind, setUploadedResumeKind] = useState<UploadedResumeKind>("none");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const coverLetterInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadedCoverLetterUrl, setUploadedCoverLetterUrl] = useState("");
  const [coverLetterFile, setCoverLetterFile] = useState<File | null>(null);
  const [coverLetterSaved, setCoverLetterSaved] = useState(false);
  const [uploadedCoverLetterKind, setUploadedCoverLetterKind] =
  useState<UploadedResumeKind>("none");
  
  
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUnlocked, setIsUnlocked] = useState(false);
 const [profileStrength, setProfileStrength] = useState(0);
  const progress = Math.round(((currentStep + 1) / steps.length) * 100);
  const isReviewStep = mode === "build" && currentStep === steps.length - 1;
async function loadCareerMemory() {
  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("career_memory")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error || !data) {
  return null;
}
   
setProfileStrength(data.profile_strength ?? 0);
  setMemoryData((prev) => ({
  ...prev,

  firstName: data.first_name ?? "",
  lastName: data.last_name ?? "",
  email: data.email ?? "",
  phone: data.phone ?? "",
  location: data.location ?? "",

  linkedin: data.linkedin ?? "",
  headline: data.headline ?? "",
  summary: data.summary ?? "",

  targetRoles: (data.target_roles || []).join(", "),
  targetIndustry: data.target_industry ?? "",
  targetLocation: data.target_location ?? "",
  salaryExpectation: data.salary_expectation ?? "",
  careerGoalSummary: data.career_goal_summary ?? "",

  skills: (data.skills || []).join(", "),

  education:
  data.education?.length
    ? data.education.map((item: any) => ({
        ...emptyEducation,
        ...item,
        startDate:
          item.startDate ??
          item.start_date ??
          "",
        endDate:
          item.endDate ??
          item.end_date ??
          "",
      }))
    : [{ ...emptyEducation }],

workExperience:
  data.experience?.length
    ? data.experience.map((item: any) => ({
        ...emptyWork,
        ...item,
        startDate:
          item.startDate ??
          item.start_date ??
          "",
        endDate:
          item.endDate ??
          item.end_date ??
          "",
        isCurrent:
          item.isCurrent ??
          item.is_current ??
          false,
      }))
    : [{ ...emptyWork }],

volunteerExperience:
  data.volunteer_experience?.length
    ? data.volunteer_experience.map(
        (item: any) => ({
          ...emptyVolunteer,
          ...item,
          startDate:
            item.startDate ??
            item.start_date ??
            "",
          endDate:
            item.endDate ??
            item.end_date ??
            "",
          isCurrent:
            item.isCurrent ??
            item.is_current ??
            false,
        })
      )
    : [{ ...emptyVolunteer }],

languages:
  data.languages?.length
    ? data.languages.map((item: any) => ({
        ...emptyLanguage,
        ...item,
      }))
    : [{ ...emptyLanguage }],

  certifications:
    data.certifications?.length
      ? data.certifications
      : [emptyCertification],

  projects:
    data.projects?.length
      ? data.projects
      : [emptyProject],

  resumeTemplate:
    data.resume_template ?? "Professional",

  coverLetterTemplate:
    data.cover_template ?? "Classic Letter",

  themeColor:
    data.theme ?? "Navy",

  font:
    data.font ?? "Calibri",

  textSize:
  data.text_size ?? "Standard",

  coverLetterTone:
    data.tone ?? "Formal",
}));

setIsUnlocked(
  data.required_completed ?? false
);

return data;
}

  useEffect(() => {
    return () => {
      if (uploadedResumeUrl) URL.revokeObjectURL(uploadedResumeUrl);
    };
  }, [uploadedResumeUrl]);
  useEffect(() => {
  if (!user) {
    return;
  }

  async function initializeCareerMemory() {
    /*
      1. 먼저 Supabase의 공식 저장 데이터를 불러온다.
    */
    await loadCareerMemory();

    /*
      2. 그다음 브라우저 draft가 있으면
         작성 중이던 값을 복원한다.
    */
    const draft =
      localStorage.getItem(
        DRAFT_KEY
      );

    if (!draft) {
      return;
    }

    try {
      const parsedDraft =
        JSON.parse(
          draft
        ) as Partial<CareerMemoryData>;

      setMemoryData(
        (prev) => ({
          ...prev,
          ...parsedDraft,
        })
      );
    } catch (error) {
      console.error(
        "CAREER MEMORY DRAFT PARSE ERROR =",
        error
      );

      /*
        깨진 draft가 계속 문제를 일으키지 않도록 삭제한다.
      */
      localStorage.removeItem(
        DRAFT_KEY
      );
    }
  }

  initializeCareerMemory();
}, [user]);

  function updateMemory(
  field: keyof CareerMemoryData,
  value: string | boolean
) {
  setMemoryData(prev => {
    const updated = {
      ...prev,
      [field]: value,
    };

    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify(updated)
    );

    return updated;
  });
}

 function updateArrayItem<T extends object>(
  section: keyof CareerMemoryData,
  index: number,
  field: keyof T,
  value: string | boolean
) {
  setMemoryData((prev) => {
    const items = [
      ...(prev[section] as T[]),
    ];

    items[index] = {
      ...items[index],
      [field]: value,
    };

    const updated = {
      ...prev,
      [section]: items,
    };

    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify(updated)
    );

    return updated;
  });
}

  function addItem(
  section: keyof CareerMemoryData,
  emptyItem: object
) {
  setMemoryData((prev) => {
    const updated = {
      ...prev,

      [section]: [
        ...(prev[section] as object[]),
        { ...emptyItem },
      ],
    };

    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify(updated)
    );

    return updated;
  });
}

 function removeItem(
  section: keyof CareerMemoryData,
  index: number
) {
  setMemoryData((prev) => {
    const items = [
      ...(prev[section] as object[]),
    ];

    /*
      최소 1개 입력 칸은 유지한다.
    */
    if (items.length === 1) {
      return prev;
    }

    items.splice(
      index,
      1
    );

    const updated = {
      ...prev,
      [section]: items,
    };

    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify(updated)
    );

    return updated;
  });
}

  function hasPersonalInfo() {
    return Boolean((memoryData.firstName.trim() || memoryData.lastName.trim()) && memoryData.email.trim());
  }

  function hasWorkExperience() {
    return memoryData.workExperience.some((x) => x.company?.trim() || x.jobTitle?.trim() || x.description?.trim());
  }

  function hasVolunteerExperience() {
    return memoryData.volunteerExperience.some((x) => x.organization?.trim() || x.role?.trim() || x.description?.trim());
  }

  function hasExperience() {
    return hasWorkExperience() || hasVolunteerExperience();
  }

  function hasSkills() {
  if (Array.isArray(memoryData.skills)) {
    return memoryData.skills.length > 0;
  }

  return Boolean(memoryData.skills?.trim());
  }

  function requiredCompletedCount() {
    return [hasPersonalInfo(), hasExperience(), hasSkills()].filter(Boolean).length;
  }

  function canUseService() {
    return requiredCompletedCount() === 3;
  }

  function memoryStrength() {
  let score = 0;

  // 1. Personal Information: 15%
  if (hasPersonalInfo()) {
    score += 15;
  }

  // 2. Education: 10%
 if (
  memoryData.education.some(
    (item) =>
      item.school?.trim() ||
      item.program?.trim() ||
      item.startDate?.trim() ||
      item.endDate?.trim() ||
      item.gpa?.trim() ||
      item.coursework?.trim()
  )
) {
  score += 10;
}

  // 3. Experience: 20%
  if (hasExperience()) {
    score += 20;
  }

  // 4. Skills: 15%
  if (hasSkills()) {
    score += 15;
  }

  // 5. Languages: 10%
  if (
    memoryData.languages.some(
      (item) =>
        item.language?.trim() ||
        item.level?.trim()
    )
  ) {
    score += 10;
  }

  // 6. Certifications: 10%
  if (
    memoryData.certifications.some(
      (item) =>
        item.name?.trim() ||
        item.issuer?.trim() ||
        item.date?.trim() ||
        item.description?.trim()
    )
  ) {
    score += 10;
  }

  // 7. Projects: 10%
  if (
    memoryData.projects.some(
      (item) =>
        item.name?.trim() ||
        item.role?.trim() ||
        item.dates?.trim() ||
        item.description?.trim()
    )
  ) {
    score += 10;
  }

  // 8. Career Goals: 10%
  if (
    memoryData.targetRoles?.trim() ||
    memoryData.targetIndustry?.trim() ||
    memoryData.targetLocation?.trim() ||
    memoryData.salaryExpectation?.trim() ||
    memoryData.careerGoalSummary?.trim()
  ) {
    score += 10;
  }

  return Math.min(score, 100);
}

  const strength = profileStrength;
  const requiredCount = requiredCompletedCount();
  
  async function persistMemory() {
  console.log("========== persistMemory START ==========");

  

  console.log("USER =", user);

  if (!user) {
    alert("User is null");
    return;
  }

  console.log("MEMORY DATA =", memoryData);
   console.log("========== Loading Career Memory ==========");
  const { data, error } = await supabase
  .from("career_memory")
  .upsert(
    {
      user_id: user.id,

      first_name: memoryData.firstName,
      last_name: memoryData.lastName,
      email: memoryData.email,
      phone: memoryData.phone,
      location: memoryData.location,

      linkedin: memoryData.linkedin,
      headline: memoryData.headline,
      summary: memoryData.summary,

      target_roles: memoryData.targetRoles
        ? memoryData.targetRoles.split(",").map((x) => x.trim())
        : [],

      target_industry: memoryData.targetIndustry,
      target_location: memoryData.targetLocation,
      salary_expectation: memoryData.salaryExpectation,
      career_goal_summary: memoryData.careerGoalSummary,

      skills: Array.isArray(memoryData.skills)
        ? memoryData.skills
        : (memoryData.skills || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),

      education: memoryData.education,

    experience: memoryData.workExperience,

volunteer_experience:
  memoryData.volunteerExperience,

      languages: memoryData.languages,
      certifications: memoryData.certifications,
      projects: memoryData.projects,

      resume_template: memoryData.resumeTemplate,
      cover_template: memoryData.coverLetterTemplate,
      theme: memoryData.themeColor,
      font: memoryData.font,
      text_size: memoryData.textSize,
      tone: memoryData.coverLetterTone,
      resume_name: "Career Memory Resume",
      profile_strength: memoryStrength(),
      required_completed:
  hasPersonalInfo() &&
  hasExperience() &&
  hasSkills(),
    },
    {
      onConflict: "user_id",
    }
  )
  .select();

console.log("CAREER MEMORY DATA =", data);
console.log("CAREER MEMORY ERROR =", error);

if (error) {
  alert(error.message);
  return false;
}

/*
  공식 저장에 성공했으므로
  브라우저 임시 draft를 삭제한다.
*/
localStorage.removeItem(
  DRAFT_KEY
);

const newStrength =
  memoryStrength();

setProfileStrength(
  newStrength
);

setIsUnlocked(
  hasPersonalInfo() &&
  hasExperience() &&
  hasSkills()
);

return true;
  }
  async function saveMemory() {
  console.log("SAVE CLICKED");

  await persistMemory();

  alert("Career Memory saved.");
}

  async function continueToDashboard() {
  

  await persistMemory();
  router.replace("/dashboard");
}
function continueUploadedDashboard() {
  router.replace("/dashboard");
}
 function handleProtectedNav(item: string) {
  const allowedBeforeUnlock = [
    "Career Memory",
    "Find Jobs",
    "Settings",
  ];

  const pathMap: Record<string, string> = {
    Dashboard: "/dashboard",
    "Career Memory": "/career-memory",
    "Find Jobs": "/find-jobs",
    "Create Package": "/create-package",
    "Job Tracker": "/job-tracker",
    Analytics: "/analytics",
    Settings: "/settings",
  };

  const path = pathMap[item];

  if (!path) {
    return;
  }

  // Career Memory는 현재 페이지라 이동 안 함
  if (item === "Career Memory") {
    return;
  }




  router.push(path);
}

  async function handleSaveAndContinue() {
  const saved = await persistMemory();

  if (!saved) {
    return;
  }

  if (currentStep < steps.length - 1) {
    setCurrentStep((prev) => prev + 1);
    return;
  }

  router.replace("/dashboard");
}

  function guessFileKind(file: File): UploadedResumeKind {
    const lowerName = file.name.toLowerCase();
    if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) return "pdf";
    if (file.type === "text/plain" || lowerName.endsWith(".txt")) return "txt";
    if (lowerName.endsWith(".docx")) return "docx";
    return "other";
  }

  function parseTxtResume(text: string, fileName: string) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
    const phone = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0] || "";
    const firstLine = lines[0] || fileName.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ");
    const nameParts = firstLine.split(/\s+/).filter(Boolean);
    const skillsLine = lines.find((line) => /skills?/i.test(line)) || "";
    const experienceLine = lines.find((line) => /experience|employment|work/i.test(line)) || "";
    const educationLine = lines.find((line) => /education|college|university|school|seneca/i.test(line)) || "";

    setMemoryData((prev) => ({
  ...prev,

  firstName:
    prev.firstName || nameParts[0] || "",

  lastName:
    prev.lastName ||
    nameParts.slice(1).join(" ") ||
    "",

  email:
    prev.email || email,

  phone:
    prev.phone || phone,

  headline:
    prev.headline ||
    lines.find(
      (line) =>
        !line.includes("@") &&
        line.length < 60 &&
        line !== firstLine
    ) ||
    "",

  summary:
    prev.summary ||
    lines
      .slice(1, 5)
      .join(" ")
      .slice(0, 700),

  workExperience:
    prev.workExperience.some(
      (x) =>
        x.company ||
        x.jobTitle ||
        x.description
    )
      ? prev.workExperience
      : [
          {
            company: "",
            jobTitle:
              experienceLine ||
              "Experience from uploaded resume",
            location: "",
            startDate: "",
            endDate: "",
            isCurrent: false,
            description: text.slice(0, 900),
          },
        ],

  education:
    prev.education.some(
      (x) =>
        x.school ||
        x.program
    )
      ? prev.education
      : [
          {
            school: educationLine,
            program: "",
            startDate: "",
            endDate: "",
            gpa: "",
            coursework: "",
          },
        ],

  skills:
    prev.skills ||
    skillsLine
      .replace(/skills?:?/i, "")
      .trim() ||
    "Extracted from uploaded resume. Review and edit your skills before continuing.",

  uploadedResumeText: text,
}));
  }

  async function processResumeFile(file: File) {
  setResumeUploadError("");

  const allowedExtensions = ["pdf", "docx"];
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (!extension || !allowedExtensions.includes(extension)) {
    setResumeUploadError(
      "Unsupported file type. Please upload a PDF or DOCX resume."
    );
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    setResumeUploadError(
      "This file is larger than 10MB. Please upload a smaller resume."
    );
    return;
  }

  function resetResumeImport() {
    setImportStage("idle");
    setImportMessage("");
    setUploadProgress(0);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }
if (!user) {
  resetResumeImport();
  setResumeUploadError(
    "Please sign in before uploading your resume."
  );
  return;
}

  let storagePath = "";

  try {
    /*
      1. 업로드 이력서 개수 확인
    */
    const { count, error: countError } =
      await supabase
        .from("resumes")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("user_id", user.id)
        .eq("source_type", "uploaded");

    if (countError) {
      console.error(
        "RESUME COUNT ERROR =",
        countError
      );

      resetResumeImport();
setResumeUploadError(
  `We could not check your existing resumes: ${countError.message}`
);
return;
    }

    if ((count ?? 0) >= 3) {
      resetResumeImport();

      setResumeUploadError(
  "You can upload up to 3 resumes. Delete an existing resume before uploading another one."
);

      return;
    }

    /*
      2. 분석 화면 시작
    */
    setImportStage("parsing");
    setImportMessage(
      "Career Élan is analyzing your resume"
    );
    setUploadProgress(12);

    const formData = new FormData();
    formData.append("file", file);

    storagePath =
      `${user.id}/${Date.now()}-${file.name}`;

    /*
      3. Supabase Storage 업로드
    */
    const { error: uploadError } =
      await supabase.storage
        .from("resumes")
        .upload(storagePath, file, {
          upsert: false,
        });

    if (uploadError) {
      console.error(
        "RESUME STORAGE ERROR =",
        uploadError
      );

      resetResumeImport();
      setResumeUploadError(uploadError.message);
      return;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 250)
    );

    setUploadProgress(28);

    /*
      4. AI 분석 API 호출
    */
    const response = await fetch(
      "/api/analyze-resume",
      {
        method: "POST",
        body: formData,
      }
    );

    let result: any;

    try {
      result = await response.json();
    } catch (jsonError) {
      console.error(
        "RESUME JSON ERROR =",
        jsonError
      );

      await supabase.storage
        .from("resumes")
        .remove([storagePath]);

      resetResumeImport();

      setResumeUploadError(
  "The resume analysis server returned an invalid response. Please try again."
);

      return;
    }

    console.log("RESULT =", result);
    console.log(
      "ORIGINAL =",
      result.data?.originalText
    );
    console.log(
      "TYPE =",
      typeof result.data?.originalText
    );

    setUploadProgress(47);

    await new Promise((resolve) =>
      setTimeout(resolve, 250)
    );

    /*
      5. 분석 실패 처리
      여기서 회전 화면이 사라짐
    */
    if (!response.ok || !result.success) {
      console.error(
        "RESUME ANALYSIS FAILED =",
        result
      );

      const { error: cleanupError } =
        await supabase.storage
          .from("resumes")
          .remove([storagePath]);

      if (cleanupError) {
        console.error(
          "RESUME STORAGE CLEANUP ERROR =",
          cleanupError
        );
      }

      resetResumeImport();

      setResumeUploadError(
  result.message ||
  result.error ||
  "Failed to analyze resume."
);

      return;
    }

    if (!result.data) {
      await supabase.storage
        .from("resumes")
        .remove([storagePath]);

      resetResumeImport();

      setResumeUploadError(
"The resume was analyzed, but no usable data was returned."
);

      return;
    }

    /*
      6. 분석 성공 데이터 화면에 반영
    */
    setUploadProgress(72);

    await new Promise((resolve) =>
      setTimeout(resolve, 250)
    );

    setMemoryData((prev) => ({
  ...prev,

  uploadedResumeName: file.name,
  uploadedResumeText:
    result.data.originalText || "",
  resumeSource: "uploaded",
}));

    /*
      7. resumes 테이블에 새 이력서 추가
    */
    const {
      data: resumeData,
      error: saveError,
    } = await supabase
      .from("resumes")
      .insert({
        user_id: user.id,
        source_type: "uploaded",
        file_name: file.name,
        storage_path: storagePath,
        original_text:
          result.data.originalText || "",
        parsed_data: result.data,
        is_default: count === 0,
        conversion_status: "pending",
      })
      .select();

    console.log(
      "RESUME DATA =",
      resumeData
    );
    console.log(
      "RESUME ERROR =",
      saveError
    );

    if (saveError) {
      console.error(
        "RESUME DATABASE SAVE ERROR =",
        saveError
      );

      await supabase.storage
        .from("resumes")
        .remove([storagePath]);

      resetResumeImport();

      setResumeUploadError(
  `Your resume was analyzed, but could not be saved: ${saveError.message}`
);
      return;
    }

    /*
      7.5. 원본 디자인 보존 프리뷰 처리 (best-effort, 업로드 완료를 막지 않음)
    */
    const newResumeId = resumeData?.[0]?.id;

    if (newResumeId) {
      fetch("/api/process-resume-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId: newResumeId }),
      }).catch((designError) => {
        console.error(
          "PROCESS RESUME DESIGN REQUEST ERROR =",
          designError
        );
      });
    }

    /*
      8. 완료 표시
    */
    setUploadProgress(91);

    await new Promise((resolve) =>
      setTimeout(resolve, 250)
    );

    setUploadProgress(100);
    setImportStage("parsed");
    setImportMessage(
      "Resume analyzed successfully."
    );
  } catch (error) {
    console.error(
      "RESUME UPLOAD ERROR =",
      error
    );

    if (storagePath) {
      const { error: cleanupError } =
        await supabase.storage
          .from("resumes")
          .remove([storagePath]);

      if (cleanupError) {
        console.error(
          "RESUME CLEANUP ERROR =",
          cleanupError
        );
      }
    }

    resetResumeImport();

    setResumeUploadError(
  error instanceof Error
    ? error.message
    : "Failed to analyze resume. Please try again."
);
  }
}
async function handleResumeUpload(
  event: ChangeEvent<HTMLInputElement>
) {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  await processResumeFile(file);
}

function handleResumeDragOver(
  event: React.DragEvent<HTMLDivElement>
) {
  event.preventDefault();
  event.stopPropagation();

  setIsResumeDragging(true);
}

function handleResumeDragLeave(
  event: React.DragEvent<HTMLDivElement>
) {
  event.preventDefault();
  event.stopPropagation();

  setIsResumeDragging(false);
}

async function handleResumeDrop(
  event: React.DragEvent<HTMLDivElement>
) {
  event.preventDefault();
  event.stopPropagation();

  setIsResumeDragging(false);

  const file = event.dataTransfer.files?.[0];

  if (!file) {
    setResumeUploadError(
      "No file was detected. Please try dropping your resume again."
    );
    return;
  }

  await processResumeFile(file);
}
  async function handleCoverLetterUpload(
  event: ChangeEvent<HTMLInputElement>
) {
  const file = event.target.files?.[0];

if (!file) return;

setCoverLetterUploadError("");

  function resetCoverLetterImport() {
    setCoverLetterImportStage("idle");
    setCoverLetterImportMessage("");
    setCoverLetterUploadProgress(0);

    if (coverLetterInputRef.current) {
      coverLetterInputRef.current.value = "";
    }
  }

  if (!user) {
  resetCoverLetterImport();
  setCoverLetterUploadError(
    "Please sign in before uploading a cover letter."
  );
  return;
}

  let storagePath = "";

  try {
    const { count, error: countError } =
      await supabase
        .from("cover_letters")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("user_id", user.id);

    if (countError) {
      console.error(
        "COVER LETTER COUNT ERROR =",
        countError
      );

      resetCoverLetterImport();
setCoverLetterUploadError(
  `We could not check your existing cover letters: ${countError.message}`
);
return;
    }

    if ((count ?? 0) >= 3) {
      resetCoverLetterImport();

      setCoverLetterUploadError(
  "You can upload up to 3 cover letters. Delete an existing cover letter before uploading another one."
);

      return;
    }

    storagePath =
      `${user.id}/${Date.now()}-${file.name}`;

    const { error: uploadError } =
      await supabase.storage
        .from("cover-letters")
        .upload(storagePath, file, {
          upsert: false,
        });

    if (uploadError) {
      console.error(
        "COVER LETTER STORAGE ERROR =",
        uploadError
      );

      resetCoverLetterImport();
      setCoverLetterUploadError(uploadError.message);
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setCoverLetterImportStage("parsing");
    setCoverLetterImportMessage(
      "Career Élan is analyzing your cover letter..."
    );
    setCoverLetterUploadProgress(15);

    const response = await fetch(
      "/api/analyze-cover-letter",
      {
        method: "POST",
        body: formData,
      }
    );

    setCoverLetterUploadProgress(60);

    let result: any;

    try {
      result = await response.json();
    } catch (jsonError) {
      console.error(
        "COVER LETTER JSON ERROR =",
        jsonError
      );

      await supabase.storage
        .from("cover-letters")
        .remove([storagePath]);

      resetCoverLetterImport();

      setCoverLetterUploadError(
  "The cover letter analysis server returned an invalid response. Please try again."
);

      return;
    }

    if (!response.ok || !result.success) {
      console.error(
        "COVER LETTER ANALYSIS FAILED =",
        result
      );

      const { error: cleanupError } =
        await supabase.storage
          .from("cover-letters")
          .remove([storagePath]);

      if (cleanupError) {
        console.error(
          "COVER LETTER CLEANUP ERROR =",
          cleanupError
        );
      }

      resetCoverLetterImport();

      setCoverLetterUploadError(
  result.message ||
    result.error ||
    "Failed to analyze cover letter. Please try again."
);

      return;
    }

    if (!result.data) {
      await supabase.storage
        .from("cover-letters")
        .remove([storagePath]);

      resetCoverLetterImport();

      setCoverLetterUploadError(
  "The cover letter was analyzed, but no usable data was returned."
);

      return;
    }

    const { error: saveError } =
      await supabase
        .from("cover_letters")
        .insert({
          user_id: user.id,
          file_name: file.name,
          storage_path: storagePath,
          original_text:
            result.data.originalText || "",
          parsed_data: result.data,

          // 기본값 로직은 기존대로 유지
          is_default: true,
        });

    if (saveError) {
  console.error(
    "COVER LETTER DATABASE ERROR =",
    saveError
  );

  await supabase.storage
    .from("cover-letters")
    .remove([storagePath]);

  resetCoverLetterImport();

  setCoverLetterUploadError(
    `Your cover letter was analyzed, but could not be saved: ${saveError.message}`
  );

  return;
}

setMemoryData((prev) => ({
  ...prev,

  uploadedCoverLetterName: file.name,

  uploadedCoverLetterText:
    result.data.originalText || "",

  coverLetterSource: "uploaded",

  recipient: result.data.recipient || "",

  company: result.data.company || "",

  jobTitle: result.data.jobTitle || "",

  greeting: result.data.greeting || "",

  body: result.data.body || "",

  closing: result.data.closing || "",

  signature: result.data.signature || "",

  coverLetterTone:
    result.data.tone ||
    prev.coverLetterTone,
}));

setCoverLetterUploadProgress(100);
setCoverLetterUploadError("");
setCoverLetterImportStage("parsed");
setCoverLetterImportMessage(
  "Cover Letter analyzed successfully."
);
  } catch (error) {
    console.error(
      "COVER LETTER UPLOAD ERROR =",
      error
    );

    if (storagePath) {
      const { error: cleanupError } =
        await supabase.storage
          .from("cover-letters")
          .remove([storagePath]);

      if (cleanupError) {
        console.error(
          "COVER LETTER FINAL CLEANUP ERROR =",
          cleanupError
        );
      }
    }

    resetCoverLetterImport();

    setCoverLetterUploadError(
  error instanceof Error
    ? error.message
    : "Failed to analyze cover letter. Please try again."
);
  }
}


  function getThemeClass() {
    if (memoryData.themeColor === "Green") return "border-green-600 text-green-700";
    if (memoryData.themeColor === "Blue") return "border-blue-600 text-blue-700";
    if (memoryData.themeColor === "Black") return "border-black text-black";
    if (memoryData.themeColor === "Gray") return "border-gray-500 text-gray-700";
    return "border-slate-800 text-slate-800";
  }

  function continueToImportPreview() {
  setImportStage("preview");
}

  function renderStyleSettings() {
    return (
      <div className="mt-8 rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
        <h3 className="text-xl font-extrabold">Document Style</h3>
        <p className="mt-1 text-sm text-gray-500">Choose the default design for uploaded resumes, new resumes, and cover letters.</p>
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <Select label="Resume Template" value={memoryData.resumeTemplate} onChange={(v) => updateMemory("resumeTemplate", v)} items={resumeTemplates} />
          
          <Select label="Theme Color" value={memoryData.themeColor} onChange={(v) => updateMemory("themeColor", v)} items={themeColors} />
          <Select label="Font" value={memoryData.font} onChange={(v) => updateMemory("font", v)} items={fonts} />
          <Select
  label="Text Size"
  value={memoryData.textSize}
  onChange={(v) => updateMemory("textSize", v)}
  items={textSizes}
/>
         
        </div>
        
      </div>
    );
  }

  function renderResumePreview() {
    return (
      <div
  className={`mt-6 rounded-2xl border-2 bg-white p-6 shadow-sm ${getThemeClass()}`}
  style={{
  fontFamily: memoryData.font,
  zoom:
    memoryData.textSize === "Small"
      ? 0.9
      : memoryData.textSize === "Large"
      ? 1.1
      : 1,
}}
>
        <div className="border-b pb-4">
          <h3 className="text-2xl font-extrabold">{memoryData.firstName || "First"} {memoryData.lastName || "Last"}</h3>
          <p className="mt-1 text-sm text-gray-600">{memoryData.email || "email@example.com"} · {memoryData.phone || "Phone"} · {memoryData.location || "Location"}</p>
          {memoryData.headline.trim() && (
         <p className="mt-2 font-bold">
          {memoryData.headline}
        </p>
  )}
        </div>
       <div className="mt-5 space-y-5">
          <div><h4 className="font-extrabold">Summary</h4><p className="mt-2 text-sm leading-6 text-gray-600">{memoryData.summary || "Your professional summary will appear here."}</p></div>
          <div><h4 className="font-extrabold">Skills</h4><p className="mt-2 text-sm leading-6 text-gray-600">{memoryData.skills || "Excel, Communication, Customer Service, Organization"}</p></div>
          <div><h4 className="font-extrabold">Experience</h4><p className="mt-2 text-sm font-bold">{memoryData.workExperience[0]?.jobTitle || memoryData.volunteerExperience[0]?.role || "Job / Volunteer Title"}</p><p className="text-sm text-gray-600">{memoryData.workExperience[0]?.company || memoryData.volunteerExperience[0]?.organization || "Company / Organization"}</p><p className="mt-1 text-sm text-gray-600">{memoryData.workExperience[0]?.description || memoryData.volunteerExperience[0]?.description || "Experience bullets will appear here."}</p></div>
          <div><h4 className="font-extrabold">Education</h4><p className="mt-2 text-sm font-bold">{memoryData.education[0]?.program || "Program / Degree"}</p><p className="text-sm text-gray-600">{memoryData.education[0]?.school || "School Name"}</p></div>
        </div>
      </div>
    );
  }

  function renderUploadedOriginalPreview() {
    if (!uploadedResumeUrl && !memoryData.uploadedResumeText) {
      return <div className="flex min-h-[900px] items-center justify-center rounded-2xl bg-white text-center text-sm font-semibold text-slate-500">Upload a resume to preview the original file.</div>;
    }
    if (uploadedResumeKind === "pdf" && uploadedResumeUrl) {
      return <iframe src={`${uploadedResumeUrl}#toolbar=1&navpanes=0&view=FitH`} title="Uploaded resume preview" className="h-[900px] w-full rounded-2xl border border-slate-200 bg-white" />;
    }
    if (uploadedResumeKind === "txt") {
      return <pre className="min-h-[900px] whitespace-pre-wrap rounded-2xl border border-slate-200 bg-white p-10 text-sm leading-7 text-slate-800 shadow-xl">{memoryData.uploadedResumeText || "TXT resume preview is empty."}</pre>;
    }
    if (uploadedResumeKind === "docx") {
      return (
        <div className="flex min-h-[900px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-xl">
          <div><p className="text-5xl">📄</p><h3 className="mt-5 text-2xl font-black text-slate-950">DOCX uploaded</h3><p className="mt-3 max-w-md text-sm leading-6 text-slate-500">Browser preview for DOCX is not available in this page yet. Convert DOCX to PDF on the backend or extract its text before showing the full resume.</p><p className="mt-4 text-sm font-bold text-blue-600">{memoryData.uploadedResumeName}</p></div>
        </div>
      );
    }
    return <div className="flex min-h-[900px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-xl"><div><p className="text-5xl">⚠️</p><h3 className="mt-5 text-2xl font-black text-slate-950">Preview not available</h3><p className="mt-3 max-w-md text-sm leading-6 text-slate-500">Please upload a PDF, DOCX, or TXT resume.</p></div></div>;
  }
   function renderCoverLetterPreview() {
  return (
    <div className="rounded-2xl bg-white p-10 shadow">

      <p>{memoryData.greeting}</p>

      <div className="mt-8 whitespace-pre-wrap">
        {memoryData.body}
      </div>

      <div className="mt-10">
        <p>{memoryData.closing}</p>

        <p className="mt-5 font-bold">
          {memoryData.signature}
        </p>
      </div>

    </div>
  );
}

  function renderBuiltResumePreview() {
  const template = memoryData.resumeTemplate;
const accent =
  memoryData.themeColor === "Blue"
    ? "#2563eb"
    : memoryData.themeColor === "Green"
    ? "#16a34a"
    : memoryData.themeColor === "Black"
    ? "#111827"
    : memoryData.themeColor === "Gray"
    ? "#6b7280"
    : "#1e3a8a"; // Navy
const resumeScale =
  memoryData.textSize === "Small"
    ? 0.9
    : memoryData.textSize === "Large"
    ? 1.1
    : 1;

  if (template === "Professional") {
  return (
  <div
    className="mx-auto max-w-[820px] bg-white shadow-xl"
   style={{
  fontFamily: memoryData.font,
  zoom: resumeScale,
}}
  >
      <div className="border-b-4 px-10 py-9"
style={{
  borderColor: accent,
}}>
        <h1 className="break-words text-4xl font-black leading-tight text-slate-950">
          {memoryData.firstName || "First"}{" "}
          {memoryData.lastName || "Last"}
        </h1>

        {memoryData.headline && (
          <p className="mt-3 break-words text-lg font-semibold text-slate-600">
            {memoryData.headline}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-x-3 gap-y-2 text-sm text-slate-500">
          {memoryData.location && (
            <span>{memoryData.location}</span>
          )}

          {memoryData.email && (
            <>
              {memoryData.location && <span>•</span>}
              <span className="break-all">
                {memoryData.email}
              </span>
            </>
          )}

          {memoryData.phone && (
            <>
              {(memoryData.location ||
                memoryData.email) && <span>•</span>}
              <span>{memoryData.phone}</span>
            </>
          )}

          {memoryData.linkedin && (
            <>
              {(memoryData.location ||
                memoryData.email ||
                memoryData.phone) && <span>•</span>}
              <span className="break-all">
                {memoryData.linkedin}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-10 px-10 py-8">
        <aside className="min-w-0 border-r pr-8"
style={{
  borderColor: accent,
}}>
          <ResumeSection title="Skills">
            <div className="space-y-2">
              {String(memoryData.skills || "")
                .split(",")
                .map((skill) => skill.trim())
                .filter(Boolean)
                .map((skill, index) => (
                  <p
                    key={index}
                    className="break-words"
                  >
                    • {skill}
                  </p>
                ))}
            </div>
          </ResumeSection>

          {memoryData.languages.some((item) =>
            item.language.trim()
          ) && (
            <ResumeSection title="Languages">
              {memoryData.languages
                .filter((item) => item.language)
                .map((item, index) => (
                  <div
                    key={index}
                    className="mb-3"
                  >
                    <p className="break-words font-medium">
                      {item.language}
                    </p>

                    <p className="text-sm text-slate-500">
                      {item.level}
                    </p>
                  </div>
                ))}
            </ResumeSection>
          )}

          {memoryData.certifications.some((item) =>
            item.name.trim()
          ) && (
            <ResumeSection title="Certifications">
              {memoryData.certifications
                .filter((item) => item.name)
                .map((item, index) => (
                  <div
                    key={index}
                    className="mb-4"
                  >
                    <h3 className="break-words font-bold">
                      {item.name}
                    </h3>

                    {item.date && (
                      <p className="text-sm text-slate-500">
                        {item.date}
                      </p>
                    )}

                    <p className="break-words text-slate-500">
                      {item.issuer}
                    </p>

                    {item.description && (
                      <p className="mt-2 break-words">
                        {item.description}
                      </p>
                    )}
                  </div>
                ))}
            </ResumeSection>
          )}
        </aside>

        <div className="min-w-0">
          <ResumeSection title="Professional Summary">
            <p className="break-words">
              {memoryData.summary}
            </p>
          </ResumeSection>

          <ResumeSection title="Experience">
            {memoryData.workExperience
              .filter(
                (item) =>
                  item.company ||
                  item.jobTitle
              )
              .map((item, index) => (
                <div
                  key={index}
                  className="mb-6"
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <h3 className="break-words font-bold">
                      {item.jobTitle}
                    </h3>

                    <span className="shrink-0 text-sm text-slate-500">
                      {formatExperienceDates(item)}
                    </span>
                  </div>

                  <p className="mb-2 break-words text-slate-500">
                    {item.company}
                    {item.location
                      ? ` · ${item.location}`
                      : ""}
                  </p>

                  <ul className="list-disc space-y-2 pl-6">
                    {String(item.description)
                      .split(/\r?\n|•/)
                      .filter(Boolean)
                      .map((line, lineIndex) => (
                        <li
                          key={lineIndex}
                          className="break-words"
                        >
                          {line.trim()}
                        </li>
                      ))}
                  </ul>
                </div>
              ))}

            {memoryData.volunteerExperience.some(
              (item) =>
                item.organization ||
                item.role ||
                item.description
            ) && (
              <div className="mt-7">
                <h3 className="mb-5 text-sm font-black uppercase tracking-[0.12em] text-slate-950">
                  Volunteer / Internship
                </h3>

                {memoryData.volunteerExperience
                  .filter(
                    (item) =>
                      item.organization ||
                      item.role ||
                      item.description
                  )
                  .map((item, index) => (
                    <div
                      key={index}
                      className="mb-6"
                    >
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                        <h3 className="break-words font-bold">
                          {item.role}
                        </h3>

                        <span className="shrink-0 text-sm text-slate-500">
                          {formatExperienceDates(item)}
                        </span>
                      </div>

                      <p className="mb-2 break-words text-slate-500">
                        {item.organization}
                        {item.location
                          ? ` · ${item.location}`
                          : ""}
                      </p>

                      <ul className="list-disc space-y-2 pl-6">
                        {String(item.description)
                          .split(/\r?\n|•/)
                          .filter(Boolean)
                          .map((line, lineIndex) => (
                            <li
                              key={lineIndex}
                              className="break-words"
                            >
                              {line.trim()}
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
              </div>
            )}
          </ResumeSection>

          {memoryData.projects.some((item) =>
            item.name.trim()
          ) && (
            <ResumeSection title="Projects">
              {memoryData.projects
                .filter((item) => item.name)
                .map((item, index) => (
                  <div
                    key={index}
                    className="mb-5"
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <h3 className="break-words font-bold">
                        {item.name}
                      </h3>

                      <span className="shrink-0 text-sm text-slate-500">
                        {item.dates}
                      </span>
                    </div>

                    <p className="break-words text-slate-500">
                      {item.role}
                    </p>

                    <p className="mt-2 break-words">
                      {item.description}
                    </p>
                  </div>
                ))}
            </ResumeSection>
          )}

          {memoryData.education.some(
            (item) =>
              item.school ||
              item.program
          ) && (
            <ResumeSection title="Education">
              {memoryData.education.map(
                (item, index) => (
                  <div
                    key={index}
                    className="mb-4"
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <h3 className="break-words font-bold">
                        {item.program}
                      </h3>

                      <span className="shrink-0 text-sm text-slate-500">
                        {formatEducationDates(item)}
                      </span>
                    </div>

                    <p className="break-words">
                      {item.school}
                    </p>

                    {item.gpa && (
                      <p className="mt-1 text-sm text-slate-500">
                        GPA / Honours: {item.gpa}
                      </p>
                    )}

                    {item.coursework && (
                      <p className="mt-2 break-words text-sm">
                        {item.coursework}
                      </p>
                    )}
                  </div>
                )
              )}
            </ResumeSection>
          )}

          {(memoryData.targetRoles ||
            memoryData.targetIndustry ||
            memoryData.targetLocation ||
            memoryData.salaryExpectation ||
            memoryData.careerGoalSummary) && (
            <ResumeSection title="Career Objective">
              {memoryData.targetRoles && (
                <p className="mb-2 break-words">
                  <strong>Target Role:</strong>{" "}
                  {memoryData.targetRoles}
                </p>
              )}

              {memoryData.targetIndustry && (
                <p className="mb-2 break-words">
                  <strong>Industry:</strong>{" "}
                  {memoryData.targetIndustry}
                </p>
              )}

              {memoryData.targetLocation && (
                <p className="mb-2 break-words">
                  <strong>Preferred Location:</strong>{" "}
                  {memoryData.targetLocation}
                </p>
              )}

              {memoryData.salaryExpectation && (
                <p className="mb-2 break-words">
                  <strong>Salary Expectation:</strong>{" "}
                  {memoryData.salaryExpectation}
                </p>
              )}

              {memoryData.careerGoalSummary && (
                <p className="mt-3 break-words">
                  {memoryData.careerGoalSummary}
                </p>
              )}
            </ResumeSection>
          )}
        </div>
      </div>
    </div>
  );
}

  if (template === "Creative") {
   return (
  <div
    className="mx-auto max-w-[760px] bg-white shadow-xl"
   style={{
  fontFamily: memoryData.font,
  zoom: resumeScale,
}}
  >
        <div className="p-10 text-white"
style={{
  backgroundColor: accent,
}}>
          <h1 className="text-5xl font-black">
            {memoryData.firstName}{" "}
            {memoryData.lastName}
          </h1>

          <p className="mt-3">
            {memoryData.location} •{" "}
            {memoryData.email} •{" "}
            {memoryData.phone}
          </p>
        </div>

        <div className="p-10">
          <ResumeSection title="Profile">
            <p>{memoryData.summary}</p>
          </ResumeSection>

          <ResumeSection title="Skills">
            <div className="mt-3 flex flex-wrap gap-2">
              {String(memoryData.skills || "")
                .split(",")
                .map((skill) => skill.trim())
                .filter(Boolean)
                .map((skill, index) => (
                  <span
                    key={index}
                    className="rounded-full px-3 py-1 text-sm font-medium"
style={{
  backgroundColor: `${accent}20`,
  color: accent,
}}
                  >
                    {skill}
                  </span>
                ))}
            </div>
          </ResumeSection>

          <ResumeSection title="Experience">
            {memoryData.workExperience
              .filter(
                (item) =>
                  item.company || item.jobTitle
              )
              .map((item, index) => (
                <div
                  key={index}
                  className="mb-8 border-l-4 pl-5"
style={{
  borderColor: accent,
}}
                >
                  <div className="flex justify-between">
                    <h3 className="text-lg font-bold">
                      {item.jobTitle}
                    </h3>

                    {formatExperienceDates(item)}
                  </div>

                  <p className="mb-2 text-slate-500">
                    {item.company}
                  </p>

                  <ul className="list-disc space-y-2 pl-6">
                    {String(item.description)
                      .split(/\r?\n|•/)
                      .filter(Boolean)
                      .map((line, lineIndex) => (
                        <li key={lineIndex}>
                          {line.trim()}
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
          </ResumeSection>

          {memoryData.projects.some((item) =>
            item.name.trim()
          ) && (
            <ResumeSection title="Projects">
              {memoryData.projects
                .filter((item) => item.name)
                .map((item, index) => (
                  <div key={index} className="mb-5">
                    <div className="flex justify-between">
                      <h3 className="font-bold">
                        {item.name}
                      </h3>

                      <span>{item.dates}</span>
                    </div>

                    <p className="text-slate-500">
                      {item.role}
                    </p>

                    <p className="mt-2">
                      {item.description}
                    </p>
                  </div>
                ))}
            </ResumeSection>
          )}

          {memoryData.education.some(
            (item) => item.school || item.program
          ) && (
            <ResumeSection title="Education">
              {memoryData.education.map(
                (item, index) => (
                  <div key={index} className="mb-4">
                    <h3 className="font-bold">
                      {item.program}
                    </h3>

                    <p>{item.school}</p>

                    <p className="text-sm text-slate-500">
                      {formatEducationDates(item)}
                    </p>

                    {item.gpa && (
                      <p className="mt-1 text-sm text-slate-500">
                        GPA / Honours: {item.gpa}
                      </p>
                    )}

                    {item.coursework && (
                      <p className="mt-2 text-sm">
                        {item.coursework}
                      </p>
                    )}
                  </div>
                )
              )}
            </ResumeSection>
          )}

          {memoryData.languages.some((item) =>
            item.language.trim()
          ) && (
            <ResumeSection title="Languages">
              {memoryData.languages
                .filter((item) => item.language)
                .map((item, index) => (
                  <div
                    key={index}
                    className="mb-2 flex justify-between"
                  >
                    <span className="font-medium">
                      {item.language}
                    </span>

                    <span className="text-slate-500">
                      {item.level}
                    </span>
                  </div>
                ))}
            </ResumeSection>
          )}

          {memoryData.certifications.some((item) =>
            item.name.trim()
          ) && (
            <ResumeSection title="Certifications">
              {memoryData.certifications
                .filter((item) => item.name)
                .map((item, index) => (
                  <div key={index} className="mb-4">
                    <div className="flex justify-between">
                      <h3 className="font-bold">
                        {item.name}
                      </h3>

                      <span>{item.date}</span>
                    </div>

                    <p className="text-slate-500">
                      {item.issuer}
                    </p>

                    {item.description && (
                      <p className="mt-2">
                        {item.description}
                      </p>
                    )}
                  </div>
                ))}
            </ResumeSection>
          )}

          {(memoryData.targetRoles ||
            memoryData.targetIndustry ||
            memoryData.targetLocation ||
            memoryData.salaryExpectation ||
            memoryData.careerGoalSummary) && (
            <ResumeSection title="Career Objective">
              <p className="mb-2">
                <strong>Target Role:</strong>{" "}
                {memoryData.targetRoles}
              </p>

              <p className="mb-2">
                <strong>Industry:</strong>{" "}
                {memoryData.targetIndustry}
              </p>

              <p className="mb-2">
                <strong>Preferred Location:</strong>{" "}
                {memoryData.targetLocation}
              </p>

              <p className="mb-2">
                <strong>Salary Expectation:</strong>{" "}
                {memoryData.salaryExpectation}
              </p>

              {memoryData.careerGoalSummary && (
                <p className="mt-3">
                  {memoryData.careerGoalSummary}
                </p>
              )}
            </ResumeSection>
          )}
        </div>
      </div>
    );
  }

 return (
  <div
    className="mx-auto min-h-[960px] w-full max-w-[760px] bg-white p-8 shadow-xl sm:p-10"
    style={{
  fontFamily: memoryData.font,
  zoom: resumeScale,
}}
  >
      <div className="border-b-4 pb-5"
style={{
  borderColor: accent,
}}>
        <h1 className="break-words text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
          {memoryData.firstName || "First"}{" "}
          {memoryData.lastName || "Last"}
        </h1>

        <p className="mt-3 break-words text-sm text-slate-500">
          {memoryData.location || "Location"} ·{" "}
          {memoryData.email || "email@example.com"} ·{" "}
          {memoryData.phone || "Phone"} ·{" "}
          {memoryData.linkedin || "LinkedIn "}
        </p>
      </div>

      <ResumeSection title="Professional Summary">
        <p>
          {memoryData.summary ||
            "Your professional summary will appear here."}
        </p>
      </ResumeSection>

      <ResumeSection title="Skills">
        <div className="mt-3 flex flex-wrap gap-2">
          {(Array.isArray(memoryData.skills)
            ? memoryData.skills
            : (memoryData.skills || "").split(",")
          )
            .map((skill) => String(skill).trim())
            .filter(Boolean)
            .map((skill, index) => (
              <span
                key={index}
                className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium"
              >
                {skill}
              </span>
            ))}
        </div>
      </ResumeSection>

      <ResumeSection title="Experience">
        {memoryData.workExperience
          .filter(
            (item) =>
              item.company ||
              item.jobTitle ||
              item.description
          )
          .map((item, index) => (
            <div
              key={`work-${index}`}
              className="mb-5"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
                <p className="font-black text-slate-950">
                  {item.jobTitle || "Role Title"}
                </p>

                <p className="text-sm text-slate-500">
                  {formatExperienceDates(item) ||
                    "Dates"}
                </p>
              </div>

              <p className="font-bold text-slate-700">
                {item.company || "Company Name"}
                {item.location
                  ? ` · ${item.location}`
                  : ""}
              </p>

              <ul className="mt-2 list-disc space-y-2 pl-6">
                {(
                  item.description ||
                  "Experience details will appear here."
                )
                  .split(/\r?\n|•/)
                  .filter((line) => line.trim())
                  .map((line, lineIndex) => (
                    <li key={lineIndex}>
                      {line.trim()}
                    </li>
                  ))}
              </ul>
            </div>
          ))}

        {memoryData.volunteerExperience
          .filter(
            (item) =>
              item.organization ||
              item.role ||
              item.description
          )
          .map((item, index) => (
            <div
              key={`vol-${index}`}
              className="mb-5"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
                <p className="font-black text-slate-950">
                  {item.role ||
                    "Volunteer / Internship "}
                </p>

                <p className="text-sm text-slate-500">
                  {formatExperienceDates(item) ||
                    "Dates"}
                </p>
              </div>

              <p className="font-bold text-slate-700">
                {item.organization ||
                  "Organization"}
              </p>

              <ul className="mt-2 list-disc space-y-2 pl-6">
                {(
                  item.description ||
                  "Experience details will appear here."
                )
                  .split(/\r?\n|•/)
                  .filter((line) => line.trim())
                  .map((line, lineIndex) => (
                    <li key={lineIndex}>
                      {line.trim()}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
      </ResumeSection>

      {memoryData.projects.some((item) =>
        item.name.trim()
      ) && (
        <ResumeSection title="Projects">
          {memoryData.projects
            .filter((item) => item.name)
            .map((item, index) => (
              <div key={index} className="mb-5">
                <div className="flex justify-between">
                  <h3 className="font-bold">
                    {item.name}
                  </h3>

                  <span>{item.dates}</span>
                </div>

                <p className="text-slate-500">
                  {item.role}
                </p>

                <p className="mt-2">
                  {item.description}
                </p>
              </div>
            ))}
        </ResumeSection>
      )}

      {memoryData.education.some(
        (item) => item.school || item.program
      ) && (
        <ResumeSection title="Education">
          {memoryData.education
            .filter(
              (item) =>
                item.school || item.program
            )
            .map((item, index) => (
              <div key={index} className="mb-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
                  <p className="font-black text-slate-950">
                    {item.program}
                  </p>

                  <p className="text-sm text-slate-500">
                    {formatExperienceDates(item) ||
                      "Dates"}
                  </p>
                </div>

                <p className="font-bold text-slate-700">
                  {item.school}
                </p>

                {item.gpa && (
                  <p className="mt-1 text-sm text-slate-600">
                    GPA / Honours: {item.gpa}
                  </p>
                )}

                {item.coursework && (
                  <p className="mt-1 text-slate-600">
                    {item.coursework}
                  </p>
                )}
              </div>
            ))}
        </ResumeSection>
      )}

      {memoryData.languages.some((item) =>
        item.language.trim()
      ) && (
        <ResumeSection title="Languages">
          {memoryData.languages
            .filter((item) => item.language)
            .map((item, index) => (
              <div
                key={index}
                className="mb-2 flex justify-between"
              >
                <span className="font-medium">
                  {item.language}
                </span>

                <span className="text-slate-500">
                  {item.level}
                </span>
              </div>
            ))}
        </ResumeSection>
      )}

      {memoryData.certifications.some((item) =>
        item.name.trim()
      ) && (
        <ResumeSection title="Certifications">
          {memoryData.certifications
            .filter((item) => item.name)
            .map((item, index) => (
              <div key={index} className="mb-4">
                <div className="flex justify-between">
                  <h3 className="font-bold">
                    {item.name}
                  </h3>

                  <span>{item.date}</span>
                </div>

                <p className="text-slate-500">
                  {item.issuer}
                </p>

                {item.description && (
                  <p className="mt-2">
                    {item.description}
                  </p>
                )}
              </div>
            ))}
        </ResumeSection>
      )}

      {(memoryData.targetRoles ||
        memoryData.targetIndustry ||
        memoryData.targetLocation ||
        memoryData.salaryExpectation ||
        memoryData.careerGoalSummary) && (
        <ResumeSection title="Career Objective">
          {memoryData.targetRoles && (
            <p className="mb-2">
              <strong>Target Role:</strong>{" "}
              {memoryData.targetRoles}
            </p>
          )}

          {memoryData.targetIndustry && (
            <p className="mb-2">
              <strong>Industry:</strong>{" "}
              {memoryData.targetIndustry}
            </p>
          )}

          {memoryData.targetLocation && (
            <p className="mb-2">
              <strong>Preferred Location:</strong>{" "}
              {memoryData.targetLocation}
            </p>
          )}

          {memoryData.salaryExpectation && (
            <p className="mb-2">
              <strong>Salary:</strong>{" "}
              {memoryData.salaryExpectation}
            </p>
          )}

          {memoryData.careerGoalSummary && (
            <p className="mt-3">
              {memoryData.careerGoalSummary}
            </p>
          )}
        </ResumeSection>
      )}
    </div>
  );
}

  function renderFullResumePreview() {
    const isUploadedResumePreview = memoryData.resumeSource === "uploaded" && (uploadedResumeUrl || memoryData.uploadedResumeText || uploadedResumeKind !== "none");
    return (
      <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-black uppercase tracking-wide text-blue-600">Full Resume Preview</p><h2 className="mt-1 text-3xl font-black text-slate-950">Review your resume before saving</h2></div>
          <div className="flex gap-3"><button onClick={() => (mode === "import" ? setImportStage("parsed") : setCurrentStep(7))} className="rounded-xl border border-blue-600 px-5 py-3 font-bold text-blue-600">Back</button><button onClick={() => { persistMemory(); continueToDashboard(); }} className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white">Save & Continue</button></div>
        </div>
        <div className="grid gap-6 2xl:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-5 2xl:block 2xl:space-y-3">
            <p className="text-sm font-black text-slate-900 sm:col-span-5 2xl:col-span-1">Template</p>
            {resumeTemplates.map((template) => (
              <button key={template} onClick={() => updateMemory("resumeTemplate", template)} className={`w-full rounded-xl px-4 py-3 text-left text-sm font-bold ${memoryData.resumeTemplate === template ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-blue-50"}`}>{template}</button>
            ))}
            <div className="pt-3 text-xs font-semibold leading-5 text-slate-500 sm:col-span-5 2xl:col-span-1">Style: {memoryData.themeColor} · {memoryData.font} · {memoryData.textSize}</div>
            {isUploadedResumePreview && <div className="rounded-xl bg-blue-50 p-3 text-xs font-semibold leading-5 text-blue-700 sm:col-span-5 2xl:col-span-1">Showing your original uploaded resume. Template changes apply after backend parsing/conversion.</div>}
          </aside>
          <div className="max-h-[900px] min-w-0 overflow-auto rounded-2xl border border-slate-200 bg-slate-100 p-4 sm:p-6">
            {isUploadedResumePreview ? renderUploadedOriginalPreview() : renderBuiltResumePreview()}
          </div>
        </div>
      </div>
    );
  }

  function renderRequiredBanner() {
  const unlocked = canUseService();

  return (
    <div className="mb-6 rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-wide text-blue-600">
            Career Memory Unlock
          </p>

          <h2 className="mt-1 text-xl font-black text-slate-950">
            Required sections: {requiredCount}/3
          </h2>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            Complete Personal Information, Experience, and Skills to unlock
            Dashboard and application features.
          </p>
        </div>

        <button
          type="button"
         onClick={continueToDashboard}
          
          className={`rounded-xl px-5 py-3 font-bold transition ${
            unlocked
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "cursor-not-allowed bg-slate-100 text-slate-400"
          }`}
        >
          {unlocked
            ? "Continue to Dashboard →"
            : `Complete Required Sections (${requiredCount}/3)`}
        </button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <RequiredStatus
          done={hasPersonalInfo()}
          title="Personal Information"
        />

        <RequiredStatus
          done={hasExperience()}
          title="Experience"
        />

        <RequiredStatus
          done={hasSkills()}
          title="Skills"
        />
      </div>
    </div>
  );
}

  function renderStepForm() {
    if (currentStep === 0) return (
      <div className="mt-6 grid gap-5 md:grid-cols-2"><Input placeholder="First Name" value={memoryData.firstName} onChange={(v) => updateMemory("firstName", v)} /><Input placeholder="Last Name" value={memoryData.lastName} onChange={(v) => updateMemory("lastName", v)} /><Input placeholder="Email" value={memoryData.email} onChange={(v) => updateMemory("email", v)} /><Input placeholder="Phone" value={memoryData.phone} onChange={(v) => updateMemory("phone", v)} /><Input placeholder="Location" value={memoryData.location} onChange={(v) => updateMemory("location", v)} /><Input placeholder="LinkedIn (optional)" value={memoryData.linkedin} onChange={(v) => updateMemory("linkedin", v)} /><Textarea rows={5} placeholder="Career Summary" value={memoryData.summary} onChange={(v) => updateMemory("summary", v)} className="md:col-span-2" /></div>
    );
    if  (currentStep === 4) {
  return (
    <ArraySection
      title="Education"
      items={memoryData.education}
      section="education"
      emptyItem={emptyEducation}
      addLabel="+ Add Education"
      removeItem={removeItem}
      addItem={addItem}
      render={(item, index) => (
        <div className="grid gap-5 md:grid-cols-2">
          <Input
            placeholder="School Name"
            value={item.school}
            onChange={(value) =>
              updateArrayItem<EducationItem>(
                "education",
                index,
                "school",
                value
              )
            }
          />

          <Input
            placeholder="Program / Degree"
            value={item.program}
            onChange={(value) =>
              updateArrayItem<EducationItem>(
                "education",
                index,
                "program",
                value
              )
            }
          />

          <MonthInput
            label="Start Date"
            value={item.startDate || ""}
            onChange={(value) =>
              updateArrayItem<EducationItem>(
                "education",
                index,
                "startDate",
                value
              )
            }
          />

          <MonthInput
            label="End Date"
            value={item.endDate || ""}
            onChange={(value) =>
              updateArrayItem<EducationItem>(
                "education",
                index,
                "endDate",
                value
              )
            }
          />

          <Input
            placeholder="GPA / Honours (Optional)"
            value={item.gpa}
            onChange={(value) =>
              updateArrayItem<EducationItem>(
                "education",
                index,
                "gpa",
                value
              )
            }
            className="md:col-span-2"
          />

          <Textarea
            rows={4}
            placeholder="Relevant coursework, awards, academic achievements..."
            value={item.coursework}
            onChange={(value) =>
              updateArrayItem<EducationItem>(
                "education",
                index,
                "coursework",
                value
              )
            }
            className="md:col-span-2"
          />
        </div>
      )}
    />
  );
}
   if (currentStep === 2) {
  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5">
        <h3 className="font-black text-slate-950">
          Experience
        </h3>

        <p className="mt-2 text-sm leading-6 text-slate-600">
          Add work, volunteer, internship, co-op, or other relevant
          experience.
        </p>
      </div>

      <ArraySection
        title="Work Experience"
        items={memoryData.workExperience}
        section="workExperience"
        emptyItem={emptyWork}
        addLabel="+ Add Work Experience"
        removeItem={removeItem}
        addItem={addItem}
        render={(item, index) => (
          <div className="grid gap-5 md:grid-cols-2">
            <Input
              placeholder="Company Name"
              value={item.company}
              onChange={(value) =>
                updateArrayItem<WorkItem>(
                  "workExperience",
                  index,
                  "company",
                  value
                )
              }
            />

            <Input
              placeholder="Job Title"
              value={item.jobTitle}
              onChange={(value) =>
                updateArrayItem<WorkItem>(
                  "workExperience",
                  index,
                  "jobTitle",
                  value
                )
              }
            />

            <Input
              placeholder="Location (Optional)"
              value={item.location || ""}
              onChange={(value) =>
                updateArrayItem<WorkItem>(
                  "workExperience",
                  index,
                  "location",
                  value
                )
              }
              className="md:col-span-2"
            />

            <MonthInput
              label="Start Date"
              value={item.startDate || ""}
              onChange={(value) =>
                updateArrayItem<WorkItem>(
                  "workExperience",
                  index,
                  "startDate",
                  value
                )
              }
            />

            <MonthInput
              label="End Date"
              value={item.endDate || ""}
              disabled={item.isCurrent}
              onChange={(value) =>
                updateArrayItem<WorkItem>(
                  "workExperience",
                  index,
                  "endDate",
                  value
                )
              }
            />

            <div className="md:col-span-2">
              <p className="mb-2 text-sm font-semibold text-slate-700">
                Are you currently working here?
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    updateArrayItem<WorkItem>(
                      "workExperience",
                      index,
                      "isCurrent",
                      true
                    );

                    updateArrayItem<WorkItem>(
                      "workExperience",
                      index,
                      "endDate",
                      ""
                    );
                  }}
                  className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                    item.isCurrent
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"
                  }`}
                >
                  Yes, currently working
                </button>

                <button
                  type="button"
                  onClick={() =>
                    updateArrayItem<WorkItem>(
                      "workExperience",
                      index,
                      "isCurrent",
                      false
                    )
                  }
                  className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                    !item.isCurrent
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"
                  }`}
                >
                  No, previously worked
                </button>
              </div>
            </div>

            <Textarea
              rows={5}
              placeholder="Responsibilities, achievements, tools used, numbers/results..."
              value={item.description}
              onChange={(value) =>
                updateArrayItem<WorkItem>(
                  "workExperience",
                  index,
                  "description",
                  value
                )
              }
              className="md:col-span-2"
            />
          </div>
        )}
      />

      <ArraySection
        title="Volunteer / Internship / Other Experience"
        items={memoryData.volunteerExperience}
        section="volunteerExperience"
        emptyItem={emptyVolunteer}
        addLabel="+ Add Volunteer / Other Experience"
        removeItem={removeItem}
        addItem={addItem}
        render={(item, index) => (
          <div className="grid gap-5 md:grid-cols-2">
            <Input
              placeholder="Organization / Program Name"
              value={item.organization}
              onChange={(value) =>
                updateArrayItem<VolunteerItem>(
                  "volunteerExperience",
                  index,
                  "organization",
                  value
                )
              }
            />

            <Input
              placeholder="Role / Experience Type"
              value={item.role}
              onChange={(value) =>
                updateArrayItem<VolunteerItem>(
                  "volunteerExperience",
                  index,
                  "role",
                  value
                )
              }
            />

            <Input
              placeholder="Location (Optional)"
              value={item.location || ""}
              onChange={(value) =>
                updateArrayItem<VolunteerItem>(
                  "volunteerExperience",
                  index,
                  "location",
                  value
                )
              }
              className="md:col-span-2"
            />

            <MonthInput
              label="Start Date"
              value={item.startDate || ""}
              onChange={(value) =>
                updateArrayItem<VolunteerItem>(
                  "volunteerExperience",
                  index,
                  "startDate",
                  value
                )
              }
            />

            <MonthInput
              label="End Date"
              value={item.endDate || ""}
              disabled={item.isCurrent}
              onChange={(value) =>
                updateArrayItem<VolunteerItem>(
                  "volunteerExperience",
                  index,
                  "endDate",
                  value
                )
              }
            />

            <div className="md:col-span-2">
              <p className="mb-2 text-sm font-semibold text-slate-700">
                Are you currently volunteering or participating here?
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    updateArrayItem<VolunteerItem>(
                      "volunteerExperience",
                      index,
                      "isCurrent",
                      true
                    );

                    updateArrayItem<VolunteerItem>(
                      "volunteerExperience",
                      index,
                      "endDate",
                      ""
                    );
                  }}
                  className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                    item.isCurrent
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"
                  }`}
                >
                  Yes, currently active
                </button>

                <button
                  type="button"
                  onClick={() =>
                    updateArrayItem<VolunteerItem>(
                      "volunteerExperience",
                      index,
                      "isCurrent",
                      false
                    )
                  }
                  className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                    !item.isCurrent
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"
                  }`}
                >
                  No, previously participated
                </button>
              </div>
            </div>

            <Textarea
              rows={5}
              placeholder="Duties, events, leadership, internship tasks, impact..."
              value={item.description}
              onChange={(value) =>
                updateArrayItem<VolunteerItem>(
                  "volunteerExperience",
                  index,
                  "description",
                  value
                )
              }
              className="md:col-span-2"
            />
          </div>
        )}
      />
    </div>
  );
}
    if (currentStep === 1) return <div className="mt-6"><Textarea rows={8} placeholder="Add skills separated by commas. Example: Excel, Outlook, Client Service, Legal Research, Data Entry..." value={memoryData.skills} onChange={(v) => updateMemory("skills", v)} className="w-full" /></div>;
   if (currentStep === 5) {
  return (
    <ArraySection
      title="Language"
      items={memoryData.languages}
      section="languages"
      emptyItem={emptyLanguage}
      addLabel="+ Add Language"
      removeItem={removeItem}
      addItem={addItem}
      render={(item, index) => (
        <div className="space-y-5">
          <Input
            placeholder="Language"
            value={item.language}
            onChange={(value) =>
              updateArrayItem<LanguageItem>(
                "languages",
                index,
                "language",
                value
              )
            }
          />

          <div>
            <p className="mb-3 text-sm font-semibold text-slate-700">
              Proficiency Level
            </p>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {languageLevels.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() =>
                    updateArrayItem<LanguageItem>(
                      "languages",
                      index,
                      "level",
                      level
                    )
                  }
                  className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                    item.level === level
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    />
  );
}
    if (currentStep === 6) return <ArraySection title="Certification" items={memoryData.certifications} section="certifications" emptyItem={emptyCertification} addLabel="+ Add Certification" removeItem={removeItem} addItem={addItem} render={(item, index) => <div className="grid gap-5 md:grid-cols-2"><Input placeholder="Certification / Award Name" value={item.name} onChange={(v) => updateArrayItem<CertificationItem>("certifications", index, "name", v)} /><Input placeholder="Issuer / Organization" value={item.issuer} onChange={(v) => updateArrayItem<CertificationItem>("certifications", index, "issuer", v)} /><Input placeholder="Date" value={item.date} onChange={(v) => updateArrayItem<CertificationItem>("certifications", index, "date", v)} className="md:col-span-2" /><Textarea rows={4} placeholder="Description or details..." value={item.description} onChange={(v) => updateArrayItem<CertificationItem>("certifications", index, "description", v)} className="md:col-span-2" /></div>} />;
    if (currentStep === 3) return <ArraySection title="Project" items={memoryData.projects} section="projects" emptyItem={emptyProject} addLabel="+ Add Project" removeItem={removeItem} addItem={addItem} render={(item, index) => <div className="grid gap-5 md:grid-cols-2"><Input placeholder="Project Name" value={item.name} onChange={(v) => updateArrayItem<ProjectItem>("projects", index, "name", v)} /><Input placeholder="Role / Your Contribution" value={item.role} onChange={(v) => updateArrayItem<ProjectItem>("projects", index, "role", v)} /><Input placeholder="Dates" value={item.dates} onChange={(v) => updateArrayItem<ProjectItem>("projects", index, "dates", v)} className="md:col-span-2" /><Textarea rows={5} placeholder="Describe the project, tools used, result, and impact..." value={item.description} onChange={(v) => updateArrayItem<ProjectItem>("projects", index, "description", v)} className="md:col-span-2" /></div>} />;
    if (currentStep === 7) return <div className="mt-6 grid gap-5 md:grid-cols-2"><Input placeholder="Target Roles" value={memoryData.targetRoles} onChange={(v) => updateMemory("targetRoles", v)} /><Input placeholder="Target Industry" value={memoryData.targetIndustry} onChange={(v) => updateMemory("targetIndustry", v)} /><Input placeholder="Preferred Location" value={memoryData.targetLocation} onChange={(v) => updateMemory("targetLocation", v)} /><Input placeholder="Salary Expectation" value={memoryData.salaryExpectation} onChange={(v) => updateMemory("salaryExpectation", v)} /><Textarea rows={6} placeholder="Describe your short-term and long-term career goals..." value={memoryData.careerGoalSummary} onChange={(v) => updateMemory("careerGoalSummary", v)} className="md:col-span-2" /></div>;
    return <div><div className="mt-6 rounded-2xl bg-blue-50 p-5"><h3 className="font-extrabold">Career Memory Review</h3><p className="mt-2 text-sm text-gray-600">Source: {memoryData.resumeSource === "uploaded" ? "Uploaded Resume" : "Built From Scratch"}</p>{memoryData.uploadedResumeName && <p className="mt-1 text-sm font-bold text-blue-700">Uploaded: {memoryData.uploadedResumeName}</p>}<p className="mt-3 text-sm font-semibold text-slate-600">Required sections: {requiredCount}/3 · Overall strength: {memoryStrength()}%</p></div>{renderStyleSettings()}{renderFullResumePreview()}</div>;
  }

  return (
    <main className="min-h-screen bg-[#f6fbff] text-gray-900">
       {coverLetterPreview && (
  <div className="fixed inset-0 z-50 overflow-auto bg-white p-10">

    <button
      onClick={() => setCoverLetterPreview(false)}
      className="mb-6 rounded-xl border border-blue-600 px-5 py-3 font-bold text-blue-600"
    >
      ← Back
    </button>

    <h1 className="mb-8 text-3xl font-black">
      Cover Letter Preview
    </h1>

    {renderCoverLetterPreview()}

  </div>
)}
      <div className="flex min-h-screen">
  <aside className="w-60 border-r border-blue-100 bg-white px-5 py-6">
  <div className="flex items-center justify-between">
    <a href="/dashboard">
      <Image
        src="/logo.png"
        alt="Career Élan"
        width={120}
        height={45}
      />
    </a>

    <span className="text-gray-400">‹</span>
  </div>

    <p className="mt-8 text-xs font-bold uppercase tracking-wider text-gray-400">
      Overview
    </p>

    <nav className="mt-4 space-y-2">
      {[
        "Dashboard",
        "Career Memory",
        "Find Jobs",
        "Create Package",
        "Job Tracker",
        "Analytics",
        "Settings",
      ].map((item) => {
        const isLocked = false;

        const icon =
          item === "Dashboard"
            ? "🏠"
            : item === "Career Memory"
            ? "🧠"
            : item === "Find Jobs"
            ? "🔍"
            : item === "Create Package"
            ? "📦"
            : item === "Job Tracker"
            ? "💼"
            : item === "Analytics"
            ? "📊"
            : "⚙️";

        return (
          <button
            key={item}
            type="button"
            onClick={() => handleProtectedNav(item)}
            className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${
  item === "Career Memory"
    ? "bg-blue-600 text-white"
    : "text-gray-600 hover:bg-blue-50 hover:text-blue-600"
}`}
          >
            <span>{icon}</span>

            <span className="flex-1">{item}</span>

           
          </button>
        );
      })}
    </nav>
  </aside>

        <section className="flex-1 px-8 py-6">
          {mode === "start" ? (
            <StartScreen
  strength={profileStrength}
  requiredCount={requiredCount}
  coverLetterUploadError={coverLetterUploadError}
  setCoverLetterUploadError={setCoverLetterUploadError}
  canUseService={canUseService()}
            onImport={() => setMode("import")}
            isUnlocked={isUnlocked}
            onBuild={() => setMode("build")}
            onContinue={continueToDashboard}
            onSaveCoverLetter={async () => {
  await persistMemory();
  alert("Cover Letter saved.");
  continueToDashboard();
}}
            coverLetterInputRef={coverLetterInputRef}
            handleCoverLetterUpload={handleCoverLetterUpload}
            coverLetterImportStage={coverLetterImportStage}
            coverLetterUploadProgress={coverLetterUploadProgress}
            coverLetterImportMessage={coverLetterImportMessage}
            coverLetterPreview={coverLetterPreview}
            setCoverLetterPreview={setCoverLetterPreview}
          />
          ) : (
            <>
              <header className="mb-8 flex items-center justify-between">
  <div>
    <h1 className="text-3xl font-extrabold">
      Career Memory
    </h1>

    <p className="mt-1 text-sm text-gray-500">
      Your career database. AI uses this information to create
      company-specific application packages.
    </p>
  </div>

  <button
    type="button"
    onClick={saveMemory}
    className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white"
  >
    Save Memory
  </button>
</header>

{renderRequiredBanner()}

{mode === "import" && (
  <div className="rounded-2xl border border-blue-100 bg-white p-10 shadow-sm">
    <button
      type="button"
      onClick={() => {
        setMode("start");
        setImportStage("idle");
      }}
      className="mb-6 font-bold text-blue-600"
    >
      ← Back
    </button>

    {importStage === "preview" ? (
      renderFullResumePreview()
    ) : (
      <>
        <h2 className="text-3xl font-extrabold">
          Import Resume
        </h2>

        <p className="mt-3 text-gray-500">
          Upload your existing resume. Career Élan will extract your
          information and build your Career Memory.
        </p>

       <input
  ref={fileInputRef}
  type="file"
  accept=".pdf,.docx"
  className="hidden"
  onChange={handleResumeUpload}
/>

       <div
  onDragOver={handleResumeDragOver}
  onDragEnter={handleResumeDragOver}
  onDragLeave={handleResumeDragLeave}
  onDrop={handleResumeDrop}
  className={`mt-8 rounded-2xl border-2 border-dashed p-16 text-center transition ${
    isResumeDragging
      ? "border-blue-600 bg-blue-100 shadow-lg"
      : "border-blue-200 bg-blue-50"
  }`}
>
  <div className="text-6xl">
    {isResumeDragging ? "⬇️" : "📄"}
  </div>

  <h3 className="mt-5 text-xl font-bold">
    {isResumeDragging
      ? "Drop your resume now"
      : "Drop your resume here"}
  </h3>

  <p className="mt-2 text-sm text-gray-500">
    PDF or DOCX · Maximum 10MB
  </p>

  <button
    type="button"
    onClick={() => fileInputRef.current?.click()}
    className="mt-6 rounded-xl bg-blue-600 px-6 py-3 font-bold text-white"
  >
    Browse Files
  </button>
</div>

        {importStage !== "idle" && (
          <ParsingStatus
            stage={importStage}
            requiredCount={requiredCount}
            progress={uploadProgress}
          />
        )}

        {importMessage && (
          <p className="mt-5 rounded-xl bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">
            {importMessage}
          </p>
        )}
         
         {resumeUploadError && (
  <div
    role="alert"
    className="mt-5 rounded-xl border border-red-300 bg-red-50 px-5 py-4"
  >
    <p className="font-black text-red-700">
      Resume upload failed
    </p>

    <p className="mt-1 text-sm leading-6 text-red-600">
      {resumeUploadError}
    </p>

    <button
      type="button"
      onClick={() => setResumeUploadError("")}
      className="mt-3 text-sm font-bold text-red-700 underline"
    >
      Dismiss
    </button>
  </div>
)}

        {renderStyleSettings()}

        <div className="mt-8 flex justify-end gap-3">
          <button
            type="button"
            onClick={continueToImportPreview}
            disabled={importStage !== "parsed"}
            className={`rounded-xl border px-6 py-3 font-bold ${
              importStage === "parsed"
                ? "border-blue-600 text-blue-600"
                : "cursor-not-allowed border-slate-200 text-slate-400"
            }`}
          >
            Continue to Preview →
          </button>

          <button
            type="button"
            onClick={continueToDashboard}
            className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white"
          >
            Continue to Dashboard
          </button>
        </div>
      </>
    )}
  </div>
)}

{mode === "build" && (
  <>
    <div className="mb-8 rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
      <button
        type="button"
        onClick={() => setMode("start")}
        className="mb-4 font-bold text-blue-600"
      >
        ← Back
      </button>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">
            Profile Progress
          </h2>

          <p className="text-sm text-gray-500">
            Step {currentStep + 1} of {steps.length} ·{" "}
            {steps[currentStep].title}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="rounded-full bg-green-50 px-4 py-2 text-sm font-bold text-green-700">
            Recommended {requiredCount}/3
          </span>

          <span className="rounded-full bg-blue-100 px-4 py-2 text-sm font-bold text-blue-700">
            {progress}% Complete
          </span>
        </div>
      </div>

      <div className="mt-5 h-3 rounded-full bg-gray-100">
        <div
          className="h-3 rounded-full bg-blue-600"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>

    <div className="grid grid-cols-12 gap-6">
      <aside className="col-span-12 rounded-2xl border border-blue-100 bg-white p-5 shadow-sm xl:col-span-3">
        <h2 className="text-lg font-bold">
          Steps
        </h2>

        <div className="mt-5 space-y-2">
          {steps.map((step, index) => (
            <button
              key={step.title}
              type="button"
              onClick={() => setCurrentStep(index)}
              className={`w-full rounded-xl px-4 py-3 text-left transition ${
                index === currentStep
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 hover:bg-blue-50"
              }`}
            >
              <p className="flex items-center justify-between text-sm font-bold">
                <span>
                  {index + 1}. {step.title}
                </span>

                {step.required && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                      index === currentStep
                        ? "bg-white/15 text-white"
                        : "bg-blue-50 text-blue-600"
                    }`}
                  >
                    Recommended
                  </span>
                )}
              </p>

              <p
                className={`mt-1 text-xs leading-5 ${
                  index === currentStep
                    ? "text-blue-100"
                    : "text-gray-400"
                }`}
              >
                {step.description}
              </p>
            </button>
          ))}
        </div>
      </aside>

      <section
        className={`col-span-12 space-y-6 ${
          isReviewStep
            ? "xl:col-span-9"
            : "xl:col-span-6"
        }`}
      >
        <div className="rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">
            {steps[currentStep].title}
          </h2>

          <p className="mt-2 text-sm text-gray-500">
            {steps[currentStep].description}
          </p>

          {renderStepForm()}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={continueToDashboard}
              className="rounded-xl border border-blue-600 px-6 py-3 font-bold text-blue-600"
            >
              Continue to Dashboard
            </button>

            <button
              type="button"
              onClick={handleSaveAndContinue}
              className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white"
            >
              {currentStep === steps.length - 1
                ? "Finish Memory"
                : "Save & Continue →"}
            </button>
          </div>
        </div>
      </section>

      {!isReviewStep && (
        <aside className="col-span-12 space-y-6 xl:col-span-3">
          <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">
              Memory Strength
            </h2>

            <p className="mt-2 text-sm text-gray-500">
              More complete information creates better AI results.
            </p>

            <div className="mt-5 h-2 rounded-full bg-gray-100">
              <div
                className="h-2 rounded-full bg-blue-600"
                style={{ width: `${strength}%` }}
              />
            </div>

            <p className="mt-3 text-sm font-bold text-blue-600">
              {strength}% Overall · Recommended {requiredCount}/3
            </p>
          </div>

          <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">
              Recommended Information
            </h2>

            <div className="mt-4 space-y-3 text-sm font-semibold text-gray-600">
              <RequiredLine
                done={hasPersonalInfo()}
                text="Personal Information"
              />

              <RequiredLine
                done={hasExperience()}
                text="Experience"
              />

              <RequiredLine
                done={hasSkills()}
                text="Skills"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">
              Selected Style
            </h2>

            <div className="mt-4 space-y-2 text-sm font-semibold text-gray-600">
              <p>📄 {memoryData.resumeTemplate}</p>
              <p>✉️ {memoryData.coverLetterTemplate}</p>
              <p>🎨 {memoryData.themeColor}</p>
              <p>🔤 {memoryData.font}</p>
              <p>🔎 {memoryData.textSize}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">
              This Memory Powers
            </h2>

            <div className="mt-4 space-y-3 text-sm font-semibold text-gray-600">
              <p>📦 Application Packages</p>
              <p>📄 Resume Generation</p>
              <p>✉️ Cover Letter Generation</p>
              <p>🎯 Job URL Analysis</p>
            </div>
          </div>
        </aside>
      )}
    </div>
  </>
)}

            </>
          )}
        </section>
      </div>
    </main>
  );
}

function StartScreen({
  strength,
  requiredCount,
  coverLetterUploadError,
  setCoverLetterUploadError,
  canUseService,
  isUnlocked,
  onImport,
  onBuild,
  onContinue,
  onSaveCoverLetter,
  coverLetterInputRef,
  handleCoverLetterUpload,
  coverLetterImportStage,
  coverLetterUploadProgress,
  coverLetterImportMessage,
  coverLetterPreview,
  setCoverLetterPreview,
}: {
  strength: number;
requiredCount: number;

coverLetterUploadError: string;

setCoverLetterUploadError: React.Dispatch<
  React.SetStateAction<string>
>;

canUseService: boolean;
  isUnlocked: boolean;
  onImport: () => void;
  onBuild: () => void;
  onContinue: () => void;
  onSaveCoverLetter: () => void;

  coverLetterInputRef: React.RefObject<HTMLInputElement | null>;

  handleCoverLetterUpload: (
    event: React.ChangeEvent<HTMLInputElement>
  ) => void;

  coverLetterImportStage:
    "idle" | "uploaded" | "parsing" | "parsed";

  coverLetterUploadProgress: number;

  coverLetterImportMessage: string;
  coverLetterPreview: boolean;

 setCoverLetterPreview: React.Dispatch<
  React.SetStateAction<boolean>
>;
}) {
  return (
    <div className="mx-auto max-w-[1280px]">
      <div className="mb-8 flex items-start justify-between gap-6"><div><h1 className="text-4xl font-black tracking-tight text-slate-950">Build Your Career Memory ✨</h1><p className="mt-3 max-w-2xl text-base leading-7 text-slate-500">Complete the required sections first. Then Career Élan can create resumes, cover letters, and job application packages from your profile.</p></div><div className="hidden text-sm text-slate-500 lg:block">Need help?⌄</div></div>
      <div className="mb-6 rounded-3xl border border-blue-100 bg-white p-5 shadow-sm"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-sm font-black uppercase tracking-wide text-blue-600">CREATE RESUME</p><h2 className="mt-1 text-2xl font-black text-slate-950">Required sections: {requiredCount}/3</h2><p className="mt-2 text-sm leading-6 text-slate-500">Personal Information, Experience, and Skills are enough to start. Optional sections can be completed later.</p></div><button onClick={onContinue} className="rounded-xl bg-blue-600 px-6 py-4 font-black text-white">Continue  →</button></div></div>
      <div className="space-y-6">
  {/* Import Resume */}
  <button
    type="button"
    onClick={onImport}
    className="w-full rounded-3xl border-2 border-blue-600 bg-blue-600 p-8 text-left text-white shadow-lg shadow-blue-100 transition hover:-translate-y-1 hover:bg-blue-700 hover:shadow-xl"
  >
    <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-5">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-4xl">
          ☁️
        </div>

        <div>
          <h2 className="text-2xl font-black">
              Import Your Resume ✨
          </h2>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-100">
            Save time by uploading your existing resume. Career Élan instantly converts it into your complete Career Memory.
          </p>

          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-white">
            <p>✓ Work Experience</p>
            <p>✓ Skills</p>
            <p>✓ Education</p>
            <p>✓ Projects</p>
            <p>✓ Certifications</p>
            <p>✓ Achievements</p>
          </div>
        </div>
      </div>

      <div className="shrink-0 rounded-xl bg-white px-7 py-4 text-center font-black text-blue-600">
        Upload Resume
      </div>
    </div>
  </button>

  {/* Cover Letter */}
  <div className="rounded-3xl border border-purple-400 bg-gradient-to-r from-purple-200 to-violet-200 p-6 shadow-md">
    <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-5">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-purple-50 text-4xl">
          ✉️
        </div>

        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black">
              Cover Letter
            </h2>

            <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-bold text-purple-700">
              Optional
            </span>
          </div>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
            Upload your existing cover letter, or let Career Élan create a tailored one for every job you apply to.
          </p>

          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-slate-600">
            <p>✓ Use in Generate Package</p>
            <p>✨ Tailored automatically</p>
            <p>📝 Edit and reuse anytime</p>
          </div>
        </div>
      </div>

      <div className="shrink-0">
        <input
          ref={coverLetterInputRef}
          type="file"
          accept=".pdf,.docx,.txt"
          className="hidden"
          onChange={handleCoverLetterUpload}
        />

        <button
          type="button"
          onClick={() => coverLetterInputRef.current?.click()}
          className="rounded-xl border-2 border-purple-300 bg-purple-50 px-7 py-4 font-black text-purple-700 transition hover:bg-purple-100"
        >
          Upload Cover Letter
        </button>
      </div>
    </div>

    {coverLetterImportStage !== "idle" && (
      <ParsingStatus
        stage={coverLetterImportStage}
        requiredCount={requiredCount}
        progress={coverLetterUploadProgress}
        type="coverLetter"
      />
    )}

    {coverLetterImportStage === "parsed" && (
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={() => setCoverLetterPreview(true)}
          className="rounded-xl border border-blue-600 px-6 py-3 font-bold text-blue-600"
        >
          Preview
        </button>

        <button
          type="button"
          onClick={onSaveCoverLetter}
          className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white"
        >
          Save & Continue
        </button>
      </div>
    )}

    {coverLetterImportMessage && (
      <p className="mt-4 rounded-xl bg-purple-50 px-4 py-3 text-sm font-bold text-purple-700">
        {coverLetterImportMessage}
      </p>
      
    )}
    {coverLetterUploadError && (
  <div
    role="alert"
    className="mt-4 rounded-xl border border-red-300 bg-red-50 px-5 py-4"
  >
    <p className="font-black text-red-700">
      Cover Letter upload failed
    </p>

    <p className="mt-1 text-sm leading-6 text-red-600">
      {coverLetterUploadError}
    </p>

    <button
      type="button"
      onClick={() => setCoverLetterUploadError("")}
      className="mt-3 text-sm font-bold text-red-700 underline"
    >
      Dismiss
    </button>
  </div>
)}
  </div>

  {/* No Resume */}
  <button
    type="button"
    onClick={onBuild}
    className="w-full rounded-3xl border border-blue-100 bg-white p-8 text-left shadow-sm transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-xl"
  >
    <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-5">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-4xl">
          ✎
        </div>

        <div>
          <h2 className="text-2xl font-black">
            Create Resume
          </h2>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
            Create a professional resume in minutes. Career Élan generate personalized application packages instantly.
          </p>

          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-slate-600">
            <p>✓ Build step-by-step</p>
            <p>✓ Save and continue anytime</p>
            <p>✓ Complete optional sections later</p>
          </div>
        </div>
      </div>

      <div className="shrink-0 rounded-xl border border-blue-600 px-7 py-4 text-center font-black text-blue-600">
        Start Building
      </div>
    </div>
  </button>
</div>
      <div className="mt-8 rounded-3xl border border-blue-100 bg-white p-6 shadow-sm"><h3 className="text-center text-lg font-black text-slate-950">What happens after this?</h3><div className="mt-6 grid gap-5 md:grid-cols-4"><FlowStep number="1" icon="⇧" title="Add Required Info" body="Personal information, experience, and skills." /><FlowStep number="2" icon="🧠" title="Career Memory Learns You" body="AI organizes your career information." /><FlowStep number="3" icon="🔗" title="Find or Paste Any Job URL" body="Search jobs inside Career Élan or Paste any job URL you want to apply to" /><FlowStep number="4" icon="📄 ✉️" title="Get Your Tailored Package" body="Resume, cover letter, and email ready in seconds." /></div></div><div className="mt-6 grid gap-4 rounded-3xl border border-blue-100 bg-white p-5 shadow-sm md:grid-cols-4"><TrustItem icon="🛡️" title="Trusted by job seekers" body="worldwide" /><TrustItem icon="🔒" title="Your privacy" body="is our priority" /><TrustItem icon="👥" title="Join professionals" body="getting more interviews" /><TrustItem icon="☆" title="AI-Powered" body="Human-Focused. Results-Driven." /></div>
    </div>
  );
}

function ParsingStatus({
  stage,
  requiredCount,
  progress,
  type = "resume",
}: {
  stage: ImportStage;
  requiredCount: number;
  progress: number;
  type?: "resume" | "coverLetter";
}) {
  return (
    <div className="mt-6 rounded-3xl border border-blue-100 bg-white p-8 shadow-sm">

      <div className="flex flex-col items-center">

        {stage === "parsing" ? (
          <div className="h-24 w-24 rounded-full border-[8px] border-blue-200 border-t-blue-600 animate-spin" />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-green-100 text-5xl">
            ✓
          </div>
        )}

        <h2 className="mt-8 text-3xl font-extrabold text-slate-900">
          {stage === "parsing"
  ? (type === "resume"
      ? "Career Élan is analyzing your resume"
      : "Career Élan is analyzing your cover letter")
  : (type === "resume"
      ? "Resume analyzed successfully"
      : "Cover Letter analyzed successfully")}
        </h2>
        <p className="mt-3 text-2xl font-bold text-blue-600">
           {progress}%
        </p>
        <p className="mt-3 text-center text-gray-500 max-w-xl">
          {stage === "parsing"
  ? (type === "resume"
      ? "Extracting your experience, education, skills and building your Career Memory."
      : "Extracting your cover letter and identifying its sections.")
  : (type === "resume"
      ? "Your Career Memory has been created successfully."
      : "Your cover letter has been imported successfully.")}
        </p>

        <div className="mt-10 w-full max-w-xl space-y-4">

          <Step
            done={stage !== "parsing"}
            title="Reading document"
          />

          <Step
            done={stage !== "parsing"}
            title="Extracting text"
          />

          <Step
            loading={stage === "parsing"}
            done={stage !== "parsing"}
            title="Understanding experience"
          />

          <Step
            done={stage !== "parsing"}
            title="Identifying skills"
          />

          <Step
            done={stage !== "parsing"}
            title="Parsing education"
          />

          <Step
            done={stage !== "parsing"}
            title="Building Career Memory"
          />

        </div>

      </div>
    </div>
  );
}
function ResumeSection({ title, children }: { title: string; children: ReactNode }) { return <section className="mt-7 text-sm leading-6 text-slate-700"><h2 className="mb-3 border-b border-slate-200 pb-2 text-sm font-black uppercase tracking-[0.16em] text-slate-950">{title}</h2>{children}</section>; }
function RequiredStatus({ done, title }: { done: boolean; title: string }) { return <div className={`rounded-xl border px-4 py-3 text-sm font-bold ${done ? "border-green-200 bg-green-50 text-green-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{done ? "✓" : "○"} {title}</div>; }
function RequiredLine({ done, text }: { done: boolean; text: string }) { return <p className={done ? "text-green-700" : "text-slate-500"}>{done ? "✓" : "○"} {text}</p>; }
function FlowStep({ number, icon, title, body }: { number: string; icon: string; title: string; body: string }) { return <div className="relative rounded-2xl bg-white p-4"><div className="absolute -top-3 left-0 flex h-7 w-7 items-center justify-center rounded-full bg-green-600 text-xs font-black text-white">{number}</div><div className="flex gap-4"><div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-blue-100 bg-white text-3xl text-blue-600">{icon}</div><div><p className="font-black text-slate-950">{title}</p><p className="mt-2 text-xs leading-5 text-slate-500">{body}</p></div></div></div>; }
function TrustItem({ icon, title, body }: { icon: string; title: string; body: string }) { return <div className="flex items-center gap-4 border-slate-100 px-3 md:border-r last:border-r-0"><div className="text-3xl text-blue-600">{icon}</div><div><p className="text-sm font-bold text-slate-700">{title}</p><p className="text-sm text-slate-500">{body}</p></div></div>; }
function Select({ label, value, onChange, items }: { label: string; value: string; onChange: (value: string) => void; items: string[] }) { return <div><label className="text-sm font-bold text-gray-600">{label}</label><select value={value} onChange={(e) => onChange(e.target.value)} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600">{items.map((item) => <option key={item}>{item}</option>)}</select></div>; }
function Input({ placeholder, value, onChange, className = "" }: { placeholder: string; value: string; onChange: (value: string) => void; className?: string }) { return <input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className={`rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600 ${className}`} />; }
function Textarea({ placeholder, value, onChange, rows, className = "" }: { placeholder: string; value: string; onChange: (value: string) => void; rows: number; className?: string }) { return <textarea rows={rows} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className={`rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600 ${className}`} />; }
function MonthInput({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-700">
        {label}
      </span>

      <input
        type="month"
        value={value}
        disabled={disabled}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
      />
    </label>
  );
}
function ArraySection<T extends object>({ title, items, section, emptyItem, addLabel, removeItem, addItem, render }: { title: string; items: T[]; section: keyof CareerMemoryData; emptyItem: object; addLabel: string; removeItem: (section: keyof CareerMemoryData, index: number) => void; addItem: (section: keyof CareerMemoryData, emptyItem: object) => void; render: (item: T, index: number) => ReactNode }) { return <div className="mt-6 space-y-5">{items.map((item, index) => <div key={index} className="rounded-2xl border border-gray-100 bg-slate-50 p-5"><div className="mb-4 flex items-center justify-between"><h3 className="font-bold">{title} #{index + 1}</h3><button onClick={() => removeItem(section, index)} className="text-sm font-bold text-red-500">Remove</button></div>{render(item, index)}</div>)}<button onClick={() => addItem(section, emptyItem)} className="rounded-xl border border-blue-600 px-5 py-3 font-bold text-blue-600">{addLabel}</button></div>; }
function Step({
  title,
  done,
  loading,
}: {
  title: string;
  done?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 p-4">

      {done ? (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500 text-white">
          ✓
        </div>
      ) : loading ? (
        <div className="h-8 w-8 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300">
          ○
        </div>
      )}

      <span className="font-semibold">{title}</span>

    </div>
  );
}