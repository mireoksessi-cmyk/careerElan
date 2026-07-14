import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log("LOGIN API ENV =", {
      hasUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
      serviceRoleKeyLength:
        serviceRoleKey?.length ?? 0,
    });

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          error: "Missing server environment variables.",
          hasUrl: Boolean(supabaseUrl),
          hasServiceRoleKey: Boolean(serviceRoleKey),
        },
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

    console.log("LOGIN LOOKUP RESULT =", {
      loginId: cleanLoginId,
      data,
      error,
    });

    if (error) {
      return NextResponse.json(
        {
          error: "Unable to verify login ID.",
          supabaseMessage: error.message,
          supabaseCode: error.code,
          supabaseDetails: error.details,
          supabaseHint: error.hint,
        },
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
      {
        error: "Unable to process login.",
        detail:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 }
    );
  }
}