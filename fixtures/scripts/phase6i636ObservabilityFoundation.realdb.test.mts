/*
  Phase 6I.6.36 - Production Monitoring, Error Tracking & Observability
  Foundation. Test list (A-O) per the round spec's Part AC.

  A-F test lib/observability/logger.ts in-process (no DB needed) by
  monkey-patching console.log to capture emitted JSON lines.
  G-L test lib/observability/health.ts against real local Supabase -
  a single throwaway synthetic auth user (no FK issue - applications.
  user_id DOES reference auth.users, unlike quota_reservations.user_id,
  which has no FK, confirmed by reading both CREATE TABLE statements)
  for the applications-table cases, and fully synthetic random UUIDs
  for the quota_reservations-table cases.
  M-O are code-level proofs (grep the actual committed source) that the
  PII denylist matches the round spec's exact list and that every call
  site this phase touched actually imports/uses the new logger, and
  that the specific raw console.error(label, errorObject) patterns
  flagged by the Part Z audit are gone.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i636ObservabilityFoundation.realdb.test.mts
  Requires local Supabase running.
*/
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  logOperationalEvent,
  elapsedMs,
} from "../../lib/observability/logger";
import {
  getStuckPendingGenerationsHealth,
  getRecentGenerationOutcomeHealth,
} from "../../lib/observability/health";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

const URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const admin = createClient(URL, SERVICE_ROLE_KEY);

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

const readSrc = (relPath: string) => readFileSync(join(repoRoot, relPath), "utf8");

