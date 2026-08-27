"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import CareerElanFooter from "@/components/marketing/CareerElanFooter";
import PublicAuthActionsProvider, {
  useAuthActions,
} from "@/components/marketing/PublicAuthActions";
import { useLogin } from "@/lib/auth/LoginManager";

/*
  Phase 6I.6.28 - the real Log in/Get Started/CTA behavior (the modal,
  its state, and all Supabase auth calls) now lives in
  components/marketing/PublicAuthActions.tsx, shared with the public
  marketing pages (/features, /how-it-works, /pricing, /about) so none of
  them duplicate this page's auth logic. HomePage itself is now a thin
  wrapper that provides that context; HomePageBody is this page's actual
  content, unchanged, using useAuthActions().openAuth(...) exactly where
  it previously called its own local openAuth(...).
*/
export default function HomePage() {
  return (
    <PublicAuthActionsProvider>
      <HomePageBody />
    </PublicAuthActionsProvider>
  );
}

function HomePageBody() {
  const { openAuth } = useAuthActions();
  /*
    Phase 6I.6.30 - session-aware Header. LoginManager (lib/auth/
    LoginManager.tsx) already wraps the entire app (app/layout.tsx) and
    tracks the real Supabase session via getSession()/onAuthStateChange()
    - reused here rather than adding a second auth listener. Log in/Get
    Started are only ever rendered while genuinely logged out; while the
    initial session check is still resolving (`loading`), neither renders,
    which avoids a flash of the CTAs for an already-authenticated user.
  */
  const { user, loading } = useLogin();
  const showAuthCta = !loading && !user;

  /*
    A suspended account signs in successfully - suspension is a flag on the
    profile, not a change to the Supabase credential - and middleware then
    turns them away from every protected route, sending them here with
    ?accountSuspended=1 (see middleware.ts). Until now nothing read that,
    so the person landed back on the marketing page with no explanation and
    no way to tell a suspension apart from a login that silently failed.

    Read the same way the auth modal reads its own parameters
    (components/marketing/PublicAuthActions.tsx): URLSearchParams over
    window.location.search inside an effect, and the parameter is left in
    the URL afterwards, exactly as the existing ones are.

    Says only that the account is suspended and that access resumes when it
    is reactivated. Not why, not by whom, and no support address - there is
    no contact route in this UI to promise one.
  */
  const [showSuspendedNotice, setShowSuspendedNotice] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("accountSuspended") === "1") {
      setShowSuspendedNotice(true);
    }
  }, []);

  return (
  <main className="min-h-screen w-screen overflow-x-hidden bg-white text-slate-950">
    {/*
      Shown only for ?accountSuspended=1. Dismissing it clears local state
      and nothing else - no request, no write, no session change.
    */}
    {showSuspendedNotice && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <h2 className="text-xl font-black text-slate-950">Account suspended</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Your account has been suspended. You won&apos;t be able to use Career
            Élan until it is reactivated.
          </p>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => setShowSuspendedNotice(false)}
              className="rounded-xl bg-blue-600 px-5 py-2.5 font-bold text-white"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    )}

    <section className="relative overflow-hidden bg-gradient-to-br from-white via-blue-50 to-slate-50">
      <div className="pointer-events-none absolute -left-40 top-24 h-96 w-96 rounded-full bg-blue-200/50 blur-3xl" />
      <div className="pointer-events-none absolute -right-40 top-0 h-[520px] w-[520px] rounded-full bg-blue-300/40 blur-3xl" />

      <header className="relative z-10 mx-auto flex w-full max-w-[1440px] items-center justify-between px-5 py-5 sm:px-8 lg:px-10 xl:px-12">
        <Image
          src="/logo.png"
          alt="Career Élan"
          width={180}
          height={76}
          priority
          className="h-auto w-[145px] sm:w-[176px]"
        />

        <nav className="hidden items-center gap-8 text-[13px] font-bold text-slate-800 md:flex">
          <a
            href="#features"
            className="transition hover:text-blue-600"
          >
            Features
          </a>

          <a
            href="#how-it-works"
            className="transition hover:text-blue-600"
          >
            How it Works
          </a>

          <Link
            href="/pricing"
            className="transition hover:text-blue-600"
          >
            Pricing
          </Link>
        </nav>

        {showAuthCta && (
          <div className="hidden items-center gap-4 md:flex">
            <button
              type="button"
              onClick={() => openAuth("login")}
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Log in
            </button>

            <button
              type="button"
              onClick={() => openAuth("signup")}
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-extrabold text-white shadow-xl shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700"
            >
              Sign Up
            </button>
          </div>
        )}

        {showAuthCta && (
          <button
            type="button"
            onClick={() => openAuth("signup")}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-blue-200 md:hidden"
          >
            Start
          </button>
        )}
      </header>

      <div className="relative z-10 mx-auto w-full max-w-[1440px] px-5 pb-10 pt-3 sm:px-8 lg:px-10 xl:px-12">
        {/* 상단: 소개 문구 + 패키지 카드 */}
        <div className="grid items-start gap-10 lg:grid-cols-[0.82fr_1.18fr]">
          {/* 왼쪽 */}
          <div className="max-w-[540px]">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-blue-100/90 px-4 py-2 text-xs font-extrabold text-blue-700 ring-1 ring-blue-200">
              🇨🇦 Built for job seekers in Canada
            </div>

            <h1 className="text-[44px] font-black leading-[0.98] tracking-[-0.05em] text-slate-950 sm:text-[56px] lg:text-[66px] xl:text-[72px]">
              Upload One Profile.
              <br />
              <span className="text-blue-600">
                Apply Everywhere.
              </span>
            </h1>

            <p className="mt-6 max-w-[500px] text-[15px] leading-7 text-slate-600">
              Career Élan is your AI career partner that
              tailors your resume, cover letter, and emails
              to every job automatically — so you never have
              to rewrite anything again.
            </p>

            <p className="mt-4 max-w-[500px] text-[15px] font-bold leading-7 text-slate-700">
              Upload one profile. Career Élan tailors every
              application for you.
            </p>

            <div className="mt-5 grid gap-3 text-sm font-bold text-slate-700">
              <span>
                ✓ One profile for your entire career
              </span>

              <span>
                ✓ AI tailors to any job description in seconds
              </span>

              <span>
                ✓ ATS-optimized &amp; recruiter-approved
              </span>

              <span>
                ✓ Never rewrite your resume again
              </span>
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => openAuth("signup")}
                className="w-fit rounded-xl bg-blue-600 px-8 py-4 text-base font-black text-white shadow-xl shadow-blue-300 transition hover:-translate-y-0.5 hover:bg-blue-700"
              >
                Get Started
              </button>

              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById("how-it-works")
                    ?.scrollIntoView({
                      behavior: "smooth",
                    })
                }
                className="w-fit rounded-xl border border-slate-200 bg-white px-7 py-4 text-base font-black text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50"
              >
                See How It Works ◎
              </button>
            </div>
          </div>

          {/* 오른쪽 패키지 카드 */}
          <div className="rounded-[1.7rem] border border-slate-200 bg-white/90 p-6 shadow-xl shadow-blue-100/70 sm:p-7">
            <div className="mb-6 flex items-center justify-between gap-4">
              <h3 className="text-2xl font-black tracking-[-0.03em] text-slate-950">
                Your AI Application Package
              </h3>

              <span className="shrink-0 rounded-full bg-green-50 px-4 py-2 text-xs font-black text-green-700">
                ATS Match 95%
              </span>
            </div>

            <div className="space-y-4">
              <HeroPackageCard
                title="Optimized Resume"
                body="Tailored to the job description"
                detail="✓ Changes explained"
                icon={<MiniResume compact />}
                onClick={() => openAuth("signup")}
              />

              <HeroPackageCard
                title="Personalized Cover Letter"
                body="Custom letter that speaks to"
                detail="the hiring manager"
                icon={<MiniLetter />}
                onClick={() => openAuth("signup")}
              />

              <HeroPackageCard
                title="Professional Email Draft"
                body="Ready-to-send email draft"
                detail="for your application"
                icon={<IconBox icon="✉" />}
                onClick={() => openAuth("signup")}
              />
            </div>

            <div className="mt-6 rounded-2xl bg-slate-50 p-5 text-center">
              <p className="text-sm font-black text-slate-800">
                🔒 One Profile. Unlimited Applications.
              </p>

              <p className="mt-1 text-xs font-semibold text-slate-500">
                No rewriting. Just better applications.
              </p>
            </div>
          </div>
        </div>

        {/* 하단: 전체 폭 비교표 */}
