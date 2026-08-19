import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  GENERATE_PACKAGE_MONTHLY_LIMIT,
  isNetlifyProductionRuntime,
} from "@/lib/config/packageQuota";
import { entitlementEmailHmac } from "@/lib/security/generatePackageEntitlementIdentity";

/*
  Read-only status for the "N generations remaining this month" UI hint -
  never reserves anything and never calls OpenAI. Real enforcement always
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
      limit: GENERATE_PACKAGE_MONTHLY_LIMIT,
      used: null,
      remaining: null,
    });
  }

  /*
    Stage 2C - display must resolve usage through the SAME identity
    enforcement uses. Enforcement keys the quota ledger to the founding
    entitlement owner (see app/api/generate-package/route.ts), so reading it
    back by the current auth uuid would show a recreated account a fresh
    allowance it does not actually have.

    The address comes only from the server-side session User, is used
    transiently to derive the keyed digest, and is never stored, logged, or
    returned to the browser - nor is the digest or the resolved owner id.

    Deliberately NO Free-only email-confirmation gate here: confirmation
    governs whether a generation may proceed, not how a usage identity is
    looked up, so paid, free, upgraded and overridden accounts all resolve
    the same way.
  */
  if (!user.email) {
    /*
      No address means no entitlement identity. Failing the display outright
      is the point: falling back to a per-uuid read would render a number
      that is knowingly wrong for a recreated account, and a wrong quota
      figure is worse than an absent one. Enforcement is untouched either way.
    */
    return NextResponse.json(
      { error: "Failed to load Generate Package usage." },
      { status: 500 }
    );
  }

  let emailHmac: string;

  try {
    emailHmac = entitlementEmailHmac(user.email);
  } catch {
    /*
      Missing or misconfigured secret. Not logged - the caught value could
      only describe configuration, and logging here risks nothing useful
      while the reserve path already surfaces the same condition. Same rule
      as above: no per-uuid fallback.
    */
    return NextResponse.json(
      { error: "Failed to load Generate Package usage." },
      { status: 500 }
    );
  }

  /*
    Read-only by construction: this wrapper SELECTs an existing claim, never
    creates one and never advances last_used_at, and unlike
    get_generate_package_usage it does not create a quota period row either.
    When no claim exists it falls back internally to p_user_id for DISPLAY
    ONLY - which also means a recreated account under-reports until its first
    post-recreation generation mints the claim. That residual is accepted:
    closing it would require minting a claim on a mere page view.

    p_stale_after_seconds is left at the RPC default, exactly as the
    enforcement reserve call does.
  */
  const { data: usageRows, error: usageError } =
    await supabaseAdmin.rpc("get_generate_package_usage_for_entitlement", {
      /*
        p_user_id stays the CURRENT auth user: the RPC resolves this
        account's own plan limit (subscription / admin override) from it,
        while reading usage from the founding owner the digest resolves to.
      */
      p_user_id: user.id,
      p_email_hmac: emailHmac,
      p_limit: GENERATE_PACKAGE_MONTHLY_LIMIT,
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

  const used = usage?.used ?? 0;
  const remaining = usage?.remaining ?? GENERATE_PACKAGE_MONTHLY_LIMIT;

  return NextResponse.json({
    enforced: true,
    // used + remaining reflects the RPC's own server-resolved, per-user
    // limit (resolve_generate_package_quota_limit()) rather than this
    // file's display constant - see packageQuota.ts's doc comment.
    limit: used + remaining,
    used,
    remaining,
  });
}
