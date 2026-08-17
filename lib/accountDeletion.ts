import { supabaseAdmin } from "./supabaseAdmin";

/*
  Admin User Controls Phase 2 - the ONE deletion implementation shared
  by both app/api/delete-account/route.ts (self-service, unchanged
  password-confirmation flow around this call) and the new admin
  delete path (app/api/admin/users/[id]/delete/route.ts). Neither
  caller does its own DB/Storage deletion steps directly - both call
  this function so the two paths can never silently diverge into
  contradictory cleanup logic.

  Sequencing (Stripe-safe by design, per Section G):
    1. load subscription state (the seam a future Stripe cancellation
       hook would use - see stripeSubscriptionNotCancelled below)
    2. [FUTURE: external Stripe cancellation would run here - NOT
       implemented, no Stripe SDK/call exists in this codebase]
    3. local subscription + quota-override cleanup
    4. Storage files (resumes, cover letters)
    5. DB rows: applications, analytics_cache, career_memory,
       cover_letters, resumes, profiles
    6. auth identity deleted LAST, unchanged from the pre-existing
       self-service route's own ordering rationale

  Never fabricates a successful Stripe cancellation: if the loaded
  subscription row was provider='stripe' and still carries a
  stripe_subscription_id, the result honestly reports
  stripeSubscriptionNotCancelled: true rather than silently discarding
  that fact - this deployment has no Stripe integration to actually
  cancel it, and the caller (admin route, audit log) must be able to
  disclose that rather than imply provider-side billing was handled.
*/

export type AccountDeletionResult =
  | {
      success: true;
      stripeSubscriptionNotCancelled: boolean;
      stripeSubscriptionId: string | null;
    }
  | { success: false; failedStep: string };

export async function deleteUserAccountData(
  userId: string
): Promise<AccountDeletionResult> {
  // Step 1: load subscription state before touching anything - this is
  // the seam a future Stripe cancellation hook would read from.
  const { data: subscriptionRow, error: subscriptionSelectError } =
    await supabaseAdmin
      .from("subscriptions")
      .select("provider, stripe_subscription_id")
      .eq("user_id", userId)
      .maybeSingle();

  if (subscriptionSelectError) {
    return { success: false, failedStep: "select_subscription" };
  }

  const stripeSubscriptionId =
    subscriptionRow?.provider === "stripe"
      ? (subscriptionRow.stripe_subscription_id ?? null)
      : null;

  // Step 2: [FUTURE Stripe cancellation hook would run here.]

  // Step 3: local subscription + quota-override cleanup. Explicit,
  // even though both rows also cascade-delete via their own FK to
  // auth.users(id) once step 6 runs - kept explicit so this function's
  // own step-by-step contract stays correct and self-documenting even
  // if either FK is ever changed, and so a failure here is reported
  // with its own specific step name rather than surfacing later as an
  // opaque auth-delete failure.
  const { error: subscriptionDeleteError } = await supabaseAdmin
    .from("subscriptions")
    .delete()
    .eq("user_id", userId);

  if (subscriptionDeleteError) {
    return { success: false, failedStep: "delete_subscription" };
  }

  const { error: quotaOverrideDeleteError } = await supabaseAdmin
    .from("admin_user_quota_overrides")
    .delete()
    .eq("user_id", userId);

  if (quotaOverrideDeleteError) {
    return { success: false, failedStep: "delete_quota_override" };
  }

  // Step 4: Storage files, while the DB rows that point to them still
  // exist (their storage_path is read from those rows).
  const { data: resumeRows, error: resumeSelectError } = await supabaseAdmin
    .from("resumes")
    .select("storage_path")
    .eq("user_id", userId);

  if (resumeSelectError) {
    return { success: false, failedStep: "select_resumes" };
  }

  const { data: coverLetterRows, error: coverLetterSelectError } =
    await supabaseAdmin
      .from("cover_letters")
      .select("storage_path")
      .eq("user_id", userId);

  if (coverLetterSelectError) {
    return { success: false, failedStep: "select_cover_letters" };
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
      return { success: false, failedStep: "delete_resume_files" };
    }
  }

  if (coverLetterStoragePaths.length > 0) {
    const { error: coverLetterStorageError } = await supabaseAdmin.storage
      .from("cover-letters")
      .remove(coverLetterStoragePaths);

    if (coverLetterStorageError) {
      return { success: false, failedStep: "delete_cover_letter_files" };
    }
  }

  // Step 5: DB rows, in no particular dependency order (none of these
  // tables reference each other) - each checked individually.
  const tableDeletes: Array<{ step: string; table: string; column: string }> = [
    { step: "delete_applications", table: "applications", column: "user_id" },
    { step: "delete_analytics_cache", table: "analytics_cache", column: "user_id" },
    { step: "delete_career_memory", table: "career_memory", column: "user_id" },
    { step: "delete_cover_letters", table: "cover_letters", column: "user_id" },
    { step: "delete_resumes", table: "resumes", column: "user_id" },
    { step: "delete_profiles", table: "profiles", column: "id" },
  ];

  for (const { step, table, column } of tableDeletes) {
    const { error } = await supabaseAdmin.from(table).delete().eq(column, userId);
    if (error) {
      return { success: false, failedStep: step };
    }
  }

  // Step 6: the Auth identity, only after every step above has succeeded.
  const { error: deleteUserError } =
    await supabaseAdmin.auth.admin.deleteUser(userId);

  if (deleteUserError) {
    return { success: false, failedStep: "delete_auth_user" };
  }

  return {
    success: true,
    stripeSubscriptionNotCancelled: stripeSubscriptionId !== null,
    stripeSubscriptionId,
  };
}
