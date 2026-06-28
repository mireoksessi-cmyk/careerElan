"use client";

import Image from "next/image";
import { ChangeEvent, useEffect, useRef, useState } from "react";

const steps = [
  { title: "Personal Information", description: "Your contact information and professional summary used across every application." },
  { title: "Education", description: "Schools, degrees, GPA, coursework, and academic achievements that strengthen your profile." },
  { title: "Work Experience", description: "Add your employment history. AI will rewrite your responsibilities into professional resume bullet points." },
  { title: "Volunteer Experience", description: "Community service, internships, leadership, and unpaid experience that demonstrate your skills." },
  { title: "Skills", description: "Technical skills, software, legal knowledge, customer service, and other professional abilities." },
  { title: "Languages", description: "Languages you speak and your proficiency level, such as English, French, or Korean." },
  { title: "Certifications", description: "Professional certifications, licenses, awards, and completed training." },
  { title: "Projects", description: "School, personal, volunteer, or professional projects that showcase your experience." },
  { title: "Career Goals", description: "Tell AI your target industry, preferred roles, locations, salary expectations, and long-term goals." },
  { title: "Review & Templates", description: "Review your Career Memory and choose resume and cover letter styles." },
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
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  headline: string;
  summary: string;

  education: EducationItem[];
  workExperience: WorkItem[];
  volunteerExperience: VolunteerItem[];
  skills: string;
  languages: LanguageItem[];
  certifications: CertificationItem[];
  projects: ProjectItem[];

  targetRoles: string;
  targetIndustry: string;
  targetLocation: string;
  salaryExpectation: string;
  careerGoalSummary: string;

  uploadedResumeName: string;
  uploadedResumeText: string;
  resumeSource: "uploaded" | "built";
  resumeTemplate: string;
  coverLetterTemplate: string;
  themeColor: string;
  font: string;
  layout: string;
  coverLetterTone: string;
  applySameStyleToCoverLetter: boolean;
};

const emptyEducation = { school: "", program: "", dates: "", gpa: "", coursework: "" };
const emptyWork = { company: "", jobTitle: "", dates: "", description: "" };
const emptyVolunteer = { organization: "", role: "", dates: "", description: "" };
const emptyLanguage = { language: "", level: "" };
const emptyCertification = { name: "", issuer: "", date: "", description: "" };
const emptyProject = { name: "", role: "", dates: "", description: "" };

const defaultMemoryData: CareerMemoryData = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  location: "",
  linkedin: "",
  headline: "",
  summary: "",

  education: [emptyEducation],
  workExperience: [emptyWork],
  volunteerExperience: [emptyVolunteer],
  skills: "",
  languages: [emptyLanguage],
  certifications: [emptyCertification],
  projects: [emptyProject],

  targetRoles: "",
  targetIndustry: "",
  targetLocation: "",
  salaryExpectation: "",
  careerGoalSummary: "",

  uploadedResumeName: "",
  uploadedResumeText: "",
  resumeSource: "built",
  resumeTemplate: "Professional",
  coverLetterTemplate: "Classic Letter",
  themeColor: "Navy",
  font: "Calibri",
  layout: "One Column",
  coverLetterTone: "Formal",
  applySameStyleToCoverLetter: true,
};

