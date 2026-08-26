import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { checkRateLimit } from "@/lib/security/rateLimiter";

/*
  Tells the signup form whether an address already belongs to an account,
  and if so what the person should do about it.

  Create Account used to say "your account has been created, check your
  email" to someone whose address was already registered. Supabase behaves
  correctly there - with email confirmation on it neither creates a second
  account nor re-sends a confirmation to an address that is already
  confirmed - but it deliberately answers the browser in a way that cannot
  be told apart from a genuine new signup, so the form had nothing to go on
  and reported success. The person then waited for an email that was never
  going to arrive.

  Answering this at all means admitting to an unauthenticated caller that
  an address is registered, which the login and password-reset paths go out
  of their way never to do. That is a deliberate trade for this one
  surface: the cost of the old behaviour was a person quietly stuck outside
  their own account, and no amount of enumeration hardening elsewhere helps
  them. The disclosure is kept as small as it can be - one address per
  request, a rate limit on its own bucket, and a single enum out. No id, no
  provider, no timestamp, no address echoed back, and nothing about the
  account written down in a log.

  Read-only by construction: it looks up one row and one user, and has no
  path that writes, sends mail, resends anything, or mints a session.
*/

type EmailStatus =
  | "NEW"
  | "EXISTING_VERIFIED"
  | "EXISTING_UNVERIFIED"
  | "EXISTING_SOCIAL"
  | "UNKNOWN";

/*
  Long enough for any real address (RFC 5321 caps the whole path at 254)
  and short enough that an oversized body cannot be pushed through the
  lookup below.
*/
const MAX_EMAIL_LENGTH = 254;

function statusResponse(status: EmailStatus, init?: number) {
  return NextResponse.json(
    { status },
    {
      status: init ?? 200,
      /*
        One caller's account state must never be served to the next one
        from a shared cache.
      */
      headers: { "Cache-Control": "no-store" },
    }
  );
}

export async function POST(request: Request) {
  try {
    const rateLimitResult = await checkRateLimit("auth-email-status", {
      userId: null,
      requestHeaders: request.headers,
    });

    if (!rateLimitResult.allowed) {
      /*
        Deliberately the same shape as every other answer: a caller who
        hits the limit learns nothing about the address they asked about.
      */
      return NextResponse.json(
        { status: "UNKNOWN" satisfies EmailStatus },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(rateLimitResult.retryAfterSeconds),
          },
        }
      );
    }

    const body = await request.json().catch(() => null);
    const rawEmail = body && typeof body.email === "string" ? body.email : "";
    const email = rawEmail.trim().toLowerCase();

    /*
      Normalized here rather than trusted from the form - this route is
      reachable directly, and the comparison below is only as good as the
      value going into it.
    */
    if (!email || email.length > MAX_EMAIL_LENGTH || !email.includes("@")) {
      return statusResponse("UNKNOWN", 400);
    }

    /*
      profiles.email is written by the on_auth_user_created trigger as
      lower(auth.users.email), so an exact match here resolves the one
      account without walking the user list - listUsers() has no email
      filter, and paging the whole directory to answer a question about a
      single address is exactly the bulk lookup this endpoint is not.
    */
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (profileError) {
      console.error("EMAIL STATUS PROFILE LOOKUP ERROR =", profileError.code);
      return statusResponse("UNKNOWN");
    }

    if (!profile) {
      return statusResponse("NEW");
    }

    const { data: userResult, error: userError } =
      await supabaseAdmin.auth.admin.getUserById(profile.id);

    if (userError || !userResult?.user) {
      /*
        A profile with no auth user behind it is a state this codebase does
        not produce. Saying NEW here would send the person into a signup
        that then fails, so it stays unknown.
      */
      console.error("EMAIL STATUS AUTH LOOKUP FAILED");
      return statusResponse("UNKNOWN");
    }

    const user = userResult.user;
    const identities = user.identities ?? [];
    const hasEmailIdentity = identities.some(
      (identity) => identity.provider === "email"
    );

    /*
      Someone who only ever signed in with Google or Facebook has no
      password to log in with, so pointing them at the login form alone
      would strand them. They are told an account exists and to use the way
      they used before - never which provider it was: app_metadata.provider
      names one identity, a person can hold several, and naming the wrong
      one is both unhelpful and more disclosure than this owes anyone.

      An account carrying an email identity is classified by whether that
      address has been confirmed, whatever else is linked to it - that is
      the thing the signup form actually needs to act on.
    */
    if (!hasEmailIdentity && identities.length > 0) {
      return statusResponse("EXISTING_SOCIAL");
    }

    return statusResponse(
      user.email_confirmed_at ? "EXISTING_VERIFIED" : "EXISTING_UNVERIFIED"
    );
  } catch (error) {
    /*
      No address, no user object, no identity list - a failure here says
      only that it failed.
    */
    console.error(
      "EMAIL STATUS ERROR =",
      error instanceof Error ? error.name : "Unknown"
    );

    return statusResponse("UNKNOWN");
  }
}
