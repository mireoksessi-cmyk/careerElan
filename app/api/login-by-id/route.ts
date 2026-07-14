import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {
    const { loginId } = await request.json();

    const cleanLoginId =
      typeof loginId === "string"
        ? loginId.trim()
        : "";

    if (!cleanLoginId) {
      return NextResponse.json(
        { error: "Login ID is required." },
        { status: 400 }
      );
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
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
      console.error("LOGIN ID LOOKUP ERROR =", error);

      return NextResponse.json(
        { error: "Unable to verify login ID." },
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
      { error: "Unable to process login." },
      { status: 500 }
    );
  }
}