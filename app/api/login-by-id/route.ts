import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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