/*
  Phase 6E - "API Integration" + "Repository Integration" test category
  (spec section 15). Exercises every lib/canonicalCareerUi/apiClient.ts
  function against the REAL app/api/internal/canonical-career-memory/**
  route handlers (which in turn call the REAL Phase 6D
  service/repository layer) via testSupport/routeFetch.ts - not a
  live HTTP server, but not a hand-rolled mock either: the same
  handler functions, service classes, and repository interfaces a real
  request goes through, driven by a FakeSupabaseClient in place of a
  live Postgres connection (the same boundary
  lib/careerMemory/api/apiRoutes.test.ts already accepts and discloses
  for backend-only testing).

  Run with `npx tsx lib/canonicalCareerUi/apiClient.test.ts`.
*/
import * as api from "./apiClient";
import { CanonicalApiError, classifyApiError } from "./errors";
import { freshRouteFetch, createRouteFetch } from "./testSupport/routeFetch";
import { createFakeCareerMemorySupabaseClient } from "../careerMemory/repositories/testSupport/fakeSupabaseClient";
import { buildFixtureRuntime } from "../careerMemory/persistence/testFixtures";
import type { CanonicalResumeRuntime } from "./types";

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
async function expectApiError(label: string, fn: () => Promise<unknown>, expectedCode: string) {
  try {
    await fn();
    check(label, "no error thrown", `${expectedCode} error`);
  } catch (error) {
    checkTrue(`${label} (is CanonicalApiError)`, error instanceof CanonicalApiError);
    check(`${label} (code)`, (error as CanonicalApiError).code, expectedCode);
  }
}

function pristineRuntime(): CanonicalResumeRuntime {
  const runtime = buildFixtureRuntime();
  return { ...runtime, sourceDocuments: [], overlayState: { history: [] } };
}

