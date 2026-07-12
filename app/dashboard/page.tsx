"use client";

import { searchJobs } from "@/lib/services/search";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";

const menuItems = [
  "Dashboard",
  "Career Memory",
  "Find Jobs",
  "Create Package",
  "Job Tracker",
  "Analytics",
  "Settings",
];

const progressCards = [
  { title: "Career Memory", change: "+6%", note: "profile improved this week", icon: "🧠" },
  { title: "Application Packages", change: "+3", note: "new packages created this week", icon: "📦" },
  { title: "Applications Sent", change: "+5", note: "applications submitted this month", icon: "📤" },
  { title: "Interviews", change: "+2", note: "interviews scheduled", icon: "🗓️" },
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

const neutralJobs: JobItem[] = [
  { title: "Administrative Assistant", company: "Office Support Role", location: "Toronto, ON", type: "Full-time", tags: ["Office", "Admin"], matched: ["Communication", "Organization", "Microsoft Office"], missing: ["Upload resume for deeper match"] },
  { title: "Customer Service Representative", company: "Client Service Role", location: "Toronto, ON", type: "Part-time", tags: ["Customer Service", "Communication"], matched: ["Customer service", "Phone support", "Problem solving"], missing: ["Add work history for better match"] },
  { title: "Office Clerk", company: "Entry-Level Office Role", location: "Toronto, ON", type: "Full-time", tags: ["Data Entry", "Organization"], matched: ["Data entry", "Filing", "Document organization"], missing: ["Add skills to personalize"] },
  { title: "Receptionist", company: "Front Desk Role", location: "Toronto, ON", type: "Part-time", tags: ["Reception", "Client Service"], matched: ["Greeting clients", "Scheduling", "Email communication"], missing: ["Add language skills"] },
  { title: "Data Entry Clerk", company: "General Office Role", location: "Remote / Hybrid", type: "Remote", tags: ["Data Entry", "Remote"], matched: ["Typing accuracy", "File organization", "Attention to detail"], missing: ["Upload resume for better match"] },
  { title: "Legal Assistant", company: "Entry-Level Legal Role", location: "Toronto, ON", type: "Full-time", tags: ["Legal", "Admin"], matched: ["Document handling", "Client communication", "Office support"], missing: ["Add education details"] },
  { title: "Program Assistant", company: "Non-Profit Organization", location: "Toronto, ON", type: "Part-time", tags: ["Program", "Admin"], matched: ["Event support", "Volunteer coordination", "Client service"], missing: ["Add project details"] },
  { title: "HR Assistant", company: "Human Resources Role", location: "Toronto, ON", type: "Hybrid", tags: ["HR", "Admin"], matched: ["Email communication", "Organization", "Office support"], missing: ["Add HR-related experience"] },
  { title: "Client Intake Assistant", company: "Community Service Role", location: "Toronto, ON", type: "Full-time", tags: ["Client Intake", "Support"], matched: ["Client communication", "Documentation", "Customer service"], missing: ["Add intake experience"] },
];

const personalizedJobs: JobItem[] = [
  { title: "Legal Assistant", company: "TD Bank", location: "Toronto, ON", type: "Full-time", tags: ["Legal", "Admin"], match: "94%", matched: ["Law Clerk education", "Administrative experience", "Outlook & email", "Customer service"], missing: ["Clio", "Legal research experience"] },
  { title: "Administrative Assistant", company: "RBC", location: "Toronto, ON", type: "Full-time", tags: ["Office", "Client Service"], match: "91%", matched: ["Excel skills", "Scheduling", "Email communication", "Volunteer coordination"], missing: ["SAP experience"] },
  { title: "Law Clerk Intern", company: "BMO", location: "Toronto, ON", type: "Internship", tags: ["Law Clerk", "Research"], match: "90%", matched: ["Law Clerk program", "Document preparation", "Research & analysis", "Client communication"], missing: ["Additional language skills"] },
  { title: "Customer Service Representative", company: "Scotiabank", location: "Toronto, ON", type: "Part-time", tags: ["Customer Service", "Banking"], match: "88%", matched: ["Customer service", "Phone & email support", "Problem solving", "Bilingual Korean/English"], missing: ["Additional language skills"] },
  { title: "Office Clerk", company: "CIBC", location: "Toronto, ON", type: "Full-time", tags: ["Data Entry", "Office"], match: "87%", matched: ["Data entry experience", "Filing & documents", "Microsoft Office"], missing: ["Accounting software"] },
  { title: "Data Entry Clerk", company: "OMERS", location: "Toronto, ON", type: "Remote", tags: ["Data Entry", "Remote"], match: "85%", matched: ["Data accuracy", "Microsoft Excel", "Attention to detail"], missing: ["Database experience"] },
  { title: "Legal Receptionist", company: "Toronto Legal Clinic", location: "Toronto, ON", type: "Full-time", tags: ["Legal", "Reception"], match: "83%", matched: ["Client intake", "Phone support", "Document handling"], missing: ["Legal clinic experience"] },
  { title: "Program Coordinator", company: "Community Agency", location: "Toronto, ON", type: "Part-time", tags: ["Program", "Non-profit"], match: "82%", matched: ["Event coordination", "Google Forms", "Client communication"], missing: ["Grant reporting"] },
  { title: "Government Clerk", company: "Ontario Public Service", location: "Toronto, ON", type: "Full-time", tags: ["Government", "Admin"], match: "80%", matched: ["Documentation", "Data entry", "Client service"], missing: ["Government experience"] },
];

const defaultInsightItems = [
  { name: "Add your target roles", level: "Recommended" },
  { name: "Add language skills", level: "Worth Adding" },
  { name: "Add work or volunteer details", level: "Worth Adding" },
  { name: "Add certifications or licenses", level: "Nice to Have" },
];

const personalizedInsightItems = [
  { name: "Add measurable achievements", level: "Recommended" },
  { name: "Add tools or software you used", level: "Worth Adding" },
  { name: "Add language skills", level: "Worth Adding" },
  { name: "Add certifications or licenses", level: "Nice to Have" },
];

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

export default function DashboardPage() {
  const { user, loading } = useAuth();
  console.log("USER =", user);
console.log("LOADING =", loading);

  const [careerMemoryCompleted, setCareerMemoryCompleted] = useState(false);
  const [careerMemory, setCareerMemory] = useState<any>(null); const [memoryStrength, setMemoryStrength] = useState(0);
  const [resumes, setResumes] = useState<any[]>([]);
const [coverLetters, setCoverLetters] = useState<any[]>([]);
const [selectedResumeType, setSelectedResumeType] =
useState("");
const [name, setName] = useState("Guest");

const [selectedResumeId, setSelectedResumeId] =
useState("");

const [selectedCoverLetterId, setSelectedCoverLetterId] =
useState("");
const [selectedResume, setSelectedResume] = useState("");
const [selectedCoverLetter, setSelectedCoverLetter] = useState("");
  const [careerFairLocation, setCareerFairLocation] = useState("Toronto, ON");
  const [stats, setStats] = useState({ packages: 0, applications: 0, interviews: 0 });
  const [careerFairs, setCareerFairs] = useState(defaultCareerFairs);
  const [showTour, setShowTour] = useState(false);
  const [visibleJobs, setVisibleJobs] = useState(6);
  const [recommendedJobs, setRecommendedJobs] =
  useState<JobItem[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [insightItems, setInsightItems] = useState(defaultInsightItems);
  const [showPackageChoice, setShowPackageChoice] = useState(false);
  const router = useRouter();

  async function loadProfile() {
 

  if (!user) return;

  const { data } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (data?.full_name) {
    setName(data.full_name);
  }
}

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

async function loadDashboard() {

  console.log("===== loadDashboard START =====");

  const cachedJobs = sessionStorage.getItem("recommendedJobs");
  const cachedTime = sessionStorage.getItem("recommendedJobsTime");

  console.log("1. cachedJobs =", !!cachedJobs);
  console.log("2. cachedTime =", cachedTime);

  if (cachedJobs) {
    setRecommendedJobs(JSON.parse(cachedJobs));
  }

  if (!user) {
    console.log("❌ NO USER");
    return;
  }

  console.log("3. USER ID =", user.id);

  const {
    data: resumes,
    error: resumeError,
  } = await supabase
    .from("resumes")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  console.log("4. resumeError =", resumeError);
  console.log("5. resumes =", resumes);

  const {
    data: coverLetters,
    error: coverError,
  } = await supabase
    .from("cover_letters")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  console.log("===== loadDashboard =====");

const { data, error } = await supabase
  .from("career_memory")
  .select("*")
  .eq("user_id", user.id)
  .single();

console.log("career_memory data =", data);
console.log("career_memory error =", error);

if (error || !data) {
  console.error("STOPPED HERE");
  return;
}

console.log("required_completed =", data.required_completed);

  setCareerMemory(data);

  setSelectedResume(
    data.selected_resume_type === "career_memory"
      ? "career_memory"
      : data.selected_resume_id || ""
  );

  setSelectedCoverLetter(
    data.selected_cover_letter_id || ""
  );

  setCareerMemoryCompleted(data.required_completed ?? false);
  setMemoryStrength(data.profile_strength ?? 0);

  setResumes(resumes ?? []);
  setCoverLetters(coverLetters ?? []);

  if (
    data.selected_resume_type === "career_memory" ||
    data.resume_name
  ) {
    setSelectedResume("career_memory");
  }

  setSelectedCoverLetter("");

  if (!data.required_completed) {
    console.log("❌ RETURN HERE (required_completed = false)");
    return;
  }

  console.log("11. ABOUT TO FETCH");

  setCareerFairs(personalizedCareerFairs);
  setInsightItems(personalizedInsightItems);

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
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
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
              location: aiJob.location || "Canada",
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
      "recommendedJobs",
      JSON.stringify(realJobs)
    );
    sessionStorage.setItem(
  "recommendedJobsTime",
  Date.now().toString()
);
  })
  .catch((err) => {
  console.error(err);
  setLoadingJobs(false);
});
}
useEffect(() => {
  if (!user) return;

  loadUserName();
}, [user]);

