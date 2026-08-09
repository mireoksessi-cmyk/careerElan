import type { Metadata } from "next";
import type { LucideIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  UserRoundPlus,
  LayoutTemplate,
  ClipboardPaste,
  ScanSearch,
  FileText,
  PenLine,
  ListChecks,
  ArrowRight,
} from "lucide-react";
import FooterGroup from "@/components/marketing/FooterGroup";

export const metadata: Metadata = {
  title: "How It Works | Career Élan",
  description:
    "See the end-to-end workflow: build your career profile once, choose your resume and template on your Dashboard, then let Career Élan help you go from job posting to a tailored, organized application.",
};

/*
  Phase 6I.6.25 - public marketing page, no auth/DB/AI. Mirrors app/
  features/page.tsx's own approach: Header/Footer markup+classes copied
  (not imported) for the same reason as that page - the real Header's
  Log in/Get Started buttons are wired to app/page.tsx's local auth-modal
  state, which this static page doesn't have and shouldn't reach into.
  FooterGroup itself IS a real shared import (components/marketing/
  FooterGroup.tsx), so Product/Company/Legal columns stay in sync with
  the home page and /features rather than drifting copies.

  Content-truth note (Part G of this phase's spec): step wording below is
  deliberately scoped to only claim behavior already verified in the
  actual product - Dashboard-authoritative resume/template selection
  (6I.6.14/15/16/19), Canada-wide (not "any remote job") scope policy
  (6I.6.22), the real Key Changes review card and <textarea> editing
  already present in app/paste-job/page.tsx, and Auto Apply's Coming
  Soon status (unchanged, not implied active anywhere below).
*/

type Step = {
  eyebrow: string;
  title: string;
  description: string;
  keyIdea: string;
  icon: LucideIcon;
  supportingList?: string[];
};

const STEPS: Step[] = [
  {
    eyebrow: "Step 1",
    title: "Build Your Career Profile",
    description:
      "Upload an existing resume or enter your experience directly into Career Memory. Your work history, education, skills, projects, certifications, and other career information become the foundation for future applications.",
    keyIdea: "Build once. Reuse across opportunities.",
    icon: UserRoundPlus,
  },
  {
    eyebrow: "Step 2",
    title: "Choose Your Resume & Template",
    description:
      "From your Dashboard, choose the resume you want to use and select its professional template. Career Élan keeps that resume and template together so new application packages start from the version you intended.",
    keyIdea: "Your Dashboard controls the resume and design used for new applications.",
    icon: LayoutTemplate,
  },
  {
    eyebrow: "Step 3",
    title: "Find or Paste a Job",
    description:
      "Explore opportunities or paste a job posting into Career Élan. The platform supports job postings available to applicants across Canada, including eligible remote roles.",
    keyIdea: "Bring the opportunity into one workspace.",
    icon: ClipboardPaste,
  },
  {
    eyebrow: "Step 4",
    title: "Understand the Job",
    description:
      "Career Élan analyzes the posting to identify the role's priorities, requirements, and important skills so you can understand what the employer is looking for.",
    keyIdea: "See the job before you tailor the application.",
    icon: ScanSearch,
  },
  {
    eyebrow: "Step 5",
    title: "Generate Your Application Package",
    description:
      "Using the resume and template already selected on your Dashboard, Career Élan creates a tailored application package for the opportunity.",
    keyIdea: "One selected resume. One selected template. One opportunity-specific package.",
    icon: FileText,
    supportingList: [
      "Tailored Resume",
      "Cover Letter",
      "Email Draft",
      "Package Analysis",
    ],
  },
  {
    eyebrow: "Step 6",
    title: "Review, Understand & Edit",
    description:
      "Review your tailored documents, see what changed and why, and make your own edits before applying.",
    keyIdea: "AI helps prepare the package. You stay in control of the final version.",
    icon: PenLine,
    supportingList: [
      "Tailored resume",
      "Cover letter",
      "Email draft",
      "Match analysis / key changes where available",
    ],
  },
  {
    eyebrow: "Step 7",
    title: "Apply & Track",
    description:
      "Apply through the employer's website, then keep your application materials and progress organized in Job Tracker.",
    keyIdea:
      "Your application history stays connected to the resume and template used when the package was created.",
    icon: ListChecks,
  },
];

const FLOW_NODES = [
  "Career Memory",
  "Dashboard Resume & Template",
  "Job Posting",
  "AI Analysis",
  "Generate Package",
  "Review & Edit",
  "Job Tracker",
];

