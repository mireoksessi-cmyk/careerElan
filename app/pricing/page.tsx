import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Check, Sparkles, Clock } from "lucide-react";
import FooterGroup, {
  PRODUCT_FOOTER_ITEMS,
  PRODUCT_FOOTER_LINKS,
} from "@/components/marketing/FooterGroup";

export const metadata: Metadata = {
  title: "Pricing | Career Élan",
  description:
    "Start with Career Élan for free. Generate up to 3 tailored application packages every month.",
};

/*
  Phase 6I.6.26 - public marketing page, no auth/DB/AI/quota calls. Same
  Header/Footer pattern as app/features/page.tsx and app/how-it-works/
  page.tsx (markup copied, not the real Header, for the same reason
  documented there - Log in/Get Started only exist as modal state on
  app/page.tsx itself).

  Content-truth notes (Part F/G of this phase's spec):
  - "3 Generate Packages / month" mirrors the ACTUAL current policy
    already confirmed live in the DB in Phase 6I.6.23
    (resolve_generate_package_quota_limit() -> quota_plans.free.
    monthly_generation_limit = 3, UTC calendar month). This page does not
    reimplement, recompute, or call that RPC - it is a static marketing
    restatement of an already-verified number, phrased as "each month"
    rather than exposing "UTC calendar month" to end users.
  - The free-plan feature list below reproduces ONLY items already
    verified as real, live product capabilities in Phase 6I.6.24's own
    Features-page audit and Phase 6I.6.25's How It Works audit (Career
    Memory, AI Job Analysis, Tailored Resume/Cover Letter, Email Draft,
    Package Analysis, Resume Templates, Job Tracker) - nothing invented.
  - Pro is intentionally priceless and quota-less here: quota_plans.pro's
    internal DB value (50/month) is NOT surfaced to users - this phase
    explicitly prohibits promising a specific Pro number before Pro is
    actually sold. The Pro card is Coming Soon only, with a disabled CTA,
    no checkout/subscribe/upgrade action of any kind.
*/

const FREE_FEATURES = [
  "Career Memory",
  "AI Job Analysis",
  "Tailored Resume",
  "Tailored Cover Letter",
  "Email Draft",
  "Package Analysis",
  "Resume Templates",
  "Job Tracker",
];

export default function PricingPage() {
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
        <div className="mx-auto max-w-[760px] text-center">
          <h1 className="text-3xl font-black tracking-[-0.03em] text-slate-950 sm:text-4xl">
            Pricing
          </h1>
          <p className="mt-4 text-base font-semibold leading-7 text-slate-600 sm:text-lg">
            Start with Career Élan for free. Generate tailored application
            packages for your job search, with more options coming soon.
          </p>
        </div>
      </section>

      <section className="w-full bg-white px-5 py-14 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto grid max-w-[920px] gap-6 md:grid-cols-2">
          {/* Free plan */}
          <div className="flex flex-col rounded-3xl border-2 border-blue-600 bg-white p-8 shadow-lg shadow-blue-100">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-black uppercase tracking-wide text-blue-600">
                Free
              </p>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-blue-700 ring-1 ring-blue-200">
                Available now
              </span>
            </div>

            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-5xl font-black tracking-[-0.03em] text-slate-950">
                $0
              </span>
              <span className="text-sm font-bold text-slate-500">/ month</span>
            </div>

            <div className="mt-5 rounded-2xl bg-blue-50 px-4 py-3">
              <p className="text-lg font-black text-blue-700">
                3 Generate Packages / month
              </p>
              <p className="mt-1 text-sm font-semibold text-blue-900/70">
                Generate up to 3 tailored application packages each month.
                Your allowance resets automatically at the start of each
                month.
              </p>
            </div>

            <ul className="mt-6 flex-1 space-y-3">
              {FREE_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5">
                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0 text-blue-600"
                    strokeWidth={2.5}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-semibold text-slate-700">
                    {feature}
                  </span>
                </li>
              ))}
            </ul>

            <Link
              href="/"
              className="mt-8 rounded-xl bg-blue-600 px-6 py-3 text-center text-sm font-black text-white shadow-lg shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700"
            >
              Get Started
            </Link>
          </div>

          {/* Pro plan - Coming Soon, no price, no quota number, no checkout */}
          <div className="flex flex-col rounded-3xl border border-slate-200 bg-slate-50 p-8">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-black uppercase tracking-wide text-slate-500">
                Pro
              </p>
              <span className="flex items-center gap-1.5 rounded-full bg-slate-200 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-slate-600">
                <Clock className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                Coming Soon
              </span>
            </div>

            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-5xl font-black tracking-[-0.03em] text-slate-400">
                —
              </span>
            </div>

            <p className="mt-5 text-sm font-semibold leading-6 text-slate-600">
              More application capacity and additional premium features are
              planned for Career Élan Pro.
            </p>

            <div className="mt-6 flex-1 space-y-3">
              <p className="flex items-start gap-2.5 text-sm font-semibold text-slate-500">
                <Sparkles
                  className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                Details, capacity, and pricing will be announced closer to
                launch.
              </p>
            </div>

            <button
              type="button"
              disabled
              aria-disabled="true"
              className="mt-8 cursor-not-allowed rounded-xl border border-slate-300 bg-slate-100 px-6 py-3 text-sm font-black text-slate-400"
            >
              Pro — Coming Soon
            </button>
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
            items={PRODUCT_FOOTER_ITEMS}
            links={PRODUCT_FOOTER_LINKS}
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
