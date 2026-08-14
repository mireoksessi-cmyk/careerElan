"use client";

import type { LucideIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  ScanSearch,
  FileText,
  MessageCircleQuestion,
  BrainCircuit,
  Building2,
  LayoutTemplate,
  UserCheck,
  ListChecks,
  MapPin,
  Rocket,
} from "lucide-react";
import CareerElanFooter from "@/components/marketing/CareerElanFooter";
import PublicAuthActionsProvider, {
  useAuthActions,
} from "@/components/marketing/PublicAuthActions";
import { useLogin } from "@/lib/auth/LoginManager";

/*
  Phase 6I.6.28 - Log in/Get Started/Start now open the real Homepage auth
  modal directly (via the shared PublicAuthActionsProvider), instead of
  linking back to "/". Metadata stays in app/features/page.tsx (a Server
  Component) since a "use client" file cannot export `metadata` - this
  file is that page's client-rendered body.
*/

type Feature = {
  icon: LucideIcon;
  title: string;
  description: string;
  comingSoon?: boolean;
};

const FEATURES: Feature[] = [
  {
    icon: ScanSearch,
    title: "AI Job Analysis",
    description: "Understand what employers are really looking for.",
  },
  {
    icon: FileText,
    title: "Tailored Application Package",
    description:
      "Create a tailored resume and cover letter for every opportunity.",
  },
  {
    icon: MessageCircleQuestion,
    title: "Explain Why",
    description: "See exactly what AI changed — and why.",
  },
  {
    icon: BrainCircuit,
    title: "Career Memory",
    description:
      "Build your career profile once and put your experience to work across applications.",
  },
  {
    icon: Building2,
    title: "Career Fair",
    description:
      "Discover employers, explore opportunities, and prepare before you make your first impression.",
  },
  {
    icon: LayoutTemplate,
    title: "Resume Templates",
    description:
      "Present your experience with professional, ATS-friendly resume designs.",
  },
  {
    icon: UserCheck,
    title: "AI Recruiter Simulation",
    description: "Get feedback from a recruiter's perspective before you apply.",
    comingSoon: true,
  },
  {
    icon: ListChecks,
    title: "Job Tracker",
    description:
      "Keep your applications, resumes, and next steps organized in one place.",
  },
  {
    icon: MapPin,
    title: "Built for Canada",
    description: "Designed around the Canadian job market and hiring experience.",
  },
  {
    icon: Rocket,
    title: "Auto Apply",
    description: "Take the next step toward a faster, more automated job search.",
    comingSoon: true,
  },
];

export default function FeaturesPageClient() {
  return (
    <PublicAuthActionsProvider>
      <FeaturesPageBody />
    </PublicAuthActionsProvider>
  );
}

function FeaturesPageBody() {
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

      <section className="w-full bg-gradient-to-br from-white via-blue-50 to-slate-50 px-5 py-14 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto max-w-[860px] text-center">
          <h1 className="text-3xl font-black tracking-[-0.03em] text-slate-950 sm:text-4xl">
            Everything You Need to Apply with Confidence
          </h1>
          <p className="mt-4 text-base font-semibold leading-7 text-slate-600 sm:text-lg">
            Career Élan brings your job search, application materials, and
            career history together in one intelligent workspace.
          </p>
        </div>
      </section>

      <section className="w-full bg-white px-5 py-12 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto grid max-w-[1440px] gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {FEATURES.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </div>
      </section>

      <CareerElanFooter />
    </main>
  );
}

function FeatureCard({ icon: Icon, title, description, comingSoon }: Feature) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <Icon className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
        </div>

        {comingSoon && (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-amber-700 ring-1 ring-amber-200">
            Coming Soon
          </span>
        )}
      </div>

      <p className="mt-4 text-base font-black text-slate-950">{title}</p>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
        {description}
      </p>
    </div>
  );
}
