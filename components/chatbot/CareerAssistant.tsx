"use client";

import { useState } from "react";
import CareerAssistantButton from "./CareerAssistantButton";

type HelpTopic = {
  id: string;
  title: string;
  description: string;
  content?: string;
  icon: string;
  iconClassName: string;
};

const helpTopics: HelpTopic[] = [
 {
  id: "career-memory",
  title: "Career Memory",
  description:
    "Profile, resume selection, and Career Memory setup.",

  content: `
Career Memory is your personal career profile that powers every application.

Create and manage your career information once, then use it across your entire job search.

• Create 1 Career Memory Resume directly inside Career Élan.
• Upload and save up to 3 additional resumes.
• Manage up to 4 resumes in total.
• Upload and save up to 3 cover letters.
• Select the resume and cover letter you want to use before generating an application package.
• Create a different tailored package for each job using your selected resume.
• Store your experience, education, skills, certifications, projects, languages, and career goals in one place.

Career Élan uses your selected materials to generate a tailored resume, cover letter, email draft, match analysis, missing requirements, and application recommendations.
`,

  icon: "🧠",
  iconClassName:
    "bg-blue-50 text-blue-600",
},
 {
  id: "application-package",
  title: "Create Package",
  description:
    "Generate, review, save, and download your package.",

  content: `
Create Package creates a complete, job-tailored application in minutes.

Select a resume (required) and, if you'd like, choose a cover letter before generating your application package. Career Élan then analyzes the job posting and creates personalized application materials.

• Generate a tailored resume for the selected job.
• Create a customized cover letter based on your experience and the job requirements (if a cover letter is selected).
• Generate a professional email draft ready to send to recruiters or hiring managers.
• Review your Resume Analysis to understand how well your resume aligns with the job.
• Identify Missing Requirements that are requested in the job posting but not reflected in your resume.
• Discover your Transferable Skills that strengthen your application even if you don't meet every requirement.
• Receive personalized AI Recommendations to improve your application before applying.
• Download or save your complete application package for future reference.

Career Élan helps you understand not only what was generated, but also why it was generated, giving you confidence before every application.
`,

  icon: "📦",
  iconClassName:
    "bg-purple-50 text-purple-600",
},
  {
  id: "find-jobs",
  title: "Find Jobs",
  description:
    "Job search and personalized recommendations.",

  content: `
Find Jobs helps you discover opportunities that match your skills, experience, and career goals.

Career Élan uses your Career Memory to recommend jobs that align with your background, making your job search faster and more relevant.

• Search for jobs by keyword, job title, company, or location.
• Receive personalized job recommendations based on your Career Memory.
• View key job details before deciding to apply.
• Save interesting jobs for later.
• Open the original job posting with a single click.
• Send any job directly to Application Package to generate a tailored resume, cover letter, email draft, and AI analysis.

By connecting your Career Memory with every job search, Career Élan helps you focus on opportunities that best match your qualifications and career goals.
`,

  icon: "🔍",
  iconClassName:
    "bg-emerald-50 text-emerald-600",
},
  {
  id: "paste-job",
  title: "Paste Job",
  description:
    "Analyze a job URL, description, or uploaded file.",

  content: `
Paste Job lets you quickly analyze any job posting and generate a personalized application package.

Simply provide a job URL, paste the job description, or upload a supported job posting file. Career Élan will extract the job details and prepare them for AI analysis.

• Paste a job URL from a supported job board.
• Paste the full job description directly into Career Élan.
• Upload a supported job posting file for analysis.
• Review the extracted job details before continuing.
• Generate an Application Package tailored to the selected job.
• Receive Resume Analysis, Missing Requirements, Transferable Skills, and AI Recommendations based on the job posting.

Paste Job makes it easy to turn any job posting into a personalized application package, helping you apply faster and with greater confidence.
`,

  icon: "📋",
  iconClassName:
    "bg-orange-50 text-orange-600",
},
  {
  id: "job-tracker",
  title: "Job Tracker",
  description:
    "Applications, statuses, interviews, and notes.",

  content: `
Job Tracker helps you organize and monitor every application in one place.

Track your job search from application to final decision without losing important details.

• View all of your submitted application packages.
• Track each application's current status, including Applied, Interview, Offer, Accepted, or Rejected.
• Review your generated resume, cover letter, email draft, and AI insights at any time.
• Keep your application history organized in one central location.
• Quickly return to previous applications whenever you need them.
• Monitor your overall job search progress as your applications move through each stage.

Job Tracker keeps your entire job search organized, making it easy to stay on top of every opportunity and never lose track of an application.
`,

  icon: "💼",
  iconClassName:
    "bg-sky-50 text-sky-600",
},
  {
  id: "analytics",
  title: "Analytics",
  description:
    "Application performance and career insights.",

  content: `
Analytics gives you a clear overview of your job search progress and application performance.

Track your results over time to understand how your job search is progressing and identify opportunities to improve.

• View the total number of applications you've submitted.
• Track interviews, offers, accepted positions, and rejected applications.
• Monitor your application progress with easy-to-read charts and statistics.
• Measure your interview and offer rates to evaluate your job search performance.
• Review trends to better understand your application outcomes over time.
• Use your analytics to refine your resume, application strategy, and future job searches.

Analytics helps you measure your progress, stay motivated, and make more informed decisions throughout your job search.
`,

  icon: "📊",
  iconClassName:
    "bg-cyan-50 text-cyan-600",
},
  {
  id: "resume-cover-letter",
  title: "Resume & Cover Letter",
  description:
    "Upload, select, preview, edit, or delete documents.",

  content: `
Resume & Cover Letter helps you manage all of your application documents in one place.

Keep your resumes and cover letters organized so they're always ready for your next application.

• Create and edit one Career Memory Resume directly in Career Élan.
• Upload and manage up to 3 additional resumes.
• Upload and manage up to 3 cover letters.
• Preview, edit, rename, or delete your saved documents at any time.
• Choose which resume and cover letter to use for each Application Package.
• Keep multiple versions of your resumes and cover letters for different roles or industries.

Resume & Cover Letter gives you the flexibility to organize your documents and quickly select the right materials for every job application.
`,

  icon: "📄",
  iconClassName:
    "bg-indigo-50 text-indigo-600",
},
  {
  id: "account-settings",
  title: "Account & Settings",
  description:
    "Profile, login, password, and account settings.",

  content: `
Account & Settings lets you manage your Career Élan account and personal preferences.

Keep your account information up to date and customize your experience.

• View and update your profile information.
• Change your account password at any time.
• Manage your account preferences and settings.
• Review your account information.
• Secure your account with updated login credentials when needed.

Account & Settings helps you keep your Career Élan account secure, personalized, and ready for every stage of your job search.
`,

  icon: "⚙️",
  iconClassName:
    "bg-slate-100 text-slate-600",
},
  {
  id: "billing-plan",
  title: "Billing & Plan",
  description:
    "Free Beta, Pro plan, usage limits, and billing.",

  content: `
Career Élan is currently available as a Free Beta.

During the beta period, each account can generate up to 5 Application Packages at no cost.

• Free Beta access.
• Up to 5 Application Package generations per account.
• No payment is required during the beta.
• Additional plans and features will be announced in the future.

Thank you for helping us test and improve Career Élan during the beta period.
`,

  icon: "💳",
  iconClassName:
    "bg-amber-50 text-amber-600",
},
  {
  id: "contact-support",
  title: "Contact Support",
  description:
    "Contact Career Élan for additional assistance.",

  content: `
Need additional help? We're here to assist you.

If you have questions, encounter an issue, or would like to share feedback or feature suggestions, please contact us at:

careerelanhq@gmail.com

• General questions
• Technical support
• Bug reports
• Feature requests
• Account-related inquiries

Our team will respond within 2 business days.

Thank you for helping us improve Career Élan.
`,

  icon: "✉️",
  iconClassName:
    "bg-rose-50 text-rose-600",
},
];

