"use client";

import Image from "next/image";
import Link from "next/link";
import CareerElanFooter from "@/components/marketing/CareerElanFooter";
import PublicAuthActionsProvider, {
  useAuthActions,
} from "@/components/marketing/PublicAuthActions";
import { useLogin } from "@/lib/auth/LoginManager";

/*
  Phase 6I.6.28 - Log in/Get Started/Start (Header) and the Hero/Closing
  CTA's Get Started now open the real Homepage auth modal directly (via
  the shared PublicAuthActionsProvider), instead of linking back to "/".
  Metadata stays in app/about/page.tsx (a Server Component) since a
  "use client" file cannot export `metadata` - this file is that page's
  client-rendered body.

  Content-safety notes (carried over from Phase 6I.6.27): no ranking
  claims, no guarantees, no fabricated user/customer counts, no team/
  founder/office/investor/press content - only the 5 sections below.
*/
export default function AboutPageClient() {
  return (
    <PublicAuthActionsProvider>
      <AboutPageBody />
    </PublicAuthActionsProvider>
  );
}

function AboutPageBody() {
  const { openAuth } = useAuthActions();
  const { user, loading } = useLogin();
  const showAuthCta = !loading && !user;

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
          <Link href="/features" className="transition hover:text-blue-600">
            Features
          </Link>
          <Link href="/how-it-works" className="transition hover:text-blue-600">
            How it Works
          </Link>
          <Link href="/pricing" className="transition hover:text-blue-600">
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
              Get Started
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

      {/* Section 1 - Hero */}
      <section className="w-full bg-gradient-to-br from-white via-blue-50 to-slate-50 px-5 py-16 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto max-w-[760px] text-center">
          <p className="text-xs font-black uppercase tracking-[0.15em] text-blue-600">
            About Career Élan
          </p>
          <h1 className="mt-4 text-3xl font-black tracking-[-0.03em] text-slate-950 sm:text-4xl">
            Built to Make Job Searching More Human
          </h1>
          <p className="mx-auto mt-5 max-w-[620px] text-base font-semibold leading-7 text-slate-600 sm:text-lg">
            Career Élan is building a smarter way to navigate the job
            search — helping people understand opportunities, present
            their experience clearly, and approach every application with
            greater confidence.
          </p>

          <button
            type="button"
            onClick={() => openAuth("signup")}
            className="mt-8 inline-block rounded-xl bg-blue-600 px-6 py-3 text-sm font-black text-white shadow-xl shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700"
          >
            Get Started
          </button>
        </div>
      </section>

      {/* Section 2 - Why We Built Career Élan */}
      <section className="w-full bg-white px-5 py-16 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto max-w-[760px]">
          <h2 className="text-2xl font-black text-slate-950 sm:text-3xl">
            Why We Built Career Élan
          </h2>
          <p className="mt-2 text-base font-bold text-blue-600">
            Job searching shouldn&rsquo;t feel like starting over every time.
          </p>

          <div className="mt-6 space-y-4 text-sm font-semibold leading-7 text-slate-600 sm:text-base">
            <p>
              Every application asks candidates to repeat the same
              difficult work: understand what an employer wants, decide
              which experience matters, tailor a resume, write a cover
              letter, and keep track of everything that follows.
            </p>
            <p>Career Élan was created to bring those pieces together.</p>
            <p>
              Instead of treating every application as a blank page,
              Career Élan helps you build on what you already know about
              yourself — your experience, skills, achievements, and career
              goals — and use that context to create stronger, more
              relevant applications.
            </p>
          </div>
        </div>
      </section>

      {/* Section 3 - Our Approach */}
      <section className="w-full bg-slate-50 px-5 py-16 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto max-w-[820px]">
          <h2 className="text-center text-2xl font-black text-slate-950 sm:text-3xl">
            Our Approach
          </h2>

          <p className="mx-auto mt-6 max-w-[680px] text-balance text-center text-2xl font-black leading-tight tracking-[-0.02em] text-blue-700 sm:text-3xl">
            AI should support your story — not invent it.
          </p>

          <div className="mx-auto mt-8 max-w-[680px] space-y-4 text-sm font-semibold leading-7 text-slate-600 sm:text-base">
            <p>
              We believe career technology should help people communicate
              their real experience more effectively, not manufacture a
              version of themselves for an algorithm.
            </p>
            <p>
              Career Élan combines AI-assisted job analysis, application
              tailoring, Career Memory, professional resume presentation,
              and application tracking while keeping the candidate&rsquo;s
              actual experience at the centre of the process.
            </p>
          </div>
        </div>
      </section>

      {/* Section 4 - Built for Canada */}
      <section className="w-full bg-white px-5 py-16 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto max-w-[760px]">
          <h2 className="text-2xl font-black text-slate-950 sm:text-3xl">
            Built for Canada
          </h2>
          <p className="mt-2 text-base font-bold text-blue-600">
            Designed with the Canadian job search in mind.
          </p>

          <div className="mt-6 space-y-4 text-sm font-semibold leading-7 text-slate-600 sm:text-base">
            <p>
              Career Élan is being built around the realities of applying
              for work across Canada — from understanding job postings
              and preparing professional application materials to
              organizing applications throughout the hiring process.
            </p>
            <p>
              Our goal is simple: make modern career tools more useful,
              transparent, and accessible for people navigating the
              Canadian job market.
            </p>
          </div>
        </div>
      </section>

      {/* Section 5 - Closing CTA */}
      <section className="w-full bg-white px-5 pb-6 pt-4 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto max-w-[1440px] rounded-t-3xl bg-blue-600 p-8 text-center text-white sm:p-12">
          <h2 className="text-balance text-2xl font-black leading-tight tracking-[-0.02em] sm:text-3xl">
            Your experience already has value.
            <br className="hidden sm:block" /> Career Élan helps you put it
            to work.
          </h2>

          <button
            type="button"
            onClick={() => openAuth("signup")}
            className="mt-6 inline-block rounded-xl bg-white px-6 py-3 text-sm font-black text-blue-700 shadow-lg transition hover:-translate-y-0.5"
          >
            Get Started
          </button>
        </div>
      </section>

      <CareerElanFooter />
    </main>
  );
}
