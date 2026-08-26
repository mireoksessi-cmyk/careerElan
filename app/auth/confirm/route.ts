import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/*
  Signup email confirmation, deliberately separate from
  app/auth/callback/route.ts.

  The callback route exchanges a PKCE `code`, and that exchange needs the
  code_verifier the signing-up browser stored in its own cookies. That is
  exactly right for OAuth, where the same browser starts and finishes the
  round trip - and exactly wrong for a confirmation email, which is a link
  a person may well open on whichever device happens to be in front of
  them. Signing up on a phone and clicking the link on a laptop left the
  laptop with no verifier to present, so the exchange failed even though
  Supabase had already marked the address confirmed.

  Verifying a token_hash needs nothing but the token itself: Supabase
  checks it server-side and returns a session, so the browser that opened
  the link gets its own session no matter which browser asked for the
  email. The signing-up browser is not logged in by this, and does not
  need to be.

  This route is dormant until the Supabase "Confirm signup" template is
  pointed at it (a separate, deliberate step). Until then the template
  still sends {{ .ConfirmationURL }} through the callback route above,
  which is untouched.

  Kept apart from that route on purpose: it already carries OAuth, the
  password-recovery `next` branch, the consent-cookie write and the
  profile update. Adding a second verification mechanism to it would put
  all of that in the blast radius of a signup-only change.
*/

/*
  The only OTP type this route will verify. Widening it would turn a
  signup-confirmation endpoint into a general-purpose token verifier -
  a `recovery` token handed to this route would mint a full session
  without the password reset ever being completed. Password recovery
  keeps its existing callback path.
*/
const CONFIRM_OTP_TYPE = "email" as const;

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");

  /*
    Built first so Supabase's cookie writes land on the response that is
    actually returned - createServerClient's `set` below writes into
    response.cookies, and every branch afterwards only rewrites the
    Location header, never the response object. Same shape the callback
    route uses for the same reason.
  */
  const response = NextResponse.redirect(
    new URL("/?verifyError=invalid", request.url)
  );

  if (!tokenHash || type !== CONFIRM_OTP_TYPE) {
    return response;
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },

        set(name: string, value: string, options: any) {
          response.cookies.set({ name, value, ...options });
        },

        remove(name: string, options: any) {
          response.cookies.set({ name, value: "", maxAge: 0, ...options });
        },
      },
    }
  );

  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: CONFIRM_OTP_TYPE,
  });

  /*
    One generic outcome for every rejection. Expired, already consumed and
    never-valid are not told apart here: distinguishing them would mean
    reading Supabase's own error text, which is not a stable contract, and
    the wording the user sees ("invalid or expired - request a new one")
    is the same useful instruction in all three cases anyway. The token is
    never logged.
  */
  if (error || !data.user) {
    return response;
  }

  /*
    Verification succeeded but no session came back - the address is
    confirmed and the account is usable, so the honest thing to say is
    "verified, please log in" rather than "invalid link".
  */
  if (!data.session) {
    response.headers.set(
      "Location",
      new URL("/?verifyError=session", request.url).toString()
    );

    return response;
  }

  /*
    Same rule the callback route applies after a successful login, so a
    freshly confirmed user lands where a returning one would. No profile
    is created here - the on_auth_user_created trigger already made it at
    signup, and confirmation only changes whether the address is verified.
    A failed lookup falls through to Career Memory, which is where an
    unfinished profile belongs.
  */
  const { data: careerMemory } = await supabase
    .from("career_memory")
    .select("required_completed")
    .eq("user_id", data.user.id)
    .maybeSingle();

  const redirectPath =
    careerMemory?.required_completed === true ? "/dashboard" : "/career-memory";

  response.headers.set(
    "Location",
    new URL(redirectPath, request.url).toString()
  );

  return response;
}
