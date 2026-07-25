import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

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
    response.headers.set(
      "Location",
      new URL(next, request.url).toString()
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

  response.headers.set(
    "Location",
    new URL(
      redirectPath,
      request.url
    ).toString()
  );

  return response;
}