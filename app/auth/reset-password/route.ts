import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/*
  Turns a password-recovery link into a recovery session, and nothing else.

  Recovery used to be pointed at /auth/callback, which reads a `code` and
  exchanges it. The reset email never carries one: resetPasswordForEmail()
  is dispatched by the service-role client in /api/login-by-id, and
  supabase-js defaults to the implicit flow, so what comes back is a hash
  fragment the browser never sends to a server route. The callback found no
  code, redirected to /?authError=missing_code, and since nothing reads
  that parameter the person landed on the ordinary homepage with no way to
  set a password and no explanation.

  Verifying a token_hash needs only the token, so this works from whichever
  browser opened the mail, and the session lands as cookies on the response
  that redirects. From there the existing modal takes over: PublicAuthActions
  already watches for ?resetPassword=true, checks for a session, opens its
  new-password form and calls updateUser(). None of that is rebuilt here -
  this route exists only to hand it a session it can find.

  Separate from /auth/confirm on purpose. That one verifies signup
  confirmations and accepts exactly one type; a single route taking both
  would be a general OTP verifier, and a recovery token handed to a
  signup-shaped endpoint is a session nobody proved they should have.
*/

/*
  The only OTP type this route will verify. The value below is what reaches
  Supabase - the request's own `type` is compared against it and then
  discarded, never forwarded, so no caller can widen this endpoint into
  something that mints sessions from signup or magic-link tokens.
*/
const RECOVERY_OTP_TYPE = "recovery" as const;

/*
  Same allowlist the confirmation route runs on, and for the same reason:
  request.url describes the deploy rather than the address the person
  visited, and a redirect built from it can land the browser on a host that
  was never sent the session cookie. The Host header does carry the real
  address but is caller-supplied, so it is only ever matched against this
  fixed list, never interpolated as given, with the platform origin as the
  fallback for anything unrecognized.
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
    actually returned - the adapter below writes into response.cookies, and
    every branch afterwards only rewrites the Location header, never the
    response object.
  */
  const response = NextResponse.redirect(
    new URL("/?resetError=invalid", publicOrigin)
  );

  if (!tokenHash || type !== RECOVERY_OTP_TYPE) {
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
    type: RECOVERY_OTP_TYPE,
  });

  /*
    One outcome for every rejection. Expired, already spent and never-valid
    are not told apart - Supabase's own wording is not a stable contract to
    branch on, and "ask for a new link" is the same instruction in all three
    cases. The token is never logged and never echoed back.
  */
  if (error || !data.user) {
    return response;
  }

  /*
    Verification without a session is not something the person can use: the
    modal waiting on the other side asks getSession() before it will show a
    password field, and updateUser() has nothing to authenticate against.
    Saying so is better than sending them to a form that cannot work.
  */
  if (!data.session) {
    response.headers.set(
      "Location",
      new URL("/?resetError=session", publicOrigin).toString()
    );

    return response;
  }

  /*
    Where the existing UI is already listening. The session travels as
    cookies on this response - never as tokens in the URL, which would put
    them in history, referrers and any log that records a path.
  */
  response.headers.set(
    "Location",
    new URL("/?resetPassword=true", publicOrigin).toString()
  );

  return response;
}