<div className="mt-9 overflow-hidden rounded-2xl border-2 border-blue-600 bg-white shadow-xl shadow-blue-100">

  {/* 비교표 헤더 */}
  <div className="grid grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)] items-center border-b border-slate-200 bg-slate-50 px-6 py-5">

    {/* ChatGPT / Gemini */}
    <div className="flex items-center justify-end gap-4">

      <div className="text-right">
        <p className="whitespace-nowrap text-base font-black text-slate-950">
          ChatGPT / Gemini
        </p>

        <p className="whitespace-nowrap text-xs font-semibold text-slate-500">
          General AI Assistants
        </p>
      </div>

      <div className="flex shrink-0 items-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm">
          <Image
            src="/openai.png"
            alt="OpenAI"
            width={28}
            height={28}
            className="h-7 w-7 object-contain"
          />
        </div>

        <div className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm">
          <Image
            src="/gemini.png"
            alt="Google Gemini"
            width={28}
            height={28}
            className="h-7 w-7 object-contain"
          />
        </div>
      </div>

    </div>

    {/* VS */}
    <div className="flex justify-center">
      <span className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-xs font-black tracking-widest text-white shadow-lg">
        VS
      </span>
    </div>

    {/* Career Élan */}
    <div className="flex items-center justify-start gap-4">

      <Image
        src="/logo.png"
        alt="Career Élan"
        width={52}
        height={52}
        className="h-11 w-auto shrink-0 object-contain"
      />

      <div>
        <p className="whitespace-nowrap text-base font-black text-slate-950">
          Career Élan
        </p>

        <p className="whitespace-nowrap text-xs font-semibold text-slate-500">
          Built for Job Seekers
        </p>
      </div>


    </div>
  </div>

  <ComparisonRow
  left="General Resume"
  right="Job-Specific Resume"
