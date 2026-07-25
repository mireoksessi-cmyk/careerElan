import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  GENERATE_PACKAGE_LIFETIME_LIMIT,
  isNetlifyProductionRuntime,
} from "@/lib/config/packageQuota";

/*
  Read-only status for the "N generations remaining" UI hint - never
  reserves anything and never calls OpenAI. Real enforcement always
  happens server-side in POST /api/generate-package at generation time;
  this is display-only, and the client must never treat its response as
  authoritative.
*/
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401 }
    );
  }

  if (!isNetlifyProductionRuntime()) {
    return NextResponse.json({
      enforced: false,
      limit: GENERATE_PACKAGE_LIFETIME_LIMIT,
      used: null,
      remaining: null,
    });
  }

  const { data: usageRows, error: usageError } =
    await supabaseAdmin.rpc("get_generate_package_usage", {
      p_user_id: user.id,
      p_limit: GENERATE_PACKAGE_LIFETIME_LIMIT,
    });

  if (usageError) {
    return NextResponse.json(
      { error: "Failed to load Generate Package usage." },
      { status: 500 }
    );
  }

  const usage = Array.isArray(usageRows)
    ? usageRows[0]
    : usageRows;

  return NextResponse.json({
    enforced: true,
    limit: GENERATE_PACKAGE_LIFETIME_LIMIT,
    used: usage?.used ?? 0,
    remaining:
      usage?.remaining ?? GENERATE_PACKAGE_LIFETIME_LIMIT,
  });
}
