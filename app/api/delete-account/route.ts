import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createClient } from "@/lib/supabase-server";

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
      Storage files first, while the DB rows that point to them still
      exist (their storage_path is read from those rows). If any step
      below fails, the function returns before ever calling
      auth.admin.deleteUser() - a partially-deleted account with no way
      to log back in and clean up would be worse than one where the
      delete simply didn't happen yet.
    */
    const { data: resumeRows, error: resumeSelectError } = await supabaseAdmin
      .from("resumes")
      .select("storage_path")
      .eq("user_id", userId);

    if (resumeSelectError) {
      logDeleteAccountFailure(requestId, userId, "select_resumes");

      return NextResponse.json(
        { success: false, error: SAFE_ERROR_MESSAGE },
        { status: 500 }
      );
    }

    const { data: coverLetterRows, error: coverLetterSelectError } =
      await supabaseAdmin
        .from("cover_letters")
        .select("storage_path")
        .eq("user_id", userId);

    if (coverLetterSelectError) {
      logDeleteAccountFailure(requestId, userId, "select_cover_letters");

      return NextResponse.json(
        { success: false, error: SAFE_ERROR_MESSAGE },
        { status: 500 }
      );
    }

    const resumeStoragePaths = (resumeRows ?? [])
      .map((row) => row.storage_path)
      .filter((path): path is string => Boolean(path));

    const coverLetterStoragePaths = (coverLetterRows ?? [])
      .map((row) => row.storage_path)
      .filter((path): path is string => Boolean(path));

    if (resumeStoragePaths.length > 0) {
      const { error: resumeStorageError } = await supabaseAdmin.storage
        .from("resumes")
        .remove(resumeStoragePaths);

      if (resumeStorageError) {
        logDeleteAccountFailure(requestId, userId, "delete_resume_files");

        return NextResponse.json(
          { success: false, error: SAFE_ERROR_MESSAGE },
          { status: 500 }
        );
      }
    }

    if (coverLetterStoragePaths.length > 0) {
      const { error: coverLetterStorageError } = await supabaseAdmin.storage
        .from("cover-letters")
        .remove(coverLetterStoragePaths);

      if (coverLetterStorageError) {
        logDeleteAccountFailure(
          requestId,
          userId,
          "delete_cover_letter_files"
        );

        return NextResponse.json(
          { success: false, error: SAFE_ERROR_MESSAGE },
          { status: 500 }
        );
      }
    }

    /*
      DB rows next, in no particular dependency order (none of these
      tables reference each other) - each checked individually so a
      single silent failure can't slip through.
    */
    const tableDeletes: Array<{
      step: string;
      table: string;
      column: string;
    }> = [
      { step: "delete_applications", table: "applications", column: "user_id" },
      {
        step: "delete_analytics_cache",
        table: "analytics_cache",
        column: "user_id",
      },
      { step: "delete_career_memory", table: "career_memory", column: "user_id" },
      { step: "delete_cover_letters", table: "cover_letters", column: "user_id" },
      { step: "delete_resumes", table: "resumes", column: "user_id" },
      { step: "delete_profiles", table: "profiles", column: "id" },
    ];

    for (const { step, table, column } of tableDeletes) {
      const { error } = await supabaseAdmin
        .from(table)
        .delete()
        .eq(column, userId);

      if (error) {
        logDeleteAccountFailure(requestId, userId, step);

        return NextResponse.json(
          { success: false, error: SAFE_ERROR_MESSAGE },
          { status: 500 }
        );
      }
    }

    /*
      The Auth user is only ever deleted last, after every other step
      above has succeeded - this is what "all data first, then the
      account" actually means in code, not just in the request order.
    */
    const { error: deleteUserError } =
      await supabaseAdmin.auth.admin.deleteUser(userId);

    if (deleteUserError) {
      logDeleteAccountFailure(requestId, userId, "delete_auth_user");

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
