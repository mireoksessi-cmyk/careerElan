"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import PublicAuthActionsProvider, {
  useAuthActions,
} from "@/components/marketing/PublicAuthActions";

/*
  Phase 2A Quick Win - shared entry-point body for /login and /signup.
  Direct navigation to either route used to show a dead-end stub ("Please
  log in from the homepage modal." + "Go to Home"), which broke bookmarked
  links, search results, shared links, and OAuth/auth redirects that land
  on these paths. This reuses the SAME PublicAuthActionsProvider/openAuth
  modal every other public page already uses (Phase 6I.6.28) - no new auth
  logic, no duplicated Supabase calls, same OAuth providers, same email/
  password rules. It only auto-opens that existing modal on mount instead
  of requiring an extra click from "/".

  If the user closes the modal, this renders a minimal branded page (not a
  blank screen) with a manual button to reopen it - so the route is a real
  destination either way, not just a modal launcher.
*/
export default function AuthEntryPageClient({
  mode,
}: {
  mode: "login" | "signup";
}) {
  return (
    <PublicAuthActionsProvider>
      <AuthEntryBody mode={mode} />
    </PublicAuthActionsProvider>
  );
}

function AuthEntryBody({ mode }: { mode: "login" | "signup" }) {
  const { openAuth } = useAuthActions();

  useEffect(() => {
    openAuth(mode);
    // Only ever auto-open once, for the mode this route was loaded with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const heading = mode === "login" ? "Log in to Career Élan" : "Create your Career Élan account";
  const body =
    mode === "login"
      ? "Continue building smarter applications."
      : "Start with one profile. Apply everywhere.";
  const buttonLabel = mode === "login" ? "Log in" : "Get Started";

  return (
    <main className="flex min-h-screen w-screen flex-col items-center justify-center bg-slate-50 px-6 py-12 text-center">
      <Link href="/">
        <Image
          src="/logo.png"
          alt="Career Élan"
          width={180}
          height={76}
          priority
          className="h-auto w-[160px]"
        />
      </Link>

      <h1 className="mt-8 text-2xl font-black tracking-[-0.03em] text-slate-950">
        {heading}
      </h1>
      <p className="mt-2 max-w-sm text-sm font-semibold text-slate-500">{body}</p>

      <button
        type="button"
        onClick={() => openAuth(mode)}
        className="mt-6 rounded-xl bg-blue-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700"
      >
        {buttonLabel}
      </button>

      <Link
        href="/"
        className="mt-6 text-sm font-bold text-slate-500 transition hover:text-blue-600"
      >
        ← Back to Home
      </Link>
    </main>
  );
}
