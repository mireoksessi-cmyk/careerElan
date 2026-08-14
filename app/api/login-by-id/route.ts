import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit } from "@/lib/security/rateLimiter";

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

    /*
      Unauthenticated, account-enumeration-sensitive lookup - rate limit
      before touching Supabase so an abusive caller cannot use this route
      to probe an unbounded number of login ids. This endpoint runs
      strictly pre-authentication (it exists to resolve a login id into
      an email before the password step), so there is never a session to
      check here - every caller is rate-limited on the guest/IP bucket.
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

    if (!data?.email) {
      return NextResponse.json(
        { error: "Invalid ID or password." },
        { status: 401 }
      );
    }

    return NextResponse.json({
      email: data.email,
    });
  } catch (error) {
    console.error("LOGIN API ERROR =", error);

    return NextResponse.json(
      { error: "Unable to process this request." },
      { status: 500 }
    );
  }
}