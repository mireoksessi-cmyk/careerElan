"use client";

import { useEffect, useState } from "react";
import CareerElanFooter from "@/components/marketing/CareerElanFooter";
import LandingPage from "@/components/marketing/LandingPage";
import PublicAuthActionsProvider, {
  useAuthActions,
} from "@/components/marketing/PublicAuthActions";
import { useLogin } from "@/lib/auth/LoginManager";
import { track } from "@/lib/analytics/posthog";

/*
  Phase 6I.6.28 - the real Log in/Get Started/CTA behavior (the modal,
  its state, and all Supabase auth calls) now lives in
  components/marketing/PublicAuthActions.tsx, shared with the public
  marketing pages (/features, /how-it-works, /pricing, /about) so none of
  them duplicate this page's auth logic. HomePage itself is now a thin
  wrapper that provides that context; HomePageBody is this page's actual
  content, unchanged, using useAuthActions().openAuth(...) exactly where
  it previously called its own local openAuth(...).
*/
export default function HomePage() {
  return (
    <PublicAuthActionsProvider>
      <HomePageBody />
    </PublicAuthActionsProvider>
  );
}

function HomePageBody() {
  const { openAuth } = useAuthActions();

  /*
    Analytics only. This route IS the public landing page, so mounting it is
    exactly the "landing_viewed" moment. Fires once per mount and touches
    nothing else.
  */
  useEffect(() => {
    track("landing_viewed");
  }, []);

  /*
    Analytics only. Every landing CTA - "Try Career Élan Free", "Try Free",
    "Start Free Beta" and the mobile menu's Try Free - already routes through
    this same openAuth prop (see LandingPage.tsx), so wrapping it here records
    the primary Get Started click for all of them WITHOUT touching
    LandingPage.tsx or changing any existing handler. Additive: the original
    openAuth is always called with the original argument.
  */
  function openAuthWithAnalytics(mode?: "login" | "signup") {
    if (mode === "signup") track("get_started_clicked");
    openAuth(mode);
  }
  /*
    Phase 6I.6.30 - session-aware Header. LoginManager (lib/auth/
    LoginManager.tsx) already wraps the entire app (app/layout.tsx) and
    tracks the real Supabase session via getSession()/onAuthStateChange()
    - reused here rather than adding a second auth listener. Log in/Get
    Started are only ever rendered while genuinely logged out; while the
    initial session check is still resolving (`loading`), neither renders,
    which avoids a flash of the CTAs for an already-authenticated user.
  */
  const { user, loading } = useLogin();
  const showAuthCta = !loading && !user;

  /*
    A suspended account signs in successfully - suspension is a flag on the
    profile, not a change to the Supabase credential - and middleware then
    turns them away from every protected route, sending them here with
    ?accountSuspended=1 (see middleware.ts). Until now nothing read that,
    so the person landed back on the marketing page with no explanation and
    no way to tell a suspension apart from a login that silently failed.

    Read the same way the auth modal reads its own parameters
    (components/marketing/PublicAuthActions.tsx): URLSearchParams over
    window.location.search inside an effect, and the parameter is left in
    the URL afterwards, exactly as the existing ones are.

    Says only that the account is suspended and that access resumes when it
    is reactivated. Not why, not by whom, and no support address - there is
    no contact route in this UI to promise one.
  */
  const [showSuspendedNotice, setShowSuspendedNotice] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("accountSuspended") === "1") {
      setShowSuspendedNotice(true);
    }
  }, []);

  return (
  <main className="min-h-screen w-full overflow-x-hidden bg-white text-slate-950">
    {/*
      Shown only for ?accountSuspended=1. Dismissing it clears local state
      and nothing else - no request, no write, no session change.
    */}
    {showSuspendedNotice && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <h2 className="text-xl font-black text-slate-950">Account suspended</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Your account has been suspended. You won&apos;t be able to use Career
            Élan until it is reactivated.
          </p>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => setShowSuspendedNotice(false)}
              className="rounded-xl bg-blue-600 px-5 py-2.5 font-bold text-white"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    )}

    <LandingPage openAuth={openAuthWithAnalytics} showAuthCta={showAuthCta} />

      <CareerElanFooter />
    </main>
  );
}
