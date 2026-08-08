/*
  Phase 6I.6.10 - Job Tracker Delete All Applications. Real-DB test suite
  covering:

  A. individual delete regression (existing per-application delete still works)
  B. delete all - 3 owned applications -> 0 remain
  C. cross-user isolation - User A's Delete All never touches User B
  D. related application data - career_tailored_resumes survives (FK is
     ON DELETE SET NULL, not CASCADE) exactly as individual delete would
  E. canonical resume history preservation (career_profiles/
     career_resume_versions/career_source_documents untouched)
  F. uploaded resume preservation (resumes rows untouched)
  G. Career Memory preservation (career_memory row untouched)
  H. zero-application safe no-op
  I. filter independence (mixed statuses, all deleted regardless)
  J. idempotency (calling Delete All twice is safe)

  Every operation below uses each test user's OWN authenticated client
  (never the admin/service-role client) for the applications table itself,
  matching exactly how app/job-tracker/page.tsx's real deleteApplication()/
  deleteAllApplications() call supabase-js directly under RLS - this suite
  proves the SAME RLS policy (`application_delete`: auth.uid() = user_id)
  is what actually enforces ownership, not application-level filtering
  alone. The admin client is used only to create test users and to
  independently verify final DB state (read-only, or seeding rows a real
  user client could not directly seed, e.g. a source document row).

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i610DeleteAllApplications.realdb.test.mts
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
  const email = `phase6i610-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i610-realdb-pw-12345";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client };
}

async function insertApplication(client: ReturnType<typeof createClient>, userId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await client
    .from("applications")
    .insert({ user_id: userId, company: "Fixture Co", job_title: "Fixture Role", status: "Applied", ...overrides })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/* Mirrors app/job-tracker/page.tsx's deleteApplication() exactly. */
async function deleteOneApplication(client: ReturnType<typeof createClient>, userId: string, applicationId: string) {
  return client.from("applications").delete().eq("id", applicationId).eq("user_id", userId).select("id");
}

/* Mirrors app/job-tracker/page.tsx's deleteAllApplications() exactly. */
async function deleteAllApplications(client: ReturnType<typeof createClient>, userId: string) {
  return client.from("applications").delete().eq("user_id", userId).select("id");
}