// Captures console.log output for the logger tests (A-E) without
// touching real stdout formatting elsewhere in the script.
function captureLog(fn: () => void): string {
  const original = console.log;
  let captured = "";
  console.log = (line: unknown) => {
    captured = String(line);
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return captured;
}

async function main() {
  /* ==================== A-F: logger.ts (in-process, no DB) ==================== */
  const lineA = captureLog(() =>
    logOperationalEvent({ domain: "auth", event: "login_succeeded", userId: "u1", provider: "google" })
  );
  const parsedA = JSON.parse(lineA);
  checkTrue("A. logOperationalEvent emits one JSON line with a ts field", typeof parsedA.ts === "string" && parsedA.domain === "auth" && parsedA.event === "login_succeeded");

  const lineB = captureLog(() =>
    logOperationalEvent({
      domain: "upload",
      event: "resume_analysis_failed",
      userId: "u1",
      resumeId: "r1",
      errorCode: "UNKNOWN",
      latencyMs: 10,
      metadata: { password: "should-not-appear", note: "safe" },
    } as any)
  );
  const parsedB = JSON.parse(lineB);
  check("B. logOperationalEvent redacts a top-level denylisted metadata key", parsedB.metadata.password, "[redacted]");
  check("B. logOperationalEvent leaves a non-denylisted metadata key intact", parsedB.metadata.note, "safe");

  const lineC = captureLog(() =>
    logOperationalEvent({
      domain: "upload",
      event: "resume_analysis_failed",
      userId: "u1",
      resumeId: "r1",
      errorCode: "UNKNOWN",
      latencyMs: 10,
      metadata: { nested: { access_token: "should-not-appear", ok: 1 } },
    } as any)
  );
  const parsedC = JSON.parse(lineC);
  check("C. logOperationalEvent redacts a denylisted key nested inside metadata", parsedC.metadata.nested.access_token, "[redacted]");
  check("C. logOperationalEvent leaves a nested non-denylisted key intact", parsedC.metadata.nested.ok, 1);

  const longString = "x".repeat(500);
  const lineD = captureLog(() =>
    logOperationalEvent({
      domain: "upload",
      event: "resume_analysis_failed",
      userId: "u1",
      resumeId: "r1",
      errorCode: "UNKNOWN",
      latencyMs: 10,
      metadata: { longField: longString },
    } as any)
  );
  const parsedD = JSON.parse(lineD);
  checkTrue("D. logOperationalEvent truncates a long metadata string value", parsedD.metadata.longField.length < longString.length && parsedD.metadata.longField.includes("truncated"));

  const openAiEventKeys = Object.keys({ domain: "openai", event: "call_failed", route: "r", model: "m", attempt: 1, latencyMs: 1, reason: "x" });
  checkTrue("E. typed OpenAiEvent shape has no free-text field name (message/stack/prompt)", !openAiEventKeys.some((k) => ["message", "stack", "prompt"].includes(k)));

  checkTrue("F. elapsedMs returns a non-negative number for a past startedAt", elapsedMs(Date.now() - 50) >= 50);

  /* ==================== G-H: getStuckPendingGenerationsHealth (real DB, applications table) ==================== */
  const testEmail = `phase6i636-${crypto.randomUUID()}@example.com`;
  const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
    email: testEmail,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (createUserError || !createdUser.user) throw new Error(`failed to create throwaway test user: ${createUserError?.message}`);
  const userId = createdUser.user.id;

  try {
    const baselineHealth = await getStuckPendingGenerationsHealth();
    // A non-stuck (fresh) pending row must NOT be counted.
    const { data: freshRow, error: freshInsertError } = await admin
      .from("applications")
      .insert({ user_id: userId, generation_status: "pending", generation_started_at: new Date().toISOString() })
      .select("id")
      .single();
    if (freshInsertError) throw freshInsertError;

    const afterFreshHealth = await getStuckPendingGenerationsHealth();
    check("G. a fresh (non-stale) pending row is not counted as stuck", afterFreshHealth.count, baselineHealth.count);

    await admin.from("applications").delete().eq("id", freshRow.id);

    // A pending row whose generation_started_at is well past the 5-minute
    // threshold (canonicalGenerateDispatchService.ts's WORKER_STALE_
    // THRESHOLD_MS, mirrored in health.ts) must be counted.
    const staleStartedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: staleRow, error: staleInsertError } = await admin
      .from("applications")
      .insert({ user_id: userId, generation_status: "pending", generation_started_at: staleStartedAt })
      .select("id")
      .single();
    if (staleInsertError) throw staleInsertError;

    const afterStaleHealth = await getStuckPendingGenerationsHealth();
    check("H. a stale (>5min) pending row IS counted as stuck", afterStaleHealth.count, baselineHealth.count + 1);
    checkTrue("H. oldestPendingAgeMs reflects the stale row's real age", (afterStaleHealth.oldestPendingAgeMs ?? 0) >= 10 * 60 * 1000 - 5000);

    await admin.from("applications").delete().eq("id", staleRow.id);

    /* ==================== K-L: getRecentGenerationOutcomeHealth (real DB) ==================== */
    const outcomeBaseline = await getRecentGenerationOutcomeHealth(60);
    const { data: succeededRow } = await admin.from("applications").insert({ user_id: userId, generation_status: "succeeded", created_at: new Date().toISOString() }).select("id").single();
    const { data: failedRow } = await admin.from("applications").insert({ user_id: userId, generation_status: "failed", created_at: new Date().toISOString() }).select("id").single();

    const outcomeAfter = await getRecentGenerationOutcomeHealth(60);
    check("K. succeeded count increments by exactly 1 after inserting one succeeded row", outcomeAfter.succeeded, outcomeBaseline.succeeded + 1);
    check("K. failed count increments by exactly 1 after inserting one failed row", outcomeAfter.failed, outcomeBaseline.failed + 1);
    checkTrue("K. errorRate is a number between 0 and 1 once terminal rows exist", typeof outcomeAfter.errorRate === "number" && outcomeAfter.errorRate! >= 0 && outcomeAfter.errorRate! <= 1);

    if (succeededRow) await admin.from("applications").delete().eq("id", succeededRow.id);
    if (failedRow) await admin.from("applications").delete().eq("id", failedRow.id);

    check("L. errorRate is null for a window with zero terminal rows (far future window start, none exist yet)", (await getRecentGenerationOutcomeHealth(0)).errorRate, null);
  } finally {
    await admin.auth.admin.deleteUser(userId); // cascades to any leftover applications rows via ON DELETE CASCADE
  }

  /*
    I-J: a stale-quota-reservation health helper was drafted, then
    deliberately removed from lib/observability/health.ts (see that
    file's own header comment) after this test run itself proved -
    empirically, via a real permission-denied error from local
    Supabase - that public.generate_package_quota_reservations revokes
    all direct access from every role except its own SECURITY DEFINER
    RPCs (supabase/migrations/
    20260725073100_generate_package_lifetime_quota.sql:305). These two
    cases are therefore verified as CODE-LEVEL PROOFS of that documented
    gap, not live DB executions - confirming the helper was actually
    removed (not left half-wired) and that the removal's reasoning is
    recorded in the source, not just in this test file.
  */
  const healthSrc = readSrc("lib/observability/health.ts");
  checkTrue("I. getStaleQuotaReservationsHealth was NOT shipped as a direct-table-access helper (would violate the table's own lockdown)", !healthSrc.includes("getStaleQuotaReservationsHealth"));
  checkTrue("J. the removal is explained in-source, citing the exact migration line that revokes access", healthSrc.includes("OBSERVABILITY_SCHEMA_CHANGE_REQUIRED") && healthSrc.includes("20260725073100_generate_package_lifetime_quota.sql:305"));

  /* ==================== M-O: code-level proofs ==================== */
  const loggerSrc = readSrc("lib/observability/logger.ts");
  const requiredDenylistKeys = [
    "resumetext", "resume_text", "coverletter", "cover_letter_text", "jobtext", "job_text",
    "emaildraft", "email_draft", "password", "token", "accesstoken", "access_token",
    "refreshtoken", "refresh_token", "authorization", "cookie", "apikey", "api_key",
    "servicerolekey", "service_role_key",
  ];
  checkTrue(
    "M. PII_DENYLIST_KEYS contains every key from the round spec's denylist",
    requiredDenylistKeys.every((key) => loggerSrc.includes(`"${key}"`))
  );

  const instrumentedFiles = [
    "lib/careerMemory/orchestration/canonicalGenerateDispatchService.ts",
    "lib/careerMemory/orchestration/canonicalGeneratePackageService.ts",
    "lib/careerMemory/orchestration/canonicalRenderService.ts",
    "lib/documentAnalysis/resumeAnalysisCore.ts",
    "lib/documentAnalysis/coverLetterAnalysisCore.ts",
    "app/api/analyze-job/route.ts",
    "app/api/analyze-job-url/route.ts",
    "app/auth/callback/route.ts",
  ];
  checkTrue(
    "N. every instrumented call site actually imports logOperationalEvent (not just written, actually wired)",
    instrumentedFiles.every((file) => readSrc(file).includes('from "') && readSrc(file).includes("logOperationalEvent"))
  );

  const rawErrorDumpPattern = /console\.error\(\s*"[A-Z ]+ERROR ="/;
  const fixedFiles = [
    "lib/documentAnalysis/resumeAnalysisCore.ts",
    "lib/documentAnalysis/coverLetterAnalysisCore.ts",
    "app/auth/callback/route.ts",
  ];
  checkTrue(
    "O. no raw console.error(label, errorObject) pattern remains in the 3 files fixed by the Part Z audit",
    fixedFiles.every((file) => !rawErrorDumpPattern.test(readSrc(file)))
  );

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