export default function CareerMemoryPage() {
  const [mode, setMode] = useState<"start" | "import" | "build">("start");
  const [currentStep, setCurrentStep] = useState(0);
  const [memoryData, setMemoryData] = useState<CareerMemoryData>(defaultMemoryData);
  const [importMessage, setImportMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const progress = Math.round(((currentStep + 1) / steps.length) * 100);

  useEffect(() => {
    const saved = localStorage.getItem("careerMemoryData");
    if (saved) {
      const parsed = JSON.parse(saved);
      setMemoryData({
        ...defaultMemoryData,
        ...parsed,
        education: parsed.education || [emptyEducation],
        workExperience: parsed.workExperience || [emptyWork],
        volunteerExperience: parsed.volunteerExperience || [emptyVolunteer],
        languages: parsed.languages || [emptyLanguage],
        certifications: parsed.certifications || [emptyCertification],
        projects: parsed.projects || [emptyProject],
      });
    }
  }, []);

  function updateMemory(field: keyof CareerMemoryData, value: string | boolean) {
    setMemoryData((prev) => ({ ...prev, [field]: value }));
  }

  function updateArrayItem<T extends object>(
    section: keyof CareerMemoryData,
    index: number,
    field: keyof T,
    value: string
  ) {
    setMemoryData((prev) => {
      const items = [...(prev[section] as T[])];
      items[index] = { ...items[index], [field]: value };
      return { ...prev, [section]: items };
    });
  }

  function addItem(section: keyof CareerMemoryData, emptyItem: object) {
    setMemoryData((prev) => ({
      ...prev,
      [section]: [...(prev[section] as object[]), { ...emptyItem }],
    }));
  }

  function removeItem(section: keyof CareerMemoryData, index: number) {
    setMemoryData((prev) => {
      const items = [...(prev[section] as object[])];
      if (items.length === 1) return prev;
      items.splice(index, 1);
      return { ...prev, [section]: items };
    });
  }

  function saveMemory() {
    localStorage.setItem("careerMemoryData", JSON.stringify(memoryData));
    alert("Career Memory saved.");
  }

  function handleSaveAndContinue() {
    localStorage.setItem("careerMemoryData", JSON.stringify(memoryData));
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      alert("Career Memory completed and saved.");
    }
  }

  async function handleResumeUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();

    updateMemory("uploadedResumeName", file.name);
    updateMemory("resumeSource", "uploaded");

    if (file.type === "text/plain" || fileName.endsWith(".txt")) {
      const text = await file.text();
      updateMemory("uploadedResumeText", text);
      setImportMessage("TXT resume imported. You can keep the original content and apply templates.");
      return;
    }

    if (fileName.endsWith(".pdf") || fileName.endsWith(".docx")) {
      setImportMessage("Resume file selected. PDF/DOCX text extraction will be connected later. Template settings are saved now.");
      return;
    }

    setImportMessage("Unsupported file type. Please upload TXT, PDF, or DOCX.");
  }

  function getThemeClass() {
    if (memoryData.themeColor === "Green") return "border-green-600 text-green-700";
    if (memoryData.themeColor === "Blue") return "border-blue-600 text-blue-700";
    if (memoryData.themeColor === "Black") return "border-black text-black";
    if (memoryData.themeColor === "Gray") return "border-gray-500 text-gray-700";
    return "border-slate-800 text-slate-800";
  }

  function renderStyleSettings() {
    return (
      <div className="mt-8 rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
        <h3 className="text-xl font-extrabold">Document Style</h3>
        <p className="mt-1 text-sm text-gray-500">
          Choose the default design for uploaded resumes, new resumes, and cover letters.
        </p>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <div>
            <label className="text-sm font-bold text-gray-600">Resume Template</label>
            <select value={memoryData.resumeTemplate} onChange={(e) => updateMemory("resumeTemplate", e.target.value)} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600">
              {resumeTemplates.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm font-bold text-gray-600">Cover Letter Template</label>
            <select value={memoryData.coverLetterTemplate} onChange={(e) => updateMemory("coverLetterTemplate", e.target.value)} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600">
              {coverLetterTemplates.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm font-bold text-gray-600">Theme Color</label>
            <select value={memoryData.themeColor} onChange={(e) => updateMemory("themeColor", e.target.value)} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600">
              {themeColors.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm font-bold text-gray-600">Font</label>
            <select value={memoryData.font} onChange={(e) => updateMemory("font", e.target.value)} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600">
              {fonts.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm font-bold text-gray-600">Layout</label>
            <select value={memoryData.layout} onChange={(e) => updateMemory("layout", e.target.value)} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600">
              {layouts.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm font-bold text-gray-600">Cover Letter Tone</label>
            <select value={memoryData.coverLetterTone} onChange={(e) => updateMemory("coverLetterTone", e.target.value)} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600">
              {tones.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
        </div>

        <label className="mt-5 flex items-center gap-3 text-sm font-bold text-gray-600">
          <input
            type="checkbox"
            checked={memoryData.applySameStyleToCoverLetter}
            onChange={(e) => updateMemory("applySameStyleToCoverLetter", e.target.checked)}
          />
          Apply the same style to resume and cover letter
        </label>
      </div>
    );
  }

  function renderResumePreview() {
    return (
      <div className={`mt-6 rounded-2xl border-2 bg-white p-6 shadow-sm ${getThemeClass()}`} style={{ fontFamily: memoryData.font }}>
        <div className="border-b pb-4">
          <h3 className="text-2xl font-extrabold">
            {memoryData.firstName || "First"} {memoryData.lastName || "Last"}
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            {memoryData.email || "email@example.com"} · {memoryData.phone || "Phone"} · {memoryData.location || "Location"}
          </p>
          <p className="mt-2 font-bold">{memoryData.headline || "Professional Headline"}</p>
        </div>

        <div className={memoryData.layout === "Two Column" ? "mt-5 grid gap-5 md:grid-cols-2" : "mt-5 space-y-5"}>
          <div>
            <h4 className="font-extrabold">Summary</h4>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              {memoryData.summary || "Your professional summary will appear here."}
            </p>
          </div>

          <div>
            <h4 className="font-extrabold">Skills</h4>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              {memoryData.skills || "Excel, Communication, Customer Service, Organization"}
            </p>
          </div>

          <div>
            <h4 className="font-extrabold">Experience</h4>
            <p className="mt-2 text-sm font-bold">{memoryData.workExperience[0]?.jobTitle || "Job Title"}</p>
            <p className="text-sm text-gray-600">{memoryData.workExperience[0]?.company || "Company Name"}</p>
            <p className="mt-1 text-sm text-gray-600">{memoryData.workExperience[0]?.description || "Work experience bullets will appear here."}</p>
          </div>

          <div>
            <h4 className="font-extrabold">Education</h4>
            <p className="mt-2 text-sm font-bold">{memoryData.education[0]?.program || "Program / Degree"}</p>
            <p className="text-sm text-gray-600">{memoryData.education[0]?.school || "School Name"}</p>
          </div>
        </div>
      </div>
    );
  }

  function renderStepForm() {
    if (currentStep === 0) {
      return (
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <input placeholder="First Name" value={memoryData.firstName} onChange={(e) => updateMemory("firstName", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
          <input placeholder="Last Name" value={memoryData.lastName} onChange={(e) => updateMemory("lastName", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
          <input placeholder="Email" value={memoryData.email} onChange={(e) => updateMemory("email", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
          <input placeholder="Phone" value={memoryData.phone} onChange={(e) => updateMemory("phone", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
          <input placeholder="Location" value={memoryData.location} onChange={(e) => updateMemory("location", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
          <input placeholder="LinkedIn" value={memoryData.linkedin} onChange={(e) => updateMemory("linkedin", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
          <input placeholder="Professional Headline" value={memoryData.headline} onChange={(e) => updateMemory("headline", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600 md:col-span-2" />
          <textarea rows={5} placeholder="Career Summary" value={memoryData.summary} onChange={(e) => updateMemory("summary", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600 md:col-span-2" />
        </div>
      );
    }

    if (currentStep === 1) {
      return (
        <div className="mt-6 space-y-5">
          {memoryData.education.map((item, index) => (
            <div key={index} className="rounded-2xl border border-gray-100 bg-slate-50 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-bold">Education #{index + 1}</h3>
                <button onClick={() => removeItem("education", index)} className="text-sm font-bold text-red-500">Remove</button>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <input placeholder="School Name" value={item.school} onChange={(e) => updateArrayItem<EducationItem>("education", index, "school", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
                <input placeholder="Program / Degree" value={item.program} onChange={(e) => updateArrayItem<EducationItem>("education", index, "program", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
                <input placeholder="Dates Attended" value={item.dates} onChange={(e) => updateArrayItem<EducationItem>("education", index, "dates", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
                <input placeholder="GPA / Honours" value={item.gpa} onChange={(e) => updateArrayItem<EducationItem>("education", index, "gpa", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
                <textarea rows={4} placeholder="Relevant coursework, awards, academic achievements..." value={item.coursework} onChange={(e) => updateArrayItem<EducationItem>("education", index, "coursework", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600 md:col-span-2" />
              </div>
            </div>
          ))}
          <button onClick={() => addItem("education", emptyEducation)} className="rounded-xl border border-blue-600 px-5 py-3 font-bold text-blue-600">+ Add Education</button>
        </div>
      );
    }

    if (currentStep === 2) {
      return (
        <div className="mt-6 space-y-5">
          {memoryData.workExperience.map((item, index) => (
            <div key={index} className="rounded-2xl border border-gray-100 bg-slate-50 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-bold">Work Experience #{index + 1}</h3>
                <button onClick={() => removeItem("workExperience", index)} className="text-sm font-bold text-red-500">Remove</button>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <input placeholder="Company Name" value={item.company} onChange={(e) => updateArrayItem<WorkItem>("workExperience", index, "company", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
                <input placeholder="Job Title" value={item.jobTitle} onChange={(e) => updateArrayItem<WorkItem>("workExperience", index, "jobTitle", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
                <input placeholder="Dates Worked" value={item.dates} onChange={(e) => updateArrayItem<WorkItem>("workExperience", index, "dates", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600 md:col-span-2" />
                <textarea rows={5} placeholder="Responsibilities, achievements, tools used, numbers/results..." value={item.description} onChange={(e) => updateArrayItem<WorkItem>("workExperience", index, "description", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600 md:col-span-2" />
              </div>
            </div>
          ))}
          <button onClick={() => addItem("workExperience", emptyWork)} className="rounded-xl border border-blue-600 px-5 py-3 font-bold text-blue-600">+ Add Work Experience</button>
        </div>
      );
    }

    if (currentStep === 3) {
      return (
        <div className="mt-6 space-y-5">
          {memoryData.volunteerExperience.map((item, index) => (
            <div key={index} className="rounded-2xl border border-gray-100 bg-slate-50 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-bold">Volunteer Experience #{index + 1}</h3>
                <button onClick={() => removeItem("volunteerExperience", index)} className="text-sm font-bold text-red-500">Remove</button>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <input placeholder="Organization Name" value={item.organization} onChange={(e) => updateArrayItem<VolunteerItem>("volunteerExperience", index, "organization", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
                <input placeholder="Volunteer Role" value={item.role} onChange={(e) => updateArrayItem<VolunteerItem>("volunteerExperience", index, "role", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
                <input placeholder="Dates" value={item.dates} onChange={(e) => updateArrayItem<VolunteerItem>("volunteerExperience", index, "dates", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600 md:col-span-2" />
                <textarea rows={5} placeholder="Volunteer duties, events, leadership, impact..." value={item.description} onChange={(e) => updateArrayItem<VolunteerItem>("volunteerExperience", index, "description", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600 md:col-span-2" />
              </div>
            </div>
          ))}
          <button onClick={() => addItem("volunteerExperience", emptyVolunteer)} className="rounded-xl border border-blue-600 px-5 py-3 font-bold text-blue-600">+ Add Volunteer Experience</button>
        </div>
      );
    }

    if (currentStep === 4) {
      return <div className="mt-6"><textarea rows={8} placeholder="Add skills separated by commas. Example: Excel, Outlook, Client Service, Legal Research, Data Entry..." value={memoryData.skills} onChange={(e) => updateMemory("skills", e.target.value)} className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" /></div>;
    }

    if (currentStep === 5) {
      return (
        <div className="mt-6 space-y-5">
          {memoryData.languages.map((item, index) => (
            <div key={index} className="grid gap-5 rounded-2xl border border-gray-100 bg-slate-50 p-5 md:grid-cols-2">
              <input placeholder="Language" value={item.language} onChange={(e) => updateArrayItem<LanguageItem>("languages", index, "language", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
              <input placeholder="Level" value={item.level} onChange={(e) => updateArrayItem<LanguageItem>("languages", index, "level", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
              <button onClick={() => removeItem("languages", index)} className="text-left text-sm font-bold text-red-500">Remove</button>
            </div>
          ))}
          <button onClick={() => addItem("languages", emptyLanguage)} className="rounded-xl border border-blue-600 px-5 py-3 font-bold text-blue-600">+ Add Language</button>
        </div>
      );
    }

    if (currentStep === 6) {
      return (
        <div className="mt-6 space-y-5">
          {memoryData.certifications.map((item, index) => (
            <div key={index} className="rounded-2xl border border-gray-100 bg-slate-50 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-bold">Certification #{index + 1}</h3>
                <button onClick={() => removeItem("certifications", index)} className="text-sm font-bold text-red-500">Remove</button>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <input placeholder="Certification / Award Name" value={item.name} onChange={(e) => updateArrayItem<CertificationItem>("certifications", index, "name", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
                <input placeholder="Issuer / Organization" value={item.issuer} onChange={(e) => updateArrayItem<CertificationItem>("certifications", index, "issuer", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
                <input placeholder="Date" value={item.date} onChange={(e) => updateArrayItem<CertificationItem>("certifications", index, "date", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600 md:col-span-2" />
                <textarea rows={4} placeholder="Description or details..." value={item.description} onChange={(e) => updateArrayItem<CertificationItem>("certifications", index, "description", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600 md:col-span-2" />
              </div>
            </div>
          ))}
          <button onClick={() => addItem("certifications", emptyCertification)} className="rounded-xl border border-blue-600 px-5 py-3 font-bold text-blue-600">+ Add Certification</button>
        </div>
      );
    }

    if (currentStep === 7) {
      return (
        <div className="mt-6 space-y-5">
          {memoryData.projects.map((item, index) => (
            <div key={index} className="rounded-2xl border border-gray-100 bg-slate-50 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-bold">Project #{index + 1}</h3>
                <button onClick={() => removeItem("projects", index)} className="text-sm font-bold text-red-500">Remove</button>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <input placeholder="Project Name" value={item.name} onChange={(e) => updateArrayItem<ProjectItem>("projects", index, "name", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
                <input placeholder="Role / Your Contribution" value={item.role} onChange={(e) => updateArrayItem<ProjectItem>("projects", index, "role", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
                <input placeholder="Dates" value={item.dates} onChange={(e) => updateArrayItem<ProjectItem>("projects", index, "dates", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600 md:col-span-2" />
                <textarea rows={5} placeholder="Describe the project, tools used, result, and impact..." value={item.description} onChange={(e) => updateArrayItem<ProjectItem>("projects", index, "description", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600 md:col-span-2" />
              </div>
            </div>
          ))}
          <button onClick={() => addItem("projects", emptyProject)} className="rounded-xl border border-blue-600 px-5 py-3 font-bold text-blue-600">+ Add Project</button>
        </div>
      );
    }

    if (currentStep === 8) {
      return (
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <input placeholder="Target Roles" value={memoryData.targetRoles} onChange={(e) => updateMemory("targetRoles", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
          <input placeholder="Target Industry" value={memoryData.targetIndustry} onChange={(e) => updateMemory("targetIndustry", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
          <input placeholder="Preferred Location" value={memoryData.targetLocation} onChange={(e) => updateMemory("targetLocation", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
          <input placeholder="Salary Expectation" value={memoryData.salaryExpectation} onChange={(e) => updateMemory("salaryExpectation", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600" />
          <textarea rows={6} placeholder="Describe your short-term and long-term career goals..." value={memoryData.careerGoalSummary} onChange={(e) => updateMemory("careerGoalSummary", e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-600 md:col-span-2" />
        </div>
      );
    }

    return (
      <div>
        <div className="mt-6 rounded-2xl bg-blue-50 p-5">
          <h3 className="font-extrabold">Career Memory Review</h3>
          <p className="mt-2 text-sm text-gray-600">
            Source: {memoryData.resumeSource === "uploaded" ? "Uploaded Resume" : "Built From Scratch"}
          </p>
          {memoryData.uploadedResumeName && (
            <p className="mt-1 text-sm font-bold text-blue-700">
              Uploaded: {memoryData.uploadedResumeName}
            </p>
          )}
        </div>

        {renderStyleSettings()}
        {renderResumePreview()}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <button className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white">
            Generate Resume
          </button>
          <button className="rounded-xl border border-blue-600 px-5 py-3 font-bold text-blue-600">
            Generate Cover Letter
          </button>
          <button className="rounded-xl border border-gray-300 px-5 py-3 font-bold text-gray-700">
            Save as Default Style
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6fbff] text-gray-900">
      <div className="flex min-h-screen">
        <aside className="w-60 border-r border-blue-100 bg-white px-5 py-6">
          <Image src="/logo.png" alt="Career Élan" width={120} height={45} />
          <p className="mt-8 text-xs font-bold uppercase tracking-wider text-gray-400">Overview</p>
          <nav className="mt-4 space-y-2">
            {["Dashboard", "Career Memory", "Application Center", "Job Tracker", "Analytics", "Settings"].map((item) => (
              <a key={item} href={item === "Dashboard" ? "/dashboard" : item === "Career Memory" ? "/career-memory" : item === "Application Center" ? "/application-center" : "#"} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${item === "Career Memory" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-blue-50 hover:text-blue-600"}`}>
                <span>{item === "Dashboard" ? "🏠" : item === "Career Memory" ? "🧠" : item === "Application Center" ? "📦" : item === "Job Tracker" ? "💼" : item === "Analytics" ? "📊" : "⚙️"}</span>
                {item}
              </a>
            ))}
          </nav>
        </aside>

        <section className="flex-1 px-8 py-6">
          <header className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-extrabold">Career Memory</h1>
              <p className="mt-1 text-sm text-gray-500">Your career database. AI uses this information to create company-specific application packages.</p>
            </div>
            {mode !== "start" && <button onClick={saveMemory} className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white">Save Memory</button>}
          </header>

          {mode === "start" && (
            <div className="grid gap-6 md:grid-cols-2">
              <button onClick={() => setMode("import")} className="rounded-2xl border border-blue-100 bg-white p-10 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
                <div className="text-6xl">📄</div>
                <h2 className="mt-6 text-3xl font-extrabold">Import Existing Resume</h2>
                <p className="mt-4 text-sm leading-6 text-gray-500">Upload your existing resume and keep the content, then apply new templates, fonts, and colors.</p>
                <div className="mt-8 inline-block rounded-xl bg-blue-600 px-6 py-3 font-bold text-white">Import Resume</div>
              </button>

              <button onClick={() => setMode("build")} className="rounded-2xl border border-blue-100 bg-white p-10 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
                <div className="text-6xl">✨</div>
                <h2 className="mt-6 text-3xl font-extrabold">Build From Scratch</h2>
                <p className="mt-4 text-sm leading-6 text-gray-500">Create your career profile step by step with AI guidance and document templates.</p>
                <div className="mt-8 inline-block rounded-xl border border-blue-600 px-6 py-3 font-bold text-blue-600">Start Building</div>
              </button>
            </div>
          )}

          {mode === "import" && (
            <div className="rounded-2xl border border-blue-100 bg-white p-10 shadow-sm">
              <button onClick={() => setMode("start")} className="mb-6 font-bold text-blue-600">← Back</button>
              <h2 className="text-3xl font-extrabold">Import Resume</h2>
              <p className="mt-3 text-gray-500">Upload your existing resume. You can keep the original content and change the template, color, font, and layout.</p>

              <input ref={fileInputRef} type="file" accept=".txt,.pdf,.docx" className="hidden" onChange={handleResumeUpload} />

              <div className="mt-8 rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50 p-16 text-center">
                <div className="text-6xl">📄</div>
                <h3 className="mt-5 text-xl font-bold">Drop your resume here</h3>
                <p className="mt-2 text-sm text-gray-500">Supported formats: TXT now. PDF, DOCX extraction later.</p>
                <button onClick={() => fileInputRef.current?.click()} className="mt-6 rounded-xl bg-blue-600 px-6 py-3 font-bold text-white">Browse Files</button>
              </div>

              {importMessage && <p className="mt-5 rounded-xl bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{importMessage}</p>}

              {renderStyleSettings()}

              <div className="mt-8 flex justify-end">
                <button onClick={() => { saveMemory(); setMode("build"); setCurrentStep(9); }} className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white">
                  Continue to Preview →
                </button>
              </div>
            </div>
          )}

          {mode === "build" && (
            <>
              <div className="mb-8 rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
                <button onClick={() => setMode("start")} className="mb-4 font-bold text-blue-600">← Back</button>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold">Profile Progress</h2>
                    <p className="text-sm text-gray-500">Step {currentStep + 1} of {steps.length} · {steps[currentStep].title}</p>
                  </div>
                  <span className="rounded-full bg-blue-100 px-4 py-2 text-sm font-bold text-blue-700">{progress}% Complete</span>
                </div>
                <div className="mt-5 h-3 rounded-full bg-gray-100">
                  <div className="h-3 rounded-full bg-blue-600" style={{ width: `${progress}%` }} />
                </div>
              </div>

              <div className="grid grid-cols-12 gap-6">
                <aside className="col-span-12 rounded-2xl border border-blue-100 bg-white p-5 shadow-sm xl:col-span-3">
                  <h2 className="text-lg font-bold">Steps</h2>
                  <div className="mt-5 space-y-2">
                    {steps.map((step, index) => (
                      <button key={step.title} onClick={() => setCurrentStep(index)} className={`w-full rounded-xl px-4 py-3 text-left transition ${index === currentStep ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-blue-50"}`}>
                        <p className="text-sm font-bold">{index + 1}. {step.title}</p>
                        <p className={`mt-1 text-xs leading-5 ${index === currentStep ? "text-blue-100" : "text-gray-400"}`}>{step.description}</p>
                      </button>
                    ))}
                  </div>
                </aside>

                <section className="col-span-12 space-y-6 xl:col-span-6">
                  <div className="rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
                    <h2 className="text-xl font-bold">{steps[currentStep].title}</h2>
                    <p className="mt-2 text-sm text-gray-500">{steps[currentStep].description}</p>
                    {renderStepForm()}
                    <div className="mt-8 flex justify-end">
                      <button onClick={handleSaveAndContinue} className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white">
                        {currentStep === steps.length - 1 ? "Finish Memory" : "Save & Continue →"}
                      </button>
                    </div>
                  </div>
                </section>

                <aside className="col-span-12 space-y-6 xl:col-span-3">
                  <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                    <h2 className="text-lg font-bold">Memory Strength</h2>
                    <p className="mt-2 text-sm text-gray-500">More complete information creates better AI results.</p>
                    <div className="mt-5 h-2 rounded-full bg-gray-100">
                      <div className="h-2 rounded-full bg-blue-600" style={{ width: `${progress}%` }} />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                    <h2 className="text-lg font-bold">Selected Style</h2>
                    <div className="mt-4 space-y-2 text-sm font-semibold text-gray-600">
                      <p>📄 {memoryData.resumeTemplate}</p>
                      <p>✉️ {memoryData.coverLetterTemplate}</p>
                      <p>🎨 {memoryData.themeColor}</p>
                      <p>🔤 {memoryData.font}</p>
                      <p>📐 {memoryData.layout}</p>
                    </div>
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