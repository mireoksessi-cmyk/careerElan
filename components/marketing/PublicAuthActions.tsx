"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useModalFocusTrap } from "@/lib/hooks/useModalFocusTrap";
import { useToast } from "@/components/ui/ToastProvider";

/*
  Phase 6I.6.28 - the SAME auth modal/state/handlers that previously lived
  only inside app/page.tsx (HomePage), extracted verbatim (not rewritten,
  not redesigned) so every public marketing page (/, /features,
  /how-it-works, /pricing, /about) can open the real Log in/Get Started
  flow directly, instead of each page's Header buttons only navigating
  back to "/" and making the user click again. Every state variable,
  effect, and Supabase call below is copied unchanged from the pre-Phase-
  6I.6.28 app/page.tsx - this file only relocates where that code lives,
  it does not alter OAuth providers, email/password rules, the Supabase
  auth API used, post-login/signup redirect destinations, consent logic,
  session/cookie handling, callback routes, or password validation.

  Usage: wrap a page's content in <PublicAuthActionsProvider>, then call
  useAuthActions().openAuth("login" | "signup" | ...) from anywhere inside
  it - the exact same signature app/page.tsx's own buttons already called
  before this phase, so no call site needed to change shape.
*/

type AuthMode =
  | "login"
  | "signup"
  | "forgot-id"
  | "forgot-password"
  | "new-password";

type AuthActionsContextValue = {
  openAuth: (mode?: AuthMode) => void;
};

const AuthActionsContext = createContext<AuthActionsContextValue | null>(null);

export function useAuthActions(): AuthActionsContextValue {
  const ctx = useContext(AuthActionsContext);
  if (!ctx) {
    throw new Error(
      "useAuthActions() must be called from inside <PublicAuthActionsProvider>."
    );
  }
  return ctx;
}

export default function PublicAuthActionsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  /*
    Find ID asks for an address, not the login_id - that is the value being
    recovered, so it cannot also be the way in. Kept apart from loginEmail,
    which despite its name holds the login_id the sign-in form wants.
  */
  const [findIdEmail, setFindIdEmail] = useState("");
  const [newPassword, setNewPassword] =
  useState("");

const [
  confirmNewPassword,
  setConfirmNewPassword,
] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  /*
    Null until Create Account has classified the address. Anything else
    means the signup was stopped because the account already exists, and
    the form is showing that instead of a success it cannot honestly claim.
  */
  const [signupAccountState, setSignupAccountState] = useState<
    "EXISTING_VERIFIED" | "EXISTING_UNVERIFIED" | "EXISTING_SOCIAL" | "UNKNOWN" | null
  >(null);
  const [loginId, setLoginId] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [agreedToLegalTerms, setAgreedToLegalTerms] = useState(false);

  const authModalPanelRef = useRef<HTMLDivElement | null>(null);
  const authModalCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  useModalFocusTrap(
    showAuthModal,
    authModalPanelRef,
    authModalCloseButtonRef,
    () => setShowAuthModal(false)
  );

useEffect(() => {
  const params = new URLSearchParams(
    window.location.search
  );

  /*
    Emitted by app/auth/confirm/route.ts when a confirmation link cannot be
    turned into a session. "invalid" covers expired, already-used and
    never-valid alike - the route deliberately does not tell them apart, and
    the instruction is the same for all three. "session" means the address
    really was verified and only the sign-in is missing, so it must not read
    like a failure.
  */
  const verifyError = params.get("verifyError");

  if (verifyError === "invalid" || verifyError === "session") {
    setAuthMode("login");
    setShowAuthModal(true);
    setMessage(
      verifyError === "session"
        ? "Your email has been verified. Please log in to continue."
        : "This verification link is invalid or has expired. Please request a new verification email."
    );

    window.history.replaceState(
      {},
      "",
      window.location.pathname
    );

    return;
  }

  if (params.get("verified") === "true") {
    setAuthMode("login");
    setShowAuthModal(true);
    setMessage(
      "Account created successfully. Your email has been verified. You can now log in."
    );

    window.history.replaceState(
      {},
      "",
      window.location.pathname
    );
  }
}, []);