export default function HowItWorksPage() {
  return (
    <main className="min-h-screen w-screen overflow-x-hidden bg-white text-slate-950">
      <header className="relative z-10 mx-auto flex w-full max-w-[1440px] items-center justify-between px-5 py-5 sm:px-8 lg:px-10 xl:px-12">
        <Link href="/">
          <Image
            src="/logo.png"
            alt="Career Élan"
            width={180}
            height={76}
            priority
            className="h-auto w-[145px] sm:w-[176px]"
          />
        </Link>

        <nav className="hidden items-center gap-8 text-[13px] font-bold text-slate-800 md:flex">
          <Link href="/#features" className="transition hover:text-blue-600">
            Features
          </Link>
          <Link href="/#how-it-works" className="transition hover:text-blue-600">
            How it Works
          </Link>
          <Link href="/#examples" className="transition hover:text-blue-600">
            Examples
          </Link>
          <Link href="/#pricing" className="transition hover:text-blue-600">
            Pricing
          </Link>
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <Link
            href="/"
            className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Log in
          </Link>

          <Link
            href="/"
            className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-extrabold text-white shadow-xl shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700"
          >
            Get Started
          </Link>
        </div>

        <Link
          href="/"
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-blue-200 md:hidden"
        >
          Start
        </Link>
      </header>

      <section className="w-full bg-gradient-to-br from-white via-blue-50 to-slate-50 px-5 py-14 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto max-w-[860px] text-center">
          <h1 className="text-3xl font-black tracking-[-0.03em] text-slate-950 sm:text-4xl">
            From Career History to Application — in One Workflow
          </h1>
          <p className="mt-4 text-base font-semibold leading-7 text-slate-600 sm:text-lg">
            Build your career profile once, choose the resume you want to
            use, and let Career Élan help you move from job discovery to a
            tailored application and organized follow-up.
          </p>
        </div>
      </section>

      <section className="w-full bg-white px-5 py-14 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto max-w-[760px]">
          {STEPS.map((step, index) => (
            <StepRow key={step.title} {...step} isLast={index === STEPS.length - 1} />
          ))}
        </div>
      </section>

      <section className="w-full bg-slate-50 px-5 py-14 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto max-w-[1200px] text-center">
          <h2 className="text-2xl font-black text-slate-950">
            One Connected Application Workflow
          </h2>

          <div className="mx-auto mt-8 flex max-w-[1100px] flex-wrap items-center justify-center gap-x-2 gap-y-4">
            {FLOW_NODES.map((node, index) => (
              <div key={node} className="flex items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-800 shadow-sm sm:text-sm">
                  {node}
                </span>
                {index < FLOW_NODES.length - 1 && (
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-blue-400"
                    strokeWidth={2.5}
                    aria-hidden="true"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="w-full bg-white px-5 py-6 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto max-w-[1440px] rounded-t-3xl bg-blue-600 p-8 text-center text-white sm:p-12">
          <h2 className="text-2xl font-black tracking-[-0.02em] sm:text-3xl">
            Ready to Build Your Next Application?
          </h2>
          <p className="mx-auto mt-3 max-w-[560px] text-sm font-semibold leading-6 text-blue-50 sm:text-base">
            Start with your career profile and let Career Élan guide the
            rest of the workflow.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="rounded-xl bg-white px-6 py-3 text-sm font-black text-blue-700 shadow-lg transition hover:-translate-y-0.5"
            >
              Get Started
            </Link>
            <Link
              href="/"
              className="rounded-xl border border-white/40 px-6 py-3 text-sm font-black text-white transition hover:bg-white/10"
            >
              Log In
            </Link>
          </div>
        </div>
      </section>

      <footer className="bg-slate-950 px-6 py-10 text-white sm:px-10 lg:px-16 xl:px-20">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-4">
          <div>
            <Image
              src="/logo.png"
              alt="Career Élan"
              width={190}
              height={74}
              className="h-auto w-[170px] rounded-md bg-white/95 p-1"
            />
            <p className="mt-4 text-sm text-slate-400">
              AI-powered career operating system.
            </p>
            <div className="mt-5 flex gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-black">
                in
              </span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-black">
                𝕏
              </span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-black">
                ◎
              </span>
            </div>
          </div>
          <FooterGroup
            title="Product"
            items={["Features", "How It Works", "Examples", "Pricing"]}
            links={{ Features: "/features", "How It Works": "/how-it-works" }}
          />
          <FooterGroup title="Company" items={["About Us", "Blog", "Careers", "Contact"]} />
          <FooterGroup
            title="Legal"
            items={["Privacy Policy", "Terms of Service", "Cookie Policy"]}
            links={{
              "Privacy Policy": "/privacy",
              "Terms of Service": "/terms",
              "Cookie Policy": "/cookies",
            }}
          />
        </div>
        <p className="mx-auto mt-8 max-w-7xl border-t border-white/10 pt-6 text-center text-sm text-slate-500">
          © 2026 Career Élan. All rights reserved.
        </p>
      </footer>
    </main>
  );
}

function StepRow({
  eyebrow,
  title,
  description,
  keyIdea,
  icon: Icon,
  supportingList,
  isLast,
}: Step & { isLast: boolean }) {
  return (
    <div className="relative flex gap-5 sm:gap-8">
      <div className="flex flex-col items-center">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-200">
          <Icon className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </div>
        {!isLast && <div className="mt-2 w-px flex-1 bg-slate-200" aria-hidden="true" />}
      </div>

      <div className={isLast ? "flex-1" : "flex-1 pb-10"}>
        <p className="text-xs font-black uppercase tracking-wide text-blue-600">{eyebrow}</p>
        <h3 className="mt-1 text-xl font-black text-slate-950">{title}</h3>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{description}</p>

        {supportingList && (
          <ul className="mt-3 space-y-1.5">
            {supportingList.map((item) => (
              <li
                key={item}
                className="flex items-center gap-2 text-sm font-semibold text-slate-600"
              >
                <span className="h-1 w-1 shrink-0 rounded-full bg-blue-400" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-xs font-bold text-slate-500">→ {keyIdea}</p>
      </div>
    </div>
  );
}
