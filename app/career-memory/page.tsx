"use client";

import Image from "next/image";
import { ChangeEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
const steps = [
  { title: "Personal Information", description: "Required. Your contact information and professional summary used across every application.", required: true },
  { title: "Education", description: "Optional. Schools, degrees, GPA, coursework, and academic achievements that strengthen your profile.", required: false },
  { title: "Experience", description: "Required. Add work, volunteer, internship, co-op, or other relevant experience. Career Élan uses this to build stronger resume bullets.", required: true },
  { title: "Skills", description: "Required. Technical skills, software, legal knowledge, customer service, and other professional abilities.", required: true },
  { title: "Languages", description: "Optional. Languages you speak and your proficiency level, such as English, French, or Korean.", required: false },
  { title: "Certifications", description: "Optional. Professional certifications, licenses, awards, and completed training.", required: false },
  { title: "Projects", description: "Optional. School, personal, volunteer, or professional projects that showcase your experience.", required: false },
  { title: "Career Goals", description: "Optional. Tell AI your target industry, preferred roles, locations, salary expectations, and long-term goals.", required: false },
  { title: "Review & Templates", description: "Review your Career Memory and choose resume and cover letter styles.", required: false },
];

const resumeTemplates = ["Classic", "Modern", "Professional", "Minimal", "Creative"];
const coverLetterTemplates = ["Classic Letter", "Modern Letter", "Executive", "Government Style", "Minimal Letter"];
const themeColors = ["Blue", "Green", "Navy", "Black", "Gray"];
const fonts = ["Arial", "Calibri", "Helvetica", "Times New Roman", "Georgia"];
const layouts = ["One Column", "Two Column"];
const tones = ["Formal", "Warm", "Confident", "Government", "Concise"];

type EducationItem = { school: string; program: string; dates: string; gpa: string; coursework: string };
type WorkItem = { company: string; jobTitle: string; dates: string; description: string };
type VolunteerItem = { organization: string; role: string; dates: string; description: string };
type LanguageItem = { language: string; level: string };
type CertificationItem = { name: string; issuer: string; date: string; description: string };
type ProjectItem = { name: string; role: string; dates: string; description: string };

type CareerMemoryData = {
  firstName: string; lastName: string; email: string; phone: string; location: string; linkedin: string; headline: string; summary: string;
  education: EducationItem[]; workExperience: WorkItem[]; volunteerExperience: VolunteerItem[]; skills: string; languages: LanguageItem[]; certifications: CertificationItem[]; projects: ProjectItem[];
  targetRoles: string; targetIndustry: string; targetLocation: string; salaryExpectation: string; careerGoalSummary: string;
  uploadedResumeName: string; uploadedResumeText: string; resumeSource: "uploaded" | "built";
  resumeTemplate: string; coverLetterTemplate: string; themeColor: string; font: string; layout: string; coverLetterTone: string; applySameStyleToCoverLetter: boolean;
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

const emptyEducation = { school: "", program: "", dates: "", gpa: "", coursework: "" };
const emptyWork = { company: "", jobTitle: "", dates: "", description: "" };
const emptyVolunteer = { organization: "", role: "", dates: "", description: "" };
const emptyLanguage = { language: "", level: "" };
const emptyCertification = { name: "", issuer: "", date: "", description: "" };
const emptyProject = { name: "", role: "", dates: "", description: "" };

const defaultMemoryData: CareerMemoryData = {
  firstName: "", lastName: "", email: "", phone: "", location: "", linkedin: "", headline: "", summary: "",
  education: [emptyEducation], workExperience: [emptyWork], volunteerExperience: [emptyVolunteer], skills: "", languages: [emptyLanguage], certifications: [emptyCertification], projects: [emptyProject],
  targetRoles: "", targetIndustry: "", targetLocation: "", salaryExpectation: "", careerGoalSummary: "",
  uploadedResumeName: "", uploadedResumeText: "", resumeSource: "built",
  resumeTemplate: "Professional", coverLetterTemplate: "Classic Letter", themeColor: "Navy", font: "Calibri", layout: "One Column", coverLetterTone: "Formal", applySameStyleToCoverLetter: true,
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
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"start" | "import" | "build">("start");
  const [currentStep, setCurrentStep] = useState(0);
  const [memoryData, setMemoryData] = useState<CareerMemoryData>(defaultMemoryData);
  const [coverLetterUploadProgress, setCoverLetterUploadProgress] =
  useState(0);
 
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
  

  if (!user) return;

  const { data, error } = await supabase
    .from("career_memory")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error || !data) return;
   
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

    education: data.education ?? [],
    workExperience: data.experience ?? [],
    languages: data.languages ?? [],
    certifications: data.certifications ?? [],
    projects: data.projects ?? [],

    resumeTemplate: data.resume_template ?? "Professional",
    coverLetterTemplate: data.cover_template ?? "Classic Letter",
    themeColor: data.theme ?? "Navy",
    font: data.font ?? "Calibri",
    layout: data.layout ?? "One Column",
    coverLetterTone: data.tone ?? "Formal",
  }));
   

  setIsUnlocked(data.required_completed ?? false);
}
  
  useEffect(() => {
    return () => {
      if (uploadedResumeUrl) URL.revokeObjectURL(uploadedResumeUrl);
    };
  }, [uploadedResumeUrl]);
  useEffect(() => {
  loadCareerMemory();
 }, []);

  function updateMemory(field: keyof CareerMemoryData, value: string | boolean) {
    setMemoryData((prev) => ({ ...prev, [field]: value }));
  }

  function updateArrayItem<T extends object>(section: keyof CareerMemoryData, index: number, field: keyof T, value: string) {
    setMemoryData((prev) => {
      const items = [...(prev[section] as T[])];
      items[index] = { ...items[index], [field]: value };
      return { ...prev, [section]: items };
    });
  }

  function addItem(section: keyof CareerMemoryData, emptyItem: object) {
    setMemoryData((prev) => ({ ...prev, [section]: [...(prev[section] as object[]), { ...emptyItem }] }));
  }

  function removeItem(section: keyof CareerMemoryData, index: number) {
    setMemoryData((prev) => {
      const items = [...(prev[section] as object[])];
      if (items.length === 1) return prev;
      items.splice(index, 1);
      return { ...prev, [section]: items };
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
    if (hasPersonalInfo()) score += 30;
    if (hasExperience()) score += 35;
    if (hasSkills()) score += 25;
    if (memoryData.education.some((x) => x.school?.trim() || x.program?.trim())) score += 2;

    if (memoryData.languages.some((x) => x.language?.trim())) score += 2;

    if (memoryData.certifications.some((x) => x.name?.trim())) score += 2;

    if (memoryData.projects.some((x) => x.name?.trim())) score += 2;

    if (memoryData.targetRoles?.trim() || memoryData.careerGoalSummary?.trim()) score += 2;
    return Math.min(score, 100);
  }

  const strength = memoryStrength();
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
      languages: memoryData.languages,
      certifications: memoryData.certifications,
      projects: memoryData.projects,

      resume_template: memoryData.resumeTemplate,
      cover_template: memoryData.coverLetterTemplate,
      theme: memoryData.themeColor,
      font: memoryData.font,
      layout: memoryData.layout,
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
console.log("CAREER MEMORY DATA =", data);
console.log("CAREER MEMORY ERROR =", error);

if (error) {
  alert(error.message);
}
}

  async function saveMemory() {
  console.log("SAVE CLICKED");

  await persistMemory();

  alert("Career Memory saved.");
}

  async function continueToDashboard() {
    
    await persistMemory();
router.push("/dashboard");
    async function saveCoverLetter() {
  persistMemory();

  alert("Cover Letter saved.");

  continueToDashboard();
}
  }

  function handleProtectedNav(item: string) {
    if (item === "Career Memory") return;
    if (item === "Job Tracker" || item === "Settings") {
      router.push(item === "Job Tracker" ? "/job-tracker" : "/settings");
      return;
    }
    const path = item === "Dashboard" ? "/dashboard" : item === "Create Package" ? "/create-package" : item === "Analytics" ? "/analytics" : "#";
    if (!isUnlocked) {
      setLockedMessage(`${item} is locked until you complete Personal Information, Experience, and Skills.`);
      return;
    }
    router.push(path);
  }

  function handleSaveAndContinue() {
    persistMemory();
    if (canUseService() && [0, 2, 3].includes(currentStep)) {
      const goNow = window.confirm("Required Career Memory sections are complete. Continue to Dashboard now?");
      if (goNow) {
        continueToDashboard();
        return;
      }
    }
    if (currentStep < steps.length - 1) setCurrentStep(currentStep + 1);
    else {
      if (canUseService()) continueToDashboard();
      else alert("Career Memory saved. Complete the required sections to unlock Dashboard.");
    }
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
      firstName: prev.firstName || nameParts[0] || "",
      lastName: prev.lastName || nameParts.slice(1).join(" ") || "",
      email: prev.email || email,
      phone: prev.phone || phone,
      headline: prev.headline || lines.find((line) => !line.includes("@") && line.length < 60 && line !== firstLine) || "",
      summary: prev.summary || lines.slice(1, 5).join(" ").slice(0, 700),
      workExperience: prev.workExperience.some((x) => x.company || x.jobTitle || x.description)
        ? prev.workExperience
        : [{ company: "", jobTitle: experienceLine || "Experience from uploaded resume", dates: "", description: text.slice(0, 900) }],
      education: prev.education.some((x) => x.school || x.program)
        ? prev.education
        : [{ school: educationLine, program: "", dates: "", gpa: "", coursework: "" }],
      skills: prev.skills || skillsLine.replace(/skills?:?/i, "").trim() || "Extracted from uploaded resume. Review and edit your skills before continuing.",
      uploadedResumeText: text,
    }));
  }

  async function handleResumeUpload(event: ChangeEvent<HTMLInputElement>) {
  const file = event.target.files?.[0];
  if (!file) return;
 

if (!user) {
  alert("Please sign in.");
  return;
}
  const formData = new FormData();
  formData.append("file", file);
 const path = `${user.id}/${Date.now()}-${file.name}`;

const { error: uploadError } = await supabase.storage
  .from("resumes")
  .upload(path, file, {
    upsert: true,
  });

if (uploadError) {
  alert(uploadError.message);
  return;
}

  setImportStage("parsing");
  setImportMessage("Career Élan is analyzing your resume");
  setUploadProgress(12);
  await new Promise((r) => setTimeout(r, 250));
  setUploadProgress(28);
  const response = await fetch("/api/analyze-resume", {
    method: "POST",
    body: formData,
  });

  const result = await response.json();
  console.log("RESULT =", result);
console.log("ORIGINAL =", result.data?.originalText);
console.log("TYPE =", typeof result.data?.originalText);
  setUploadProgress(47);
  await new Promise((r) => setTimeout(r, 250));
  if (result.success) {
    setUploadProgress(72);
    await new Promise((r) => setTimeout(r, 250));
    setMemoryData((prev) => ({
      ...prev,
      ...result.data,
    }));
     const { data, error } = await supabase
  .from("resumes")
  .upsert({
    user_id: user.id,
    file_name: file.name,
    storage_path: path,
    original_text: result.data.originalText,
    parsed_data: result.data,
    is_default: true,
  });

console.log("RESUME DATA =", data);
console.log("RESUME ERROR =", error);

if (error) {
  alert(error.message);
}

   setUploadProgress(91);
   await new Promise((r) => setTimeout(r, 250));

   setUploadProgress(100);
    setImportStage("parsed");
    setImportMessage("Resume analyzed successfully.");
    return;
  } else {
    alert(result.message);
    return;
  }
    
  }
  async function handleCoverLetterUpload(
  event: ChangeEvent<HTMLInputElement>
) {
  const file = event.target.files?.[0];

  if (!file) return;
 

if (!user) {
  alert("Please sign in.");
  return;
}
  const path = `${user.id}/${Date.now()}-${file.name}`;

const { error: uploadError } = await supabase.storage
  .from("cover-letters")
  .upload(path, file, {
    upsert: true,
  });

if (uploadError) {
  alert(uploadError.message);
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

  const result = await response.json();

  if (!result.success) {
    alert(result.message);
    return;
  }
  const { error } = await supabase
  .from("cover_letters")
  .upsert({
    user_id: user.id,
    file_name: file.name,
    storage_path: path,
    original_text: result.data.originalText,
    parsed_data: result.data,
    is_default: true,
  });

if (error) {
  alert(error.message);
  return;
}

  setMemoryData((prev) => ({
    ...prev,

    uploadedCoverLetterName: file.name,

    uploadedCoverLetterText:
      result.data.originalText,

    coverLetterSource: "uploaded",

    recipient: result.data.recipient,

    company: result.data.company,

    jobTitle: result.data.jobTitle,

    greeting: result.data.greeting,

    body: result.data.body,

    closing: result.data.closing,

    signature: result.data.signature,

    coverLetterTone:
      result.data.tone ||
      prev.coverLetterTone,
  }));

  setCoverLetterUploadProgress(100);

  setCoverLetterImportStage("parsed");

  setCoverLetterImportMessage(
    "Cover Letter analyzed successfully."
  );
}


  function getThemeClass() {
    if (memoryData.themeColor === "Green") return "border-green-600 text-green-700";
    if (memoryData.themeColor === "Blue") return "border-blue-600 text-blue-700";
    if (memoryData.themeColor === "Black") return "border-black text-black";
    if (memoryData.themeColor === "Gray") return "border-gray-500 text-gray-700";
    return "border-slate-800 text-slate-800";
  }

  function continueToImportPreview() {
    persistMemory();
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
          <Select label="Layout" value={memoryData.layout} onChange={(v) => updateMemory("layout", v)} items={layouts} />
          <Select label="Cover Letter Tone" value={memoryData.coverLetterTone} onChange={(v) => updateMemory("coverLetterTone", v)} items={tones} />
        </div>
        <label className="mt-5 flex items-center gap-3 text-sm font-bold text-gray-600">
          <input type="checkbox" checked={memoryData.applySameStyleToCoverLetter} onChange={(e) => updateMemory("applySameStyleToCoverLetter", e.target.checked)} />
          Apply the same style to resume and cover letter
        </label>
      </div>
    );
  }

  function renderResumePreview() {
    return (
      <div className={`mt-6 rounded-2xl border-2 bg-white p-6 shadow-sm ${getThemeClass()}`} style={{ fontFamily: memoryData.font }}>
        <div className="border-b pb-4">
          <h3 className="text-2xl font-extrabold">{memoryData.firstName || "First"} {memoryData.lastName || "Last"}</h3>
          <p className="mt-1 text-sm text-gray-600">{memoryData.email || "email@example.com"} · {memoryData.phone || "Phone"} · {memoryData.location || "Location"}</p>
          {memoryData.headline.trim() && (
         <p className="mt-2 font-bold">
          {memoryData.headline}
        </p>
  )}
        </div>
        <div className={memoryData.layout === "Two Column" ? "mt-5 grid gap-5 md:grid-cols-2" : "mt-5 space-y-5"}>
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
    if (template === "Professional") {
  return (
    <div className="mx-auto max-w-[760px] bg-white shadow-xl grid grid-cols-[180px_1fr]">

      <div className="bg-slate-900 text-white p-8">
        <h1 className="text-4xl font-black">
          {memoryData.firstName}<br />
          {memoryData.lastName}
        </h1>

        <div className="mt-8 text-sm space-y-2">
          <p>{memoryData.location}</p>
          <p>{memoryData.email}</p>
          <p>{memoryData.phone}</p>
          <p>{memoryData.linkedin}</p>
        </div>

        <div className="mt-10">
          <h3 className="font-bold uppercase tracking-widest">
            Skills
          </h3>

          <div className="mt-3 space-y-2 text-sm">
            {String(memoryData.skills || "")
              .split(",")
              .map(s=>s.trim())
              .filter(Boolean)
              .map((skill,i)=><p key={i}>• {skill}</p>)}
          </div>
        </div>
      </div>

      <div className="p-10">

        <ResumeSection title="Professional Summary">
          <p>{memoryData.summary}</p>
        </ResumeSection>

        <ResumeSection title="Experience">
          {memoryData.workExperience.filter(x=>x.company||x.jobTitle).map((x,i)=>(
            <div key={i} className="mb-6">

              <div className="flex justify-between">
                <h3 className="font-bold">{x.jobTitle}</h3>
                <span>{x.dates}</span>
              </div>

              <p className="text-slate-500 mb-2">
                {x.company}
              </p>

              <ul className="list-disc pl-6 space-y-2">
                {String(x.description)
                  .split(/\r?\n|•/)
                  .filter(Boolean)
                  .map((line,j)=><li key={j}>{line.trim()}</li>)}
              </ul>

            </div>
          ))}
        </ResumeSection>
           
        {memoryData.education.some(e => e.school || e.program) && (
  <ResumeSection title="Education">
    {memoryData.education.map((e, i) => (
      <div key={i} className="mb-4">
        <h3 className="font-bold">{e.program}</h3>
        <p>{e.school}</p>
      </div>
    ))}
  </ResumeSection>
)}
        
        {memoryData.languages.some(x => x.language.trim()) && (
  <ResumeSection title="Languages">
    {memoryData.languages
      .filter(x => x.language)
      .map((x, i) => (
        <div key={i} className="mb-2 flex justify-between">
          <span className="font-medium">{x.language}</span>
          <span className="text-slate-500">{x.level}</span>
        </div>
      ))}
  </ResumeSection>
)}
      
       
       {memoryData.certifications.some(x => x.name.trim()) && (
  <ResumeSection title="Certifications">
    {memoryData.certifications
      .filter(x => x.name)
      .map((x, i) => (
        <div key={i} className="mb-4">
          <div className="flex justify-between">
            <h3 className="font-bold">{x.name}</h3>
            <span>{x.date}</span>
          </div>

          <p className="text-slate-500">
            {x.issuer}
          </p>

          {x.description && (
            <p className="mt-2">{x.description}</p>
          )}
        </div>
      ))}
  </ResumeSection>
)}
     
     {memoryData.projects.some(x => x.name.trim()) && (
  <ResumeSection title="Projects">
    {memoryData.projects
      .filter(x => x.name)
      .map((x, i) => (
        <div key={i} className="mb-5">
          <div className="flex justify-between">
            <h3 className="font-bold">{x.name}</h3>
            <span>{x.dates}</span>
          </div>

          <p className="text-slate-500">
            {x.role}
          </p>

          <p className="mt-2">
            {x.description}
          </p>
        </div>
      ))}
  </ResumeSection>
)}
     {(
  memoryData.targetRoles ||
  memoryData.targetIndustry ||
  memoryData.targetLocation ||
  memoryData.salaryExpectation ||
  memoryData.careerGoalSummary
) && (
  <ResumeSection title="Career Objective">
    <p className="mb-2">
      <strong>Target Role:</strong> {memoryData.targetRoles}
    </p>

    <p className="mb-2">
      <strong>Industry:</strong> {memoryData.targetIndustry}
    </p>

    <p className="mb-2">
      <strong>Preferred Location:</strong> {memoryData.targetLocation}
    </p>

    <p className="mb-2">
      <strong>Salary Expectation:</strong> {memoryData.salaryExpectation}
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
if (template === "Creative") {
  return (
    <div className="mx-auto max-w-[760px] bg-white shadow-xl">

      <div className="bg-blue-600 text-white p-10">

        <h1 className="text-5xl font-black">
          {memoryData.firstName} {memoryData.lastName}
        </h1>

        <p className="mt-3">
          {memoryData.location} • {memoryData.email} • {memoryData.phone}
        </p>

      </div>

      <div className="p-10">

        <ResumeSection title="Profile">
          <p>{memoryData.summary}</p>
        </ResumeSection>

        <ResumeSection title="Experience">
          {memoryData.workExperience.filter(x=>x.company||x.jobTitle).map((x,i)=>(
            <div key={i} className="mb-8 border-l-4 border-blue-600 pl-5">

              <div className="flex justify-between">
                <h3 className="font-bold text-lg">
                  {x.jobTitle}
                </h3>

                <span>{x.dates}</span>
              </div>

              <p className="mb-2 text-slate-500">
                {x.company}
              </p>

              <ul className="list-disc pl-6 space-y-2">
                {String(x.description)
                  .split(/\r?\n|•/)
                  .filter(Boolean)
                  .map((line,j)=><li key={j}>{line.trim()}</li>)}
              </ul>

            </div>
          ))}
        </ResumeSection>

        {memoryData.education.some(e => e.school || e.program) && (
  <ResumeSection title="Education">
    {memoryData.education.map((e, i) => (
      <div key={i} className="mb-4">
        <h3 className="font-bold">{e.program}</h3>
        <p>{e.school}</p>
      </div>
    ))}
  </ResumeSection>
)}
        {memoryData.languages.some(x => x.language.trim()) && (
  <ResumeSection title="Languages">
    {memoryData.languages
      .filter(x => x.language)
      .map((x, i) => (
        <div key={i} className="mb-2 flex justify-between">
          <span className="font-medium">{x.language}</span>
          <span className="text-slate-500">{x.level}</span>
        </div>
      ))}
  </ResumeSection>
)}
        <ResumeSection title="Skills">
  <div className="mt-3 flex flex-wrap gap-2">
    {String(memoryData.skills || "")
      .split(",")
      .map(skill => skill.trim())
      .filter(Boolean)
      .map((skill, i) => (
        <span
          key={i}
          className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700"
        >
          {skill}
        </span>
      ))}
  </div>
     </ResumeSection>
      {memoryData.certifications.some(x => x.name.trim()) && (
  <ResumeSection title="Certifications">
    {memoryData.certifications
      .filter(x => x.name)
      .map((x, i) => (
        <div key={i} className="mb-4">
          <div className="flex justify-between">
            <h3 className="font-bold">{x.name}</h3>
            <span>{x.date}</span>
          </div>

          <p className="text-slate-500">
            {x.issuer}
          </p>

          {x.description && (
            <p className="mt-2">{x.description}</p>
          )}
        </div>
      ))}
  </ResumeSection>
)}
    {memoryData.projects.some(x => x.name.trim()) && (
  <ResumeSection title="Projects">
    {memoryData.projects
      .filter(x => x.name)
      .map((x, i) => (
        <div key={i} className="mb-5">
          <div className="flex justify-between">
            <h3 className="font-bold">{x.name}</h3>
            <span>{x.dates}</span>
          </div>

          <p className="text-slate-500">
            {x.role}
          </p>

          <p className="mt-2">
            {x.description}
          </p>
        </div>
      ))}
  </ResumeSection>
)}
    {(
  memoryData.targetRoles ||
  memoryData.targetIndustry ||
  memoryData.targetLocation ||
  memoryData.salaryExpectation ||
  memoryData.careerGoalSummary
) && (
  <ResumeSection title="Career Objective">
    <p className="mb-2">
      <strong>Target Role:</strong> {memoryData.targetRoles}
    </p>

    <p className="mb-2">
      <strong>Industry:</strong> {memoryData.targetIndustry}
    </p>

    <p className="mb-2">
      <strong>Preferred Location:</strong> {memoryData.targetLocation}
    </p>

    <p className="mb-2">
      <strong>Salary Expectation:</strong> {memoryData.salaryExpectation}
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
      <div className={`mx-auto min-h-[960px] w-full max-w-[760px] bg-white shadow-xl ${template === "Classic" ? "p-8 sm:p-10" : template === "Modern" ? "p-12 sm:p-14" : template === "Minimal" ? "p-14 sm:p-16" : "p-8 sm:p-10"}`}>
        <div className="border-b-4 border-blue-600 pb-5">
          <h1 className="break-words text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{memoryData.firstName || "First"} {memoryData.lastName || "Last"}</h1>
          
          <p className="mt-3 break-words text-sm text-slate-500">{memoryData.location || "Location"} · {memoryData.email || "email@example.com"} · {memoryData.phone || "Phone"} · {memoryData.linkedin || "LinkedIn"}</p>
        </div>
        <ResumeSection title="Professional Summary"><p>{memoryData.summary || "Your professional summary will appear here."}</p></ResumeSection>
        <ResumeSection title="Experience">
          {memoryData.workExperience.filter((x) => x.company || x.jobTitle || x.description).map((x, i) => (
            <div key={`work-${i}`} className="mb-5">
              <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4"><p className="font-black text-slate-950">{x.jobTitle || "Role Title"}</p><p className="text-sm text-slate-500">{x.dates || "Dates"}</p></div>
              <p className="font-bold text-slate-700">{x.company || "Company Name"}</p>
              <ul className="mt-2 list-disc pl-6 space-y-2">{(x.description || "Experience details will appear here.").split(/\r?\n|•/).filter(line => line.trim()).map((line, idx) => <li key={idx}>{line.trim()}</li>)}</ul>
            </div>
          ))}
          {memoryData.volunteerExperience.filter((x) => x.organization || x.role || x.description).map((x, i) => (
            <div key={`vol-${i}`} className="mb-5">
              <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4"><p className="font-black text-slate-950">{x.role || "Volunteer / Internship Role"}</p><p className="text-sm text-slate-500">{x.dates || "Dates"}</p></div>
              <p className="font-bold text-slate-700">{x.organization || "Organization"}</p>
              <ul className="mt-2 list-disc pl-6 space-y-2">{(x.description || "Experience details will appear here.").split(/\r?\n|•/).filter(line => line.trim()).map((line, idx) => <li key={idx}>{line.trim()}</li>)}</ul>
            </div>
          ))}
        {memoryData.education.some(x => x.school || x.program) && (
  <ResumeSection title="Education">
    {memoryData.education
      .filter(x => x.school || x.program)
      .map((x, i) => (
        <div key={i} className="mb-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
            <p className="font-black text-slate-950">{x.program}</p>
            <p className="text-sm text-slate-500">{x.dates}</p>
          </div>
          <p className="font-bold text-slate-700">{x.school}</p>
          {x.coursework && (
            <p className="mt-1 text-slate-600">{x.coursework}</p>
          )}
        </div>
      ))}
  </ResumeSection>
)}

{memoryData.languages.some(x => x.language.trim()) && (
  <ResumeSection title="Languages">
    {memoryData.languages
      .filter(x => x.language)
      .map((x, i) => (
        <div key={i} className="mb-2 flex justify-between">
          <span className="font-medium">{x.language}</span>
          <span className="text-slate-500">{x.level}</span>
        </div>
      ))}
  </ResumeSection>
)}

{memoryData.certifications.some(x => x.name.trim()) && (
  <ResumeSection title="Certifications">
    {memoryData.certifications
      .filter(x => x.name)
      .map((x, i) => (
        <div key={i} className="mb-4">
          <div className="flex justify-between">
            <h3 className="font-bold">{x.name}</h3>
            <span>{x.date}</span>
          </div>

          <p className="text-slate-500">{x.issuer}</p>

          {x.description && (
            <p className="mt-2">{x.description}</p>
          )}
        </div>
      ))}
  </ResumeSection>
)}

{memoryData.projects.some(x => x.name.trim()) && (
  <ResumeSection title="Projects">
    {memoryData.projects
      .filter(x => x.name)
      .map((x, i) => (
        <div key={i} className="mb-5">
          <div className="flex justify-between">
            <h3 className="font-bold">{x.name}</h3>
            <span>{x.dates}</span>
          </div>

          <p className="text-slate-500">{x.role}</p>

          <p className="mt-2">{x.description}</p>
        </div>
      ))}
  </ResumeSection>
)}

{(
  memoryData.targetRoles ||
  memoryData.targetIndustry ||
  memoryData.targetLocation ||
  memoryData.salaryExpectation ||
  memoryData.careerGoalSummary
) && (
  <ResumeSection title="Career Objective">

    {memoryData.targetRoles && (
      <p className="mb-2">
        <strong>Target Role:</strong> {memoryData.targetRoles}
      </p>
    )}

    {memoryData.targetIndustry && (
      <p className="mb-2">
        <strong>Industry:</strong> {memoryData.targetIndustry}
      </p>
    )}

    {memoryData.targetLocation && (
      <p className="mb-2">
        <strong>Preferred Location:</strong> {memoryData.targetLocation}
      </p>
    )}

    {memoryData.salaryExpectation && (
      <p className="mb-2">
        <strong>Salary:</strong> {memoryData.salaryExpectation}
      </p>
    )}

    {memoryData.careerGoalSummary && (
      <p className="mt-3">
        {memoryData.careerGoalSummary}
      </p>
    )}

  </ResumeSection>
)}


        </ResumeSection>
        <ResumeSection title="Skills"><div className="mt-3 flex flex-wrap gap-2">{(Array.isArray(memoryData.skills) ? memoryData.skills : (memoryData.skills || "").split(",")).map(skill => String(skill).trim()).filter(Boolean).map((skill, index) => <span key={index} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium">{skill}</span>)}</div></ResumeSection>
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
            <div className="pt-3 text-xs font-semibold leading-5 text-slate-500 sm:col-span-5 2xl:col-span-1">Style: {memoryData.themeColor} · {memoryData.font} · {memoryData.layout}</div>
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
    return (
      <div className="mb-6 rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div><p className="text-sm font-black uppercase tracking-wide text-blue-600">Career Memory Unlock</p><h2 className="mt-1 text-xl font-black text-slate-950">Required sections: {requiredCount}/3</h2><p className="mt-2 text-sm leading-6 text-slate-500">Complete the required sections to start using Career Élan. Optional sections can be added anytime to improve AI quality.</p></div>
          <button type="button" onClick={continueToDashboard}  className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white">Continue to Dashboard →</button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3"><RequiredStatus done={hasPersonalInfo()} title="Personal Information" /><RequiredStatus done={hasExperience()} title="Experience" /><RequiredStatus done={hasSkills()} title="Skills" /></div>
      </div>
    );
  }

  function renderStepForm() {
    if (currentStep === 0) return (
      <div className="mt-6 grid gap-5 md:grid-cols-2"><Input placeholder="First Name" value={memoryData.firstName} onChange={(v) => updateMemory("firstName", v)} /><Input placeholder="Last Name" value={memoryData.lastName} onChange={(v) => updateMemory("lastName", v)} /><Input placeholder="Email" value={memoryData.email} onChange={(v) => updateMemory("email", v)} /><Input placeholder="Phone" value={memoryData.phone} onChange={(v) => updateMemory("phone", v)} /><Input placeholder="Location" value={memoryData.location} onChange={(v) => updateMemory("location", v)} /><Input placeholder="LinkedIn" value={memoryData.linkedin} onChange={(v) => updateMemory("linkedin", v)} /><Textarea rows={5} placeholder="Career Summary" value={memoryData.summary} onChange={(v) => updateMemory("summary", v)} className="md:col-span-2" /></div>
    );
    if (currentStep === 1) return <ArraySection title="Education" items={memoryData.education} section="education" emptyItem={emptyEducation} addLabel="+ Add Education" removeItem={removeItem} addItem={addItem} render={(item, index) => <div className="grid gap-5 md:grid-cols-2"><Input placeholder="School Name" value={item.school} onChange={(v) => updateArrayItem<EducationItem>("education", index, "school", v)} /><Input placeholder="Program / Degree" value={item.program} onChange={(v) => updateArrayItem<EducationItem>("education", index, "program", v)} /><Input placeholder="Dates Attended" value={item.dates} onChange={(v) => updateArrayItem<EducationItem>("education", index, "dates", v)} /><Input placeholder="GPA / Honours" value={item.gpa} onChange={(v) => updateArrayItem<EducationItem>("education", index, "gpa", v)} /><Textarea rows={4} placeholder="Relevant coursework, awards, academic achievements..." value={item.coursework} onChange={(v) => updateArrayItem<EducationItem>("education", index, "coursework", v)} className="md:col-span-2" /></div>} />;
    if (currentStep === 2) return (
      <div className="mt-6 space-y-6"><div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5"><h3 className="font-black text-slate-950">Experience is required</h3><p className="mt-2 text-sm leading-6 text-slate-600">Add work experience, volunteer experience, internship, co-op, or other relevant experience. You only need one type to unlock Career Élan.</p></div><ArraySection title="Work Experience" items={memoryData.workExperience} section="workExperience" emptyItem={emptyWork} addLabel="+ Add Work Experience" removeItem={removeItem} addItem={addItem} render={(item, index) => <div className="grid gap-5 md:grid-cols-2"><Input placeholder="Company Name" value={item.company} onChange={(v) => updateArrayItem<WorkItem>("workExperience", index, "company", v)} /><Input placeholder="Job Title" value={item.jobTitle} onChange={(v) => updateArrayItem<WorkItem>("workExperience", index, "jobTitle", v)} /><Input placeholder="Dates Worked" value={item.dates} onChange={(v) => updateArrayItem<WorkItem>("workExperience", index, "dates", v)} className="md:col-span-2" /><Textarea rows={5} placeholder="Responsibilities, achievements, tools used, numbers/results..." value={item.description} onChange={(v) => updateArrayItem<WorkItem>("workExperience", index, "description", v)} className="md:col-span-2" /></div>} /><ArraySection title="Volunteer / Internship / Other Experience" items={memoryData.volunteerExperience} section="volunteerExperience" emptyItem={emptyVolunteer} addLabel="+ Add Volunteer / Other Experience" removeItem={removeItem} addItem={addItem} render={(item, index) => <div className="grid gap-5 md:grid-cols-2"><Input placeholder="Organization / Program Name" value={item.organization} onChange={(v) => updateArrayItem<VolunteerItem>("volunteerExperience", index, "organization", v)} /><Input placeholder="Role / Experience Type" value={item.role} onChange={(v) => updateArrayItem<VolunteerItem>("volunteerExperience", index, "role", v)} /><Input placeholder="Dates" value={item.dates} onChange={(v) => updateArrayItem<VolunteerItem>("volunteerExperience", index, "dates", v)} className="md:col-span-2" /><Textarea rows={5} placeholder="Duties, events, leadership, internship tasks, impact..." value={item.description} onChange={(v) => updateArrayItem<VolunteerItem>("volunteerExperience", index, "description", v)} className="md:col-span-2" /></div>} /></div>
    );
    if (currentStep === 3) return <div className="mt-6"><Textarea rows={8} placeholder="Add skills separated by commas. Example: Excel, Outlook, Client Service, Legal Research, Data Entry..." value={memoryData.skills} onChange={(v) => updateMemory("skills", v)} className="w-full" /></div>;
    if (currentStep === 4) return <ArraySection title="Language" items={memoryData.languages} section="languages" emptyItem={emptyLanguage} addLabel="+ Add Language" removeItem={removeItem} addItem={addItem} render={(item, index) => <div className="grid gap-5 md:grid-cols-2"><Input placeholder="Language" value={item.language} onChange={(v) => updateArrayItem<LanguageItem>("languages", index, "language", v)} /><Input placeholder="Level" value={item.level} onChange={(v) => updateArrayItem<LanguageItem>("languages", index, "level", v)} /></div>} />;
    if (currentStep === 5) return <ArraySection title="Certification" items={memoryData.certifications} section="certifications" emptyItem={emptyCertification} addLabel="+ Add Certification" removeItem={removeItem} addItem={addItem} render={(item, index) => <div className="grid gap-5 md:grid-cols-2"><Input placeholder="Certification / Award Name" value={item.name} onChange={(v) => updateArrayItem<CertificationItem>("certifications", index, "name", v)} /><Input placeholder="Issuer / Organization" value={item.issuer} onChange={(v) => updateArrayItem<CertificationItem>("certifications", index, "issuer", v)} /><Input placeholder="Date" value={item.date} onChange={(v) => updateArrayItem<CertificationItem>("certifications", index, "date", v)} className="md:col-span-2" /><Textarea rows={4} placeholder="Description or details..." value={item.description} onChange={(v) => updateArrayItem<CertificationItem>("certifications", index, "description", v)} className="md:col-span-2" /></div>} />;
    if (currentStep === 6) return <ArraySection title="Project" items={memoryData.projects} section="projects" emptyItem={emptyProject} addLabel="+ Add Project" removeItem={removeItem} addItem={addItem} render={(item, index) => <div className="grid gap-5 md:grid-cols-2"><Input placeholder="Project Name" value={item.name} onChange={(v) => updateArrayItem<ProjectItem>("projects", index, "name", v)} /><Input placeholder="Role / Your Contribution" value={item.role} onChange={(v) => updateArrayItem<ProjectItem>("projects", index, "role", v)} /><Input placeholder="Dates" value={item.dates} onChange={(v) => updateArrayItem<ProjectItem>("projects", index, "dates", v)} className="md:col-span-2" /><Textarea rows={5} placeholder="Describe the project, tools used, result, and impact..." value={item.description} onChange={(v) => updateArrayItem<ProjectItem>("projects", index, "description", v)} className="md:col-span-2" /></div>} />;
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
          <Image src="/logo.png" alt="Career Élan" width={120} height={45} />
          <p className="mt-8 text-xs font-bold uppercase tracking-wider text-gray-400">Overview</p>
          <nav className="mt-4 space-y-2">
            {["Dashboard", "Career Memory", "Create Package", "Job Tracker", "Analytics", "Settings"].map((item) => (
              <button key={item} type="button" onClick={() => handleProtectedNav(item)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${item === "Career Memory" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-blue-50 hover:text-blue-600"}`}>
                <span>{item === "Dashboard" ? "🏠" : item === "Career Memory" ? "🧠" : item === "Create Package" ? "📦" : item === "Job Tracker" ? "💼" : item === "Analytics" ? "📊" : "⚙️"}</span>
                <span className="flex-1">{item}</span>
                {!['Career Memory', 'Job Tracker', 'Settings'].includes(item) && !canUseService() && <span className="text-xs">🔒</span>}
              </button>
            ))}
          </nav>
        </aside>

        <section className="flex-1 px-8 py-6">
          {mode === "start" ? (
            <StartScreen
             strength={profileStrength}
            requiredCount={requiredCount}
            canUseService={canUseService()}
            onImport={() => setMode("import")}
            isUnlocked={isUnlocked}
            onBuild={() => setMode("build")}
            onContinue={continueToDashboard}
            onSaveCoverLetter={() => {
persistMemory();
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
              <header className="mb-8 flex items-center justify-between"><div><h1 className="text-3xl font-extrabold">Career Memory</h1><p className="mt-1 text-sm text-gray-500">Your career database. AI uses this information to create company-specific application packages.</p></div><button onClick={saveMemory} className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white">Save Memory</button></header>
              {renderRequiredBanner()}
              {mode === "import" && (
                <div className="rounded-2xl border border-blue-100 bg-white p-10 shadow-sm">
                  <button onClick={() => { setMode("start"); setImportStage("idle"); }} className="mb-6 font-bold text-blue-600">← Back</button>
                  {importStage === "preview" ? renderFullResumePreview() : <><h2 className="text-3xl font-extrabold">Import Resume</h2><p className="mt-3 text-gray-500">Upload your existing resume. Career Élan will extract your information and build your Career Memory.</p><input ref={fileInputRef} type="file" accept=".txt,.pdf,.docx" className="hidden" onChange={handleResumeUpload} /><div className="mt-8 rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50 p-16 text-center"><div className="text-6xl">📄</div><h3 className="mt-5 text-xl font-bold">Drop your resume here</h3><p className="mt-2 text-sm text-gray-500">Supported formats: PDF(text PDF only), DOCX, TXT</p><button onClick={() => fileInputRef.current?.click()} className="mt-6 rounded-xl bg-blue-600 px-6 py-3 font-bold text-white">Browse Files</button></div>{importStage !== "idle" && <ParsingStatus stage={importStage} requiredCount={requiredCount} progress={uploadProgress} />}{importMessage && <p className="mt-5 rounded-xl bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{importMessage}</p>}{renderStyleSettings()}<div className="mt-8 flex justify-end gap-3"><button onClick={continueToImportPreview} disabled={importStage !== "parsed"} className={`rounded-xl border px-6 py-3 font-bold ${importStage === "parsed" ? "border-blue-600 text-blue-600" : "cursor-not-allowed border-slate-200 text-slate-400"}`}>Continue to Preview →</button><button onClick={continueToDashboard}  className={`rounded-xl px-6 py-3 font-bold ${canUseService() ? "bg-blue-600 text-white" : "cursor-not-allowed bg-slate-100 text-slate-400"}`}>Continue to Dashboard</button></div></>}
                </div>
              )}
              {mode === "build" && (
                <>
                  <div className="mb-8 rounded-2xl border border-blue-100 bg-white p-6 shadow-sm"><button onClick={() => setMode("start")} className="mb-4 font-bold text-blue-600">← Back</button><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Profile Progress</h2><p className="text-sm text-gray-500">Step {currentStep + 1} of {steps.length} · {steps[currentStep].title}</p></div><div className="flex items-center gap-3"><span className="rounded-full bg-green-50 px-4 py-2 text-sm font-bold text-green-700">Required {requiredCount}/3</span><span className="rounded-full bg-blue-100 px-4 py-2 text-sm font-bold text-blue-700">{progress}% Complete</span></div></div><div className="mt-5 h-3 rounded-full bg-gray-100"><div className="h-3 rounded-full bg-blue-600" style={{ width: `${progress}%` }} /></div></div>
                  <div className="grid grid-cols-12 gap-6">
                    <aside className="col-span-12 rounded-2xl border border-blue-100 bg-white p-5 shadow-sm xl:col-span-3"><h2 className="text-lg font-bold">Steps</h2><div className="mt-5 space-y-2">{steps.map((step, index) => <button key={step.title} onClick={() => setCurrentStep(index)} className={`w-full rounded-xl px-4 py-3 text-left transition ${index === currentStep ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-blue-50"}`}><p className="flex items-center justify-between text-sm font-bold"><span>{index + 1}. {step.title}</span>{step.required && <span className={`rounded-full px-2 py-0.5 text-[10px] ${index === currentStep ? "bg-white/15 text-white" : "bg-red-50 text-red-600"}`}>Required</span>}</p><p className={`mt-1 text-xs leading-5 ${index === currentStep ? "text-blue-100" : "text-gray-400"}`}>{step.description}</p></button>)}</div></aside>
                    <section className={`col-span-12 space-y-6 ${isReviewStep ? "xl:col-span-9" : "xl:col-span-6"}`}><div className="rounded-2xl border border-blue-100 bg-white p-6 shadow-sm"><h2 className="text-xl font-bold">{steps[currentStep].title}</h2><p className="mt-2 text-sm text-gray-500">{steps[currentStep].description}</p>{renderStepForm()}<div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">{canUseService() && <button onClick={continueToDashboard} className="rounded-xl border border-blue-600 px-6 py-3 font-bold text-blue-600">Continue to Dashboard</button>}<button onClick={handleSaveAndContinue} className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white">{currentStep === steps.length - 1 ? "Finish Memory" : "Save & Continue →"}</button></div></div></section>
                    {!isReviewStep && <aside className="col-span-12 space-y-6 xl:col-span-3"><div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">Memory Strength</h2><p className="mt-2 text-sm text-gray-500">More complete information creates better AI results.</p><div className="mt-5 h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-blue-600" style={{ width: `${strength}%` }} /></div><p className="mt-3 text-sm font-bold text-blue-600">{strength}% Overall · Required {requiredCount}/3</p></div><div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">Required to Unlock</h2><div className="mt-4 space-y-3 text-sm font-semibold text-gray-600"><RequiredLine done={hasPersonalInfo()} text="Personal Information" /><RequiredLine done={hasExperience()} text="Experience" /><RequiredLine done={hasSkills()} text="Skills" /></div></div><div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">Selected Style</h2><div className="mt-4 space-y-2 text-sm font-semibold text-gray-600"><p>📄 {memoryData.resumeTemplate}</p><p>✉️ {memoryData.coverLetterTemplate}</p><p>🎨 {memoryData.themeColor}</p><p>🔤 {memoryData.font}</p><p>📐 {memoryData.layout}</p></div></div><div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">This Memory Powers</h2><div className="mt-4 space-y-3 text-sm font-semibold text-gray-600"><p>📦 Application Packages</p><p>📄 Resume Generation</p><p>✉️ Cover Letter Generation</p><p>🎯 Job URL Analysis</p></div></div></aside>}
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
      {lockedMessage && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-6 backdrop-blur-sm"><div className="w-full max-w-md rounded-3xl border border-blue-100 bg-white p-7 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-black uppercase tracking-wide text-blue-600">Career Memory Required</p><h2 className="mt-2 text-2xl font-black text-slate-950">Complete required sections first</h2></div><button onClick={() => setLockedMessage("")} className="text-2xl leading-none text-slate-400 hover:text-slate-700">×</button></div><p className="mt-4 text-sm leading-6 text-slate-600">{lockedMessage}</p><div className="mt-5 space-y-3 rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-600"><RequiredLine done={hasPersonalInfo()} text="Personal Information" /><RequiredLine done={hasExperience()} text="Experience" /><RequiredLine done={hasSkills()} text="Skills" /></div><button onClick={() => { setLockedMessage(""); setMode("build"); }} className="mt-6 w-full rounded-xl bg-blue-600 px-5 py-3 font-black text-white">Continue Building</button></div></div>}
    </main>
  );
}

function StartScreen({
  strength,
  requiredCount,
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
      <div className="mb-8 flex items-start justify-between gap-6"><div><h1 className="text-4xl font-black tracking-tight text-slate-950">Build Your Career Memory ✨</h1><p className="mt-3 max-w-2xl text-base leading-7 text-slate-500">Complete the required sections first. Then Career Élan can create resumes, cover letters, and job application packages from your profile.</p><div className="mt-6 flex flex-wrap gap-3">{["Personal Info", "Experience", "Skills", "Education", "Projects", "Certifications", "Preferences", "Achievements"].map((item, i) => <span key={item} className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm"><span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-white ${i < 3 ? "bg-blue-600" : "bg-slate-300"}`}>{i < 3 ? "!" : "+"}</span>{item}</span>)}</div></div><div className="hidden text-sm text-slate-500 lg:block">Need help?⌄</div></div>
      <div className="mb-6 rounded-3xl border border-blue-100 bg-white p-5 shadow-sm"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-sm font-black uppercase tracking-wide text-blue-600">Required to unlock Career Élan</p><h2 className="mt-1 text-2xl font-black text-slate-950">Required sections: {requiredCount}/3</h2><p className="mt-2 text-sm leading-6 text-slate-500">Personal Information, Experience, and Skills are enough to start. Optional sections can be completed later.</p></div><button onClick={onContinue} disabled={!isUnlocked} className={`rounded-xl px-6 py-4 font-black transition ${canUseService ? "bg-blue-600 text-white shadow-lg shadow-blue-100 hover:bg-blue-700" : "cursor-not-allowed bg-slate-100 text-slate-400"}`}>Continue to Dashboard →</button></div></div>
      <div className="grid gap-6 xl:grid-cols-[2fr_310px]">

  {/* LEFT */}
  <div className="space-y-6">

    {/* Resume + No Resume */}
    <div className="grid gap-6 md:grid-cols-2">

      {/* Resume */}
      <button
        onClick={onImport}
        className="rounded-3xl border border-blue-100 bg-white p-8 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-green-50 text-4xl">
          ☁️
        </div>

        <h2 className="mt-7 text-2xl font-black">
          Import Your Resume
        </h2>

        <p className="mt-4 text-sm text-slate-500">
          Upload your current resume and let AI extract your information automatically.
        </p>

        <div className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
          {[
            "Work Experience",
            "Skills",
            "Education",
            "Projects",
            "Certifications",
            "Achievements",
          ].map((x) => (
            <p key={x}>
              <span className="text-green-600">✓</span> {x}
            </p>
          ))}
        </div>

        <div className="mt-8 rounded-xl bg-blue-600 py-4 text-center font-black text-white">
          Upload Resume
        </div>
      </button>

      {/* No Resume */}
      <button
        onClick={onBuild}
        className="rounded-3xl border border-blue-100 bg-white p-8 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-50 text-4xl">
          ✎
        </div>

        <h2 className="mt-7 text-2xl font-black">
          No Resume?
        </h2>

        <p className="mt-4 text-sm text-slate-500">
          Answer a few simple questions and build your Career Memory step-by-step.
        </p>

        <div className="mt-6 space-y-3 text-sm">
          <p>✓ Required sections first</p>
          <p>✓ Optional sections later</p>
          <p>▣ Save and continue anytime</p>
        </div>

        <div className="mt-9 rounded-xl border border-blue-600 py-4 text-center font-black text-blue-600">
          Start Building
        </div>
      </button>

    </div>
       
    {/* Cover Letter */}
    <div className="rounded-3xl border border-purple-200 bg-white p-6 shadow-sm">

      <div className="flex items-center justify-between">

        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black">
              Cover Letter
            </h2>

            <span className="rounded-full bg-purple-100 px-2 py-1 text-xs font-bold text-purple-700">
              Optional
            </span>
          </div>

          <p className="mt-2 text-sm text-slate-500">
            Upload your existing cover letter or let AI create a new one later.
          </p>

        </div>

      </div>

      <input
        ref={coverLetterInputRef}
        type="file"
        accept=".pdf,.docx,.txt"
        className="hidden"
        onChange={handleCoverLetterUpload}
      />

      <button
        onClick={() => coverLetterInputRef.current?.click()}
        className="mt-6 flex w-full items-center justify-center rounded-2xl border-2 border-dashed border-purple-200 py-8 transition hover:bg-purple-50"
      >
        <div className="text-center">

          <div className="text-4xl">☁️</div>

          <p className="mt-3 font-bold">
            Upload Cover Letter
          </p>

          <p className="text-xs text-slate-400">
            PDF, DOCX, TXT (Max 10MB)
          </p>

        </div>
      </button>
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
onClick={() => setCoverLetterPreview(true)}
  className="rounded-xl border border-blue-600 px-6 py-3 font-bold text-blue-600"
>
  Preview
</button>

    <button
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
      <div className="mt-6 grid gap-3 md:grid-cols-2 text-sm">

        <p>✓ Use in Generate Package</p>

        <p>✨ Tailored automatically</p>

        <p>📝 Edit and reuse anytime</p>

      </div>

    </div>

  </div>

  {/* RIGHT */}
  <aside className="space-y-5">

    <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">

      <h3 className="text-center text-base font-black">
        Career Memory Status
      </h3>

      <div className="mx-auto mt-6 flex h-36 w-36 items-center justify-center rounded-full border-[12px] border-slate-100">

        <div className="text-center">

          <p className="text-3xl font-black">
               {strength}%
          </p>

          <p className="text-xs text-slate-500">
            Overall Profile Strength
          </p>

        </div>

      </div>

      <div className="mt-6 space-y-3">

        <RequiredLine done={requiredCount >= 1} text="👤 Personal Info" />

        <RequiredLine done={requiredCount >= 2} text="💼 Experience" />

        <RequiredLine done={requiredCount >= 3} text="🔐 Skills" />

      </div>

    </div>

    <div className="rounded-3xl border border-blue-100 bg-blue-50 p-6 shadow-sm">

      <h3 className="font-black text-blue-700">
        🛡️ Your data is 100% secure
      </h3>

      <p className="mt-3 text-sm text-slate-600">
        We use secure authentication and never sell or share your personal information.
      </p>

    </div>

  </aside>

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