/>

<ComparisonRow
  left="Manual Editing"
  right="One-Click AI Tailoring"
/>

<ComparisonRow
  left="Resume Only"
  right="Full Application Package"
/>

<ComparisonRow
  left="No Career Memory"
  right="Career Memory"
/>

<ComparisonRow
  left="No Application Tracker"
  right="Track Every Application"
/>

<ComparisonRow
  left="Generic Resume"
  right="ATS-Optimized Resume"
/>

<ComparisonRow
  left="No AI Explanation"
  right="Explains Every Change"
  last
/>
</div>
      </div>
    </section>

    {/* 여기부터 기존 Trusted by job seekers worldwide 섹션을 그대로 붙이면 됨 */}

      <section className="w-full bg-white px-5 py-4 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto mb-3 flex max-w-[1440px] items-center gap-6 text-center text-xs font-black uppercase tracking-widest text-slate-500">
          <div className="h-px flex-1 bg-slate-200" />
          <span>Built for job seekers in Canada</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>
        <div className="mx-auto grid max-w-[1440px] gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-100 md:grid-cols-5">
          <Stat icon="▣" label="Generated in Minutes" value="Tailored Applications" />
          <Stat icon="◎" label="Resume Templates" value="ATS-Friendly" accent="text-green-600" />
          <Stat icon="◷" label="Built for Canada" value="Career Tools" accent="text-violet-600" highlight />
          <Stat icon="☆" label="Apply Everywhere" value="One Profile" accent="text-yellow-500" />
          <div className="text-center md:border-r md:border-slate-200 last:border-r-0">
            <p className="text-xl font-black text-yellow-400">★★★★★</p>
            <p className="mt-2 text-sm font-bold text-slate-700">Your Next Opportunity Starts Here</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">Build stronger applications with Career Élan.</p>
          </div>
        </div>
      </section>

      <section className="w-full bg-white px-5 py-5 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto grid max-w-[1440px] items-center gap-6 rounded-3xl bg-slate-50/70 p-5 md:grid-cols-3">
          <Benefit title="More Accurate" body="AI matches your profile with job requirements more accurately." badge="95% ATS Match" icon="◎" />
          <div className="rounded-[2rem] bg-blue-600 p-8 text-center text-white shadow-2xl shadow-blue-200 xl:p-9">
            <p className="mx-auto mb-3 w-fit rounded-full bg-white px-4 py-1.5 text-xs font-black text-blue-700">Most Loved Feature</p>
            <p className="text-base font-black">Save Average</p>
            <p className="mt-1 text-[64px] font-black leading-none xl:text-[72px]">75%</p>
            <p className="mt-1 text-lg font-black">Application Time</p>
            <p className="mt-4 text-yellow-300">★★★★★</p>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-blue-50">Save hours on every application. Focus on preparing for interviews, not rewriting documents.</p>
          </div>
          <Benefit title="Human-like Writing" body="Natural, professional, and persuasive writing that sounds like you." badge="Loved by recruiters" icon="♡" />
        </div>
      </section>

      <section id="examples" className="w-full bg-white px-5 pb-12 pt-4 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto grid max-w-[1440px] gap-6 lg:grid-cols-[1.05fr_0.48fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-100">
            <h2 className="mb-5 text-center text-2xl font-black tracking-[-0.03em] text-slate-950">
              Career Élan Tailors Your Full Application Package
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              <ResumePreview onClick={() => openAuth("signup")} />
              <CoverLetterPreview onClick={() => openAuth("signup")} />
              <EmailDraftPreview onClick={() => openAuth("signup")} />
            </div>
          </div>

          <aside className="rounded-3xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-100">
            <OptimizationItem title="ATS Optimized" body="Formatted and written to pass ATS systems with a high match rate." badge="95%" />
            <OptimizationItem title="Human-Like Writing" body="Natural, professional, and persuasive writing that sounds like you." badge="98%" />
            <OptimizationItem title="Job-Specific Tailoring" body="Every document is customized to the job description and company culture." />
            <OptimizationItem title="Recruiter Approved" body="Designed to catch the eye of recruiters and hiring managers." />
            <button
              type="button"
              onClick={() => openAuth("signup")}
              className="mt-5 w-full rounded-2xl bg-blue-600 px-5 py-5 text-left text-white shadow-xl shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700"
            >
              <span className="block text-lg font-black">🔒 Create My Application Package</span>
              <span className="mt-2 block text-sm font-semibold leading-6 text-blue-50">Preview available. Sign up to download your complete documents. →</span>
            </button>
            <p className="mt-3 text-center text-xs font-bold text-slate-500">Career Élan explains every optimization.</p>
          </aside>
        </div>
      </section>

      <section className="w-full bg-white px-5 py-4 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto grid max-w-[1440px] items-center gap-6 rounded-3xl bg-slate-50/80 p-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="text-center">
            <p className="mx-auto mb-3 w-fit rounded-full bg-blue-50 px-4 py-2 text-xs font-black text-blue-700">YOUR AI CAREER PARTNER</p>
            <h2 className="text-3xl font-black tracking-[-0.04em] text-slate-950">One Profile. Every Application.</h2>
            <div className="mt-7 flex flex-wrap justify-center gap-6 text-xs font-bold text-slate-600">
              <span>▣ Resume</span>
              <span>▣ Cover Letter</span>
              <span>✉ Email</span>
              <span>in LinkedIn</span>
              <span>▣ Portfolio</span>
              <span>▣ References</span>
            </div>
          </div>
          <div className="rounded-3xl border border-green-100 bg-green-50 p-6">
            <div className="flex gap-5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white text-4xl">🧠</div>
              <div>
                <h3 className="text-xl font-black text-green-700">Career Memory</h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">AI learns from your applications and gets better over time.</p>
                <ul className="mt-3 space-y-1 text-sm font-bold text-green-800">
                  <li>✓ Tracks what works</li>
                  <li>✓ Learns your preferences</li>
                  <li>✓ Improves your results</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="w-full bg-white px-5 py-8 sm:px-8 lg:px-10 xl:px-12">
        <h2 className="text-center text-2xl font-black text-slate-950">Why Career Élan is Different</h2>
        <div className="mx-auto mt-7 grid max-w-[1440px] gap-4 md:grid-cols-5">
          <SmallFeature icon="💡" title="Explain Why" body="See exactly why AI added or changed each section." />
          <SmallFeature icon="🧠" title="Career Memory" body="AI learns from your career history and improves every application." />
          <SmallFeature icon="🎯" title="Job-Specific Tailoring" body="Tailor your resume and cover letter to each job in minutes." />
          <SmallFeature icon="📋" title="Job Tracker" body="Keep every application, status, and follow-up organized in one place." />
          <SmallFeature icon="🇨🇦" title="Built for Canada" body="Built around Canadian job seekers, resumes, and employer expectations." />
        </div>
      </section>

      <section id="how-it-works" className="w-full bg-white px-5 py-6 sm:px-8 lg:px-10 xl:px-12">
        <h2 className="text-center text-2xl font-black text-slate-950">How It Works</h2>
        <div className="mx-auto mt-7 grid max-w-[1440px] gap-4 md:grid-cols-4">
          <StepCard number="1" title="Upload Your Profile" body="Upload your resume once. AI builds your career profile." icon="⇧" />
          <StepCard number="2" title="Find or Paste Job URL" body="Search jobs inside Career Élan or paste any job URL from any website." icon="🔗" />
          <StepCard number="3" title="AI Analyzes & Tailors" body="AI analyzes the job and tailors your documents." icon="✦" />
          <StepCard number="4" title="Apply & Get Hired" body="Download or auto-apply and get more interviews." icon="✓" />
        </div>
      </section>

      <section className="w-full bg-white px-5 pt-4 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto max-w-[1440px] rounded-t-3xl bg-blue-600 p-8 text-white">
          <h2 className="max-w-2xl text-3xl font-black tracking-[-0.04em]">Your next opportunity starts with a stronger application.</h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-blue-50">Build your Career Memory, tailor your application, and stay organized throughout your job search.</p>
          <button type="button" onClick={() => openAuth("signup")} className="mt-5 rounded-xl bg-white px-5 py-3 text-sm font-black text-blue-700">Get Started &#8594;</button>
        </div>
      </section>

      <CareerElanFooter />
    </main>
  );
}