async function loadUserName() {
  if (!user) return;

  console.log("USER =", user);

  const { data, error } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  console.log("PROFILE DATA =", data);
  console.log("PROFILE ERROR =", error);

  if (data?.full_name) {
    setName(data.full_name);
  } else {
    setName(
      user.user_metadata?.given_name ||
      user.user_metadata?.full_name ||
      "Guest"
    );
  }
}

useEffect(() => {
  if (user) {
    loadUserName();
    loadProfile();
    loadDashboard();
  }

  const tourSeen = localStorage.getItem("careerElanTourSeen");

  if (!tourSeen) {
    setShowTour(true);
  }
}, [user]);

useEffect(() => {
  async function loadStats() {
    if (!user) return;

    const { count: packages } = await supabase
      .from("applications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "package_generated");

    const { count: applications } = await supabase
      .from("applications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "applied");

    const { count: interviews } = await supabase
      .from("applications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "interview");

    setStats({
      packages: packages ?? 0,
      applications: applications ?? 0,
      interviews: interviews ?? 0,
    });
  }

  if (user) {
    loadStats();
  }
}, [user]);
  
  

  function closeTour() {
    localStorage.setItem("careerElanTourSeen", "true");
    setShowTour(false);
  }

  function handleCareerFairSearch() {
    setCareerFairs(careerMemoryCompleted ? personalizedCareerFairs : defaultCareerFairs);
  }
   console.log("recommendedJobs state =", recommendedJobs);
   console.log("recommendedJobs length =", recommendedJobs.length);
   console.table(recommendedJobs);
  return (
    <main className="min-h-screen bg-[#f6fbff] text-gray-900">
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
  Good morning, {name}! 👋
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
  {name.charAt(0).toUpperCase()}
</div>
                <div>
                  <p className="text-sm font-bold">{name}</p>
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
                  {progressCards.map((card) => (
                    <div key={card.title} className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-semibold text-gray-500">{card.title}</p>
                         <h3 className="mt-3 text-3xl font-extrabold">{card.title === "Application Packages" ? stats.packages : card.title === "Applications Sent" ? stats.applications : card.title === "Interviews" ? stats.interviews : `${memoryStrength}%`}</h3>
                        </div>
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-xl">{card.icon}</div>
                      </div>

                      <p className="mt-3 text-xs text-gray-500">
                        <span className="font-bold text-green-600">{card.change}</span> {card.note}
                      </p>

                      <div className="mt-5 flex items-center justify-between text-sm">
                        <a href="#" className="font-bold text-blue-600">View Details</a>
                        <span>→</span>
                      </div>
                    </div>
                  ))}
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

<div>

<h3 className="mb-3 font-bold">
Resume <span className="text-red-500">*</span>
</h3>

{careerMemory?.required_completed && (

<label className="mb-3 flex cursor-pointer items-center gap-3 rounded-xl border p-3">

<input
type="radio"
name="resume"
checked={selectedResume==="career_memory"}
onChange={async()=>{

setSelectedResume("career_memory");

await saveSelection(
"career_memory",
null,
selectedCoverLetter || null
);

}}
/>

<div>

<p className="font-semibold">
Career Memory Resume
</p>

<p className="text-sm text-gray-500">
  {careerMemory.resume_name || "Career Memory Resume"}
</p>

</div>

</label>

)}

{resumes.map((resume:any)=>(

<label
key={resume.id}
className="mb-3 flex cursor-pointer items-center gap-3 rounded-xl border p-3"
>

<input
type="radio"
name="resume"
checked={selectedResume===resume.id}
onChange={async()=>{

setSelectedResume(resume.id);

await saveSelection(
"upload",
resume.id,
selectedCoverLetter || null
);

}}
/>

<div>

<p className="font-semibold">
Uploaded Resume
</p>

<p className="text-sm text-gray-500">
{resume.file_name}
</p>

</div>

</label>

))}

</div>

<div>

<h3 className="mb-3 font-bold">
Cover Letter
<span className="ml-2 text-xs text-gray-500">
(Optional)
</span>
</h3>

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

{coverLetters.map((cover:any)=>(

<label
key={cover.id}
className="mb-3 flex cursor-pointer items-center gap-3 rounded-xl border p-3"
>

<input
type="radio"
name="cover"
checked={selectedCoverLetter===cover.id}
onChange={async()=>{

setSelectedCoverLetter(cover.id);

await saveSelection(
selectedResume==="career_memory"
? "career_memory"
: "upload",

selectedResume==="career_memory"
? null
: selectedResume,

cover.id
);

}}
/>

<div>

<p className="font-semibold">
Uploaded Cover Letter
</p>

<p className="text-sm text-gray-500">
{cover.file_name}
</p>

</div>

</label>

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
                  {careerMemoryCompleted
                    ? "Based on your profile and application materials."
                    : "Small updates that can make your profile stronger."}
                </p>

                <div className="mt-5 space-y-4">
                  {insightItems.map((item) => (
                    <div key={item.name} className="rounded-xl bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-bold">{item.name}</p>
                        <span className="whitespace-nowrap rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-600">{item.level}</span>
                      </div>
                      <a href="/career-memory" className="mt-2 block text-xs font-bold text-blue-600">Review</a>
                    </div>
                  ))}
                </div>

                <button className="mt-5 text-sm font-bold text-blue-600 hover:underline">
                  More insights →
                </button>
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
                <h2 className="text-lg font-bold">AI Usage</h2>
                <p className="mt-2 text-sm text-gray-500">Monthly AI generation usage.</p>

                <div className="mt-5">
                  <div className="flex justify-between text-xs font-bold text-gray-500">
                    <span>Used</span>
                    <span>41 / 100</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-gray-100">
                    <div className="h-2 w-[41%] rounded-full bg-green-500" />
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between">
                  <p className="text-sm font-bold text-gray-600">Plan: Free</p>
                  <button className="rounded-xl bg-blue-50 px-4 py-2 text-sm font-bold text-blue-600">
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
  );
}