async function countApplications(admin: ReturnType<typeof createClient>, userId: string): Promise<number> {
  const { data, error } = await admin.from("applications").select("id").eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).length;
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);

  // ============================================================
  // TEST A - individual delete regression.
  // ============================================================
  const userA = await makeTestUser(admin);
  const appA1 = await insertApplication(userA.client, userA.userId, { company: "Regression Co" });
  const { data: delOneData, error: delOneError } = await deleteOneApplication(userA.client, userA.userId, appA1);
  check("A: individual delete still succeeds (no error)", delOneError, null);
  check("A: individual delete removed exactly 1 row", delOneData?.length, 1);
  check("A: individual-deleted application no longer readable", await countApplications(admin, userA.userId), 0);

  // ============================================================
  // TEST B - delete all: 3 owned applications -> 0 remain.
  // ============================================================
  const userB = await makeTestUser(admin);
  await insertApplication(userB.client, userB.userId, { company: "B Co 1" });
  await insertApplication(userB.client, userB.userId, { company: "B Co 2" });
  await insertApplication(userB.client, userB.userId, { company: "B Co 3" });
  check("B: 3 applications seeded", await countApplications(admin, userB.userId), 3);

  const { data: bDeleted, error: bError } = await deleteAllApplications(userB.client, userB.userId);
  check("B: Delete All succeeds (no error)", bError, null);
  check("B: Delete All removed exactly 3 rows", bDeleted?.length, 3);
  check("B: 0 applications remain", await countApplications(admin, userB.userId), 0);

  // ============================================================
  // TEST C - cross-user isolation.
  // ============================================================
  const userC1 = await makeTestUser(admin);
  const userC2 = await makeTestUser(admin);
  await insertApplication(userC1.client, userC1.userId, { company: "C1 Co A" });
  await insertApplication(userC1.client, userC1.userId, { company: "C1 Co B" });
  await insertApplication(userC1.client, userC1.userId, { company: "C1 Co C" });
  await insertApplication(userC2.client, userC2.userId, { company: "C2 Co A" });
  await insertApplication(userC2.client, userC2.userId, { company: "C2 Co B" });

  await deleteAllApplications(userC1.client, userC1.userId);
  check("C: User 1's applications all deleted", await countApplications(admin, userC1.userId), 0);
  check("C: User 2's applications untouched by User 1's Delete All", await countApplications(admin, userC2.userId), 2);

  /* Explicit attempt: User 1 tries to bulk-delete under User 2's id via a
     spoofed userId argument - RLS must still scope to auth.uid(), not the
     client-supplied filter value, so this must delete 0 rows (User 1's
     session cannot see/delete User 2's rows no matter what id is passed). */
  const { data: spoofedDelete } = await userC1.client.from("applications").delete().eq("user_id", userC2.userId).select("id");
  check("C: spoofed userId filter cannot delete another user's rows (RLS-enforced)", (spoofedDelete ?? []).length, 0);
  check("C: User 2's applications still untouched after the spoofed attempt", await countApplications(admin, userC2.userId), 2);

  // ============================================================
  // TEST D - related application data (career_tailored_resumes survives,
  // application_id set to null - ON DELETE SET NULL, not CASCADE).
  // ============================================================
  const userD = await makeTestUser(admin);
  const { data: profileD, error: profileDError } = await admin
    .from("career_profiles")
    .insert({ user_id: userD.userId, schema_version: "1.0.0", serializer_version: "career-memory-runtime-v1" })
    .select("id")
    .single();
  if (profileDError) throw profileDError;
  const appD1 = await insertApplication(userD.client, userD.userId, { company: "D Co" });
  const { data: tailoredD, error: tailoredDError } = await admin
    .from("career_tailored_resumes")
    .insert({ profile_id: profileD.id, application_id: appD1, overlay: {} })
    .select("id")
    .single();
  if (tailoredDError) throw tailoredDError;

  await deleteAllApplications(userD.client, userD.userId);
  check("D: applications row deleted", await countApplications(admin, userD.userId), 0);
  const { data: tailoredDAfter, error: tailoredDAfterError } = await admin.from("career_tailored_resumes").select("id, application_id").eq("id", tailoredD.id).maybeSingle();
  check("D: career_tailored_resumes row survives Delete All", tailoredDAfterError, null);
  checkTrue("D: career_tailored_resumes row still exists (not cascade-deleted)", !!tailoredDAfter);
  check("D: career_tailored_resumes.application_id was set to null (ON DELETE SET NULL), not left dangling", tailoredDAfter?.application_id ?? null, null);

  // ============================================================
  // TEST E - canonical resume history preservation.
  // ============================================================
  const userE = await makeTestUser(admin);
  const { data: profileE, error: profileEError } = await admin
    .from("career_profiles")
    .insert({ user_id: userE.userId, schema_version: "1.0.0", serializer_version: "career-memory-runtime-v1" })
    .select("id")
    .single();
  if (profileEError) throw profileEError;
  const { data: sourceDocE, error: sourceDocEError } = await admin
    .from("career_source_documents")
    .insert({ profile_id: profileE.id, storage_bucket: "test-fixtures", storage_path: `test/${userE.userId}/fixture.pdf`, original_file_name: "fixture.pdf", file_type: "pdf", content_hash: `phase6i610-${Math.random().toString(36).slice(2)}` })
    .select("id")
    .single();
  if (sourceDocEError) throw sourceDocEError;
  const { data: versionE, error: versionEError } = await admin
    .from("career_resume_versions")
    .insert({ profile_id: profileE.id, reason: "import", source_document_id: sourceDocE.id, snapshot: { schemaVersion: "1.0.0" }, schema_version: "1.0.0", serializer_version: "career-memory-runtime-v1" })
    .select("id")
    .single();
  if (versionEError) throw versionEError;
  await insertApplication(userE.client, userE.userId, { company: "E Co", canonical_profile_id: profileE.id, canonical_resume_version_id: versionE.id });

  await deleteAllApplications(userE.client, userE.userId);
  check("E: applications row deleted", await countApplications(admin, userE.userId), 0);
  const { data: profileEAfter } = await admin.from("career_profiles").select("id").eq("id", profileE.id).maybeSingle();
  const { data: versionEAfter } = await admin.from("career_resume_versions").select("id").eq("id", versionE.id).maybeSingle();
  const { data: sourceDocEAfter } = await admin.from("career_source_documents").select("id").eq("id", sourceDocE.id).maybeSingle();
  checkTrue("E: career_profiles row survives Delete All", !!profileEAfter);
  checkTrue("E: career_resume_versions row survives Delete All", !!versionEAfter);
  checkTrue("E: career_source_documents row survives Delete All", !!sourceDocEAfter);

  // ============================================================
  // TEST F - uploaded resume preservation.
  // ============================================================
  const userF = await makeTestUser(admin);
  const { data: resumeF, error: resumeFError } = await admin.from("resumes").insert({ user_id: userF.userId, file_name: "fixture-resume.pdf" }).select("id").single();
  if (resumeFError) throw resumeFError;
  await insertApplication(userF.client, userF.userId, { company: "F Co", resume_id: resumeF.id });

  await deleteAllApplications(userF.client, userF.userId);
  check("F: applications row deleted", await countApplications(admin, userF.userId), 0);
  const { data: resumeFAfter } = await admin.from("resumes").select("id").eq("id", resumeF.id).maybeSingle();
  checkTrue("F: uploaded resumes row survives Delete All", !!resumeFAfter);

  // ============================================================
  // TEST G - Career Memory preservation.
  // ============================================================
  const userG = await makeTestUser(admin);
  const { error: memoryGError } = await admin.from("career_memory").insert({ user_id: userG.userId, first_name: "Fixture", last_name: "User" });
  if (memoryGError) throw memoryGError;
  await insertApplication(userG.client, userG.userId, { company: "G Co" });

  await deleteAllApplications(userG.client, userG.userId);
  check("G: applications row deleted", await countApplications(admin, userG.userId), 0);
  const { data: memoryGAfter } = await admin.from("career_memory").select("user_id, first_name").eq("user_id", userG.userId).maybeSingle();
  checkTrue("G: career_memory row survives Delete All", !!memoryGAfter);
  check("G: career_memory content unchanged", memoryGAfter?.first_name, "Fixture");

  // ============================================================
  // TEST H - zero-application safe no-op.
  // ============================================================
  const userH = await makeTestUser(admin);
  const { data: hDeleted, error: hError } = await deleteAllApplications(userH.client, userH.userId);
  check("H: Delete All on a zero-application account succeeds (no error)", hError, null);
  check("H: Delete All on a zero-application account deletes 0 rows", hDeleted?.length, 0);

  // ============================================================
  // TEST I - filter independence (mixed statuses, all deleted).
  // ============================================================
  const userI = await makeTestUser(admin);
  await insertApplication(userI.client, userI.userId, { company: "I Co 1", status: "Applied" });
  await insertApplication(userI.client, userI.userId, { company: "I Co 2", status: "Interview" });
  await insertApplication(userI.client, userI.userId, { company: "I Co 3", status: "Interview" });
  await insertApplication(userI.client, userI.userId, { company: "I Co 4", status: "Offer" });
  await insertApplication(userI.client, userI.userId, { company: "I Co 5", status: "Rejected" });
  check("I: 5 mixed-status applications seeded", await countApplications(admin, userI.userId), 5);

  /* deleteAllApplications() never references `status` at all - proving
     the server-side operation is filter-blind by construction, not just
     "happens to" delete everything in this particular test. */
  const { data: iDeleted } = await deleteAllApplications(userI.client, userI.userId);
  check("I: all 5 applications deleted regardless of status distribution", iDeleted?.length, 5);
  check("I: 0 applications remain across every status", await countApplications(admin, userI.userId), 0);

  // ============================================================
  // TEST J - idempotency (call Delete All twice).
  // ============================================================
  const userJ = await makeTestUser(admin);
  await insertApplication(userJ.client, userJ.userId, { company: "J Co" });
  const { data: jFirst, error: jFirstError } = await deleteAllApplications(userJ.client, userJ.userId);
  check("J: first Delete All call succeeds", jFirstError, null);
  check("J: first call deletes the 1 seeded application", jFirst?.length, 1);

  const { data: jSecond, error: jSecondError } = await deleteAllApplications(userJ.client, userJ.userId);
  check("J: second Delete All call (nothing left) still succeeds, no error", jSecondError, null);
  check("J: second call deletes 0 rows (deterministic, not an error)", jSecond?.length, 0);

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exit(1);
});