function Stat({ label, value, icon, accent = "text-blue-600", highlight = false }: { label: string; value: string; icon?: string; accent?: string; highlight?: boolean }) {
  return (
    <div className={`text-center md:border-r md:border-slate-200 last:border-r-0 ${highlight ? "rounded-2xl bg-blue-600 py-2 text-white md:border-r-0" : ""}`}>
      <p className={`text-3xl font-black ${highlight ? "text-white" : accent}`}>{icon && <span className="mr-3 text-2xl">{icon}</span>}{value}</p>
      <p className={`mt-2 text-sm font-bold ${highlight ? "text-blue-50" : "text-slate-700"}`}>{label}</p>
    </div>
  );
}

function Benefit({ title, body, badge, icon }: { title: string; body: string; badge: string; icon: string }) {
  return <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"><div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-2xl text-blue-600">{icon}</div><p className="text-xl font-black text-slate-950">{title}</p><p className="mt-4 text-sm leading-6 text-slate-600">{body}</p><p className="mt-6 w-fit rounded-full bg-blue-50 px-4 py-2 text-xs font-black text-blue-700">{badge}</p></div>;
}

function HeroPackageCard({ title, body, detail, icon, onClick }: { title: string; body: string; detail: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-5 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="font-black text-slate-950">{title}</p>
        <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{body}</p>
        <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{detail}</p>
      </div>
      <span className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-2 text-xs font-black text-blue-700">Preview</span>
      <span className="font-black text-blue-700">›</span>
    </button>
  );
}

