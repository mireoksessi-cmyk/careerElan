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

/*
  request.url is not the address the person typed. Netlify hands the
  function its own deploy URL, so a request that arrived at
  careerelan.com is described to the route as
  fabulous-frangipane-b5d970.netlify.app - and a redirect built from it
  lands the browser on a different host than the one the session cookie
  was just issued to. Supabase writes those cookies without a Domain, so
  they are host-only: sending the browser elsewhere leaves the session
  behind and the person arrives signed out.

  The Host header does carry the real address (middleware already relies
  on that to canonicalize deploy permalinks), but it is caller-supplied,
  so it is only ever matched against this fixed list and never
  interpolated as given. Anything unrecognized falls back to the
  platform's own origin, which is where every redirect went before this
  and is provably immune to forwarded-host injection.

  Deploy Previews are listed on purpose: a preview must keep confirming
  within itself, or reviewing a change would hand the reviewer a
  production session. www is deliberately absent - it is not a domain
  alias on this site and is redirected to the apex before a request ever
  reaches here.
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
  const publicOrigin = trustedPublicOrigin(request);
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
    new URL("/?verifyError=invalid", publicOrigin)
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
      new URL("/?verifyError=session", publicOrigin).toString()
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
    new URL(redirectPath, publicOrigin).toString()
  );

  return response;
}
