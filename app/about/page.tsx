import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import FooterGroup, {
  PRODUCT_FOOTER_ITEMS,
  PRODUCT_FOOTER_LINKS,
  COMPANY_FOOTER_ITEMS,
  COMPANY_FOOTER_LINKS,
} from "@/components/marketing/FooterGroup";

export const metadata: Metadata = {
  title: "About Us | Career Élan",
  description:
    "Career Élan is building a smarter way to navigate the job search - helping people understand opportunities, present their experience clearly, and approach every application with greater confidence.",
};

/*
  Phase 6I.6.27 - public marketing page, no auth/DB/AI/quota calls. Same
  Header/Footer markup pattern as /features, /how-it-works, /pricing (copied,
  not the real app/page.tsx Header, for the same reason documented in
  those files - Log in/Get Started only exist as modal state there).

  Content-safety notes (Part E of this phase's spec): no ranking claims,
  no guarantees, no fabricated user/customer counts, no team/founder/
  office/investor/press content - only the 5 sections specified. Section 4
  deliberately does not claim to support every job posting or every
  remote role, consistent with the 3-state (SUPPORTED/UNSUPPORTED/UNKNOWN)
  Canada-scope policy from Phase 6I.6.22.
*/

export default function AboutPage() {
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

          <Link
            href="/"
            className="mt-8 inline-block rounded-xl bg-blue-600 px-6 py-3 text-sm font-black text-white shadow-xl shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700"
          >
            Get Started
          </Link>
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

          <Link
            href="/"
            className="mt-6 inline-block rounded-xl bg-white px-6 py-3 text-sm font-black text-blue-700 shadow-lg transition hover:-translate-y-0.5"
          >
            Get Started
          </Link>
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
            items={PRODUCT_FOOTER_ITEMS}
            links={PRODUCT_FOOTER_LINKS}
          />
          <FooterGroup
            title="Company"
            items={COMPANY_FOOTER_ITEMS}
            links={COMPANY_FOOTER_LINKS}
          />
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
