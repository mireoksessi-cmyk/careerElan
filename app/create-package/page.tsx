"use client";

import Image from "next/image";
import { useLogin } from "@/lib/auth/LoginManager";
import CareerMemoryGuard from "@/components/CareerMemoryGuard";
const menuItems = [
  { label: "Dashboard", href: "/dashboard", icon: "🏠" },
  { label: "Career Memory", href: "/career-memory", icon: "🧠" },
  { label: "Create Package", href: "/create-package", icon: "📦" },
  { label: "Find Jobs", href: "/find-jobs", icon: "🔍" },
  { label: "Paste Job", href: "/paste-job", icon: "📋" },
  { label: "Job Tracker", href: "/job-tracker", icon: "💼" },
  { label: "Analytics", href: "/analytics", icon: "📊" },
  { label: "Settings", href: "/settings", icon: "⚙️" },
];

export default function CreatePackagePage() {
  const { profile } = useLogin();
 return (
  <CareerMemoryGuard>
    <main className="min-h-screen bg-[#f6fbff] text-gray-900">
      <div className="flex min-h-screen">
        <aside className="w-60 border-r border-blue-100 bg-white px-5 py-6">
          <div className="flex items-center justify-between">
            <a href="/dashboard">
              <Image src="/logo.png" alt="Career Élan" width={120} height={45} />
            </a>
            <span className="text-gray-400">‹</span>
          </div>

          <p className="mt-8 text-xs font-bold uppercase tracking-wider text-gray-400">
            Overview
          </p>

          <nav className="mt-4 space-y-2">
            {menuItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  item.label === "Create Package"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-gray-600 hover:bg-blue-50 hover:text-blue-600"
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="mt-16 rounded-2xl bg-blue-50 p-5 text-center">
            <div className="text-3xl">👑</div>
            <h3 className="mt-3 font-extrabold">Upgrade to Pro</h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Unlock unlimited AI features and boost your job search.
            </p>
            <button className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white">
              Upgrade Now
            </button>
          </div>
        </aside>

        <section className="flex-1 px-8 py-6">
          <header className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-extrabold">Create Full Package</h1>
              <p className="mt-1 text-sm text-gray-500">
                Choose how you want to create your company-specific application package.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button className="rounded-full bg-white p-3 shadow-sm">🔔</button>
              <button className="rounded-full bg-white p-3 shadow-sm">💬</button>
              <a
                href="/settings"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 font-bold text-white"
              >
                {(profile?.full_name || "Guest").charAt(0).toUpperCase()}
              </a>
            </div>
          </header>

          <section className="rounded-3xl border border-blue-100 bg-white p-8 shadow-sm">
            <div className="grid gap-6 lg:grid-cols-2">
              <a
                href="/find-jobs"
                className="group rounded-3xl border border-blue-100 bg-white p-8 shadow-sm transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-xl"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-4xl shadow-sm">
                  🔍
                </div>

                <h2 className="mt-7 text-2xl font-extrabold">
                  Find Jobs in Career Élan
                </h2>

                <p className="mt-3 text-sm leading-7 text-gray-600">
                  Search jobs matched to your Career Memory, choose a posting,
                  then generate a tailored resume, cover letter, and email draft.
                </p>

                <div className="mt-8 flex items-center justify-between">
                  <span className="text-sm font-bold text-blue-600">
                    Find Jobs
                  </span>
                  <span className="text-xl transition group-hover:translate-x-1">
                    →
                  </span>
                </div>
              </a>

              <a
                href="/paste-job"
                className="group rounded-3xl border border-blue-100 bg-white p-8 shadow-sm transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-xl"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-4xl shadow-sm">
                  📦
                </div>

                <h2 className="mt-7 text-2xl font-extrabold">
                  Paste Job URL or Description
                </h2>

                <p className="mt-3 text-sm leading-7 text-gray-600">
                  Already found a job on LinkedIn, Indeed, Job Bank, or a company
                  website? Paste it here and generate your full package.
                </p>

                <div className="mt-8 flex items-center justify-between">
                  <span className="text-sm font-bold text-blue-600">
                    Create Package
                  </span>
                  <span className="text-xl transition group-hover:translate-x-1">
                    →
                  </span>
                </div>
              </a>
            </div>

            <div className="mt-8 rounded-2xl bg-green-50 px-6 py-5 text-center">
              <p className="text-sm font-bold text-green-700">
                You apply directly. Career Élan prepares your resume, cover letter,
                and email draft in minutes.
              </p>
            </div>
          </section>

          <section className="mt-8 grid gap-6 lg:grid-cols-3">
            <div className="rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
              <div className="text-3xl">1️⃣</div>
              <h3 className="mt-4 font-extrabold">Choose a job</h3>
              <p className="mt-2 text-sm leading-6 text-gray-500">
                Find one in Career Élan or paste a job posting you found elsewhere.
              </p>
            </div>

            <div className="rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
              <div className="text-3xl">2️⃣</div>
              <h3 className="mt-4 font-extrabold">Generate package</h3>
              <p className="mt-2 text-sm leading-6 text-gray-500">
                Create a tailored resume, cover letter, and follow-up email.
              </p>
            </div>

            <div className="rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
              <div className="text-3xl">3️⃣</div>
              <h3 className="mt-4 font-extrabold">Apply directly</h3>
              <p className="mt-2 text-sm leading-6 text-gray-500">
                Open the original job posting and apply with your prepared package.
              </p>
            </div>
          </section>
        </section>
     </div>
    </main>
  </CareerMemoryGuard>
  );
}