import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase-server";
import { deleteUserAccountData } from "@/lib/accountDeletion";

/*
  Only ever logs {requestId, userId, failedStep} - never a raw Supabase
  error object, message, or stack. Supabase error text can echo back
  identifiers or query fragments, so nothing from `error` is ever
  included; the step name alone is enough to find the failure in code.
*/
function logDeleteAccountFailure(
  requestId: string,
  userId: string,
  failedStep: string
) {
  console.error(
    JSON.stringify({
      route: "/api/delete-account",
      requestId,
      userId,
      failedStep,
    })
  );
}

const SAFE_ERROR_MESSAGE =
  "We couldn't delete your account. Please try again, or contact support if this keeps happening.";

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    /*
      Identity comes only from the caller's own authenticated session -
      never from the request body. A client-supplied userId would let any
      caller delete any account by guessing/obtaining a different user's
      id; requiring self-deletion only is a hard requirement here.
    */
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized." },
        { status: 401 }
      );
    }

    const userId = user.id;

    let password: unknown;

    try {
      const body = await req.json();
      password = body?.password;
    } catch {
      password = undefined;
    }

    if (typeof password !== "string" || !password) {
      return NextResponse.json(
        { success: false, error: "Please enter your password to confirm." },
        { status: 400 }
      );
    }

    /*
      Re-verifies the password server-side, independent of anything the
      client already checked - a valid session alone (e.g. a stolen or
      long-lived cookie) must not be enough to delete the account. Uses a
      throwaway anon-key client (no cookies, no shared state with the
      request's own session) purely to confirm the password matches this
      user's email; the resulting session, if any, is discarded.
    */
    const passwordCheckClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { error: passwordError } =
      await passwordCheckClient.auth.signInWithPassword({
        email: user.email!,
        password,
      });

    if (passwordError) {
      return NextResponse.json(
        { success: false, error: "Incorrect password." },
        { status: 401 }
      );
    }

    /*
      Admin User Controls Phase 2 - storage/DB/auth deletion now lives in
      the single shared lib/accountDeletion.ts::deleteUserAccountData(),
      also used by the new admin-delete path, so this self-service route
      and the admin route can never silently diverge into two
      contradictory cleanup implementations. Logging/response shape is
      unchanged from before this refactor: only {requestId, userId,
      failedStep} is ever logged, and the client-facing error stays the
      same generic SAFE_ERROR_MESSAGE regardless of which step failed.
    */
    const result = await deleteUserAccountData(userId);

    if (!result.success) {
      logDeleteAccountFailure(requestId, userId, result.failedStep);

      return NextResponse.json(
        { success: false, error: SAFE_ERROR_MESSAGE },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        route: "/api/delete-account",
        requestId,
        failedStep: "unexpected_exception",
      })
    );

    return NextResponse.json(
      { success: false, error: SAFE_ERROR_MESSAGE },
      { status: 500 }
    );
  }
}