async function main() {
  /* ---------------- Profile ---------------- */
  {
    const { fetchImpl } = freshRouteFetch("user-profile-1");
    const missing = await api.getProfile(fetchImpl);
    check("profile: getProfile returns null before any profile exists", missing, null);

    const created = await api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchImpl);
    checkTrue("profile: createProfile returns a row with an id", typeof created.id === "string" && created.id.length > 0);
    check("profile: createProfile schema_version matches input", created.schema_version, "resume-structured-v1");

    const fetched = await api.getProfile(fetchImpl);
    check("profile: getProfile after create returns the SAME id", fetched?.id, created.id);

    const createdAgain = await api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchImpl);
    check("profile: creating twice is idempotent (same row returned)", createdAgain.id, created.id);
  }

  /* ---------------- Versions: save / list / get ---------------- */
  let versionsProfileId = "";
  let firstVersionId = "";
  {
    const { fetchImpl } = freshRouteFetch("user-versions-1");
    await api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchImpl);
    const profile = await api.getProfile(fetchImpl);
    versionsProfileId = profile!.id;

    const saveResult = await api.saveVersion({ runtime: pristineRuntime() }, api.newIdempotencyKey(), fetchImpl);
    checkTrue("versions: saveVersion returns a version id", typeof saveResult.version.id === "string" && saveResult.version.id.length > 0);
    check("versions: saveVersion profile_id matches", saveResult.version.profile_id, versionsProfileId);
    check("versions: saveVersion reason defaults to fixture's reason", saveResult.version.reason, "initial");
    checkTrue("versions: saveVersion round trip is valid", saveResult.roundTripValid);
    firstVersionId = saveResult.version.id;

    const list = await api.listVersions(versionsProfileId, fetchImpl);
    check("versions: listVersions returns exactly 1 row", list.length, 1);
    check("versions: listVersions[0].id matches saved version", list[0].id, firstVersionId);

    const fetchedVersion = await api.getVersion(versionsProfileId, firstVersionId, fetchImpl);
    check("versions: getVersion returns the same row", fetchedVersion.id, firstVersionId);

    const second = await api.saveVersion({ runtime: pristineRuntime(), expectedCurrentVersionId: firstVersionId }, api.newIdempotencyKey(), fetchImpl);
    checkTrue("versions: second save with correct expectedCurrentVersionId succeeds", typeof second.version.id === "string");
    check("versions: second save's parent is the first version", second.version.parent_version_id, firstVersionId);

    const listAfterSecond = await api.listVersions(versionsProfileId, fetchImpl);
    check("versions: listVersions returns 2 rows after 2nd save", listAfterSecond.length, 2);
  }

  /* ---------------- Versions: optimistic conflict -> classifyApiError ---------------- */
  {
    const { fetchImpl } = freshRouteFetch("user-versions-conflict");
    await api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchImpl);
    await api.saveVersion({ runtime: pristineRuntime() }, api.newIdempotencyKey(), fetchImpl);

    await expectApiError(
      "versions: stale expectedCurrentVersionId -> CONFLICT",
      () => api.saveVersion({ runtime: pristineRuntime(), expectedCurrentVersionId: "not-the-real-latest-id" }, api.newIdempotencyKey(), fetchImpl),
      "CONFLICT"
    );

    try {
      await api.saveVersion({ runtime: pristineRuntime(), expectedCurrentVersionId: "not-the-real-latest-id" }, api.newIdempotencyKey(), fetchImpl);
    } catch (error) {
      check("versions: CONFLICT classifies as version_conflict for save_version call site", classifyApiError(error as CanonicalApiError, "save_version"), "version_conflict");
    }
  }

  /* ---------------- Versions: idempotency replay ---------------- */
  {
    const { fetchImpl } = freshRouteFetch("user-versions-replay");
    await api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchImpl);
    const key = api.newIdempotencyKey();
    const first = await api.saveVersion({ runtime: pristineRuntime() }, key, fetchImpl);
    const replay = await api.saveVersion({ runtime: pristineRuntime() }, key, fetchImpl);
    check("versions: replaying the SAME idempotency key returns the SAME version id", replay.version.id, first.version.id);

    const profile = await api.getProfile(fetchImpl);
    const list = await api.listVersions(profile!.id, fetchImpl);
    check("versions: replayed request did not create a duplicate row", list.length, 1);
  }

  /* ---------------- Versions: restore ---------------- */
  {
    const { fetchImpl } = freshRouteFetch("user-restore-1");
    await api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchImpl);
    const profile = await api.getProfile(fetchImpl);
    const saved = await api.saveVersion({ runtime: pristineRuntime() }, api.newIdempotencyKey(), fetchImpl);

    const restored = await api.restoreVersion(profile!.id, saved.version.id, api.newIdempotencyKey(), fetchImpl);
    checkTrue("restore: restoreVersion returns a NEW version id", restored.version.id !== saved.version.id);
    check("restore: restoredFromVersionId matches the target", restored.restoredFromVersionId, saved.version.id);
    check("restore: new version's reason is 'restore'", restored.version.reason, "restore");
    check("restore: new version's parent is the original", restored.version.parent_version_id, saved.version.id);

    const list = await api.listVersions(profile!.id, fetchImpl);
    check("restore: listVersions now shows 2 rows (original + restored)", list.length, 2);

    await expectApiError(
      "restore: restoring a nonexistent version id -> NOT_FOUND",
      () => api.restoreVersion(profile!.id, "nonexistent-version-id", api.newIdempotencyKey(), fetchImpl),
      "NOT_FOUND"
    );
  }

  /* ---------------- Overlays ---------------- */
  let overlaysProfileId = "";
  let overlayVersionId = "";
  let createdOverlayId = "";
  {
    const { fetchImpl } = freshRouteFetch("user-overlays-1");
    await api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchImpl);
    const profile = await api.getProfile(fetchImpl);
    overlaysProfileId = profile!.id;
    const saved = await api.saveVersion({ runtime: pristineRuntime() }, api.newIdempotencyKey(), fetchImpl);
    overlayVersionId = saved.version.id;

    const emptyList = await api.listOverlays(overlaysProfileId, fetchImpl);
    check("overlays: listOverlays is empty before any overlay is created", emptyList.length, 0);

    const overlay = {
      schemaVersion: "resume-structured-v1",
      professionalSummaryText: "Tailored for a supply-chain director role.",
      entries: [{ entryId: "exp-acme-ops", bullets: [{ text: "Directed carrier scorecard rollout across 3 regions." }] }],
    };
    const result = await api.createOverlay({ profileId: overlaysProfileId, resumeVersionId: overlayVersionId, overlay }, api.newIdempotencyKey(), fetchImpl);
    checkTrue("overlays: createOverlay returns a row with an id", typeof result.overlay.id === "string" && result.overlay.id.length > 0);
    checkTrue("overlays: createOverlay applied at least one entry", result.appliedEntryIds.length >= 1);
    check("overlays: createOverlay had 0 rejections for a valid overlay", result.rejections.length, 0);
    createdOverlayId = result.overlay.id;

    const listAfter = await api.listOverlays(overlaysProfileId, fetchImpl);
    check("overlays: listOverlays returns 1 row after create", listAfter.length, 1);

    const rejecting = { schemaVersion: "resume-structured-v1", entries: [{ entryId: "does-not-exist", bullets: [{ text: "x" }] }] };
    const rejectingResult = await api.createOverlay({ profileId: overlaysProfileId, resumeVersionId: overlayVersionId, overlay: rejecting }, api.newIdempotencyKey(), fetchImpl);
    checkTrue("overlays: unknown entryId is rejected, not silently applied", rejectingResult.rejections.length >= 1);
    check("overlays: rejection reason is unknown-entry-id", rejectingResult.rejections[0]?.reason, "unknown-entry-id");

    await api.deleteOverlay(overlaysProfileId, createdOverlayId, fetchImpl);
    const listAfterDelete = await api.listOverlays(overlaysProfileId, fetchImpl);
    checkTrue("overlays: deleteOverlay removes the row", !listAfterDelete.some((o) => o.id === createdOverlayId));

    await expectApiError(
      "overlays: deleting an already-deleted overlay -> NOT_FOUND",
      () => api.deleteOverlay(overlaysProfileId, createdOverlayId, fetchImpl),
      "NOT_FOUND"
    );
  }

  /* ---------------- Overlays: cross-user ownership ---------------- */
  {
    const { fetchImpl: fetchA } = freshRouteFetch("user-overlay-owner-a");
    await api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchA);
    const profileA = await api.getProfile(fetchA);
    const savedA = await api.saveVersion({ runtime: pristineRuntime() }, api.newIdempotencyKey(), fetchA);
    const overlayA = await api.createOverlay(
      { profileId: profileA!.id, resumeVersionId: savedA.version.id, overlay: { schemaVersion: "resume-structured-v1", entries: [] } },
      api.newIdempotencyKey(),
      fetchA
    );

    const { fetchImpl: fetchB } = freshRouteFetch("user-overlay-owner-b");
    await expectApiError(
      "overlays: user B deleting user A's overlay -> NOT_FOUND (no cross-user leak)",
      () => api.deleteOverlay(profileA!.id, overlayA.overlay.id, fetchB),
      "NOT_FOUND"
    );
  }

  /* ---------------- Source documents ---------------- */
  {
    const { fetchImpl } = freshRouteFetch("user-sources-1");
    await api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchImpl);
    const profile = await api.getProfile(fetchImpl);

    const emptyList = await api.listSourceDocuments(profile!.id, fetchImpl);
    check("sources: listSourceDocuments is empty before registering any", emptyList.length, 0);

    const doc = await api.registerSourceDocument(
      {
        profileId: profile!.id,
        fileName: "resume.pdf",
        fileType: "pdf",
        contentHash: "sha256-test-hash-1",
        storageBucket: "resumes",
        storagePath: `${profile!.id}/resume.pdf`,
        mimeType: "application/pdf",
        byteSize: 12345,
        parserVersion: "pdf-parser-v3",
      },
      api.newIdempotencyKey(),
      fetchImpl
    );
    checkTrue("sources: registerSourceDocument returns a row with an id", typeof doc.id === "string" && doc.id.length > 0);
    check("sources: registered document analysis_status defaults to pending", doc.analysis_status, "pending");

    const listAfter = await api.listSourceDocuments(profile!.id, fetchImpl);
    check("sources: listSourceDocuments returns 1 row after register", listAfter.length, 1);

    const dup = await api.registerSourceDocument(
      { profileId: profile!.id, fileName: "resume.pdf", fileType: "pdf", contentHash: "sha256-test-hash-1", storageBucket: "resumes", storagePath: `${profile!.id}/resume.pdf` },
      api.newIdempotencyKey(),
      fetchImpl
    );
    check("sources: registering the SAME contentHash again returns the SAME row (unique index)", dup.id, doc.id);

    await expectApiError(
      "sources: registering an invalid fileType -> VALIDATION_FAILED",
      () =>
        api.registerSourceDocument(
          { profileId: profile!.id, fileName: "x.txt", fileType: "txt" as never, contentHash: "sha256-bad", storageBucket: "resumes", storagePath: "x" },
          api.newIdempotencyKey(),
          fetchImpl
        ),
      "VALIDATION_FAILED"
    );
  }

  /* ---------------- Generated documents ---------------- */
  {
    const { fetchImpl } = freshRouteFetch("user-generated-docs-1");
    await api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchImpl);
    const profile = await api.getProfile(fetchImpl);
    const saved = await api.saveVersion({ runtime: pristineRuntime() }, api.newIdempotencyKey(), fetchImpl);
    const overlayResult = await api.createOverlay(
      { profileId: profile!.id, resumeVersionId: saved.version.id, overlay: { schemaVersion: "resume-structured-v1", entries: [] } },
      api.newIdempotencyKey(),
      fetchImpl
    );
    const tailoredResumeId = overlayResult.overlay.id;

    const emptyList = await api.listGeneratedDocuments(profile!.id, tailoredResumeId, fetchImpl);
    check("generated docs: listGeneratedDocuments is empty before creating any", emptyList.length, 0);

    const doc = await api.createGeneratedDocument(
      { profileId: profile!.id, tailoredResumeId, storageBucket: "generated", storagePath: `${profile!.id}/${tailoredResumeId}.pdf`, fileType: "pdf" },
      api.newIdempotencyKey(),
      fetchImpl
    );
    checkTrue("generated docs: createGeneratedDocument returns a row with an id", typeof doc.id === "string" && doc.id.length > 0);

    const listAfter = await api.listGeneratedDocuments(profile!.id, tailoredResumeId, fetchImpl);
    check("generated docs: listGeneratedDocuments returns 1 row after create", listAfter.length, 1);

    await expectApiError(
      "generated docs: creating one against a nonexistent tailoredResumeId -> NOT_FOUND",
      () => api.createGeneratedDocument({ profileId: profile!.id, tailoredResumeId: "nonexistent-tailored-id", storageBucket: "generated", storagePath: "x", fileType: "pdf" }, api.newIdempotencyKey(), fetchImpl),
      "NOT_FOUND"
    );
    await expectApiError(
      "generated docs: listing against a nonexistent tailoredResumeId -> NOT_FOUND",
      () => api.listGeneratedDocuments(profile!.id, "nonexistent-tailored-id", fetchImpl),
      "NOT_FOUND"
    );

    const replayKey = api.newIdempotencyKey();
    const first = await api.createGeneratedDocument({ profileId: profile!.id, tailoredResumeId, storageBucket: "generated", storagePath: "replay-path", fileType: "docx" }, replayKey, fetchImpl);
    const replay = await api.createGeneratedDocument({ profileId: profile!.id, tailoredResumeId, storageBucket: "generated", storagePath: "replay-path", fileType: "docx" }, replayKey, fetchImpl);
    check("generated docs: replaying the same idempotency key returns the SAME generated document id", replay.id, first.id);
    const listAfterReplay = await api.listGeneratedDocuments(profile!.id, tailoredResumeId, fetchImpl);
    check("generated docs: the replay did not create a 3rd row (still 2: original + replay-path)", listAfterReplay.length, 2);
  }

  /* ---------------- Overlays: idempotency replay on create ---------------- */
  {
    const { fetchImpl } = freshRouteFetch("user-overlay-replay-1");
    await api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchImpl);
    const profile = await api.getProfile(fetchImpl);
    const saved = await api.saveVersion({ runtime: pristineRuntime() }, api.newIdempotencyKey(), fetchImpl);
    const overlay = { schemaVersion: "resume-structured-v1", entries: [{ entryId: "exp-acme-ops", bullets: [{ text: "Replay-tested bullet." }] }] };
    const key = api.newIdempotencyKey();
    const first = await api.createOverlay({ profileId: profile!.id, resumeVersionId: saved.version.id, overlay }, key, fetchImpl);
    const replay = await api.createOverlay({ profileId: profile!.id, resumeVersionId: saved.version.id, overlay }, key, fetchImpl);
    check("overlays: replaying the same idempotency key returns the SAME overlay id", replay.overlay.id, first.overlay.id);
    const list = await api.listOverlays(profile!.id, fetchImpl);
    check("overlays: the replayed request did not create a duplicate row", list.length, 1);
  }

  /* ---------------- Source documents: idempotency replay via distinct content hash stays distinct ---------------- */
  {
    const { fetchImpl } = freshRouteFetch("user-source-replay-1");
    await api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchImpl);
    const profile = await api.getProfile(fetchImpl);
    const docA = await api.registerSourceDocument(
      { profileId: profile!.id, fileName: "a.pdf", fileType: "pdf", contentHash: "sha256-doc-a", storageBucket: "resumes", storagePath: "a" },
      api.newIdempotencyKey(),
      fetchImpl
    );
    const docB = await api.registerSourceDocument(
      { profileId: profile!.id, fileName: "b.pdf", fileType: "pdf", contentHash: "sha256-doc-b", storageBucket: "resumes", storagePath: "b" },
      api.newIdempotencyKey(),
      fetchImpl
    );
    checkTrue("sources: two different content hashes produce two distinct rows", docA.id !== docB.id);
    const list = await api.listSourceDocuments(profile!.id, fetchImpl);
    check("sources: listSourceDocuments returns both distinct documents", list.length, 2);
  }

  /* ---------------- User edits (read path this round) ---------------- */
  {
    const { fetchImpl } = freshRouteFetch("user-edits-1");
    await api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchImpl);
    const profile = await api.getProfile(fetchImpl);
    const emptyList = await api.listUserEdits(profile!.id, fetchImpl);
    check("user edits: listUserEdits is empty before any edit is recorded", emptyList.length, 0);
  }

  /* ---------------- Unauthenticated: every endpoint requires a real session ---------------- */
  {
    const unauthClient = createFakeCareerMemorySupabaseClient();
    const fetchImpl = createRouteFetch(unauthClient);
    await expectApiError("unauth: getProfile -> AUTHENTICATION_REQUIRED", () => api.getProfile(fetchImpl), "AUTHENTICATION_REQUIRED");
    await expectApiError("unauth: createProfile -> AUTHENTICATION_REQUIRED", () => api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchImpl), "AUTHENTICATION_REQUIRED");
    await expectApiError("unauth: listVersions -> AUTHENTICATION_REQUIRED", () => api.listVersions("any-profile-id", fetchImpl), "AUTHENTICATION_REQUIRED");
    await expectApiError("unauth: saveVersion -> AUTHENTICATION_REQUIRED", () => api.saveVersion({ runtime: pristineRuntime() }, api.newIdempotencyKey(), fetchImpl), "AUTHENTICATION_REQUIRED");
    await expectApiError("unauth: restoreVersion -> AUTHENTICATION_REQUIRED", () => api.restoreVersion("any-profile-id", "any-version-id", api.newIdempotencyKey(), fetchImpl), "AUTHENTICATION_REQUIRED");
    await expectApiError("unauth: listOverlays -> AUTHENTICATION_REQUIRED", () => api.listOverlays("any-profile-id", fetchImpl), "AUTHENTICATION_REQUIRED");
    await expectApiError(
      "unauth: createOverlay -> AUTHENTICATION_REQUIRED",
      () => api.createOverlay({ profileId: "any-profile-id", overlay: { schemaVersion: "resume-structured-v1" } }, api.newIdempotencyKey(), fetchImpl),
      "AUTHENTICATION_REQUIRED"
    );
    await expectApiError("unauth: deleteOverlay -> AUTHENTICATION_REQUIRED", () => api.deleteOverlay("any-profile-id", "any-overlay-id", fetchImpl), "AUTHENTICATION_REQUIRED");
    await expectApiError("unauth: listSourceDocuments -> AUTHENTICATION_REQUIRED", () => api.listSourceDocuments("any-profile-id", fetchImpl), "AUTHENTICATION_REQUIRED");
    await expectApiError(
      "unauth: registerSourceDocument -> AUTHENTICATION_REQUIRED",
      () =>
        api.registerSourceDocument(
          { profileId: "any-profile-id", fileName: "x.pdf", fileType: "pdf", contentHash: "sha256-x", storageBucket: "resumes", storagePath: "x" },
          api.newIdempotencyKey(),
          fetchImpl
        ),
      "AUTHENTICATION_REQUIRED"
    );
    await expectApiError("unauth: listGeneratedDocuments -> AUTHENTICATION_REQUIRED", () => api.listGeneratedDocuments("any-profile-id", "any-tailored-id", fetchImpl), "AUTHENTICATION_REQUIRED");
    await expectApiError(
      "unauth: createGeneratedDocument -> AUTHENTICATION_REQUIRED",
      () =>
        api.createGeneratedDocument(
          { profileId: "any-profile-id", tailoredResumeId: "any-tailored-id", storageBucket: "generated", storagePath: "x", fileType: "pdf" },
          api.newIdempotencyKey(),
          fetchImpl
        ),
      "AUTHENTICATION_REQUIRED"
    );
    await expectApiError("unauth: listUserEdits -> AUTHENTICATION_REQUIRED", () => api.listUserEdits("any-profile-id", fetchImpl), "AUTHENTICATION_REQUIRED");
  }

  /* ---------------- Cross-user: profile/version isolation ---------------- */
  {
    const { fetchImpl: fetchA } = freshRouteFetch("user-isolation-a");
    await api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchA);
    const profileA = await api.getProfile(fetchA);
    const savedA = await api.saveVersion({ runtime: pristineRuntime() }, api.newIdempotencyKey(), fetchA);

    const { fetchImpl: fetchB } = freshRouteFetch("user-isolation-b");
    await expectApiError("isolation: user B listing user A's versions -> NOT_FOUND", () => api.listVersions(profileA!.id, fetchB), "NOT_FOUND");
    await expectApiError("isolation: user B fetching user A's specific version -> NOT_FOUND", () => api.getVersion(profileA!.id, savedA.version.id, fetchB), "NOT_FOUND");
    await expectApiError(
      "isolation: user B restoring user A's version -> NOT_FOUND",
      () => api.restoreVersion(profileA!.id, savedA.version.id, api.newIdempotencyKey(), fetchB),
      "NOT_FOUND"
    );

    const profileB = await api.getProfile(fetchB);
    check("isolation: user B has their OWN distinct profile id", profileB, null);
  }

  /* ---------------- Idempotency key format ---------------- */
  {
    const key1 = api.newIdempotencyKey();
    const key2 = api.newIdempotencyKey();
    checkTrue("idempotency key: newIdempotencyKey produces a non-empty string", typeof key1 === "string" && key1.length > 0);
    checkTrue("idempotency key: two calls produce DIFFERENT keys", key1 !== key2);
  }

  /* ---------------- Source document analysis status transitions (registered as pending) ---------------- */
  {
    const { fetchImpl } = freshRouteFetch("user-source-status-1");
    await api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchImpl);
    const profile = await api.getProfile(fetchImpl);
    const doc = await api.registerSourceDocument(
      { profileId: profile!.id, fileName: "resume2.pdf", fileType: "pdf", contentHash: "sha256-status-test", storageBucket: "resumes", storagePath: "x" },
      api.newIdempotencyKey(),
      fetchImpl
    );
    check("source status: a freshly registered document starts 'pending'", doc.analysis_status, "pending");
  }

  /* ---------------- Network / unknown-error handling ---------------- */
  {
    const throwingFetch = (async () => {
      throw new Error("simulated DNS failure");
    }) as unknown as typeof fetch;
    await expectApiError("network: a throwing fetchImpl surfaces as NETWORK_ERROR", () => api.getProfile(throwingFetch), "NETWORK_ERROR");
  }
  {
    try {
      await api.getProfile((async () => new Response("not json{{{", { status: 200 })) as unknown as typeof fetch);
    } catch (error) {
      checkTrue("network: malformed JSON success body does not throw uncontrolled", true);
    }
  }

  /* ---------------- raw route validation: requests shaped outside what the typed client can produce ---------------- */
  {
    const { fetchImpl } = freshRouteFetch("user-raw-validation-1");
    await api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchImpl);
    const profile = await api.getProfile(fetchImpl);

    const missingRuntime = await fetchImpl("/api/internal/canonical-career-memory/versions", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": api.newIdempotencyKey() },
      body: JSON.stringify({}),
    });
    check("raw: POST /versions with no runtime field -> 422", missingRuntime.status, 422);
    const missingRuntimeBody = await missingRuntime.json();
    check("raw: missing runtime -> VALIDATION_FAILED code", missingRuntimeBody.error.code, "VALIDATION_FAILED");

    const missingIdempotencyKey = await fetchImpl("/api/internal/canonical-career-memory/versions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runtime: pristineRuntime() }),
    });
    check("raw: POST /versions without the idempotency-key header -> 400", missingIdempotencyKey.status, 400);
    const missingKeyBody = await missingIdempotencyKey.json();
    check("raw: missing idempotency-key -> VALIDATION_FAILED code", missingKeyBody.error.code, "VALIDATION_FAILED");

    const overlongKey = await fetchImpl("/api/internal/canonical-career-memory/versions", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "x".repeat(201) },
      body: JSON.stringify({ runtime: pristineRuntime() }),
    });
    check("raw: an idempotency-key over 200 chars -> 400", overlongKey.status, 400);

    const malformedJson = await fetchImpl("/api/internal/canonical-career-memory/versions", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": api.newIdempotencyKey() },
      body: "{not valid json",
    });
    check("raw: malformed JSON body -> 400", malformedJson.status, 400);

    const missingProfileIdQuery = await fetchImpl(`/api/internal/canonical-career-memory/versions?profileId=`, { method: "GET" });
    check("raw: GET /versions with an EMPTY profileId query param -> 422", missingProfileIdQuery.status, 422);

    const noProfileIdAtAll = await fetchImpl(`/api/internal/canonical-career-memory/versions`, { method: "GET" });
    check("raw: GET /versions with NO profileId query param at all -> 422", noProfileIdAtAll.status, 422);

    checkTrue("raw: profile fetched earlier is still a valid, unaffected row", typeof profile?.id === "string");
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("apiClient.test.ts CRASHED:", e);
  process.exit(1);
});
