/*
  Phase 6I.6.6 - Canonical Cover Letter / Email Draft restoration.

  Covers the round spec's §20 test matrix items C/D (cover letter and email
  draft generation/persistence/reload) plus the same identity/security
  invariants Phase 6I.6.5's own real-DB suite already established for
  packageAnalysis (ai_insight), now re-verified for the two new
  cover_letter_text/email_draft parameters on the same widened
  complete_canonical_generate_worker RPC. No real OpenAI call - this
  exercises the actual RPC + status route contract with real local-DB
  writes, exactly as the AI worker itself would call it.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i66CoverLetterEmailPersistence.realdb.test.mts
  Requires local Supabase running.
*/
import { createClient } from "@supabase/supabase-js";

const URL = "http://127.0.0.1:54321";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}

async function makeTestUser(admin: ReturnType<typeof createClient>) {
  const email = `phase6i66-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i66-realdb-pw-12345";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client };
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);
  const userA = await makeTestUser(admin);
  const userB = await makeTestUser(admin);

  const { data: appA, error: insA } = await userA.client
    .from("applications")
    .insert({ user_id: userA.userId, generation_status: "pending", generation_engine: "canonical", selected_template_id: "professional-ats", company: "Acme Co", job_title: "Coordinator" })
    .select("id")
    .single();
  if (insA) throw insA;
  const { data: appB, error: insB } = await userB.client
    .from("applications")
    .insert({ user_id: userB.userId, generation_status: "pending", generation_engine: "canonical", selected_template_id: "professional-ats", company: "Beta Co", job_title: "Analyst" })
    .select("id")
    .single();
  if (insB) throw insB;

  // C/D: claim_canonical_generate_worker must expose company/job_title so the
  // worker can build the cover-letter/email prompt without a second query.
  const { data: claimRows, error: claimErr } = await admin.rpc("claim_canonical_generate_worker", { p_application_id: appA.id });
  if (claimErr) throw claimErr;
  const claimed = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  check("claim_canonical_generate_worker returns company", claimed?.company, "Acme Co");
  check("claim_canonical_generate_worker returns job_title", claimed?.job_title, "Coordinator");

  const coverLetterA = "Dear Hiring Manager,\n\nI am writing to express my interest in the Coordinator role at Acme Co...\n\nSincerely,\nTest Applicant";
  const emailDraftA = "Subject: Application for Coordinator\n\nDear Hiring Manager,\n\nPlease find my application attached...\n\nBest,\nTest Applicant";

  // C/D: persistence - complete_canonical_generate_worker writes cover_letter_text/email_draft atomically with the status flip.
  const { error: rpcErrA } = await admin.rpc("complete_canonical_generate_worker", {
    p_application_id: appA.id,
    p_user_id: userA.userId,
    p_status: "succeeded",
    p_cover_letter_text: coverLetterA,
    p_email_draft: emailDraftA,
  });
  if (rpcErrA) throw rpcErrA;
  const { data: rowA } = await userA.client.from("applications").select("generation_status, cover_letter_text, email_draft").eq("id", appA.id).single();
  check("C: generation_status flipped to succeeded", rowA?.generation_status, "succeeded");
  check("C: cover_letter_text persisted verbatim via the widened RPC", rowA?.cover_letter_text, coverLetterA);
  check("D: email_draft persisted verbatim via the widened RPC", rowA?.email_draft, emailDraftA);

  // G: identity snapshot - app B's cover_letter_text/email_draft must remain untouched by app A's write.
  const { data: rowB } = await userB.client.from("applications").select("cover_letter_text, email_draft").eq("id", appB.id).single();
  check("G: a different application's cover_letter_text is unaffected by app A's completion", rowB?.cover_letter_text, null);
  check("G: a different application's email_draft is unaffected by app A's completion", rowB?.email_draft, null);

  // Omitting the two new params must never clear an already-written value (regression safety, same pattern as p_ai_insight).
  const { error: rpcErrNoop } = await admin.rpc("complete_canonical_generate_worker", { p_application_id: appA.id, p_user_id: userA.userId, p_status: "succeeded" });
  if (rpcErrNoop) throw rpcErrNoop;
  const { data: rowAAfterNoop } = await userA.client.from("applications").select("cover_letter_text, email_draft").eq("id", appA.id).single();
  check("regression: omitting p_cover_letter_text/p_email_draft on a later call never clears prior values", rowAAfterNoop?.cover_letter_text, coverLetterA);
  check("regression: omitting p_email_draft on a later call never clears prior value", rowAAfterNoop?.email_draft, emailDraftA);

  // Cross-user ownership: the RPC's own WHERE clause must refuse to touch app A when called with user B's id.
  const { error: rpcErrCrossUser } = await admin.rpc("complete_canonical_generate_worker", {
    p_application_id: appA.id,
    p_user_id: userB.userId,
    p_status: "succeeded",
    p_cover_letter_text: "HIJACKED",
    p_email_draft: "HIJACKED",
  });
  if (rpcErrCrossUser) throw rpcErrCrossUser;
  const { data: rowAAfterCrossUser } = await userA.client.from("applications").select("cover_letter_text, email_draft").eq("id", appA.id).single();
  check("security: a call with a mismatched p_user_id cannot overwrite another user's cover_letter_text", rowAAfterCrossUser?.cover_letter_text, coverLetterA);
  check("security: a call with a mismatched p_user_id cannot overwrite another user's email_draft", rowAAfterCrossUser?.email_draft, emailDraftA);

  // Status route contract: fetch via the anon/user client the same way app code does, confirm cross-user read is blocked by RLS.
  const { data: crossReadRow, error: crossReadErr } = await userB.client.from("applications").select("cover_letter_text").eq("id", appA.id).maybeSingle();
  checkTrue("security: user B cannot SELECT user A's application row (RLS)", !crossReadErr && crossReadRow === null);

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("TEST SUITE FAILED:", err);
  process.exit(1);
});
