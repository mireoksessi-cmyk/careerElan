"use client";

/*
  Phase 6E - nav shell for the new Canonical Career Memory UI. Lives
  entirely under this new route tree; does not touch app/layout.tsx or
  any existing page. Auth gating uses the existing useLogin() context
  only to know whether someone is signed in (not to source canonical
  data - see lib/canonicalCareerUi/apiClient.ts's own header comment on
  why this UI never reads canonical data through that context).
*/
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useLogin } from "@/lib/auth/LoginManager";

const NAV_ITEMS = [
  { href: "/canonical-career", label: "Profile" },
  { href: "/canonical-career/versions", label: "Versions" },
  { href: "/canonical-career/sources", label: "Sources" },
  { href: "/canonical-career/overlays", label: "Overlays" },
  { href: "/canonical-career/merge", label: "Merge" },
  { href: "/canonical-career/inspector", label: "Inspector" },
];

export default function CanonicalCareerLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useLogin();
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-1 px-6 py-3">
          <span className="mr-4 text-sm font-semibold text-neutral-900">Canonical Career Memory</span>
          <nav className="flex flex-wrap gap-1">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-1.5 text-sm ${active ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {loading ? (
        <div className="mx-auto max-w-5xl px-6 py-10 text-sm text-neutral-500">Checking your session…</div>
      ) : !user ? (
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-800">
            You need to sign in to view your Canonical Career Memory. <Link href="/login" className="font-medium underline">Sign in</Link>
          </div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
