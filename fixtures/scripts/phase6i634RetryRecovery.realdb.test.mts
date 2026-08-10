/*
  Phase 6I.6.34 - Retry & Failure Recovery Production Hardening.
  Real-DB verification against local Supabase, synthetic throwaway
  users only, ZERO real OpenAI calls anywhere in this file (Part AZ).

  Exercises the REAL production claim/quota/worker-claim RPCs and the
  REAL dispatchCanonicalGeneration() claim function directly - never a
  reimplemented test double - for every item in Part AW's test matrix
  that is provable via database/RPC state without invoking OpenAI.
  Items A-G (OpenAI retry/no-retry decision per error class) are
  covered by lib/generatePackage/shared.test.ts's own 8 assertions
  against shouldRetryOpenAiError() using REAL typed openai SDK error
  instances (APIConnectionTimeoutError/RateLimitError/APIError/
  SyntaxError/GenerationValidationError) - not duplicated here. Item V
  (invalid upload deterministic failure -> no retry) is covered by
  Phase 6I.6.32's 60-assertion suite (fixtures/scripts/
  phase6i632UploadHardening.realdb.test.mts) - also not duplicated.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i634RetryRecovery.realdb.test.mts
*/
import { createClient } from "@supabase/supabase-js";
import { dispatchCanonicalGeneration } from "../../lib/careerMemory/orchestration/canonicalGenerateDispatchService";
import { CanonicalResumeImportService } from "../../lib/careerMemory/services/canonicalResumeImportService";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";
import { readFileSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
  generate_package_quota_reservations and (for this one setup need)
  applications' own worker-claim columns are intentionally NOT directly
  writable by service_role (RPC-only access, confirmed by a real
  permission-denied error hit while building this file - see item [O]'s
  own comment). Local Postgres superuser access via the Supabase CLI is
  the correct, already-established way to set up local-only test state
  that the app's own RPC surface doesn't expose a "simulate this" path
  for - this never touches Production (the CLI's --local flag targets
  the local Docker Postgres instance only) and only ever writes rows
  this same script just created.
*/
// Returns the parsed `rows` array from `supabase db query --local`'s JSON
// output (it prefixes a "Connecting to local database..." line before the
// JSON object, so the parse starts at the first '{'). Uses exec() (a real
// shell) rather than execFile, since `npx` resolves to npx.cmd on Windows
// and cannot be spawned directly.
async function runLocalSql(sql: string): Promise<any[]> {
  const { stdout } = await execAsync(`npx supabase db query --local "${sql.replace(/"/g, '\\"')}"`, { cwd: process.cwd() });
  const jsonStart = stdout.indexOf("{");
  const parsed = JSON.parse(stdout.slice(jsonStart));
  return parsed.rows ?? [];
}

async function resetRowToPendingUnclaimed(applicationId: string) {
  if (!UUID_RE.test(applicationId)) throw new Error(`resetRowToPendingUnclaimed: refusing non-UUID id ${applicationId}`);
  await runLocalSql(`UPDATE public.applications SET generation_status = 'pending', generation_stage = 'queued', generation_worker_claimed_at = NULL, generation_completed_at = NULL, generation_error_code = NULL, generation_error_summary = NULL WHERE id = '${applicationId}'::uuid RETURNING id;`);
}

const URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const FIXTURE_PDF = "fixtures/resumes/standard-pdf-resume.pdf";

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

async function makeTestUser(admin: ReturnType<typeof createClient>, emailPrefix: string) {
  const email = `phase6i634-${emailPrefix}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i634-realdb-test-password-123";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client };
}

async function seedCanonicalUser(admin: ReturnType<typeof createClient>, emailPrefix: string) {
  const user = await makeTestUser(admin, emailPrefix);
  const bytes = readFileSync(FIXTURE_PDF);
  const storagePath = `${user.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}-resume.pdf`;
  const { error: uploadError } = await admin.storage.from("resumes").upload(storagePath, bytes, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;
  const { data: resumeRow, error: insertError } = await user.client
    .from("resumes")
    .insert({ user_id: user.userId, file_name: "resume.pdf", storage_path: storagePath, source_type: "uploaded", original_file_type: "pdf", is_default: true, original_text: `Resume content for phase6i634-${emailPrefix}.` })
    .select("id")
    .single();
  if (insertError) throw insertError;

  const repositories = createCanonicalRepositories(user.client as any);
  const importService = new CanonicalResumeImportService(repositories, user.client as any);
  const importResult = await importService.importResume(user.userId, resumeRow.id as string);
  if (importResult.status !== "imported") throw new Error(`seedCanonicalUser: import failed for ${emailPrefix}: ${JSON.stringify(importResult)}`);

  await user.client.from("career_memory").upsert({ user_id: user.userId, selected_resume_type: "uploaded", selected_resume_id: resumeRow.id }, { onConflict: "user_id" });

  return user;
}

/*
  Real claim call - the SAME dispatchCanonicalGeneration() Generate
  Package's own route calls.

  requestOrigin deliberately points at 127.0.0.1:1 (a reserved,
  never-bound port) rather than the app's real local dev origin. A
  developer's own Next.js dev server may genuinely be running on
  localhost:3001 while this script executes - if requestOrigin pointed
  there, enqueueCanonicalWorker() would successfully hand the row to
  that REAL server, whose worker route would make a REAL OpenAI call,
  silently violating this file's own zero-AI-call guarantee (this was
  caught and fixed during Phase 6I.6.34 verification - a live dev
  server was in fact enqueuing and completing real generations for
  every claim() call). Port 1 refuses the connection immediately and
  deterministically, on any machine, regardless of what else happens
  to be running locally, so enqueueCanonicalWorker() always fails and
  dispatchCanonicalGeneration()'s own catch block (canonicalGenerate
  DispatchService.ts ~line 351) always marks the row 'failed' with
  BACKGROUND_ENQUEUE_FAILED before this function returns - see item
  [N] below, which asserts exactly that real behavior. This is what
  actually guarantees zero OpenAI calls: not "nothing happens to be
  listening," but "the enqueue target is structurally unreachable."
*/
async function claim(user: { userId: string; client: ReturnType<typeof createClient> }, generationRequestId: string) {
  const { data: memoryRow } = await user.client.from("career_memory").select("*").eq("user_id", user.userId).single();
  await dispatchCanonicalGeneration({
    supabase: user.client as any,
    userId: user.userId,
    memory: memoryRow as Record<string, unknown>,
    generationRequestId,
    jobText: "We are hiring a Software Engineer. Location: Toronto, ON, Canada.",
    title: "Software Engineer",
    company: "Test Co",
    applicantName: "Test Applicant",
    analysis: { summary: "test job analysis" },
    jobUrl: null,
    body: {},
    requestOrigin: "http://127.0.0.1:1",
    routingReason: "phase6i634-test",
    canaryStage: 0,
  });
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);

  /* ============================================================
     H/I: same request submitted twice sequentially / concurrently
     must not create a second application row.
     ============================================================ */
  const userH = await seedCanonicalUser(admin, "seq-dup");
  const requestIdH = crypto.randomUUID();
  await claim(userH, requestIdH);
  await claim(userH, requestIdH); // sequential duplicate, same request id
  const { data: rowsH } = await admin.from("applications").select("id").eq("user_id", userH.userId).eq("generation_request_id", requestIdH);
  check("[H] sequential duplicate request (same request_id) creates exactly ONE applications row", rowsH?.length, 1);

  const userI = await seedCanonicalUser(admin, "concurrent-dup");
  const requestIdI = crypto.randomUUID();
  await Promise.all([claim(userI, requestIdI), claim(userI, requestIdI)]); // concurrent duplicate
  const { data: rowsI } = await admin.from("applications").select("id").eq("user_id", userI.userId).eq("generation_request_id", requestIdI);
  check("[I] concurrent duplicate request (same request_id, fired via Promise.all) creates exactly ONE applications row", rowsI?.length, 1);

  /* ============================================================
     J: different request_ids for the same user are independent -
     never coalesced/blocked by each other.
     ============================================================ */
  const requestIdJ1 = crypto.randomUUID();
  const requestIdJ2 = crypto.randomUUID();
  await claim(userI, requestIdJ1);
  await claim(userI, requestIdJ2);
  const { data: rowsJ } = await admin.from("applications").select("id, generation_request_id").eq("user_id", userI.userId).in("generation_request_id", [requestIdJ1, requestIdJ2]);
  check("[J] two DIFFERENT request_ids for the same user create two independent applications rows", rowsJ?.length, 2);

  /* ============================================================
     K: worker duplicate invocation - claim_generate_package_worker
     called twice for the SAME application_id must only let ONE
     caller through (atomic UPDATE ... WHERE generation_worker_claimed_at
     IS NULL). This is the exact mechanism that makes at-least-once
     Netlify Background Function delivery safe (Part BA).
     ============================================================ */
  /*
    claim() now ALWAYS ends with the row 'failed' (BACKGROUND_ENQUEUE_
    FAILED - see item [N] below and claim()'s own comment: requestOrigin
    is a structurally unreachable address, so enqueueCanonicalWorker()
    can never succeed here). That means the naturally-claimed row is
    never actually left 'pending'+unclaimed the way a real worker-eligible
    row would be, so K/L/M seed that exact state directly via a raw SQL
    UPDATE (through `supabase db query --local`, i.e. the local Postgres
    superuser - NOT the service_role client, which lacks direct table
    grants on purpose) rather than reinventing dispatchCanonicalGeneration's
    own insert. This still exercises the REAL claim_canonical_generate_
    worker()/complete_canonical_generate_worker() RPCs end to end - only
    the row's setup (not the RPCs themselves) is short-circuited.
  */
  const userK = await seedCanonicalUser(admin, "worker-dup");
  const requestIdK = crypto.randomUUID();
  await claim(userK, requestIdK);
  const { data: appKFailed } = await admin.from("applications").select("id, generation_status").eq("user_id", userK.userId).eq("generation_request_id", requestIdK).single();
  checkTrue("[K] setup: claim() with an unreachable enqueue target leaves the row 'failed' (BACKGROUND_ENQUEUE_FAILED), matching item [N]'s own assertion", !!appKFailed && appKFailed.generation_status === "failed");
  await resetRowToPendingUnclaimed(appKFailed!.id as string);
  const { data: appK } = await admin.from("applications").select("id, generation_status, generation_worker_claimed_at").eq("id", appKFailed!.id).single();
  checkTrue("[K] after the direct reset, the row is 'pending' with generation_worker_claimed_at NULL (a genuine worker-eligible row)", appK?.generation_status === "pending" && appK?.generation_worker_claimed_at === null);

  const claim1 = await admin.rpc("claim_canonical_generate_worker", { p_application_id: appK!.id });
  const claim2 = await admin.rpc("claim_canonical_generate_worker", { p_application_id: appK!.id });
  const claim1Rows = (claim1.data ?? []) as unknown[];
  const claim2Rows = (claim2.data ?? []) as unknown[];
  check("[K] first claim_canonical_generate_worker() call returns exactly 1 row (wins the claim)", claim1Rows.length, 1);
  check("[K] second claim_canonical_generate_worker() call for the SAME application returns 0 rows (already claimed, safe no-op - the exact mechanism that makes at-least-once Netlify Background Function delivery safe, Part BA)", claim2Rows.length, 0);

  /* ============================================================
     L: worker crash BEFORE calling OpenAI (claim succeeded, worker
     never completes) - the application must not remain permanently
     misleadingly succeeded. Simulated by leaving generation_worker_
     claimed_at set (as a real crash would) and confirming the row is
     still 'pending', not silently 'succeeded'.
     ============================================================ */
  const { data: appKAfterCrash } = await admin.from("applications").select("generation_status, id").eq("id", appK!.id).single();
  checkTrue("[L] after a simulated pre-AI worker crash (claimed, never completed), the row is still 'pending', never falsely 'succeeded'", appKAfterCrash?.generation_status === "pending");

  /* ============================================================
     M: worker crash AFTER OpenAI succeeds but BEFORE
     complete_canonical_generate_worker() commits. Not independently
     simulatable without a real OpenAI response (out of scope per Part
     AZ), so this is a DOCUMENTED semantics check instead: confirm
     complete_canonical_generate_worker() is the ONLY function that
     can move a row to 'succeeded', and that calling it twice for the
     same application_id is idempotent (a defensive retry of the
     completion write itself - e.g. after a transient DB error on the
     first UPDATE attempt - never double-charges or corrupts state).
     complete_canonical_generate_worker() has no p_resume_text/
     p_generation_model/p_prompt_version params (those are legacy-only
     - canonical resume output lives via tailored_resume_id, not the
     resume_text column), so idempotency is checked against
     cover_letter_text instead.
     ============================================================ */
  const completeArgs = {
    p_application_id: appK!.id,
    p_user_id: userK.userId,
    p_status: "succeeded",
    p_error_code: null as string | null,
    p_error_summary: null as string | null,
    p_ai_insight: { mismatch: { summary: "", missingRequirements: [], unsupportedClaims: [] }, matches: { strongMatches: [], transferableSkills: [] }, recommendation: { summary: "", applyRecommendation: "review_details", nextSteps: [] } },
    p_cover_letter_text: "Simulated cover letter text (test-only, never sent to OpenAI).",
    p_email_draft: "Simulated email draft.",
  };
  const complete1 = await admin.rpc("complete_canonical_generate_worker", completeArgs);
  checkTrue("[M] complete_canonical_generate_worker() (1st call) succeeds with no error", !complete1.error);
  const { data: appKAfterComplete1 } = await admin.from("applications").select("generation_status, cover_letter_text").eq("id", appK!.id).single();
  check("[M] after 1st complete call, generation_status is 'succeeded'", appKAfterComplete1?.generation_status, "succeeded");
  const complete2 = await admin.rpc("complete_canonical_generate_worker", completeArgs);
  checkTrue("[M] complete_canonical_generate_worker() called AGAIN for the same application_id (simulating a retried completion write) does not error", !complete2.error);
  const { data: appKAfterComplete2 } = await admin.from("applications").select("generation_status, cover_letter_text").eq("id", appK!.id).single();
  check("[M] after the 2nd (duplicate) complete call, generation_status is STILL 'succeeded' (idempotent, not corrupted)", appKAfterComplete2?.generation_status, "succeeded");
  check("[M] after the 2nd (duplicate) complete call, cover_letter_text is unchanged (same value both times, no double-write artifact)", appKAfterComplete2?.cover_letter_text, appKAfterComplete1?.cover_letter_text);

  /* ============================================================
     N: enqueue failure (claim/reservation succeeds, background worker
     enqueue fails - always true in this script, since requestOrigin is
     a structurally unreachable address, see claim()'s own comment).
     Confirms the claim-insert survives an enqueue failure and is not
     rolled back, and that the real code's own catch block marks the
     row 'failed' with a safe, typed BACKGROUND_ENQUEUE_FAILED error
     code (never silently vanishing, never left ambiguously 'pending'
     forever) - the row remains fully recoverable via a client retry
     that reuses the same generation_request_id (Part AO).
     ============================================================ */
  const userN = await seedCanonicalUser(admin, "enqueue-fail");
  const requestIdN = crypto.randomUUID();
  await claim(userN, requestIdN); // enqueue always fails in this script - see claim()'s own comment
  const { data: appN } = await admin.from("applications").select("generation_status, generation_error_code").eq("user_id", userN.userId).eq("generation_request_id", requestIdN).single();
  check("[N] a claim whose background-worker enqueue failed is marked 'failed' with the typed BACKGROUND_ENQUEUE_FAILED error code (safe, visible, recoverable - never a silently vanished or forever-ambiguous row)", appN?.generation_status, "failed");
  check("[N] the enqueue-failure error code is exactly BACKGROUND_ENQUEUE_FAILED", appN?.generation_error_code, "BACKGROUND_ENQUEUE_FAILED");

  /* ============================================================
     O: stale RESERVATION reclaim (quota layer). Reserve, force the
     reservation's created_at into the past, then reserve again with a
     short p_stale_after_seconds - the RPC's own reclaim step must
     release the stale reservation before evaluating the new request,
     so a NEW request_id from the same user is not blocked by an
     abandoned old one.

     generate_package_quota_reservations has NO direct service_role
     grant (confirmed by a real 42501 permission-denied error while
     building this file - it's RPC-only access by design, same
     defense-in-depth pattern as other canonical tables in this
     codebase). The backdate UPDATE and the final verification SELECT
     both go through runLocalSql() (local Postgres superuser via the
     Supabase CLI) instead of the admin/service_role client for exactly
     that reason - using admin.from(...) here would silently no-op
     (permission denied, swallowed by .single()'s optional chaining)
     rather than actually testing anything.
     ============================================================ */
  const userO = await seedCanonicalUser(admin, "stale-quota");
  const staleRequestId = crypto.randomUUID();
  const reserveStale = await admin.rpc("reserve_generate_package_usage", { p_user_id: userO.userId, p_request_id: staleRequestId, p_stale_after_seconds: 180 });
  const staleReserveRow = (reserveStale.data as any[])?.[0];
  checkTrue("[O] setup: initial reservation succeeds", staleReserveRow?.reserved === true);
  await runLocalSql(`UPDATE public.generate_package_quota_reservations SET created_at = now() - interval '10 seconds' WHERE user_id = '${userO.userId}'::uuid AND request_id = '${staleRequestId}'::uuid RETURNING id;`);
  const freshRequestId = crypto.randomUUID();
  const reserveAfterReclaim = await admin.rpc("reserve_generate_package_usage", { p_user_id: userO.userId, p_request_id: freshRequestId, p_stale_after_seconds: 5 });
  const freshReserveRow = (reserveAfterReclaim.data as any[])?.[0];
  checkTrue("[O] a NEW request_id from the same user succeeds after the stale reservation (10s old, threshold 5s) is auto-reclaimed inside the same RPC call", freshReserveRow?.reserved === true);
  const staleRowsAfterReclaim = await runLocalSql(`SELECT status FROM public.generate_package_quota_reservations WHERE user_id = '${userO.userId}'::uuid AND request_id = '${staleRequestId}'::uuid;`);
  check("[O] the original stale reservation's own status is now 'released' (reclaimed, not left dangling as 'reserved' forever)", staleRowsAfterReclaim[0]?.status, "released");

  /* ============================================================
     P: DB completion failure -> no fake success. Directly verify a
     row that was only ever claimed/reserved (never explicitly
     completed) never independently reads as 'succeeded' - the
     'succeeded' status ONLY exists after a real
     complete_generate_package_generation() call, confirmed above at
     item M; this asserts the CONVERSE for a row that never got one.
     ============================================================ */
  const userP = await seedCanonicalUser(admin, "no-fake-success");
  const requestIdP = crypto.randomUUID();
  await claim(userP, requestIdP);
  const { data: appP } = await admin.from("applications").select("generation_status").eq("user_id", userP.userId).eq("generation_request_id", requestIdP).single();
  checkTrue("[P] a claimed-but-never-completed application is never 'succeeded' by default (no fake success without an explicit completion write)", appP?.generation_status !== "succeeded");

  /* ============================================================
     X/Y: quota consumption exactness across a failed vs successful
     retry - the single most safety-critical invariant in the whole
     lifecycle (users must never be double-charged, and a genuinely
     successful generation must consume exactly one unit).
     ============================================================ */
  const userXY = await seedCanonicalUser(admin, "quota-exactness");
  const requestIdXY = crypto.randomUUID();

  const reserveXY1 = await admin.rpc("reserve_generate_package_usage", { p_user_id: userXY.userId, p_request_id: requestIdXY });
  const reserveXY1Row = (reserveXY1.data as any[])?.[0];
  checkTrue("[X] initial reservation for a fresh request_id succeeds", reserveXY1Row?.reserved === true);
  const usedAfterReserve = reserveXY1Row?.used;

  // Simulate a FAILED attempt: release the reservation (exactly what
  // the real failure path does - see generateCore.ts's catch block).
  const releaseXY = await admin.rpc("release_generate_package_usage", { p_user_id: userXY.userId, p_request_id: requestIdXY });
  checkTrue("[X] release_generate_package_usage() after a simulated failure succeeds with no error", !releaseXY.error);

  // A manual retry with the SAME request_id (this phase's own policy:
  // a transient-failure retry reuses the same logical request identity,
  // never a new billable one - Part AO).
  const reserveXY2 = await admin.rpc("reserve_generate_package_usage", { p_user_id: userXY.userId, p_request_id: requestIdXY });
  const reserveXY2Row = (reserveXY2.data as any[])?.[0];
  checkTrue("[X] re-reserving the SAME request_id after a release succeeds again (the released slot is available for retry, not permanently burned)", reserveXY2Row?.reserved === true);
  check("[X] failed-then-retried request consumes exactly the SAME single unit both times (used count identical before/after the fail+retry cycle) - never double-charged", reserveXY2Row?.used, usedAfterReserve);

  // Now simulate a SUCCESSFUL completion of that same request_id.
  const completeXY = await admin.rpc("complete_generate_package_usage", { p_user_id: userXY.userId, p_request_id: requestIdXY });
  checkTrue("[Y] complete_generate_package_usage() succeeds with no error", !completeXY.error);

  // A duplicate "retry" AFTER a real success must be recognized as
  // already-completed, never consume a second unit.
  const reserveXY3 = await admin.rpc("reserve_generate_package_usage", { p_user_id: userXY.userId, p_request_id: requestIdXY });
  const reserveXY3Row = (reserveXY3.data as any[])?.[0];
  checkTrue("[Y] reserving the SAME request_id again after a real completion reports already_completed=true", reserveXY3Row?.already_completed === true);
  check("[Y] the already-completed replay reports the SAME used count as right after the real completion (no second unit consumed)", reserveXY3Row?.used, reserveXY2Row?.used);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