export default function CareerAssistant() {
  const [open, setOpen] =
    useState(false);

  

  const [
    selectedTopic,
    setSelectedTopic,
  ] = useState<HelpTopic | null>(
    null
  );

  

  function closeAssistant() {
    setOpen(false);
    setSelectedTopic(null);
  }

  return (
    <>
      <CareerAssistantButton
        onClick={() =>
          setOpen((previous) =>
            !previous
          )
        }
      />

      {open && (
        <section className="fixed bottom-24 right-6 z-[100] flex h-[720px] w-[440px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[30px] border border-blue-100 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.24)]">
          {/* Header */}
          <header className="flex shrink-0 items-center justify-between bg-gradient-to-r from-[#082a78] to-[#06215d] px-6 py-5 text-white">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-4 border-white/20 bg-blue-500 text-2xl shadow-inner">
                🤖
              </div>

              <div className="min-w-0">
                <h2 className="truncate text-xl font-extrabold">
                  Career Élan Assistant
                </h2>

                <div className="mt-1 flex items-center gap-2 text-sm text-blue-100">
                  <span className="h-2.5 w-2.5 rounded-full bg-green-400" />

                  <span>Online</span>
                </div>
              </div>
            </div>

            <div className="ml-3 flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setOpen(false)
                }
                aria-label="Minimize assistant"
                className="flex h-10 w-10 items-center justify-center rounded-full text-2xl text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                −
              </button>

              <button
                type="button"
                onClick={
                  closeAssistant
                }
                aria-label="Close assistant"
                className="flex h-10 w-10 items-center justify-center rounded-full text-3xl text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                ×
              </button>
            </div>
          </header>

          {/* Main content */}
          <div className="flex-1 overflow-y-auto bg-[#f8fbff] px-5 py-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 text-lg text-white">
                🤖
              </div>

              <div>
                <div className="max-w-[290px] rounded-3xl rounded-tl-md bg-white px-5 py-4 text-sm leading-6 text-slate-800 shadow-sm">
                  Hi! 👋
                  <br />
                  How can I help you
                  today?
                </div>

                <p className="mt-2 text-xs text-slate-400">
                  Career Élan Support
                </p>
              </div>
            </div>

            {!selectedTopic ? (
              <>
                <div className="mt-6 flex items-center justify-between">
                  <div>
                    <h3 className="font-extrabold text-slate-900">
                      Help Topics
                    </h3>

                    <p className="mt-1 text-xs text-slate-500">
                      Choose a topic to
                      continue.
                    </p>
                  </div>

                  <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-bold text-blue-600">
                    Support
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  {helpTopics.map(
                    (topic) => (
                      <button
                        key={topic.id}
                        type="button"
                        onClick={() =>
                          setSelectedTopic(
                            topic
                          )
                        }
                        className="group min-h-[150px] rounded-2xl border border-blue-100 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div
                            className={`flex h-11 w-11 items-center justify-center rounded-xl text-xl ${topic.iconClassName}`}
                          >
                            {topic.icon}
                          </div>

                          <span className="text-xl text-slate-300 transition group-hover:translate-x-1 group-hover:text-blue-600">
                            ›
                          </span>
                        </div>

                        <h4 className="mt-4 text-sm font-extrabold text-slate-900">
                          {topic.title}
                        </h4>

                        <p className="mt-2 text-xs leading-5 text-slate-500">
                          {
                            topic.description
                          }
                        </p>
                      </button>
                    )
                  )}
                </div>
              </>
            ) : (
              <div className="mt-6">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedTopic(
                      null
                    )
                  }
                  className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:text-blue-700"
                >
                  ← Back to all topics
                </button>

                <div className="mt-4 rounded-3xl border border-blue-100 bg-white p-5 shadow-sm">
                  <div className="flex items-start gap-4">
                    <div
                      className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-2xl ${selectedTopic.iconClassName}`}
                    >
                      {
                        selectedTopic.icon
                      }
                    </div>

                    <div>
                      <h3 className="text-lg font-extrabold text-slate-900">
                        {
                          selectedTopic.title
                        }
                      </h3>

                      <div className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-600">
  {selectedTopic.content ?? selectedTopic.description}
</div>
                    </div>
                  </div>

                  {/* 세부 문의 카드를 나중에 이곳에 추가 */}
                  <div className="mt-5 min-h-[260px] rounded-2xl border border-dashed border-slate-200 bg-slate-50" />
                </div>
              </div>
            )}
          </div>

          
        </section>
      )}
    </>
  );
}