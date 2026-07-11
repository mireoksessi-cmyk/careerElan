import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const { userId } = await req.json();

    await supabaseAdmin
      .from("applications")
      .delete()
      .eq("user_id", userId);

    await supabaseAdmin
      .from("analytics_cache")
      .delete()
      .eq("user_id", userId);

    await supabaseAdmin
      .from("career_memory")
      .delete()
      .eq("user_id", userId);

    await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("id", userId);

    await supabaseAdmin.auth.admin.deleteUser(
      userId
    );

    return NextResponse.json({
      success: true,
    });

  } catch (e) {

    console.error(e);

    return NextResponse.json(
      { success: false },
      { status: 500 }
    );

  }
}