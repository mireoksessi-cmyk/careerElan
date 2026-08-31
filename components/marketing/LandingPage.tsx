"use client";

import Image from "next/image";
import { useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  CreditCard,
  Eye,
  FileText,
  LayoutGrid,
  ListChecks,
  Mail,
  MapPin,
  Menu,
  PenLine,
  Sparkles,
  Target,
  X,
  Zap,
} from "lucide-react";

/*
  The public landing page's presentation, and only its presentation.

  Kept out of app/page.tsx because that file also holds real behaviour - the
  auth-actions provider, the session lookup that decides whether Log in /
  Get Started render at all, and the suspended-account notice. Those stayed
  where they were; this component receives the two values it needs and owns
  no state, no effect, no request and no auth logic of its own. Nothing here
  can change how signing up works.

  Every call to action routes through the same openAuth("signup") the page
  already used, so the sign-up path is unchanged.

  All preview content below - the name, the role, the percentages, the
  bullet lists - is invented demo material used to show what the product
  produces. It is labelled as an example wherever a number appears, and it
  is never presented as a promise or as anyone's real application.
*/

type LandingPageProps = {
  openAuth: (mode?: "login" | "signup") => void;
  showAuthCta: boolean;
};

const DEMO_NAME = "ALEX CARTER";
const DEMO_ROLE = "Marketing Coordinator";
const DEMO_MATCH = 95;

