"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import CareerElanFooter from "@/components/marketing/CareerElanFooter";
import PublicAuthActionsProvider, {
  useAuthActions,
} from "@/components/marketing/PublicAuthActions";
import { useLogin } from "@/lib/auth/LoginManager";

/*
  Phase 6I.6.29 - shared shell for the three public legal pages
  (/privacy, /terms, /cookies). Previously this rendered a separate,
  narrow, text-only "old website" shell (small header, "Back to home",
  no marketing nav, no auth CTAs) that visually broke from Features/
  How It Works/Pricing/About. It now uses the SAME marketing Header/
  Footer/auth architecture as those pages (PublicAuthActionsProvider +
  useAuthActions, identical nav/CTA markup) so a legal page no longer
  looks like it belongs to a different site.

  IMPORTANT - this file only changes the SHELL. The three page.tsx files
  (app/privacy, app/terms, app/cookies) that pass their legal body as
  `children` are completely unchanged by this phase - their substantive
  text, headings, and Last Updated dates are untouched, verbatim. The
  `.legal-content` class (styled in app/globals.css) is preserved as-is
  on the document `<article>` below specifically so that existing
  prose styling (headings, lists, tables, hr) keeps applying unmodified.

  Kept as a client component (rather than the previous plain server
  component) only because real auth CTAs require it - the document body
  itself (`children`) is still ordinary server-rendered JSX passed in
  from each page.tsx, so no legal content becomes client-rendered.
*/
export default function LegalLayout({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <PublicAuthActionsProvider>
      <LegalLayoutBody title={title} lastUpdated={lastUpdated}>
        {children}
      </LegalLayoutBody>
    </PublicAuthActionsProvider>
  );
}

function LegalLayoutBody({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
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

      {/* Legal Hero - brand shell matches Features/About/Pricing */}
      <section className="w-full bg-gradient-to-br from-white via-blue-50 to-slate-50 px-5 py-14 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto max-w-[760px] text-center">
          <p className="text-xs font-black uppercase tracking-[0.15em] text-blue-600">
            LEGAL
          </p>
          <h1 className="mt-4 text-3xl font-black tracking-[-0.03em] text-slate-950 sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 text-sm font-semibold text-slate-500">
            Last Updated: {lastUpdated}
          </p>
        </div>
      </section>

      {/* Document body - readable max-width preserved (Part D: content
          stays document-friendly even though the shell is now marketing) */}
      <section className="w-full bg-white px-5 py-14 sm:px-8 lg:px-10 xl:px-12">
        <article className="legal-content mx-auto max-w-3xl text-[15px] leading-7 text-slate-700">
          {children}
        </article>
      </section>

      <CareerElanFooter />
    </main>
  );
}
