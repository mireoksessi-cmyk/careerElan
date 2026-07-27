import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  isNetlifyRuntime,
  detectNetlifyRuntimeSource,
} from "@/lib/generatePackage/backgroundTarget";
import {
  CONSENT_INTENT_COOKIE_NAME,
  verifyConsentIntentCookieValue,
} from "@/lib/auth/consentIntent";

/*
  Hardcoded, not read from any request - legal document versions are a
  deliberate, reviewed decision (see docs/legal-drafts/), never something
  a client request should be able to influence. Bumping these requires a
  new code change, which is the point.
*/
const LEGAL_TERMS_VERSION = "2026-07-26";
const PRIVACY_POLICY_VERSION = "2026-07-26";
const COOKIE_POLICY_VERSION = "2026-07-26";

/*
  Diagnostics-only (see the "OAuth redirect diagnostics" investigation) -
  a defensive, length-capped normalization so a caught auth error's own
  .message can never dump something unexpectedly large or structured into
  the logs. Never includes the raw error object, a code/token value, or
  any query string.
*/
function safeAuthErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message.slice(0, 200);
  }

  return "Unknown error";
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const errorParam = requestUrl.searchParams.get("error");

  /*
    Only ever a same-origin relative path (e.g. "/?resetPassword=true"
    from the password-reset flow) - never followed as-is if it looks like
    it could redirect off-site, since this value comes from a URL query
    string an attacker could craft.
  */
  const nextParam = requestUrl.searchParams.get("next");
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : null;

  /*
    Diagnostics-only (see the "OAuth redirect diagnostics" investigation)
    - the very first thing this route does, so a real Production OAuth
    attempt can be traced from the exact origin/protocol/path it actually
    arrived on. Never logs the code value, an access/refresh token, the
    full query string, or the user's email - only booleans, hostnames,
    and the same runtime-detection snapshot used by the Generate Package
    worker-routing diagnostics.
  */
  console.log(
    JSON.stringify({
      event: "oauth_callback_received",
      requestHostname: requestUrl.hostname,
      requestProtocol: requestUrl.protocol,
      pathname: requestUrl.pathname,
      hasCode: Boolean(code),
      hasError: Boolean(errorParam),
      nextPath: next,
      urlEnvHostname: process.env.URL
        ? (() => {
            try {
              return new URL(process.env.URL as string).hostname;
            } catch {
              return null;
            }
          })()
        : null,
      siteIdPresent: Boolean(process.env.SITE_ID),
      netlifyRuntimeDetected: isNetlifyRuntime(),
      runtimeDetectedBy: detectNetlifyRuntimeSource(),
      timestamp: new Date().toISOString(),
    })
  );

  /*
    Supabase가 로그인 쿠키를 이 response에 저장해야 하므로
    response를 먼저 만든다.

    실제 이동 주소는 로그인 확인 후 아래에서 변경한다.
  */
  const response = NextResponse.redirect(
  new URL("/?verified=true", request.url)
);

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },

        set(
          name: string,
          value: string,
          options: any
        ) {
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },

        remove(name: string, options: any) {
          response.cookies.set({
            name,
            value: "",
            maxAge: 0,
            ...options,
          });
        },
      },
    }
  );

  if (!code) {
    response.cookies.set({
      name: CONSENT_INTENT_COOKIE_NAME,
      value: "",
      maxAge: 0,
      path: "/",
    });

    response.headers.set(
      "Location",
      new URL(
        "/?authError=missing_code",
        request.url
      ).toString()
    );

    return response;
  }

  const {
    data: sessionData,
    error: exchangeError,
  } = await supabase.auth.exchangeCodeForSession(
    code
  );

  if (
    exchangeError ||
    !sessionData.user
  ) {
    console.error(
      "OAUTH EXCHANGE ERROR =",
      exchangeError
    );

    console.log(
      JSON.stringify({
        event: "oauth_callback_exchange_failed",
        requestHostname: requestUrl.hostname,
        errorName: exchangeError instanceof Error ? exchangeError.name : "Unknown",
        errorMessage: safeAuthErrorMessage(exchangeError),
      })
    );

    response.cookies.set({
      name: CONSENT_INTENT_COOKIE_NAME,
      value: "",
      maxAge: 0,
      path: "/",
    });

    response.headers.set(
      "Location",
      new URL(
        "/?authError=oauth_failed",
        request.url
      ).toString()
    );

    return response;
  }

  const user = sessionData.user;

  /*
    Password-recovery flow: the session is now established (cookies are
    set on `response` above via exchangeCodeForSession()), but this is a
    recovery session, not a normal login - skip the OAuth-only
    profile/career_memory upsert and dashboard routing below, and let the
    caller's own page handle showing the "new password" form.
  */
  if (next) {
    const recoveryRedirectUrl = new URL(next, request.url);

    console.log(
      JSON.stringify({
        event: "oauth_callback_session_exchanged",
        requestHostname: requestUrl.hostname,
        redirectHostname: recoveryRedirectUrl.hostname,
        redirectPath: recoveryRedirectUrl.pathname,
        provider:
          typeof user.app_metadata?.provider === "string"
            ? user.app_metadata.provider
            : null,
      })
    );

    response.headers.set(
      "Location",
      recoveryRedirectUrl.toString()
    );

    return response;
  }

  /*
    Google, LinkedIn, Facebook 최초 로그인 사용자는
    profiles 행이 없을 수 있으므로 생성하거나 갱신한다.
  */
  const fullName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "Career Élan User";

  const phone =
    user.user_metadata?.phone ||
    user.phone ||
    "";

  const { error: profileError } =
    await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          full_name: fullName,
          email: user.email || "",
          phone,
        },
        {
          onConflict: "id",
        }
      );

  if (profileError) {
    /*
      프로필 저장 실패만으로 로그인을 막지는 않는다.
      RLS 설정 때문에 발생할 수도 있으므로 기록만 한다.
    */
    console.error(
      "OAUTH PROFILE UPSERT ERROR =",
      profileError
    );
  }

  /*
    OAuth signup legal consent - only recorded when this callback was
    reached via an OAuth button clicked on the Sign Up screen (see
    app/api/auth/consent-intent/route.ts, called by app/page.tsx's
    signInWithProvider() only when authMode === "signup"). A Login-screen
    OAuth click never sets this cookie, so an existing user logging in
    never reaches this branch at all - the WHERE clause below is a second,
    redundant safety net that also protects the rare case of an existing
    user clicking a Sign Up-screen OAuth button for an account that
    already has a consent record: the UPDATE simply matches zero rows.

    Email/password signup consent is recorded separately, atomically, by
    the handle_new_user() database trigger at insert time (see this
    migration: supabase/migrations/20260726220000_legal_consent_columns.sql) -
    never here, since email signups never set this cookie.
  */
  try {
    const consentIntentCookie = cookieStore.get(
      CONSENT_INTENT_COOKIE_NAME
    )?.value;
    const consentSource = verifyConsentIntentCookieValue(consentIntentCookie);

    if (consentSource) {
      const { error: consentError } = await supabase
        .from("profiles")
        .update({
          legal_terms_accepted_at: new Date().toISOString(),
          legal_terms_version: LEGAL_TERMS_VERSION,
          privacy_policy_version: PRIVACY_POLICY_VERSION,
          cookie_policy_version: COOKIE_POLICY_VERSION,
          consent_source: consentSource,
        })
        .eq("id", user.id)
        .is("legal_terms_accepted_at", null);

      if (consentError) {
        console.error(
          "OAUTH CONSENT RECORD ERROR =",
          consentError
        );
      }
    }

    if (consentIntentCookie) {
      response.cookies.set({
        name: CONSENT_INTENT_COOKIE_NAME,
        value: "",
        maxAge: 0,
        path: "/",
      });
    }
  } catch (consentWriteError) {
    console.error(
      "OAUTH CONSENT RECORD EXCEPTION =",
      consentWriteError
    );
  }

  /*
    Career Memory 필수 항목 완료 여부 확인
  */
  const {
    data: careerMemory,
    error: memoryError,
  } = await supabase
    .from("career_memory")
    .select("required_completed")
    .eq("user_id", user.id)
    .maybeSingle();

  if (memoryError) {
    console.error(
      "CAREER MEMORY CHECK ERROR =",
      memoryError
    );
  }

  const redirectPath =
    careerMemory?.required_completed === true
      ? "/dashboard"
      : "/career-memory";

  const finalRedirectUrl = new URL(redirectPath, request.url);

  console.log(
    JSON.stringify({
      event: "oauth_callback_session_exchanged",
      requestHostname: requestUrl.hostname,
      redirectHostname: finalRedirectUrl.hostname,
      redirectPath: finalRedirectUrl.pathname,
      provider:
        typeof user.app_metadata?.provider === "string"
          ? user.app_metadata.provider
          : null,
    })
  );

  response.headers.set(
    "Location",
    finalRedirectUrl.toString()
  );

  return response;
}