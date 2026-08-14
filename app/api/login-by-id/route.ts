import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit } from "@/lib/security/rateLimiter";

/*
  Security fix (Auth Priority-1): this route must NEVER return a user's
  email address to the browser, and must never let the client distinguish
  "this login id exists" from "this login id doesn't exist" - the id ->
  email lookup below stays entirely server-side.

  That constraint means this route now has to perform BOTH auth actions
  that previously depended on the client holding the resolved email:

  - purpose "login": the client used to fetch the email here, then call
    supabase.auth.signInWithPassword({ email, password }) itself, which
    necessarily put the email in browser JS. Instead, this route now
    calls signInWithPassword() itself (server-side, using the same
    Supabase Auth API, same password rules, same account) and returns
    only the resulting session tokens. The client hydrates its normal
    Supabase browser session via supabase.auth.setSession(tokens) - same
    end state (a normal cookie-backed session), same login semantics,
    just without ever putting the email string in browser JS. A returned
    session necessarily lets the client's SDK learn its OWN email after
    the fact (as with any successful login, anywhere) - that is expected
    and unrelated to the vulnerability being fixed, which was an
    unauthenticated caller learning an ARBITRARY account's email via a
    guessed id with no password check.

  - purpose "reset": the client used to fetch the email here, then call
    supabase.auth.resetPasswordForEmail(email, ...) itself. That also
    put the email in browser JS, and the two-step shape made it possible
    for the client's own branching to reveal account existence (see the
    PublicAuthActions.tsx fix). Now this route resolves the email and
    triggers the reset itself, and always returns the exact same generic
    message regardless of whether the id matched an account.

  Invalid/missing loginId and wrong password still collapse to the same
  generic "Invalid ID or password." for purpose "login", unchanged from
  before. Rate limiting, login id normalization, and the server-side-only
  lookup are all unchanged.
*/
export async function POST(request: Request) {
  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(
        "LOGIN API ENV ERROR: missing Supabase URL or service role key."
      );

      return NextResponse.json(
        { error: "Unable to process this request." },
        { status: 500 }
      );
    }

    const body = await request.json();

    const purpose =
      body.purpose === "reset" ? "reset" : "login";

    const cleanLoginId =
      typeof body.loginId === "string"
        ? body.loginId.trim()
        : "";

    if (!cleanLoginId) {
      return NextResponse.json(
        { error: "Login ID is required." },
        { status: 400 }
      );
    }

    const password =
      typeof body.password === "string" ? body.password : "";

    if (purpose === "login" && !password) {
      return NextResponse.json(
        { error: "Password is required." },
        { status: 400 }
      );
    }

    /*
      Unauthenticated, account-enumeration-sensitive lookup - rate limit
      before touching Supabase so an abusive caller cannot use this route
      to probe an unbounded number of login ids. This endpoint runs
      strictly pre-authentication for BOTH purposes above (login itself
      still starts from an unauthenticated request), so there is never a
      session to check here - every caller is rate-limited on the
      guest/IP bucket.
    */
    const rateLimitResult = await checkRateLimit("login-by-id", {
      userId: null,
      requestHeaders: request.headers,
    });

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again shortly." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimitResult.retryAfterSeconds),
          },
        }
      );
    }

    const supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("login_id", cleanLoginId)
      .maybeSingle();

    if (error) {
      console.error("LOGIN LOOKUP ERROR =", error);

      return NextResponse.json(
        { error: "Unable to process this request." },
        { status: 500 }
      );
    }

    const resolvedEmail = data?.email ?? null;

    if (purpose === "reset") {
      /*
        Always the same response shape and message whether or not
        resolvedEmail is null, and whether or not the reset dispatch
        below succeeds - the browser must never be able to tell these
        cases apart. Failures are logged server-side only.
      */
      if (resolvedEmail) {
        const redirectOrigin = new URL(request.url).origin;

        const { error: resetError } =
          await supabaseAdmin.auth.resetPasswordForEmail(
            resolvedEmail,
            {
              redirectTo: `${redirectOrigin}/auth/callback?next=${encodeURIComponent(
                "/?resetPassword=true"
              )}`,
            }
          );

        if (resetError) {
          console.error(
            "PASSWORD RESET DISPATCH ERROR =",
            resetError
          );
        }
      }

      return NextResponse.json({
        message:
          "If an account exists for this ID, password reset instructions have been sent.",
      });
    }

    // purpose === "login"
    if (!resolvedEmail) {
      return NextResponse.json(
        { error: "Invalid ID or password." },
        { status: 401 }
      );
    }

    const { data: authData, error: authError } =
      await supabaseAdmin.auth.signInWithPassword({
        email: resolvedEmail,
        password,
      });

    if (authError) {
      console.error("LOGIN AUTH ERROR =", authError);

      if (
        authError.message
          .toLowerCase()
          .includes("email not confirmed")
      ) {
        return NextResponse.json(
          { error: "Please verify your email before logging in." },
          { status: 401 }
        );
      }

      return NextResponse.json(
        { error: "Invalid ID or password." },
        { status: 401 }
      );
    }

    if (!authData.session) {
      return NextResponse.json(
        { error: "Unable to sign in. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      session: {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
      },
    });
  } catch (error) {
    console.error("LOGIN API ERROR =", error);

    return NextResponse.json(
      { error: "Unable to process this request." },
      { status: 500 }
    );
  }
}