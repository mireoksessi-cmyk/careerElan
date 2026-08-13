"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

/*
  Phase 2B - mobile navigation for the authenticated app shell. Below md,
  every authenticated page hides its desktop <aside> sidebar (a `hidden
  md:block`/`md:flex` class added at each call site) and renders this
  component instead: a compact top app bar (logo + hamburger) plus a
  slide-in drawer covering the same primary destinations as the desktop
  sidebar. Self-contained (own open/closed state, own item list) so it
  drops into both the shared Sidebar.tsx and the 5 pages that duplicate
  sidebar markup locally without requiring any of them to restructure
  their existing layout wrappers - the drawer is a fixed-position overlay,
  so it works regardless of the parent's flex-direction.

  The item list intentionally includes "Paste Job" (present in the
  Paste Job/Find Jobs/Create Package pages' own local desktop sidebars,
  absent from the shared Sidebar.tsx's 7-item list) so every primary
  destination is reachable from the mobile drawer on every page,
  regardless of which desktop sidebar variant that page happens to use.
*/

const menuItems = [
  "Dashboard",
  "Career Memory",
  "Find Jobs",
  "Paste Job",
  "Generate Package",
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
    case "Paste Job":
      return "/paste-job";
    case "Generate Package":
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
    case "Paste Job":
      return "📋";
    case "Generate Package":
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

interface MobileNavProps {
  active: string;
}

export default function MobileNav({ active }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    menuButtonRef.current?.focus();
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-blue-100 bg-white px-4 py-2.5 md:hidden">
        <Link href="/dashboard" className="flex items-center">
          <Image
            src="/logo.png"
            alt="Career Élan"
            width={110}
            height={41}
            className="h-auto w-[100px]"
            priority
          />
        </Link>

        <button
          ref={menuButtonRef}
          type="button"
          aria-label="Open navigation"
          aria-expanded={open}
          aria-controls="mobile-nav-panel"
          onClick={() => setOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-blue-100 text-xl text-gray-700"
        >
          <span aria-hidden="true">☰</span>
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            aria-hidden="true"
            onClick={close}
            className="absolute inset-0 bg-slate-950/40"
          />

          <div
            id="mobile-nav-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="absolute left-0 top-0 flex h-dvh w-[85%] max-w-xs flex-col overflow-y-auto bg-white px-5 py-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <Image
                src="/logo.png"
                alt="Career Élan"
                width={110}
                height={41}
                className="h-auto w-[100px]"
              />
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close navigation"
                onClick={close}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-2xl leading-none text-gray-500 hover:bg-gray-100"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <p className="mt-6 text-xs font-bold uppercase tracking-wider text-gray-400">
              Overview
            </p>

            <nav aria-label="Primary" className="mt-3 flex flex-col gap-2">
              {menuItems.map((item) => (
                <Link
                  key={item}
                  href={getMenuHref(item)}
                  onClick={close}
                  aria-current={active === item ? "page" : undefined}
                  className={`flex min-h-[44px] items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                    active === item
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-gray-600 hover:bg-blue-50 hover:text-blue-600"
                  }`}
                >
                  <span aria-hidden="true">{getMenuIcon(item)}</span>
                  {item}
                </Link>
              ))}
            </nav>

            <div className="mt-6 rounded-2xl bg-blue-50 p-4 text-center">
              <h3 className="text-sm font-bold">Career Élan Pro</h3>
              <p className="mt-1 text-xs text-black">
                More capacity and premium features are coming soon.
              </p>
              <Link
                href="/pricing"
                onClick={close}
                className="mt-3 block w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white"
              >
                Coming Soon
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