function IconBox({ icon }: { icon: string }) {
  return <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-2xl font-black text-blue-600">{icon}</div>;
}

function MiniResume({ compact = false }: { compact?: boolean }) {
  return <div className={`${compact ? "h-20 w-16" : "h-28 w-20"} shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[5px] leading-tight text-slate-400`}><p className="font-black text-slate-700">ALEX CARTER</p><p className="text-blue-600">Marketing Coordinator</p><br /><p className="font-black">Summary</p><p>Results-driven professional...</p><br /><p className="font-black">Experience</p><p>Brighton Solutions Inc.</p><div className="mt-2 space-y-1"><div className="h-px bg-slate-300" /><div className="h-px bg-slate-300" /><div className="h-px bg-slate-300" /></div></div>;
}

function MiniLetter() {
  return <div className="h-20 w-16 shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[5px] leading-tight text-slate-400"><p className="font-black text-blue-600">LETTER</p><br /><div className="space-y-1"><div className="h-px bg-slate-300" /><div className="h-px bg-slate-300" /><div className="h-px bg-slate-300" /><div className="h-px bg-slate-300" /><div className="h-px bg-slate-300" /></div></div>;
}

function ResumePreview({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group relative h-[460px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-left text-[10px] leading-4 text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-start justify-between gap-3"><p className="font-black text-slate-950">AI-Optimized Resume</p><span className="rounded-full bg-green-50 px-3 py-1 text-[10px] font-black text-green-700">ATS Match 95%</span></div>
      <div className="mt-4">
        <p className="text-2xl font-black leading-none text-slate-950">ALEX CARTER</p>
        <p className="mt-1 font-black text-blue-600">Marketing Coordinator</p>
        <p className="mt-2 text-[8px] text-slate-500">Toronto, ON · alexcarter@email.com · (416) 555-9876 · linkedin.com/in/alexcarter</p>
        <hr className="my-3" />
        <p className="font-black text-slate-900">PROFESSIONAL SUMMARY</p>
        <p className="mt-1">Marketing professional with 4+ years of experience in digital marketing, campaign management, content strategy, SEO, paid media, CRM automation, and conversion-focused communications.</p>
        <p className="mt-3 font-black text-slate-900">CORE COMPETENCIES</p>
        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
          <p>• Digital Marketing</p><p>• Email Marketing</p><p>• Campaign Management</p><p>• Marketing Automation</p><p>• Content Strategy</p><p>• Data Analysis & Reporting</p><p>• SEO / SEM</p><p>• Google Analytics</p>
        </div>
        <p className="mt-3 font-black text-slate-900">PROFESSIONAL EXPERIENCE</p>
        <div className="mt-1 flex justify-between"><p className="font-black">Marketing Coordinator | Brighton Solutions Inc.</p><p>Jan 2021 – Present</p></div>
        <ul className="mt-1 list-disc pl-4"><li>Managed end-to-end digital marketing campaigns across multiple channels.</li><li>Increased website traffic by 40% and lead generation by 35% within 6 months.</li><li>Collaborated with sales team to create targeted content and email sequences.</li></ul>
        <div className="mt-2 flex justify-between"><p className="font-black">Marketing Assistant | CreativeWay Agency</p><p>May 2020 – Dec 2020</p></div>
        <ul className="mt-1 list-disc pl-4"><li>Assisted in planning and executing social media and SEO strategies.</li><li>Created content calendars and optimized copy for landing pages.</li><li>Tracked KPIs and prepared performance reports using Google Analytics.</li></ul>
        <p className="mt-3 font-black text-slate-900">EDUCATION</p>
        <div className="mt-1 flex justify-between"><p>Bachelor of Business Administration<br />University of Toronto · Toronto, ON</p><p>2016 – 2020</p></div>
        <p className="mt-3 font-black text-slate-900">SKILLS</p>
        <div className="mt-1 flex flex-wrap gap-1">{["Digital Marketing", "SEO", "Google Analytics", "Google Ads", "Meta Ads", "Content Strategy", "Email Marketing", "Marketing Automation", "Data Analysis", "Copywriting", "CRM", "Excel", "PowerPoint", "Canva"].map((s) => <span key={s} className="rounded bg-slate-100 px-2 py-1 text-[8px]">{s}</span>)}</div>
      </div>
      <PreviewLock label="Unlock full resume" />
    </button>
  );
}

function CoverLetterPreview({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group relative h-[460px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-left text-[11px] leading-5 text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <p className="font-black text-slate-950">Personalized Cover Letter</p>
      <p className="mt-5">Dear Hiring Manager,</p>
      <p className="mt-3">I am excited to apply for the Marketing Coordinator position at Brighton Solutions Inc.</p>
      <p className="mt-3">With over 4 years of experience in digital marketing and campaign management, I have developed a strong ability to create data-driven strategies that drive engagement and deliver measurable results.</p>
      <p className="mt-3">In my current role at Brighton Solutions, I successfully increased website traffic by 60% and lead generation by 40% through targeted content and performance-driven campaigns.</p>
      <p className="mt-3">I am particularly drawn to Brighton Solutions because of your commitment to innovation and your focus on delivering exceptional results for clients.</p>
      <p className="mt-3">I look forward to the opportunity to contribute to your team.</p>
      <p className="mt-3">Sincerely,<br />Alex Carter</p>
      <PreviewLock label="Unlock full letter" />
    </button>
  );
}

function EmailDraftPreview({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group relative h-[460px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-left text-[11px] leading-5 text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <p className="font-black text-slate-950">Professional Email Draft</p>
      <p className="mt-5">To: hiring.manager@brightonsolutions.com</p>
      <p>Subject: Application for Marketing Coordinator Position</p>
      <hr className="my-4" />
      <p>Hi Hiring Manager,</p>
      <p className="mt-3">I hope this email finds you well. I am very interested in the Marketing Coordinator position at Brighton Solutions Inc. and would love the opportunity to contribute to your team.</p>
      <p className="mt-3">I have attached my resume and cover letter for your review.</p>
      <p className="mt-3">My experience in digital marketing, content strategy, and campaign management aligns well with the requirements of this role.</p>
      <p className="mt-3">Thank you for your time and consideration. I look forward to the possibility of discussing how I can contribute to Brighton Solutions.</p>
      <p className="mt-3">Best regards,<br />Alex Carter</p>
      <PreviewLock label="Unlock full email" />
    </button>
  );
}

function PreviewLock({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-b from-white/10 via-white/80 to-white">
      <div className="absolute inset-x-5 bottom-16 border-t border-dashed border-blue-300" />
      <div className="absolute inset-x-0 bottom-6 text-center">
        <p className="text-xs font-semibold text-slate-500">Preview Only</p>
        <p className="mt-1 text-xs font-black text-blue-600">🔒 {label}</p>
      </div>
      <div className="absolute inset-x-5 top-10 h-20 rounded-2xl backdrop-blur-[3px]" />
    </div>
  );
}

function OptimizationItem({ title, body, badge }: { title: string; body: string; badge?: string }) {
  return (
    <div className="mb-7 flex gap-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">✓</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="font-black text-slate-950">{title}</p>
          {badge && <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-black text-green-700">{badge}</span>}
        </div>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{body}</p>
      </div>
    </div>
  );
}

function SmallFeature({ icon, title, body }: { icon: string; title: string; body: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm"><p className="text-3xl">{icon}</p><p className="mt-4 font-black text-slate-950">{title}</p><p className="mt-3 text-xs font-semibold leading-5 text-slate-600">{body}</p></div>;
}

function StepCard({ number, title, body, icon }: { number: string; title: string; body: string; icon: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-4"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-3xl text-blue-600">{icon}</div><p className="text-sm font-black text-blue-600">{number}</p><p className="font-black text-slate-950">{title}</p></div><p className="mt-3 text-sm leading-6 text-slate-600">{body}</p></div>;
}

function ComparisonRow({
  left,
  right,
  last = false,
}: {
  left: string;
  right: string;
  last?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-[1fr_110px_1fr] ${
        last ? "" : "border-b border-slate-200"
      }`}
    >
      {/* ChatGPT / Gemini */}
      <div className="flex min-h-[58px] items-center justify-end bg-red-50/30 px-5 py-3 text-right">
        <span className="text-[13px] font-semibold text-slate-600">
          {left}
        </span>

        <span className="ml-3 text-lg font-black text-red-500">
          ✕
        </span>
      </div>

      {/* VS */}
      <div className="flex items-center justify-center border-x border-slate-200 bg-gradient-to-b from-blue-50 to-white">
        <span className="rounded-full bg-blue-600 px-4 py-1.5 text-xs font-black tracking-widest text-white shadow-md">
          VS
        </span>
      </div>

      {/* Career Élan */}
      <div className="flex min-h-[58px] items-center justify-start bg-blue-50/30 px-5 py-3 text-left">
        <span className="mr-3 text-lg font-black text-blue-600">
          ✓
        </span>

        <span className="text-[13px] font-black text-slate-900">
          {right}
        </span>
      </div>
    </div>
  );
}
