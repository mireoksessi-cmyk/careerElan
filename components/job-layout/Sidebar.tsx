"use client";

import Image from "next/image";

const menuItems = [
  "Dashboard",
  "Career Memory",
  "Find Jobs",
  "Create Package",
  "Job Tracker",
  "Analytics",
  "Settings",
];

function getMenuHref(item: string) {
  switch (item) {
    case "Dashboard":
      return "/dashboard";
    case "Career Memory":
      return "/career-memory";
    case "Find Jobs":
      return "/find-jobs";
    case "Create Package":
      return "/create-package";
    case "Job Tracker":
      return "/job-tracker";
    case "Analytics":
      return "/analytics";
    case "Settings":
      return "/settings";
    default:
      return "#";
  }
}

function getMenuIcon(item: string) {
  switch (item) {
    case "Dashboard":
      return "🏠";
    case "Career Memory":
      return "🧠";
    case "Find Jobs":
      return "🔍";
    case "Create Package":
      return "📦";
    case "Job Tracker":
      return "💼";
    case "Analytics":
      return "📊";
    case "Settings":
      return "⚙️";
    default:
      return "•";
  }
}

interface SidebarProps {
  active: string;
}

export default function Sidebar({
  active,
}: SidebarProps) {
  return (
    <aside className="w-60 border-r border-blue-100 bg-white px-5 py-6">

      <div className="flex items-center justify-between">

        <a href="/dashboard">
          <Image
            src="/logo.png"
            alt="Career Élan"
            width={120}
            height={45}
          />
        </a>

        <span className="text-gray-400">‹</span>

      </div>

      <p className="mt-8 text-xs font-bold uppercase tracking-wider text-gray-400">
        Overview
      </p>

      <nav className="mt-4 space-y-2">

        {menuItems.map((item) => (

          <a
            key={item}
            href={getMenuHref(item)}
            className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${
              active === item
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-600 hover:bg-blue-50 hover:text-blue-600"
            }`}
          >
            <span>{getMenuIcon(item)}</span>

            {item}

          </a>

        ))}

      </nav>

      <div className="mt-24 rounded-2xl bg-blue-50 p-5 text-center">

        <div className="text-3xl">
          👑
        </div>

        <h3 className="mt-3 font-bold">
          Upgrade to Pro
        </h3>

        <p className="mt-2 text-sm text-black">
          Unlock unlimited AI features
          and faster package generation.
        </p>

        <button className="mt-5 w-full rounded-xl bg-blue-600 py-3 font-semibold text-black">
          Upgrade
        </button>

      </div>

    </aside>
  );
}