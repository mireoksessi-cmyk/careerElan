"use client";

import Image from "next/image";
import Link from "next/link";
import { Mail } from "lucide-react";
import FooterGroup, {
  PRODUCT_FOOTER_ITEMS,
  PRODUCT_FOOTER_LINKS,
  COMPANY_FOOTER_ITEMS,
  COMPANY_FOOTER_LINKS,
} from "@/components/marketing/FooterGroup";
import PublicAuthActionsProvider, {
  useAuthActions,
} from "@/components/marketing/PublicAuthActions";

/*
  Phase 6I.6.29 - new public marketing page for the Company Footer's
  "Contact" destination. Same Header/Footer/auth architecture as
  Features/How It Works/Pricing/About (PublicAuthActionsProvider +
  useAuthActions) - no separate contact form, no server action, no DB
  write. The only contact method is a real mailto link to
  careerelanhq@gmail.com (Part K/L of this phase's spec explicitly
  forbids building a form or making unsupported support-time promises).
*/
export default function ContactPageClient() {
  return (
    <PublicAuthActionsProvider>
      <ContactPageBody />
    </PublicAuthActionsProvider>
  );
}

const CONTACT_EMAIL = "careerelanhq@gmail.com";

function ContactPageBody() {
  const { openAuth } = useAuthActions();

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

        <button
          type="button"
          onClick={() => openAuth("signup")}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-blue-200 md:hidden"
        >
          Start
        </button>
      </header>

      <section className="w-full bg-gradient-to-br from-white via-blue-50 to-slate-50 px-5 py-14 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto max-w-[760px] text-center">
          <p className="text-xs font-black uppercase tracking-[0.15em] text-blue-600">
            CONTACT
          </p>
          <h1 className="mt-4 text-3xl font-black tracking-[-0.03em] text-slate-950 sm:text-4xl">
            Get in Touch
          </h1>
          <p className="mx-auto mt-5 max-w-[560px] text-base font-semibold leading-7 text-slate-600 sm:text-lg">
            Have a question about Career Élan? We&rsquo;d be happy to hear
            from you.
          </p>
        </div>
      </section>

      <section className="w-full bg-white px-5 py-14 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto max-w-[640px] rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <Mail className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
          </div>

          <h2 className="mt-5 text-2xl font-black text-slate-950">
            Contact Career Élan
          </h2>

          <p className="mx-auto mt-3 max-w-[480px] text-sm font-semibold leading-6 text-slate-600 sm:text-base">
            For general questions, product feedback, or support inquiries,
            contact us at:
          </p>

          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="mt-6 inline-block break-all rounded-xl bg-blue-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700 sm:text-base"
          >
            {CONTACT_EMAIL}
          </a>
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