useEffect(() => {
  let mounted = true;

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange(
    (event) => {
      if (!mounted) return;

      if (event === "PASSWORD_RECOVERY") {
        setAuthMode("new-password");
        setShowAuthModal(true);
        setMessage("");
      }
    }
  );

  const params = new URLSearchParams(
    window.location.search
  );

  /*
    Emitted by app/auth/reset-password/route.ts when a recovery link cannot
    be turned into a session. "invalid" covers expired, already spent and
    never-valid alike - the route deliberately does not tell them apart, and
    asking for a fresh link is the answer to all three. Handled here rather
    than left to a bare query string: the old recovery path already failed
    silently through ?authError, and a second unread parameter would only
    repeat that.
  */
  const resetError = params.get("resetError");

  if (resetError === "invalid" || resetError === "session") {
    setAuthMode("login");
    setShowAuthModal(true);
    setMessage(
      resetError === "session"
        ? "We couldn't start a secure password reset session. Please request a new password reset link."
        : "This password reset link is invalid or has expired. Please request a new one."
    );

    window.history.replaceState(
      {},
      "",
      window.location.pathname
    );

    return;
  }

  if (
    params.get("resetPassword") === "true"
  ) {
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return;

        if (error || !data.session) {
          setAuthMode("login");
          setShowAuthModal(true);
          setMessage(
            "This password reset link is invalid or expired."
          );
          return;
        }

        setAuthMode("new-password");
        setShowAuthModal(true);
        setMessage("");
      });

    window.history.replaceState(
      {},
      "",
      window.location.pathname
    );
  }

  /*
    Emitted by /api/auth/find-login-id once it has verified an emailed
    recovery link. The Login ID is deliberately absent from this URL - the
    route left it behind an HttpOnly cookie, so it is asked for over a
    request of its own rather than read out of the address bar, where it
    would end up in history and in every log that records a path.
  */
  const findId = params.get("findId");

  if (findId === "ready" || findId === "invalid") {
    window.history.replaceState(
      {},
      "",
      window.location.pathname
    );

    setAuthMode("login");
    setShowAuthModal(true);

    if (findId === "invalid") {
      setMessage(
        "This Login ID recovery link is invalid or has expired. Please request a new one."
      );
    } else {
      setMessage("");

      fetch("/api/auth/find-login-id?consume=1")
        .then((response) => response.json())
        .then((result) => {
          if (!mounted) return;

          /*
            Fills the sign-in form's ID field and stops there. No password
            is supplied, nothing is submitted, and no session exists -
            clicking a link proved control of a mailbox, which is not the
            same thing as signing in.
          */
          if (
            result?.status === "FOUND" &&
            typeof result.loginId === "string"
          ) {
            setLoginEmail(result.loginId);
            setMessage(
              "Your Login ID has been recovered. Enter your password to continue."
            );

            return;
          }

          setMessage(
            "This Login ID recovery link is invalid or has expired. Please request a new one."
          );
        })
        .catch(() => {
          if (!mounted) return;

          setMessage(
            "This Login ID recovery link is invalid or has expired. Please request a new one."
          );
        });
    }
  }

  return () => {
    mounted = false;
    subscription.unsubscribe();
  };
}, []);

  function openAuth(mode: AuthMode = "login") {
    setAuthMode(mode);
    setMessage("");
    setShowAuthModal(true);
  }

  async function signInWithProvider(provider: "google" | "linkedin_oidc" | "facebook") {
    setLoading(true);
    setMessage("");

    /*
      From BOTH the Sign Up and Login screens: records "this browser is
      about to start an OAuth attempt with this provider" server-side,
      via a signed, short-lived cookie the callback reads - see
      app/api/auth/consent-intent/route.ts and app/auth/callback/route.ts.

      Sent unconditionally (not gated on authMode) because Supabase's
      signInWithOAuth() creates a brand-new account on first use
      regardless of which screen's button triggered it - a user's very
      first OAuth sign-in can happen from the Login screen (e.g. they
      never explicitly clicked "Sign up"), and that new account still
      needs a consent record. This is still always safe for a genuinely
      existing user logging back in: app/auth/callback/route.ts's UPDATE
      only ever writes WHERE legal_terms_accepted_at IS NULL, so a
      returning user with an existing consent record is never touched by
      this - it also means the callback intentionally does NOT need to
      distinguish "brand-new signup" from "existing user whose consent
      happens to still be null" (e.g. a pre-feature account) - both are
      handled by the same "never overwrite, only fill in when null" rule.

      Best-effort: if this request fails, OAuth sign-in still proceeds
      below - consent simply won't be recorded for this attempt, which is
      safer than blocking login over it.
    */
    try {
      await fetch("/api/auth/consent-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
    } catch (consentIntentError) {
      console.error(
        "CONSENT INTENT REQUEST ERROR =",
        consentIntentError
      );
    }

    const redirectTo = `${window.location.origin}/auth/callback`;

    const options =
      provider === "facebook"
        ? {
            redirectTo,
            scopes: "public_profile",
          }
        : {
            redirectTo,
          };

    /*
      Diagnostics-only (see the "OAuth redirect diagnostics" investigation)
      - records exactly what origin this click computed redirectTo from,
      so a real Google/Facebook login attempt can be correlated against
      whatever Supabase/provider-console redirect allow-lists are actually
      configured. Never logs an access/refresh token, authorization code,
      user email, or provider secret - only the browser's own origin/
      hostname, which is not sensitive.
    */
    console.log(
      JSON.stringify({
        event: "oauth_sign_in_started",
        provider,
        browserOrigin: window.location.origin,
        redirectPath: "/auth/callback",
        redirectHostname: window.location.hostname,
        isSecureProtocol: window.location.protocol === "https:",
        currentHostname: window.location.hostname,
        timestamp: new Date().toISOString(),
      })
    );

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options,
      });

      if (error) {
        console.log(
          JSON.stringify({
            event: "oauth_sign_in_request_failed",
            provider,
            errorName: error.name || "Unknown",
            errorMessage:
              typeof error.message === "string"
                ? error.message.slice(0, 200)
                : "Unknown error",
            browserOrigin: window.location.origin,
          })
        );

        setMessage(error.message);
        setLoading(false);
      }
    } catch (thrownError: any) {
      console.log(
        JSON.stringify({
          event: "oauth_sign_in_request_failed",
          provider,
          errorName: thrownError?.name || "Unknown",
          errorMessage:
            typeof thrownError?.message === "string"
              ? thrownError.message.slice(0, 200)
              : "Unknown error",
          browserOrigin: window.location.origin,
        })
      );

      setMessage(
        typeof thrownError?.message === "string"
          ? thrownError.message
          : "Unable to sign in. Please try again."
      );
      setLoading(false);
    }
  }

 async function handleEmailLogin() {
  const cleanLoginId = loginEmail.trim();

  if (!cleanLoginId || !loginPassword) {
    setMessage("Please enter your ID and password.");
    return;
  }

  setLoading(true);
  setMessage("");

  try {
    /*
      Security fix (Auth Priority-1): /api/login-by-id now performs the
      actual sign-in server-side (loginId -> email resolution and the
      supabase.auth.signInWithPassword() call both happen on the server)
      and returns only session tokens, never the account's email address.
      The browser hydrates its normal Supabase session from those tokens
      via setSession() below - same end state as before (a normal
      cookie-backed session), just without the email ever reaching
      browser JS.
    */
    const loginResponse = await fetch(
      "/api/login-by-id",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          purpose: "login",
          loginId: cleanLoginId,
          password: loginPassword,
        }),
      }
    );

    const loginResult = await loginResponse.json();

    if (!loginResponse.ok || !loginResult.session) {
      setMessage(
        loginResult.error ||
          "Invalid ID or password."
      );
      return;
    }

    const { data: sessionData, error: setSessionError } =
      await supabase.auth.setSession({
        access_token: loginResult.session.access_token,
        refresh_token: loginResult.session.refresh_token,
      });

    if (setSessionError) {
      console.error("SET SESSION ERROR =", setSessionError);
      setMessage("Unable to sign in. Please try again.");
      return;
    }

    if (!sessionData.user) {
      setMessage("Unable to load your account.");
      return;
    }

    const { data: memory, error: memoryError } =
      await supabase
        .from("career_memory")
        .select("required_completed")
        .eq("user_id", sessionData.user.id)
        .maybeSingle();


    if (memoryError) {
      console.error(
        "CAREER MEMORY LOGIN CHECK ERROR =",
        memoryError
      );
    }

    router.replace(
      memory?.required_completed === true
        ? "/dashboard"
        : "/career-memory"
    );

    router.refresh();
  } catch (error) {
    console.error("LOGIN ERROR =", error);

    setMessage(
      "Unable to sign in. Please try again."
    );
  } finally {
    setLoading(false);
  }
}
  async function handleEmailSignup() {
  const cleanFullName = fullName.trim();
  const cleanPhone = phone.trim();
  const cleanLoginId = loginId.trim();
  const cleanEmail = signupEmail.trim().toLowerCase();

  if (!cleanFullName) {
    setMessage("Please enter your full name.");
    return;
  }

  if (!cleanLoginId) {
    setMessage("Please create a login ID.");
    return;
  }

  if (!cleanEmail) {
    setMessage("Please enter your email.");
    return;
  }

  if (!signupPassword) {
    setMessage("Please create a password.");
    return;
  }

  /*
    Defense in depth - the "Create Account" button is already disabled
    while unchecked (see its disabled prop below), but this guard makes
    the requirement hold even if that ever changes or this function is
    ever called some other way.
  */
  if (!agreedToLegalTerms) {
    setMessage(
      "You must agree to the Terms of Service, Privacy Policy, and Cookie Policy before creating an account."
    );
    return;
  }

  setLoading(true);
  setMessage("");
  setSignupAccountState(null);

  try {
    /*
      Checked before signUp, not after: with email confirmation on,
      Supabase answers an already-registered address in a way the browser
      cannot tell apart from a new one, so there is nothing to inspect
      afterwards. Only a genuinely new address goes on to create an account.
    */
    const preflightStatus = await classifySignupEmail(cleanEmail);

    if (preflightStatus !== "NEW") {
      setSignupAccountState(preflightStatus);
      return;
    }

    const { data, error } =
      await supabase.auth.signUp({
        email: cleanEmail,
        password: signupPassword,
        options: {
          data: {
            full_name: cleanFullName,
            phone: cleanPhone,
            login_id: cleanLoginId,
            /*
              Consumed only by the handle_new_user() database trigger
              (supabase/migrations/20260726220000_legal_consent_columns.sql)
              at insert time, using the server's own now() and hardcoded
              document version constants - never trusts a client-supplied
              timestamp or version string, only this boolean/source pair.
            */
            legal_consent: true,
            consent_source: "email_signup",
          },
          emailRedirectTo:
            `${window.location.origin}/auth/callback`,
        },
      });

    if (error) {
      console.error("SIGNUP ERROR =", error);

      /*
        I3-3 hardening: a duplicate login id/email must be observationally
        indistinguishable from a brand-new signup that requires email
        confirmation - same toast, same message, no redirect, no session -
        so a pre-auth caller can never use this response to confirm an
        email is already registered. Supabase itself still refuses to
        create the duplicate account (unchanged); only the UI outcome
        shown to the caller no longer reveals why.
      */
      if (
        error.message
          .toLowerCase()
          .includes("duplicate")
      ) {
        /*
          Kept as a safety net for the window between the check above and
          this call. It no longer claims the account was created - it asks
          once more what the address actually is and shows that, falling
          back to the neutral message if even that cannot be answered. The
          raw Supabase text never reaches the browser either way.
        */
        setSignupAccountState(await classifySignupEmail(cleanEmail));
        return;
      }

      setMessage(error.message);
      return;
    }

    if (!data.user) {
      setMessage(
        "Unable to create your account."
      );
      return;
    }

    /*
      Supabase hands back a user carrying no identities when the address was
      already taken - the same window the duplicate branch above covers,
      reached when it answers without an error at all. Reclassify once
      rather than announce a signup that did not happen.
    */
    if ((data.user.identities?.length ?? 0) === 0 && !data.session) {
      setSignupAccountState(await classifySignupEmail(cleanEmail));
      return;
    }

    if (data.session) {
  toast.success("Your account has been created successfully.");

  router.replace("/career-memory");
  router.refresh();
  return;
}

toast.success(
  "Your account has been created. Please verify your email address - you'll be able to log in once it's verified."
);

setMessage(
  "Verification email sent. Check your inbox to finish setting up your account."
);
  } catch (error) {
    console.error("SIGNUP ERROR =", error);

    setMessage(
      "Unable to create your account. Please try again."
    );
  } finally {
    setLoading(false);
  }
}

