/*
  Phase 6E - error classification test category (spec section 14:
  Loading/Retry/Unauthorized/Version Conflict/Merge Conflict/Restore
  Failed/RPC Error/Idempotency Replay). Run with
  `npx tsx lib/canonicalCareerUi/errors.test.ts`.
*/
import { CanonicalApiError, classifyApiError, apiErrorFromResponseBody, networkError } from "./errors";

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

function main() {
  /* ---------------- classifyApiError: every code, default call site ---------------- */
  check("classify: AUTHENTICATION_REQUIRED -> unauthorized", classifyApiError(new CanonicalApiError("AUTHENTICATION_REQUIRED", "x", 401)), "unauthorized");
  check("classify: AUTHORIZATION_DENIED -> unauthorized", classifyApiError(new CanonicalApiError("AUTHORIZATION_DENIED", "x", 403)), "unauthorized");
  check("classify: NOT_FOUND -> not_found", classifyApiError(new CanonicalApiError("NOT_FOUND", "x", 404)), "not_found");
  check("classify: VALIDATION_FAILED -> validation", classifyApiError(new CanonicalApiError("VALIDATION_FAILED", "x", 422)), "validation");
  check("classify: TRANSACTION_UNAVAILABLE -> rpc_error", classifyApiError(new CanonicalApiError("TRANSACTION_UNAVAILABLE", "x", 503)), "rpc_error");
  check("classify: SCHEMA_GAP -> rpc_error", classifyApiError(new CanonicalApiError("SCHEMA_GAP", "x", 501)), "rpc_error");
  check("classify: NETWORK_ERROR -> retry", classifyApiError(new CanonicalApiError("NETWORK_ERROR", "x", 0)), "retry");
  check("classify: UNKNOWN -> retry", classifyApiError(new CanonicalApiError("UNKNOWN", "x", 0)), "retry");
  check("classify: PERSISTENCE_ERROR default call site -> retry", classifyApiError(new CanonicalApiError("PERSISTENCE_ERROR", "x", 500)), "retry");

  /* ---------------- classifyApiError: CONFLICT depends on call site ---------------- */
  check("classify: CONFLICT + save_version -> version_conflict", classifyApiError(new CanonicalApiError("CONFLICT", "x", 409), "save_version"), "version_conflict");
  check("classify: CONFLICT + restore_version -> restore_failed", classifyApiError(new CanonicalApiError("CONFLICT", "x", 409), "restore_version"), "restore_failed");
  check("classify: CONFLICT + create_overlay -> retry (no dedicated kind)", classifyApiError(new CanonicalApiError("CONFLICT", "x", 409), "create_overlay"), "retry");
  check("classify: CONFLICT + generic -> retry", classifyApiError(new CanonicalApiError("CONFLICT", "x", 409), "generic"), "retry");

  /* ---------------- classifyApiError: PERSISTENCE_ERROR depends on call site ---------------- */
  check("classify: PERSISTENCE_ERROR + restore_version -> restore_failed", classifyApiError(new CanonicalApiError("PERSISTENCE_ERROR", "x", 500), "restore_version"), "restore_failed");
  check("classify: PERSISTENCE_ERROR + create_overlay -> retry", classifyApiError(new CanonicalApiError("PERSISTENCE_ERROR", "x", 500), "create_overlay"), "retry");
  check("classify: PERSISTENCE_ERROR + register_source_document -> retry", classifyApiError(new CanonicalApiError("PERSISTENCE_ERROR", "x", 500), "register_source_document"), "retry");
  check("classify: PERSISTENCE_ERROR + delete_overlay -> retry", classifyApiError(new CanonicalApiError("PERSISTENCE_ERROR", "x", 500), "delete_overlay"), "retry");

  /* ---------------- apiErrorFromResponseBody: well-formed bodies ---------------- */
  {
    const err = apiErrorFromResponseBody(422, { error: { code: "VALIDATION_FAILED", message: "profileId is required" } });
    check("fromBody: code parsed", err.code, "VALIDATION_FAILED");
    check("fromBody: message parsed", err.message, "profileId is required");
    check("fromBody: status parsed", err.status, 422);
    checkTrue("fromBody: is a CanonicalApiError instance", err instanceof CanonicalApiError);
  }
  {
    const err = apiErrorFromResponseBody(404, { error: { code: "NOT_FOUND", message: "Career profile not found." } });
    check("fromBody: NOT_FOUND round-trips", err.code, "NOT_FOUND");
  }
  {
    const err = apiErrorFromResponseBody(409, { error: { code: "CONFLICT", message: "stale version" } });
    check("fromBody: CONFLICT round-trips", err.code, "CONFLICT");
  }

  /* ---------------- apiErrorFromResponseBody: malformed/unexpected bodies never throw ---------------- */
  check("fromBody: null body -> UNKNOWN, does not throw", apiErrorFromResponseBody(500, null).code, "UNKNOWN");
  check("fromBody: undefined body -> UNKNOWN", apiErrorFromResponseBody(500, undefined).code, "UNKNOWN");
  check("fromBody: empty object body -> UNKNOWN", apiErrorFromResponseBody(500, {}).code, "UNKNOWN");
  check("fromBody: array body -> UNKNOWN", apiErrorFromResponseBody(500, []).code, "UNKNOWN");
  check("fromBody: string body -> UNKNOWN", apiErrorFromResponseBody(500, "oops").code, "UNKNOWN");
  check("fromBody: error field is a string, not object -> UNKNOWN", apiErrorFromResponseBody(500, { error: "raw string" }).code, "UNKNOWN");
  check("fromBody: unrecognized code string -> UNKNOWN (never trusts an arbitrary server code)", apiErrorFromResponseBody(500, { error: { code: "SOMETHING_NEW", message: "x" } }).code, "UNKNOWN");
  check("fromBody: missing message falls back to a generic message", apiErrorFromResponseBody(500, { error: { code: "PERSISTENCE_ERROR" } }).message, "An unexpected error occurred.");
  check("fromBody: empty-string message falls back to a generic message", apiErrorFromResponseBody(500, { error: { code: "PERSISTENCE_ERROR", message: "" } }).message, "An unexpected error occurred.");
  check("fromBody: preserves the given HTTP status even on a malformed body", apiErrorFromResponseBody(503, "not json").status, 503);

  /* ---------------- networkError ---------------- */
  {
    const err = networkError("connection refused");
    check("networkError: code is NETWORK_ERROR", err.code, "NETWORK_ERROR");
    check("networkError: status is 0 (no real HTTP response)", err.status, 0);
    checkTrue("networkError: message includes the underlying detail", err.message.includes("connection refused"));
  }

  /* ---------------- CanonicalApiError itself ---------------- */
  {
    const err = new CanonicalApiError("NOT_FOUND", "Career profile not found.", 404);
    checkTrue("CanonicalApiError: is instanceof Error", err instanceof Error);
    check("CanonicalApiError: name is set for debuggability", err.name, "CanonicalApiError");
  }

  /* ---------------- classifyApiError: every remaining call site value for the codes that don't branch on it ---------------- */
  check("classify: NOT_FOUND + restore_version -> not_found regardless of call site", classifyApiError(new CanonicalApiError("NOT_FOUND", "x", 404), "restore_version"), "not_found");
  check("classify: VALIDATION_FAILED + create_overlay -> validation regardless of call site", classifyApiError(new CanonicalApiError("VALIDATION_FAILED", "x", 422), "create_overlay"), "validation");
  check("classify: AUTHENTICATION_REQUIRED + delete_overlay -> unauthorized regardless of call site", classifyApiError(new CanonicalApiError("AUTHENTICATION_REQUIRED", "x", 401), "delete_overlay"), "unauthorized");

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
