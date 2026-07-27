import { NextResponse } from "next/server";
import {
  CONSENT_INTENT_COOKIE_NAME,
  CONSENT_INTENT_MAX_AGE_SECONDS,
  createConsentIntentCookieValue,
  providerToConsentSource,
} from "@/lib/auth/consentIntent";

/*
  Called from the Sign Up screen's OAuth buttons (app/page.tsx's
  signInWithProvider()), right before supabase.auth.signInWithOAuth()
  navigates the browser away - never from the Login screen. Sets a
  short-lived, signed, HttpOnly cookie that app/auth/callback/route.ts
  reads after the OAuth round-trip completes, so it can record legal
  consent only for OAuth signups that genuinely started from this screen.

  Deliberately unauthenticated (no session exists yet, pre-login) and
  side-effect-free beyond setting a cookie on the caller's own browser -
  see lib/auth/consentIntent.ts's doc comment on why that's an acceptable
  trust boundary for this specific purpose.
*/
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const provider = typeof body?.provider === "string" ? body.provider : null;
  const source = provider ? providerToConsentSource(provider) : null;

  if (!source) {
    return NextResponse.json(
      { error: "Unsupported provider." },
      { status: 400 }
    );
  }

  const response = NextResponse.json({ ok: true });

  response.cookies.set(
    CONSENT_INTENT_COOKIE_NAME,
    createConsentIntentCookieValue(source),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: CONSENT_INTENT_MAX_AGE_SECONDS,
      path: "/",
    }
  );

  return response;
}