export default function LandingPage({ openAuth, showAuthCta }: LandingPageProps) {
  return (
    <>
      {/* ============================ HERO ============================ */}
      <section className="relative overflow-hidden bg-gradient-to-b from-blue-50/80 via-white to-white">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-32 -top-24 h-[420px] w-[420px] rounded-full bg-blue-300/25 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 top-10 h-[460px] w-[460px] rounded-full bg-violet-300/25 blur-3xl"
        />

        <LandingHeader openAuth={openAuth} showAuthCta={showAuthCta} />

        <div className="relative z-10 mx-auto grid w-full max-w-[1200px] items-center gap-10 px-5 pb-14 pt-1 sm:px-8 sm:pb-20 lg:grid-cols-[1fr_1.12fr] lg:gap-12 lg:pb-24 lg:pt-0">
          {/* ---- hero copy ---- */}
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-extrabold text-blue-700 shadow-sm ring-1 ring-blue-100 sm:text-xs">
              <span aria-hidden="true">🇨🇦</span> Built for job seekers in Canada
            </p>

            <h1 className="mt-4 text-[34px] font-black leading-[1.04] tracking-[-0.045em] text-slate-900 sm:mt-5 sm:text-[48px] lg:text-[56px] xl:text-[62px]">
              Upload One Resume.
              <br />
              <span className="text-blue-600">Tailor Every Application.</span>
            </h1>

            <p className="mt-4 max-w-[500px] text-[15px] leading-7 text-slate-600 sm:mt-5 sm:text-[17px]">
              Save time. Get a personalized application package built around you
              and tailored to every job posting.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-slate-600">
                <CheckCircle2
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-emerald-500"
                />
                Free during Beta
              </span>
              <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-slate-600">
                <CreditCard
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-blue-500"
                />
                No credit card required
              </span>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => openAuth("signup")}
                className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-7 py-3.5 text-[15px] font-black text-white shadow-lg shadow-blue-600/25 transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:w-auto"
              >
                Try Career Élan Free
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 transition group-hover:translate-x-0.5"
                />
              </button>
              <a
                href="#real-example"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-7 py-3.5 text-[15px] font-black text-slate-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:w-auto"
              >
                <Eye aria-hidden="true" className="h-4 w-4" />
                See an Example
              </a>
            </div>
          </div>

          {/*
            The application package, shown as the three documents it
            actually produces. A first-time visitor should understand from
            the hero alone that this is not a resume rewriter - the resume
            leads, with the cover letter and email draft layered beneath it,
            so the three read as one package rather than three features.

            No score or match figure appears here on purpose: the hero sells
            what Career Élan produces, not a performance claim.
          */}
          <div className="relative min-w-0 pt-8 lg:pt-0">
            <div className="relative mx-auto w-full max-w-[440px] lg:max-w-none">
              <Sparkles
                aria-hidden="true"
                className="absolute -left-2 -top-4 h-5 w-5 text-violet-400/70"
              />
              <Sparkles
                aria-hidden="true"
                className="absolute -bottom-2 right-2 h-4 w-4 text-blue-400/70"
              />

              {/* resume - front of the stack */}
              <div className="relative z-10 mx-auto w-[88%] rotate-[-1.5deg] rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_18px_45px_-14px_rgba(15,23,42,0.25)] sm:w-[82%] sm:p-5">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                    <FileText aria-hidden="true" className="h-4 w-4" />
                  </span>
                  <p className="text-[13px] font-black text-slate-900">Resume</p>
                </div>

                <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                  <p className="text-[11px] font-black tracking-[0.08em] text-slate-900">
                    {DEMO_NAME}
                  </p>
                  <p className="text-[9px] font-bold text-blue-600">{DEMO_ROLE}</p>

                  <p className="mt-2.5 text-[8px] font-black uppercase tracking-wider text-slate-400">
                    Professional Summary
                  </p>
                  <div className="mt-1.5 space-y-1" aria-hidden="true">
                    <div className="h-1 w-full rounded-full bg-slate-200" />
                    <div className="h-1 w-[90%] rounded-full bg-slate-100" />
                    <div className="h-1 w-[66%] rounded-full bg-blue-200" />
                  </div>

                  <p className="mt-2.5 text-[8px] font-black uppercase tracking-wider text-slate-400">
                    Experience
                  </p>
                  <div className="mt-1.5 space-y-1" aria-hidden="true">
                    <div className="h-1 w-[48%] rounded-full bg-slate-300" />
                    <div className="h-1 w-full rounded-full bg-slate-100" />
                    <div className="h-1 w-[84%] rounded-full bg-slate-100" />
                    <div className="h-1 w-[42%] rounded-full bg-slate-300" />
                    <div className="h-1 w-[92%] rounded-full bg-slate-100" />
                    <div className="h-1 w-[58%] rounded-full bg-blue-200" />
                  </div>
                </div>

                <span className="mt-3 inline-block rounded-full bg-blue-50 px-2.5 py-1 text-[9px] font-black text-blue-700">
                  Tailored to the job
                </span>
              </div>

              {/* cover letter + email draft - layered beneath the resume */}
              <div className="relative z-20 -mt-5 grid grid-cols-2 gap-3 sm:gap-4">
                <div className="rotate-[2deg] rounded-2xl border border-slate-200/90 bg-white p-3 shadow-[0_16px_40px_-14px_rgba(109,40,217,0.30)] sm:p-4">
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 ring-1 ring-violet-100">
                      <PenLine aria-hidden="true" className="h-3.5 w-3.5" />
                    </span>
                    <p className="truncate text-[11px] font-black text-slate-900">
                      Cover Letter
                    </p>
                  </div>

                  <div className="mt-2.5 rounded-lg border border-slate-100 bg-slate-50/70 p-2.5">
                    <p className="text-[9px] font-black text-slate-800">
                      Dear Hiring Manager,
                    </p>
                    <div className="mt-1.5 space-y-1" aria-hidden="true">
                      <div className="h-1 w-full rounded-full bg-slate-100" />
                      <div className="h-1 w-[92%] rounded-full bg-slate-100" />
                      <div className="h-1 w-[70%] rounded-full bg-violet-200" />
                      <div className="h-1 w-[86%] rounded-full bg-slate-100" />
                    </div>
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 90 20"
                      className="mt-2 h-4 w-[58px] text-slate-400"
                    >
                      <path
                        d="M2 15c8-10 13 4 20-4S36 2 42 9s6 8 12 3 14-8 22-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>

                  <p className="mt-2 text-[8px] font-bold text-violet-700">
                    Personalized for the role
                  </p>
                </div>

                <div className="rotate-[-2.5deg] rounded-2xl border border-slate-200/90 bg-white p-3 shadow-[0_16px_40px_-14px_rgba(16,185,129,0.30)] sm:p-4">
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
                      <Mail aria-hidden="true" className="h-3.5 w-3.5" />
                    </span>
                    <p className="truncate text-[11px] font-black text-slate-900">
                      Email Draft
                    </p>
                  </div>

                  <div className="mt-2.5 rounded-lg border border-slate-100 bg-slate-50/70 p-2.5">
                    <p className="text-[8px] font-bold text-slate-400">Subject:</p>
                    <p className="text-[9px] font-black leading-snug text-slate-800">
                      Application for Senior UX/UI Designer
                    </p>
                    <div className="mt-1.5 space-y-1" aria-hidden="true">
                      <div className="h-1 w-full rounded-full bg-slate-100" />
                      <div className="h-1 w-[88%] rounded-full bg-slate-100" />
                      <div className="h-1 w-[64%] rounded-full bg-emerald-200" />
                    </div>
                  </div>

                  <p className="mt-2 text-[8px] font-bold text-emerald-700">
                    Ready to edit &amp; send
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ======================= PACKAGE SECTION ======================= */}
      <section
        id="real-example"
        className="scroll-mt-16 bg-white px-5 py-16 sm:px-8 sm:py-20"
      >
        <div className="mx-auto max-w-[1200px]">
          <SectionHeading
            title="Your AI Application Package"
            subtitle="Everything tailored to the job description in minutes."
          />

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {/* card 1 - resume */}
            <PackageCard
              tone="blue"
              icon={<FileText aria-hidden="true" className="h-5 w-5" />}
              title="Optimized Resume"
              subtitle="Tailored to the job description"
              checks={[
                "ATS-friendly formatting",
                "Changes explained",
                "Tailored to the JD",
              ]}
            >
              <p className="text-[11px] font-black tracking-[0.08em] text-slate-900">
                {DEMO_NAME}
              </p>
              <p className="text-[9px] font-bold text-blue-600">{DEMO_ROLE}</p>
              <div className="mt-2.5 space-y-1.5" aria-hidden="true">
                <div className="h-1 w-[40%] rounded-full bg-slate-300" />
                <div className="h-1 w-full rounded-full bg-slate-100" />
                <div className="h-1 w-[88%] rounded-full bg-slate-100" />
                <div className="h-1 w-[35%] rounded-full bg-slate-300" />
                <div className="h-1 w-[94%] rounded-full bg-slate-100" />
                <div className="h-1 w-[62%] rounded-full bg-blue-200" />
              </div>
            </PackageCard>

            {/* card 2 - cover letter */}
            <PackageCard
              tone="violet"
              icon={<PenLine aria-hidden="true" className="h-5 w-5" />}
              title={
                <>
                  Personalized
                  <br />
                  Cover Letter
                </>
              }
              subtitle="Speaks to the hiring manager"
              checks={[
                "Custom for the role",
                "Highlights your fit",
                "Ready to send",
              ]}
            >
              <p className="text-[10px] font-black text-slate-800">
                Dear Hiring Manager,
              </p>
              <div className="mt-2.5 space-y-1.5" aria-hidden="true">
                <div className="h-1 w-full rounded-full bg-slate-100" />
                <div className="h-1 w-[95%] rounded-full bg-slate-100" />
                <div className="h-1 w-[70%] rounded-full bg-violet-200" />
                <div className="h-1 w-full rounded-full bg-slate-100" />
                <div className="h-1 w-[80%] rounded-full bg-slate-100" />
              </div>
              <svg
                aria-hidden="true"
                viewBox="0 0 90 22"
                className="mt-3 h-5 w-[76px] text-slate-400"
              >
                <path
                  d="M2 16c8-11 13 4 20-4S36 2 42 9s6 9 12 4 14-9 22-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </PackageCard>

            {/* card 3 - email */}
            <PackageCard
              tone="emerald"
              icon={<Mail aria-hidden="true" className="h-5 w-5" />}
              title="Email Draft"
              subtitle="Professional follow-up message"
              checks={[
                "Application email draft",
                "Professional tone",
                "Edit and send",
              ]}
            >
              <p className="text-[9px] font-bold text-slate-400">Subject:</p>
              <p className="text-[10px] font-black leading-snug text-slate-800">
                Application for Senior UX/UI Designer
              </p>
              <div className="mt-2.5 space-y-1.5" aria-hidden="true">
                <div className="h-1 w-full rounded-full bg-slate-100" />
                <div className="h-1 w-[90%] rounded-full bg-slate-100" />
                <div className="h-1 w-[66%] rounded-full bg-emerald-200" />
                <div className="h-1 w-[84%] rounded-full bg-slate-100" />
              </div>
            </PackageCard>
          </div>
        </div>
      </section>

      {/* ======================= ANALYSIS SECTION ====================== */}
      <section className="bg-gradient-to-b from-white via-blue-50/40 to-white px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-[1200px]">
          <SectionHeading
            title="See what changes — and why"
            subtitle="Our AI shows you what was improved, what matches, and what's missing."
          />

          {/*
            The real product, not a drawing of it. This is a screenshot of an
            actual generated package beside its analysis - the same panel a
            person sees after Generate Package runs - so the section shows
            what Career Élan produces rather than a stylised approximation of
            it. Presentation only: nothing inside is interactive.
          */}
          <div className="mt-10 overflow-hidden rounded-2xl border border-slate-200/80 shadow-[0_10px_40px_-16px_rgba(15,23,42,0.18)]">
            <Image
              src="/marketing/application-package-analysis.png"
              alt="Career Élan example application package with tailored resume and AI job-match analysis"
              width={1536}
              height={1133}
              sizes="(min-width: 1280px) 1200px, 100vw"
              className="h-auto w-full"
            />
          </div>
        </div>
      </section>

      {/* ======================= BENEFITS SECTION ====================== */}
      <section className="bg-white px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-[1200px]">
          <SectionHeading title="Why job seekers use Career Élan" />

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <BenefitCard
              tone="blue"
              icon={<Target aria-hidden="true" className="h-5 w-5" />}
              title="Job-specific resume"
              body="Rewritten for the posting in front of you."
            />
            <BenefitCard
              tone="violet"
              icon={<Zap aria-hidden="true" className="h-5 w-5" />}
              title="One-click AI tailoring"
              body="Paste the job, get the package."
            />
            <BenefitCard
              tone="emerald"
              icon={<LayoutGrid aria-hidden="true" className="h-5 w-5" />}
              title="Full application package"
              body="Resume, cover letter and email draft together."
            />
            <BenefitCard
              tone="amber"
              icon={<ListChecks aria-hidden="true" className="h-5 w-5" />}
              title="Explains every change"
              body="See what was edited and why."
            />
            <BenefitCard
              tone="sky"
              icon={<FileText aria-hidden="true" className="h-5 w-5" />}
              title="Track every application"
              body="Keep every job and package in one place."
            />
            <BenefitCard
              tone="rose"
              icon={<MapPin aria-hidden="true" className="h-5 w-5" />}
              title="Built for Canada"
              body="Canadian postings and Canadian formatting."
            />
          </div>
        </div>
      </section>

      {/* ======================= HOW IT WORKS ========================= */}
      <section className="bg-gradient-to-b from-white via-blue-50/30 to-white px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-[1200px]">
          <SectionHeading
            title="How It Works"
            subtitle="From one resume to a tailored application strategy in four simple steps."
          />

          {/*
            Four steps, written to match what the product actually does. The
            wording stops at "prepares" and "review" on purpose - Career Élan
            builds the package and the analysis, and the person decides where
            and when to send it.
          */}
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                step: "1",
                title: "Upload Your Resume or Build It Directly",
                body: "Upload your existing resume or create your career information directly in Career Élan.",
                icon: <FileText aria-hidden="true" className="h-5 w-5" />,
                chip: "bg-blue-50 text-blue-600 ring-blue-100",
                num: "text-blue-600",
              },
              {
                step: "2",
                title: "Paste a Job or Find One",
                body: "Paste a job posting or use Find Jobs to discover opportunities that match what you're looking for.",
                icon: <Target aria-hidden="true" className="h-5 w-5" />,
                chip: "bg-violet-50 text-violet-600 ring-violet-100",
                num: "text-violet-600",
              },
              {
                step: "3",
                title: "Generate Your Application Package",
                body: "Career Élan tailors your resume and prepares a personalized cover letter and professional email draft for the job.",
                icon: <Sparkles aria-hidden="true" className="h-5 w-5" />,
                chip: "bg-indigo-50 text-indigo-600 ring-indigo-100",
                num: "text-indigo-600",
              },
              {
                step: "4",
                title: "Review Your Application Strategy",
                body: "Review your match, strengths, missing requirements, key changes, and AI recommendation so you know where to focus before applying.",
                icon: <ListChecks aria-hidden="true" className="h-5 w-5" />,
                chip: "bg-emerald-50 text-emerald-600 ring-emerald-100",
                num: "text-emerald-600",
              },
            ].map((s) => (
              <div
                key={s.step}
                className="flex min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_6px_24px_-14px_rgba(15,23,42,0.2)]"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ${s.chip}`}
                  >
                    {s.icon}
                  </span>
                  <span className={`text-2xl font-black leading-none ${s.num}`}>
                    {s.step}
                  </span>
                </div>
                <h3 className="mt-4 text-[15px] font-black leading-snug text-slate-900">
                  {s.title}
                </h3>
                <p className="mt-2 text-[13px] leading-6 text-slate-500">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ FAQ ============================= */}
      <section className="bg-white px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-[1200px]">
          <SectionHeading
            title="Frequently Asked Questions"
            subtitle="Everything you need to know before getting started."
          />

          {/*
            Static cards rather than an accordion: three short answers do not
            need state, and everything stays readable without JavaScript.
          */}
          <div className="mx-auto mt-10 flex max-w-[820px] flex-col gap-4">
            {[
              {
                q: "Is Career Élan free?",
                a: "Yes. Career Élan is free during Beta, and no credit card is required.",
              },
              {
                q: "What do I get from one resume?",
                a: "Career Élan turns one resume into a tailored application package for each job — including a job-specific resume, personalized cover letter, professional email draft, and job-match analysis.",
              },
              {
                q: "Can I review everything before I apply?",
                a: "Yes. You can review your tailored resume, cover letter, email draft, and match analysis before applying. Career Élan prepares the application package, and you decide when and where to submit it.",
              },
            ].map((item) => (
              <div
                key={item.q}
                className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_6px_24px_-16px_rgba(15,23,42,0.2)] sm:p-6"
              >
                <h3 className="text-[15px] font-black text-slate-900 sm:text-base">
                  {item.q}
                </h3>
                <p className="mt-2 text-[14px] leading-7 text-slate-600">
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========================= FINAL CTA ========================== */}
      <section className="bg-white px-5 pb-20 pt-4 sm:px-8">
        <div className="mx-auto max-w-[1200px]">
          <div className="relative overflow-hidden rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-violet-50 p-7 shadow-[0_14px_50px_-18px_rgba(37,99,235,0.35)] sm:p-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-blue-300/25 blur-3xl"
            />
            <div className="relative flex flex-col gap-7 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <h2 className="text-[26px] font-black leading-[1.15] tracking-[-0.035em] text-slate-900 sm:text-[34px]">
                  Stop rewriting your
                  <br className="hidden sm:block" /> resume for every job.
                </h2>
                <p className="mt-3 max-w-[440px] text-[15px] leading-7 text-slate-600">
                  Let Career Élan tailor your resume, cover letter, and email —
                  in minutes.
                </p>
              </div>

              <div className="shrink-0">
                <button
                  type="button"
                  onClick={() => openAuth("signup")}
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-8 py-4 text-base font-black text-white shadow-xl shadow-blue-600/30 transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 lg:w-auto"
                >
                  Start Free Beta
                  <ArrowRight
                    aria-hidden="true"
                    className="h-4 w-4 transition group-hover:translate-x-0.5"
                  />
                </button>

                <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:gap-4 lg:flex-col lg:gap-1.5">
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-600">
                    <Check
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 text-emerald-500"
                    />
                    Free during Beta
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-600">
                    <Check
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 text-emerald-500"
                    />
                    No credit card required
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/* ---------------------------------------------------------------- */

/*
  The landing header.

  Its own component, and the only place in this file that holds state - the
  mobile menu's open flag. Kept local deliberately: nothing outside the
  header needs to know the menu is open, so there is no context, no store
  and no prop drilling into the page.

  Destinations are the ones that already exist, never new ones:
    Try Free / Sign In -> the same openAuth() modal every other CTA uses
    Features           -> #real-example, the package section further down
    How It Works       -> /how-it-works, an existing route

  Features scrolls rather than navigates because the section it points at is
  already on this page. How It Works navigates because no equivalent section
  exists here, and inventing an anchor would have meant editing a part of
  the page that is signed off.
*/
function LandingHeader({ openAuth }: LandingPageProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinkClass =
    "rounded-lg px-1 py-1 text-sm font-bold text-slate-600 transition hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

  return (
    <header className="relative z-20 mx-auto w-full max-w-[1200px] px-5 py-2 sm:px-8">
      <div className="flex items-center justify-between gap-4">
        {/*
          Logo and tagline sit on one line rather than stacked. The asset is
          a wide 256x171 mark, so at the larger size asked for it is already
          the tallest thing in the header - putting the tagline beside it
          instead of beneath keeps the header short enough for the hero to
          move up, and fills the horizontal space that looked empty.
        */}
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Image
            src="/logo.png"
            alt="Career Élan"
            width={256}
            height={171}
            priority
            className="h-auto w-[132px] shrink-0 sm:w-[196px]"
          />
          <p className="hidden min-w-0 border-l border-slate-200 pl-3 text-[11px] font-bold leading-tight tracking-wide text-slate-400 sm:block sm:pl-4">
            One Resume.
            <br />
            Every Application.
          </p>
        </div>

        {/* desktop nav */}
        {/*
          Order is About Us, Log In, How It Works, Features, Try Free. The
          first four stay plain text so the only thing competing for a
          first-time visitor's eye is Try Free - returning users know to
          look for a log-in, new ones should not have to choose between two
          equally loud buttons.

          Every item renders unconditionally. Gating Log In and Try Free on
          session state meant they vanished for a signed-in visitor and
          during the moment the session was still resolving - the header
          silently lost two items depending on who was looking.
        */}
        <nav className="hidden shrink-0 items-center gap-7 lg:flex">
          <a href="/about" className={navLinkClass}>
            About Us
          </a>
          <button
            type="button"
            onClick={() => openAuth("login")}
            className={navLinkClass}
          >
            Log In
          </button>
          <a href="/how-it-works" className={navLinkClass}>
            How It Works
          </a>
          <a href="#real-example" className={navLinkClass}>
            Features
          </a>
          <button
            type="button"
            onClick={() => openAuth("signup")}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Try Free
          </button>
        </nav>

        {/* mobile trigger */}
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="landing-mobile-menu"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((open) => !open)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 lg:hidden"
        >
          {menuOpen ? (
            <X aria-hidden="true" className="h-5 w-5" />
          ) : (
            <Menu aria-hidden="true" className="h-5 w-5" />
          )}
        </button>
      </div>

      {/* mobile menu - closes on every selection */}
      {menuOpen && (
        <nav
          id="landing-mobile-menu"
          className="mt-3 flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg lg:hidden"
        >
          <a
            href="/about"
            onClick={() => setMenuOpen(false)}
            className="rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            About Us
          </a>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              openAuth("login");
            }}
            className="rounded-xl px-3 py-2.5 text-left text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Log In
          </button>
          <a
            href="/how-it-works"
            onClick={() => setMenuOpen(false)}
            className="rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            How It Works
          </a>
          <a
            href="#real-example"
            onClick={() => setMenuOpen(false)}
            className="rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Features
          </a>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              openAuth("signup");
            }}
            className="mt-1 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-black text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Try Free
          </button>
        </nav>
      )}
    </header>
  );
}

function SectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mx-auto max-w-[680px] text-center">
      <h2 className="text-[26px] font-black tracking-[-0.035em] text-slate-900 sm:text-[34px]">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-3 text-[15px] leading-7 text-slate-500">{subtitle}</p>
      )}
    </div>
  );
}

const CARD_TONES = {
  blue: { chip: "bg-blue-50 text-blue-600", ring: "ring-blue-100" },
  violet: { chip: "bg-violet-50 text-violet-600", ring: "ring-violet-100" },
  emerald: { chip: "bg-emerald-50 text-emerald-600", ring: "ring-emerald-100" },
  amber: { chip: "bg-amber-50 text-amber-600", ring: "ring-amber-100" },
  sky: { chip: "bg-sky-50 text-sky-600", ring: "ring-sky-100" },
  rose: { chip: "bg-rose-50 text-rose-600", ring: "ring-rose-100" },
} as const;

function PackageCard({
  tone,
  icon,
  title,
  subtitle,
  checks,
  children,
}: {
  tone: keyof typeof CARD_TONES;
  icon: React.ReactNode;
  title: React.ReactNode;
  subtitle: string;
  checks: string[];
  children: React.ReactNode;
}) {
  const t = CARD_TONES[tone];
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_10px_36px_-18px_rgba(15,23,42,0.25)] transition hover:shadow-[0_16px_44px_-16px_rgba(15,23,42,0.28)] sm:p-6">
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-xl ring-1 ${t.chip} ${t.ring}`}
      >
        {icon}
      </span>

      <h3 className="mt-4 text-[19px] font-black leading-tight text-slate-900">
        {title}
      </h3>
      <p className="mt-1 text-[13px] font-semibold text-slate-500">{subtitle}</p>

      {/* preview box */}
      <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
        {children}
      </div>

      <ul className="mt-4 space-y-2">
        {checks.map((c) => (
          <li key={c} className="flex items-start gap-2 text-[13px] text-slate-600">
            <Check
              aria-hidden="true"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500"
            />
            <span className="min-w-0">{c}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BenefitCard({
  tone,
  icon,
  title,
  body,
}: {
  tone: keyof typeof CARD_TONES;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  const t = CARD_TONES[tone];
  return (
    <div className="flex min-w-0 items-start gap-3.5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_6px_24px_-14px_rgba(15,23,42,0.2)]">
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-1 ${t.chip} ${t.ring}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-black text-slate-900">{title}</p>
        <p className="mt-1 text-[13px] leading-6 text-slate-500">{body}</p>
      </div>
    </div>
  );
}
