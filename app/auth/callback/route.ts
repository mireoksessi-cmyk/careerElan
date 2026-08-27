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
import { logSafeError } from "@/lib/errors/publicError";
import { logOperationalEvent } from "@/lib/observability/logger";

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

/*
  request.url is not the address the person typed. Netlify hands the
  function its own deploy URL, so a request that arrived at careerelan.com
  is described to this route as fabulous-frangipane-b5d970.netlify.app - and
  a redirect built from it lands the browser on a different host than the one
  the session cookie was just issued to. Supabase writes those cookies
  without a Domain, so they are host-only: sending the browser elsewhere
  leaves the session behind and the person arrives signed out, having done
  nothing wrong.

  app/auth/confirm/route.ts already carries exactly this, for exactly this
  reason; the OAuth callback was simply never given it, which is why social
  logins ended on the platform hostname while email confirmations did not.
  Copied rather than shared, matching how confirm, reset-password and
  find-login-id each hold their own - extracting it would mean editing four
  files to fix one.

  The Host header does carry the real address (middleware already relies on
  that to canonicalize deploy permalinks), but it is caller-supplied, so it is
  only ever matched against this fixed list and never interpolated as given.
  Anything unrecognized falls back to the platform's own origin, which is
  where every redirect here went before this change and is provably immune to
  forwarded-host injection.

  Deploy Previews are listed on purpose: a preview must keep authenticating
  within itself, or reviewing a change would hand the reviewer a production
  session. www is deliberately absent - it is not a domain alias on this site
  and is redirected to the apex before a request ever reaches here.
*/
const TRUSTED_PUBLIC_HOSTS = new Set([
  "careerelan.com",
  "fabulous-frangipane-b5d970.netlify.app",
]);

const TRUSTED_DEPLOY_PREVIEW_HOST =
  /^deploy-preview-\d+--fabulous-frangipane-b5d970\.netlify\.app$/;

function trustedPublicOrigin(request: Request): string {
  const hostHeader = request.headers.get("host");

  if (hostHeader) {
    const hostname = hostHeader.split(":")[0].toLowerCase();

    if (
      TRUSTED_PUBLIC_HOSTS.has(hostname) ||
      TRUSTED_DEPLOY_PREVIEW_HOST.test(hostname)
    ) {
      return `https://${hostname}`;
    }
  }

  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  /* Every redirect below is built from this, never from requestUrl. */
  const publicOrigin = trustedPublicOrigin(request);
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
  new URL("/?verified=true", publicOrigin)
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
        publicOrigin
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
    console.log(
      JSON.stringify({
        event: "oauth_callback_exchange_failed",
        requestHostname: requestUrl.hostname,
        errorName: exchangeError instanceof Error ? exchangeError.name : "Unknown",
        errorMessage: safeAuthErrorMessage(exchangeError),
      })
    );
    logOperationalEvent({ domain: "auth", event: "login_failed", provider: "unknown", reason: "oauth_exchange_failed" });

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
        publicOrigin
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
    const recoveryRedirectUrl = new URL(next, publicOrigin);

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
    logOperationalEvent({ domain: "auth", event: "login_succeeded", userId: user.id, provider: typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : "unknown" });

    response.headers.set(
      "Location",
      recoveryRedirectUrl.toString()
    );

    return response;
  }

  /*
    Google, LinkedIn, Facebook 로그인 사용자의 provider 프로필 정보를
    갱신한다. 행 생성은 여기서 하지 않는다 - auth.users INSERT 시점에
    on_auth_user_created 트리거(handle_new_user(), 20260720153937_remote_schema.sql:733)
    가 이미 profiles 행을 만들며, 그 때 login_id를
    lower(coalesce(raw_user_meta_data->>'login_id', split_part(email,'@',1)))
    로 채운다. OAuth 신규 가입도 auth.users INSERT를 거치므로 예외가 아니다.

    이전 구현은 upsert({id, full_name, email, phone})였는데, PostgREST의
    upsert는 INSERT ... ON CONFLICT (id) DO UPDATE로 나가고 Postgres는
    충돌 판정 전에 INSERT 튜플의 NOT NULL 제약을 먼저 검사한다. profiles
    .login_id는 NOT NULL이고 DEFAULT가 없으므로(remote_schema.sql:258),
    행이 이미 존재하더라도 매 콜백마다 23502
    "null value in column login_id ... violates not-null constraint"로
    실패했다 - Production 로그상 모든 OAuth 콜백에서 100% 재현.

    UPDATE로 바꾸면 login_id를 아예 전송하지 않으므로 제약을 건드리지
    않고, 사용자가 설정 화면(app/settings/page.tsx)에서 직접 바꾼
    login_id를 provider 값으로 덮어쓸 위험도 없다. 바로 아래 consent
    블록이 이미 같은 전제(행 존재)로 update().eq("id")를 쓰고 있다.
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
      .update({
        full_name: fullName,
        email: user.email || "",
        phone,
      })
      .eq("id", user.id);

  if (profileError) {
    /*
      프로필 저장 실패만으로 로그인을 막지는 않는다.
      RLS 설정 때문에 발생할 수도 있으므로 기록만 한다.
    */
    logSafeError(profileError, { requestId: user.id, route: "auth/callback#profile-upsert", userId: user.id });
    logOperationalEvent({ domain: "auth", event: "profile_upsert_failed", userId: user.id });
  }

  /*
    OAuth legal consent - recorded whenever this callback is reached via
    a real OAuth button click, from EITHER the Sign Up or Login screen
    (see app/api/auth/consent-intent/route.ts, called unconditionally by
    app/page.tsx's signInWithProvider() regardless of authMode). Both
    screens set this cookie because Supabase's signInWithOAuth() creates
    a brand-new account on first use no matter which screen's button
    triggered it - a user's very first OAuth sign-in can happen from the
    Login screen, and that new account still needs a consent record.

    The WHERE clause below (legal_terms_accepted_at IS NULL) is what
    actually enforces every consent rule here, not which screen the
    click came from:
    - a returning user with an existing consent record: UPDATE matches
      zero rows, nothing is overwritten
    - a returning user whose consent happens to still be null (e.g. an
      account created before this feature existed): this OAuth click is
      treated as their consent and gets recorded now - that's correct,
      not a bug, since they're actively clicking through the notice text
    - a genuinely new account: recorded, exactly as intended

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
        logSafeError(consentError, { requestId: user.id, route: "auth/callback#consent-record", userId: user.id });
        logOperationalEvent({ domain: "auth", event: "consent_record_failed", userId: user.id });
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
    logSafeError(consentWriteError, { requestId: user.id, route: "auth/callback#consent-record-exception", userId: user.id });
    logOperationalEvent({ domain: "auth", event: "consent_record_failed", userId: user.id });
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
    logSafeError(memoryError, { requestId: user.id, route: "auth/callback#career-memory-check", userId: user.id });
  }

  const redirectPath =
    careerMemory?.required_completed === true
      ? "/dashboard"
      : "/career-memory";

  const finalRedirectUrl = new URL(redirectPath, publicOrigin);

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
  logOperationalEvent({ domain: "auth", event: "login_succeeded", userId: user.id, provider: typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : "unknown" });

  response.headers.set(
    "Location",
    finalRedirectUrl.toString()
  );

  return response;
}