/*
  Asks the server whether this address already belongs to an account. The
  browser is told only which of five states applies - never an id, a
  provider or a timestamp - and the server writes nothing to answer. A
  failure returns UNKNOWN rather than NEW: proceeding on a bad guess is how
  the misleading success message happened in the first place.
*/
async function classifySignupEmail(email: string) {
  try {
    const response = await fetch("/api/auth/email-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const result = await response.json().catch(() => null);
    const status = result?.status;

    return status === "NEW" ||
      status === "EXISTING_VERIFIED" ||
      status === "EXISTING_UNVERIFIED" ||
      status === "EXISTING_SOCIAL"
      ? status
      : "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

async function resendConfirmationEmail() {
  const email = signupEmail.trim();

  if (!email) {
    setMessage("Please enter your email first.");
    return;
  }

  setLoading(true);
  setMessage("");

  /*
    Reliability fix (Auth Priority-1): this call previously had no
    try/catch, so a rejected/thrown promise (network error, blocked
    request, etc.) skipped setLoading(false) entirely and left the whole
    auth modal permanently disabled - every other handler in this file
    already used try/catch/finally for exactly this reason.

    I3-3 hardening: this now calls /api/login-by-id's server-side
    "resend" purpose instead of supabase.auth.resend() directly - the
    browser never sees Supabase's own raw error text, and the response
    is the exact same generic message regardless of whether the email
    is registered, already confirmed, or unregistered, mirroring the
    existing "reset" purpose's always-the-same-response pattern.
  */
  try {
    const response = await fetch(
      "/api/login-by-id",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          purpose: "resend",
          email,
        }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      setMessage(
        result.error ||
          "Unable to resend the verification email. Please try again."
      );
      return;
    }

    setMessage(
      result.message ||
        "If your account needs email verification, a new verification email has been sent."
    );
  } catch (error) {
    console.error("RESEND ERROR =", error);

    setMessage(
      "Unable to resend the verification email. Please try again."
    );
  } finally {
    setLoading(false);
  }
}async function handleFindLoginId() {
  const email = findIdEmail.trim();

  if (!email) {
    setMessage("Please enter your email address first.");
    return;
  }

  setLoading(true);
  setMessage("");

  try {
    const response = await fetch(
      "/api/auth/find-login-id",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      }
    );

    if (response.status === 429) {
      setMessage(
        "Too many requests. Please try again shortly."
      );
      return;
    }

    const result = await response
      .json()
      .catch(() => null);

    /*
      SOCIAL_ONLY is the only branch that says anything about the account,
      and only because Create Account already says the same thing about the
      same address. Everything else - eligible, unknown address, lookup
      failure - collapses to one message, so this reply cannot be read as
      confirming that a password account exists.
    */
    if (result?.status === "SOCIAL_ONLY") {
      setMessage(
        "This account uses a connected sign-in method. Please sign in with Google, Facebook, or LinkedIn instead."
      );
      return;
    }

    if (result?.status === "CHECK_EMAIL") {
      setMessage(
        "If this email belongs to a Career Élan password account, we've sent a secure Login ID link. Please check your inbox."
      );
      return;
    }

    setMessage(
      "We couldn't complete that request. Please try again in a moment."
    );
  } catch (error) {
    console.error(
      "FIND LOGIN ID ERROR =",
      error
    );

    setMessage(
      "We couldn't complete that request. Please try again in a moment."
    );
  } finally {
    setLoading(false);
  }
}

async function handleForgotPassword() {
  const cleanLoginId = loginEmail.trim();

  if (!cleanLoginId) {
    setMessage("Please enter your ID first.");
    return;
  }

  setLoading(true);
  setMessage("");

  try {
    /*
      Security fix (Auth Priority-1): the id -> email lookup AND the
      actual supabase.auth.resetPasswordForEmail() dispatch now both
      happen server-side inside /api/login-by-id (purpose: "reset") -
      this call returns the exact same generic message and the exact
      same 200 status whether or not cleanLoginId matches a real
      account, so the browser can no longer distinguish "this id
      exists" from "this id doesn't exist" the way the old two-step
      (fetch email, then branch on it client-side) flow could.
    */
    const response = await fetch(
      "/api/login-by-id",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          purpose: "reset",
          loginId: cleanLoginId,
        }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      setMessage(
        result.error ||
          "Unable to send the password reset email."
      );
      return;
    }

    setMessage(
      result.message ||
        "If an account exists for this ID, password reset instructions have been sent."
    );
  } catch (error) {
    console.error(
      "PASSWORD RESET ERROR =",
      error
    );

    setMessage(
      "Unable to send the password reset email."
    );
  } finally {
    setLoading(false);
  }
}async function handleUpdatePassword() {
  if (newPassword.length < 8) {
    setMessage(
      "Password must contain at least 8 characters."
    );
    return;
  }

  if (
    newPassword !== confirmNewPassword
  ) {
    setMessage(
      "Passwords do not match."
    );
    return;
  }

  setLoading(true);
  setMessage("");

  try {
    const { error } =
      await supabase.auth.updateUser({
        password: newPassword,
      });

    if (error) {
      setMessage(error.message);
      return;
    }

    await supabase.auth.signOut();

    setNewPassword("");
    setConfirmNewPassword("");
    setLoginPassword("");

    setAuthMode("login");
    setShowAuthModal(true);

    setMessage(
      "Your password has been changed. Please log in with your new password."
    );
  } catch (error) {
    console.error(
      "UPDATE PASSWORD ERROR =",
      error
    );

    setMessage(
      "Unable to update your password."
    );
  } finally {
    setLoading(false);
  }
}

  return (
    <AuthActionsContext.Provider value={{ openAuth }}>
      {children}

      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/30 px-6 py-6 backdrop-blur-md">
          <div
            ref={authModalPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-modal-title"
            aria-describedby="auth-modal-description"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-8 shadow-2xl"
          >
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h2 id="auth-modal-title" className="text-2xl font-black text-slate-950">
  {authMode === "login"
    ? "Welcome back"
    : authMode === "signup"
    ? "Create your account"
    : authMode === "forgot-id"
    ? "Find your Login ID"
    : authMode === "forgot-password"
    ? "Reset your password"
    : "Create a new password"}
</h2>

<p id="auth-modal-description" className="mt-2 text-sm font-medium text-slate-500">
  {authMode === "login"
    ? "Continue building smarter applications."
    : authMode === "signup"
    ? "Start with one profile. Apply everywhere."
    : authMode === "forgot-id"
    ? "Enter your email and we will send you a secure link to recover it."
    : authMode === "forgot-password"
    ? "Enter your ID and we will email you a password reset link."
    : "Enter and confirm your new password."}
</p>
              </div>
              <button
                ref={authModalCloseButtonRef}
                type="button"
                onClick={() => setShowAuthModal(false)}
                aria-label="Close"
                className="text-2xl leading-none text-slate-400 transition hover:text-slate-700"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

           {authMode !== "forgot-password" &&
  authMode !== "new-password" && (
    <>
      <div className="space-y-3">
        <button
          type="button"
          onClick={() =>
            signInWithProvider("google")
          }
          disabled={loading}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-700 transition hover:bg-slate-50"
        >
          G Continue with Google
        </button>

        <button
          type="button"
          onClick={() =>
            signInWithProvider(
              "linkedin_oidc"
            )
          }
          disabled={loading}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-700 transition hover:bg-slate-50"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded bg-blue-700 text-xs font-black text-white">
            in
          </span>
          Continue with LinkedIn
        </button>

        <button
          type="button"
          onClick={() =>
            signInWithProvider("facebook")
          }
          disabled={loading}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-700 transition hover:bg-slate-50"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">
            f
          </span>
          Continue with Facebook
        </button>
      </div>

      {authMode === "signup" ? (
        <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
          By continuing with Google, Facebook, or LinkedIn, you
          acknowledge that you have read and agree to the{" "}
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-blue-600 underline hover:text-blue-700"
          >
            Terms of Service
          </a>
          ,{" "}
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-blue-600 underline hover:text-blue-700"
          >
            Privacy Policy
          </a>
          , and{" "}
          <a
            href="/cookies"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-blue-600 underline hover:text-blue-700"
          >
            Cookie Policy
          </a>
          .
        </p>
      ) : (
        /*
          Informational only - purely a disclosure notice, never a gate.
          No checkbox, and nothing here disables or otherwise blocks the
          OAuth buttons above: an existing user logging in must never be
          blocked by this text.
        */
        <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
          By continuing, you agree to the{" "}
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-blue-600 underline hover:text-blue-700"
          >
            Terms of Service
          </a>{" "}
          and acknowledge the{" "}
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-blue-600 underline hover:text-blue-700"
          >
            Privacy Policy
          </a>{" "}
          and{" "}
          <a
            href="/cookies"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-blue-600 underline hover:text-blue-700"
          >
            Cookie Policy
          </a>
          .
        </p>
      )}

      <div className="my-6 flex items-center gap-4">
        <div className="h-px flex-1 bg-slate-200" />

        <span className="text-sm font-bold text-slate-400">
          or
        </span>

        <div className="h-px flex-1 bg-slate-200" />
      </div>
    </>
  )}

{authMode === "signup" ? (
  <form className="space-y-4">
    <Input
      value={fullName}
      onChange={setFullName}
      placeholder="Full name"
      icon="👤"
    />

    <Input
      value={phone}
      onChange={setPhone}
      placeholder="Phone number"
      icon="📞"
    />

    <Input
      value={loginId}
      onChange={setLoginId}
      placeholder="Create ID"
      icon="🆔"
      type="text"
    />

    <Input
      value={signupEmail}
      onChange={setSignupEmail}
      placeholder="Email address"
      icon="✉️"
      type="email"
    />

    <Input
      value={signupPassword}
      onChange={setSignupPassword}
      placeholder="Create password"
      icon="🔒"
      type="password"
    />

    <div className="flex items-start gap-3">
      <input
        id="legal-consent-checkbox"
        type="checkbox"
        checked={agreedToLegalTerms}
        onChange={(e) => setAgreedToLegalTerms(e.target.checked)}
        aria-describedby="legal-consent-hint"
        className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
      />

      <label
        htmlFor="legal-consent-checkbox"
        className="text-sm leading-relaxed text-slate-600"
      >
        I have read and agree to the{" "}
        <a
          href="/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-blue-600 underline hover:text-blue-700"
        >
          Terms of Service
        </a>
        ,{" "}
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-blue-600 underline hover:text-blue-700"
        >
          Privacy Policy
        </a>
        , and{" "}
        <a
          href="/cookies"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-blue-600 underline hover:text-blue-700"
        >
          Cookie Policy
        </a>
        .
      </label>
    </div>

    {!agreedToLegalTerms && (
      <p
        id="legal-consent-hint"
        role="alert"
        aria-live="polite"
        className="text-sm font-semibold text-red-600"
      >
        You must agree to the Terms of Service, Privacy Policy, and
        Cookie Policy before creating an account.
      </p>
    )}

    <button
      type="button"
      onClick={handleEmailSignup}
      disabled={loading || !agreedToLegalTerms}
      className="w-full rounded-xl bg-blue-600 px-5 py-3 font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
    >
      {loading
        ? "Creating account..."
        : "Create Account"}
    </button>

    {/*
      Shown only once the address has been identified as an account that
      never finished verifying. It used to sit here on every signup,
      offering to re-send a confirmation to people who had no account and
      to people whose address was already confirmed - neither of whom would
      ever receive anything from it.
    */}
    {signupAccountState === "EXISTING_UNVERIFIED" && (
      <button
        type="button"
        onClick={resendConfirmationEmail}
        disabled={loading}
        className="w-full rounded-xl border border-blue-600 px-5 py-3 font-bold text-blue-600 disabled:opacity-50"
      >
        Resend verification email
      </button>
    )}

    {/*
      What Create Account found, when it found an account instead of
      creating one. The verified and social wordings differ because the
      actions differ: one has a password to log in with, the other has to
      use whichever provider they signed up through - never named here,
      since an account can carry more than one and guessing wrong sends
      them to the wrong button.
    */}
    {signupAccountState && (
      <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 text-sm text-slate-700">
        <p>
          {signupAccountState === "EXISTING_VERIFIED"
            ? "This email is already registered. Please log in instead."
            : signupAccountState === "EXISTING_UNVERIFIED"
              ? "This account hasn't finished email verification yet. Check your inbox, or send yourself a new verification email."
              : signupAccountState === "EXISTING_SOCIAL"
                ? "An account already exists for this email. Please sign in with the method you used before."
                : "We couldn't complete that just now. Please try again in a moment."}
        </p>

        {(signupAccountState === "EXISTING_VERIFIED" ||
          signupAccountState === "EXISTING_SOCIAL") && (
          <button
            type="button"
            onClick={() => {
              setLoginEmail(signupEmail.trim());
              setSignupAccountState(null);
              setAuthMode("login");
              setMessage("");
            }}
            disabled={loading}
            className="mt-3 w-full rounded-xl bg-blue-600 px-5 py-2.5 font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            Log in
          </button>
        )}
      </div>
    )}

    <button
      type="button"
      onClick={() => {
        setAuthMode("login");
        setMessage("");
      }}
      disabled={loading}
      className="w-full rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
    >
      ← Back to Login
    </button>
  </form>
) : authMode === "forgot-password" ? (
  <form className="space-y-4">
    <Input
      value={loginEmail}
      onChange={setLoginEmail}
      placeholder="Enter your ID"
      icon="🆔"
      type="text"
    />

    <button
      type="button"
      onClick={handleForgotPassword}
      disabled={loading}
      className="w-full rounded-xl bg-blue-600 px-5 py-3 font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
    >
      {loading
        ? "Sending..."
        : "Send Reset Email"}
    </button>

    <button
      type="button"
      onClick={() => {
        setAuthMode("login");
        setMessage("");
      }}
      disabled={loading}
      className="w-full rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
    >
      ← Back to Login
    </button>
  </form>
) : authMode === "forgot-id" ? (
  <form className="space-y-4">
    <Input
      value={findIdEmail}
      onChange={setFindIdEmail}
      placeholder="Enter your email"
      icon="✉️"
      type="email"
      autoComplete="email"
    />

    <button
      type="button"
      onClick={handleFindLoginId}
      disabled={loading}
      className="w-full rounded-xl bg-blue-600 px-5 py-3 font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
    >
      {loading
        ? "Sending..."
        : "Send Login ID Link"}
    </button>

    <button
      type="button"
      onClick={() => {
        setAuthMode("login");
        setMessage("");
      }}
      disabled={loading}
      className="w-full rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
    >
      ← Back to Login
    </button>
  </form>
) : authMode === "new-password" ? (
  <form className="space-y-4">
    <Input
      value={newPassword}
      onChange={setNewPassword}
      placeholder="New password"
      icon="🔒"
      type="password"
    />

    <Input
      value={confirmNewPassword}
      onChange={setConfirmNewPassword}
      placeholder="Confirm new password"
      icon="✅"
      type="password"
    />

    <button
      type="button"
      onClick={handleUpdatePassword}
      disabled={loading}
      className="w-full rounded-xl bg-blue-600 px-5 py-3 font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
    >
      {loading
        ? "Updating..."
        : "Update Password"}
    </button>
  </form>
) : (
  <form className="space-y-4">
    <Input
      value={loginEmail}
      onChange={setLoginEmail}
      placeholder="ID"
      icon="🆔"
      type="text"
    />

    <Input
      value={loginPassword}
      onChange={setLoginPassword}
      placeholder="Password"
      icon="🔒"
      type="password"
    />

    <div className="flex justify-between">
      <button
        type="button"
        onClick={() => {
          setAuthMode("forgot-id");
          setMessage("");
        }}
        className="text-sm font-bold text-blue-600 transition hover:text-blue-700"
      >
        Forgot ID?
      </button>

      <button
        type="button"
        onClick={() => {
          setAuthMode(
            "forgot-password"
          );
          setMessage("");
        }}
        className="text-sm font-bold text-blue-600 transition hover:text-blue-700"
      >
        Forgot password?
      </button>
    </div>

    <button
      type="button"
      onClick={handleEmailLogin}
      disabled={loading}
      className="w-full rounded-xl bg-blue-600 px-5 py-3 font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
    >
      {loading
        ? "Signing in..."
        : "Continue"}
    </button>
  </form>
)}

{message && (
  <p role="status" aria-live="polite" className="mt-4 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-600">
    {message}
  </p>
)}

{authMode !== "forgot-id" &&
  authMode !== "forgot-password" &&
  authMode !== "new-password" && (
    <p className="mt-6 text-center text-sm text-slate-500">
      {authMode === "login"
        ? "No account? "
        : "Already have an account? "}

      <button
        type="button"
        onClick={() => {
          setAuthMode(
            authMode === "login"
              ? "signup"
              : "login"
          );
          setMessage("");
        }}
        disabled={loading}
        className="rounded font-black text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {authMode === "login"
          ? "Sign up"
          : "Log in"}
      </button>
    </p>
  )}
          </div>
        </div>
      )}
    </AuthActionsContext.Provider>
  );
}

/*
  Only one auth mode's fields render at a time (the JSX above is an
  if/else chain keyed on authMode), so an id slugified from this field's
  own placeholder is always unique within the current render - no id prop
  needed at each of this component's ~13 call sites.
*/
function slugifyForId(text: string): string {
  return "auth-field-" + text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function Input({ value, onChange, placeholder, icon, type = "text", autoComplete }: { value: string; onChange: (value: string) => void; placeholder: string; icon: string; type?: string; autoComplete?: string }) {
  const id = slugifyForId(placeholder);
  return (
    <div>
      <label htmlFor={id} className="sr-only">{placeholder}</label>
      <div className="flex items-center rounded-xl border border-slate-300 px-4 transition focus-within:border-blue-600">
        <span aria-hidden="true" className="mr-3 text-slate-400">{icon}</span>
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} type={type} placeholder={placeholder} autoComplete={autoComplete} className="w-full bg-transparent py-3 outline-none" />
      </div>
    </div>
  );
}
