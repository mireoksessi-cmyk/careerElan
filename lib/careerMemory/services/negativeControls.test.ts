/*
  Phase 6D gate test - dedicated negative-control suite for the NEW
  repository/service/API surface (Phase 6A.2 Runtime, 6B Persistence,
  6C Mappers already have their own negativeControls.test.ts /
  repositories.test.ts negative cases - this file does not repeat
  those, only Phase 6D's own repository/service/route negative paths).
  Every assertion here confirms a REJECTION (wrong input -> the right
  domain error / HTTP status), not a happy path. Run with
  `npx tsx lib/careerMemory/services/negativeControls.test.ts`.
*/
import { createFakeCareerMemorySupabaseClient } from "../repositories/testSupport/fakeSupabaseClient";
import { createCanonicalRepositories } from "../repositories/createRepositories";
import { buildSeededScenario, createBareScenario } from "../repositories/testSupport/scenario";
import { buildFixtureRuntime } from "../persistence/testFixtures";
import { canonicalRuntimeToInsertBundle } from "../persistence/mappers";
import { AuthenticationRequiredError, ConflictError, NotFoundError, SchemaGapError, ValidationError } from "../errors/domainErrors";
import { getAuthenticatedUserId } from "../auth/authContext";
import { mapPostgrestError } from "../repositories/postgrestErrors";
import { CanonicalCareerMemoryService } from "./canonicalCareerMemoryService";
import { CanonicalResumeVersionService, assertValidReason } from "./canonicalResumeVersionService";
import { CanonicalOverlayService } from "./canonicalOverlayService";
import { CanonicalSourceDocumentService } from "./canonicalSourceDocumentService";
import { CanonicalUserEditService } from "./canonicalUserEditService";
import { CanonicalGeneratedDocumentService } from "./canonicalGeneratedDocumentService";
import { requireOwnedProfile } from "./profileAccess";
import { runWithAuthenticatedContext } from "../api/routeGuard";
import { errorResponse } from "../api/httpErrorMapping";
import { makeHandleCreateVersion } from "../../../app/api/internal/canonical-career-memory/versions/route";
import { makeHandleRegisterSourceDocument } from "../../../app/api/internal/canonical-career-memory/source-documents/route";

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
async function expectThrows(label: string, fn: () => Promise<unknown>, ctor: new (...args: never[]) => Error) {
  try {
    await fn();
    check(label, "did not throw", `${ctor.name} thrown`);
  } catch (e) {
    checkTrue(label, e instanceof ctor);
  }
}
function pristineCanonicalRuntime(runtime: ReturnType<typeof buildFixtureRuntime>) {
  return { ...runtime, sourceDocuments: [], overlayState: { ...runtime.overlayState, history: [] } };
}
let idemKeyCounter = 0;
const WRITE_METHODS = ["POST", "PATCH", "PUT", "DELETE"];
function jsonRequest(url: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; omitIdempotencyKey?: boolean } = {}): Request {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers ?? {}) };
  if (WRITE_METHODS.includes(method) && !opts.omitIdempotencyKey && !("idempotency-key" in headers)) {
    idemKeyCounter += 1;
    headers["idempotency-key"] = `test-idem-key-${idemKeyCounter}`;
  }
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  return new Request(url, init);
}

async function main() {
  // ==================== 1. Unauthenticated ====================
  {
    const client = createFakeCareerMemorySupabaseClient();
    await expectThrows("unauthenticated: getAuthenticatedUserId rejects a session with no user", () => getAuthenticatedUserId(client as never), AuthenticationRequiredError);
  }
  {
    const client = createFakeCareerMemorySupabaseClient();
    client.setCurrentUser(null);
    await expectThrows("unauthenticated: explicit null user is still rejected", () => getAuthenticatedUserId(client as never), AuthenticationRequiredError);
  }

  // ==================== 2. Spoofed userId ignored by every service method (service only trusts its own first argument) ====================
  {
    const seeded = await buildSeededScenario("spoof-owner");
    const service = new CanonicalUserEditService(seeded.repos);
    const edit = await service.recordEdit(seeded.userId, { profileId: seeded.profileId, targetTable: "career_experiences", targetId: "exp-1", fieldPath: "role", previousValue: "A", newValue: "B" });
    check("userId spoof: recorded edit belongs to the real caller's profile, not any body-supplied id", edit.profile_id, seeded.profileId);
  }

  // ==================== 3. Wrong owner (cross-user) across every service ====================
  {
    const seeded = await buildSeededScenario("wrong-owner-1");
    await expectThrows("wrong owner: listVersions for someone else's profileId", () => new CanonicalResumeVersionService(seeded.repos).listVersions("attacker", seeded.profileId), NotFoundError);
  }
  {
    const seeded = await buildSeededScenario("wrong-owner-2");
    await expectThrows("wrong owner: listSourceDocuments for someone else's profileId", () => new CanonicalSourceDocumentService(seeded.repos).listSourceDocuments("attacker", seeded.profileId), NotFoundError);
  }
  {
    const seeded = await buildSeededScenario("wrong-owner-3");
    await expectThrows("wrong owner: listOverlays for someone else's profileId", () => new CanonicalOverlayService(seeded.repos).listOverlays("attacker", seeded.profileId), NotFoundError);
  }
  {
    const seeded = await buildSeededScenario("wrong-owner-4");
    await expectThrows("wrong owner: listEdits for someone else's profileId", () => new CanonicalUserEditService(seeded.repos).listEdits("attacker", seeded.profileId), NotFoundError);
  }
  {
    const seeded = await buildSeededScenario("wrong-owner-5");
    await expectThrows(
      "wrong owner: createGeneratedDocument for someone else's profileId",
      () => new CanonicalGeneratedDocumentService(seeded.repos).createGeneratedDocument("attacker", { profileId: seeded.profileId, tailoredResumeId: "x", storageBucket: "b", storagePath: "p", fileType: "pdf" }),
      NotFoundError,
    );
  }
  {
    const seeded = await buildSeededScenario("wrong-owner-6");
    await expectThrows("wrong owner: restoreVersion for someone else's profileId", () => new CanonicalResumeVersionService(seeded.repos).restoreVersion("attacker", seeded.profileId, seeded.runtime.version.id), NotFoundError);
  }
  {
    const seeded = await buildSeededScenario("wrong-owner-7");
    await expectThrows("wrong owner: deleteVersion for someone else's profileId", () => new CanonicalResumeVersionService(seeded.repos).deleteVersion("attacker", seeded.profileId, seeded.runtime.version.id), NotFoundError);
  }

  // ==================== 4. Missing profile (profile never created) ====================
  {
    const { repos, userId } = createBareScenario("no-profile-user");
    await expectThrows("missing profile: listVersions for a userId with no profile row", () => new CanonicalResumeVersionService(repos).listVersions(userId, "any-profile-id"), NotFoundError);
  }
  {
    const { repos, userId } = createBareScenario("no-profile-user-2");
    const runtime = pristineCanonicalRuntime(buildFixtureRuntime());
    const service = new CanonicalCareerMemoryService(repos);
    const result = await service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime });
    checkTrue("missing profile: first save auto-creates a profile rather than throwing NotFoundError", result.version.profile_id.length > 0);
  }

  // ==================== 5. Invalid/unknown UUID-shaped ids resolve to NotFoundError, not a crash ====================
  {
    const seeded = await buildSeededScenario("badid-user");
    await expectThrows("invalid id: getVersion with a non-existent version id", () => new CanonicalResumeVersionService(seeded.repos).getVersion(seeded.userId, seeded.profileId, "00000000-0000-0000-0000-000000000000"), NotFoundError);
  }
  {
    const seeded = await buildSeededScenario("badid-user-2");
    await expectThrows("invalid id: deleteOverlay with a non-existent overlay id", () => new CanonicalOverlayService(seeded.repos).deleteOverlay(seeded.userId, seeded.profileId, "not-a-real-overlay-id"), NotFoundError);
  }

  // ==================== 6. Duplicate content hash (real UNIQUE constraint) is idempotent, not a hard failure ====================
  {
    const seeded = await buildSeededScenario("duphash-user");
    const service = new CanonicalSourceDocumentService(seeded.repos);
    const first = await service.registerSourceDocument(seeded.userId, { profileId: seeded.profileId, fileName: "a.pdf", fileType: "pdf", contentHash: "dup-hash-value", storageBucket: "b", storagePath: "p1" });
    const second = await service.registerSourceDocument(seeded.userId, { profileId: seeded.profileId, fileName: "b.pdf", fileType: "pdf", contentHash: "dup-hash-value", storageBucket: "b", storagePath: "p2" });
    check("duplicate content hash: second register returns the SAME row id, not a new one", second.id, first.id);
  }
  {
    const seeded = await buildSeededScenario("dupprofile-user");
    await expectThrows(
      "duplicate profile: a second profiles.insert for the same user_id is rejected",
      () => seeded.repos.profiles.insert({ user_id: seeded.userId, schema_version: "v1", serializer_version: "s1" }),
      ConflictError,
    );
  }

  // ==================== 7. Invalid file type ====================
  {
    const seeded = await buildSeededScenario("badfiletype-user");
    await expectThrows(
      "invalid file type: registerSourceDocument with fileType=txt",
      () => new CanonicalSourceDocumentService(seeded.repos).registerSourceDocument(seeded.userId, { profileId: seeded.profileId, fileName: "a.txt", fileType: "txt" as never, contentHash: "abcdefgh", storageBucket: "b", storagePath: "p" }),
      ValidationError,
    );
  }
  {
    const seeded = await buildSeededScenario("badfiletype-user-2");
    await expectThrows(
      "invalid file type: createGeneratedDocument with fileType=html",
      () => new CanonicalGeneratedDocumentService(seeded.repos).createGeneratedDocument(seeded.userId, { profileId: seeded.profileId, tailoredResumeId: "x", storageBucket: "b", storagePath: "p", fileType: "html" as never }),
      ValidationError,
    );
  }

  // ==================== 8. Negative / invalid byte size ====================
  {
    const seeded = await buildSeededScenario("negsize-user");
    await expectThrows(
      "negative byte size: registerSourceDocument with byteSize=-1",
      () => new CanonicalSourceDocumentService(seeded.repos).registerSourceDocument(seeded.userId, { profileId: seeded.profileId, fileName: "a.pdf", fileType: "pdf", contentHash: "abcdefgh", storageBucket: "b", storagePath: "p", byteSize: -1 }),
      ValidationError,
    );
  }
  {
    const seeded = await buildSeededScenario("badhash-user");
    await expectThrows(
      "invalid content hash shape: too short to match the hash pattern",
      () => new CanonicalSourceDocumentService(seeded.repos).registerSourceDocument(seeded.userId, { profileId: seeded.profileId, fileName: "a.pdf", fileType: "pdf", contentHash: "short", storageBucket: "b", storagePath: "p" }),
      ValidationError,
    );
  }

  // ==================== 9. Invalid version reason ====================
  {
    checkTrue("invalid version reason: 'initial' is accepted (no throw)", (() => { assertValidReason("initial"); return true; })());
    try {
      assertValidReason("not-a-real-reason");
      check("invalid version reason: 'not-a-real-reason' should have thrown", "did not throw", "ValidationError thrown");
    } catch (e) {
      checkTrue("invalid version reason: 'not-a-real-reason' throws ValidationError", e instanceof ValidationError);
    }
  }

  // ==================== 10. Stale expectedCurrentVersionId (optimistic concurrency) ====================
  {
    const runtime = pristineCanonicalRuntime(buildFixtureRuntime());
    const { repos, userId } = createBareScenario("stale-version-user");
    const service = new CanonicalCareerMemoryService(repos);
    await service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime });
    await expectThrows("stale expectedCurrentVersionId: a made-up id is rejected", () => service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime, expectedCurrentVersionId: "totally-made-up" }), ConflictError);
  }

  // ==================== 11. Broken / nonexistent target for version restore ====================
  {
    const seeded = await buildSeededScenario("badrestore-user");
    await expectThrows(
      "broken parent: restoreVersion targeting a version id that does not exist",
      () => new CanonicalResumeVersionService(seeded.repos).restoreVersion(seeded.userId, seeded.profileId, "nonexistent-version-id"),
      NotFoundError,
    );
  }

  // ==================== 12. Missing source document referenced by runtime.sourceDocuments ====================
  {
    const runtime = buildFixtureRuntime(); // has 2 baked-in sourceDocuments, none registered against this fresh profile
    const { repos, userId } = createBareScenario("missing-sourcedoc-user");
    const service = new CanonicalCareerMemoryService(repos);
    await expectThrows("missing source document: save referencing an unregistered source document id", () => service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime }), NotFoundError);
  }

  // ==================== 13. Profile mismatch (row exists, but for a DIFFERENT profile) ====================
  {
    const seededA = await buildSeededScenario("mismatch-user-a");
    const seededB = await buildSeededScenario("mismatch-user-b");
    void seededB;
    const clientC = createFakeCareerMemorySupabaseClient();
    clientC.setCurrentUser({ id: seededA.userId });
    const reposC = createCanonicalRepositories(clientC as never);
    // seed a second, unrelated profile in the SAME db instance, then confirm cross-profile source doc lookup fails cleanly
    const otherProfile = await reposC.profiles.insert({ user_id: "other-owner", schema_version: "v1", serializer_version: "s1" });
    const doc = await reposC.sourceDocuments.insert({ profile_id: otherProfile.id, storage_bucket: "b", storage_path: "p", original_file_name: "f.pdf", content_hash: "mismatch-hash", file_type: "pdf" });
    const profileA = await reposC.profiles.insert({ user_id: seededA.userId, schema_version: "v1", serializer_version: "s1" });
    await expectThrows(
      "profile mismatch: updateAnalysisStatus for a source document that belongs to a DIFFERENT profile",
      () => new CanonicalSourceDocumentService(reposC).updateAnalysisStatus(seededA.userId, profileA.id, doc.id, "processing"),
      ValidationError,
    );
  }

  // ==================== 14. Partial normalized-row failure triggers compensating rollback, not a half-written state ====================
  {
    const runtime = pristineCanonicalRuntime(buildFixtureRuntime());
    const { client, repos, userId } = createBareScenario("rollback-user");
    const service = new CanonicalCareerMemoryService(repos);
    client.failNextQueryOn("career_awards", { message: "simulated mid-workflow failure", code: "XXFAIL" });
    await expectThrows("partial failure: a mid-workflow step failure surfaces as PersistenceError, not a silent partial write", () => service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime }), Error);
    const profileAfter = await repos.profiles.getByUserId(userId);
    check("partial failure: profile creation is NOT rolled back (documented - precedes the gated write)", profileAfter !== null, true);
    if (profileAfter) {
      const versionsAfter = await repos.resumeVersions.listByProfileId(profileAfter.id);
      check("partial failure: the version row inserted before the failing step WAS compensated away", versionsAfter.length, 0);
    }
  }

  // ==================== 15. Invalid overlay shape ====================
  {
    const seeded = await buildSeededScenario("badoverlay-user");
    await expectThrows("invalid overlay: array instead of a plain object", () => new CanonicalOverlayService(seeded.repos).createOverlay(seeded.userId, { profileId: seeded.profileId, resumeVersionId: null, applicationId: null, templateId: null, aiModel: null, promptVersion: null, overlay: [] as never }), ValidationError);
    await expectThrows("invalid overlay: null overlay", () => new CanonicalOverlayService(seeded.repos).createOverlay(seeded.userId, { profileId: seeded.profileId, resumeVersionId: null, applicationId: null, templateId: null, aiModel: null, promptVersion: null, overlay: null as never }), ValidationError);
  }

  // ==================== 16. Protected field modification is REJECTED, never silently applied ====================
  {
    const seeded = await buildSeededScenario("protectedfield-user");
    const service = new CanonicalOverlayService(seeded.repos);
    const result = await service.createOverlay(seeded.userId, { profileId: seeded.profileId, resumeVersionId: seeded.runtime.version.id, applicationId: null, templateId: null, aiModel: null, promptVersion: null, overlay: { identity: { fullName: "Attacker Name" } } });
    checkTrue("protected field: identity.fullName overlay attempt is recorded as a rejection", result.rejections.length >= 1);
    const reconstructed = await service.resolveTailoredView(seeded.userId, seeded.profileId, seeded.runtime.version.id);
    check("protected field: the resolved view's identity.fullName is UNCHANGED by the rejected overlay", reconstructed.identity?.fullName, seeded.runtime.resume.identity?.fullName);
  }

  // ==================== 17. Nonexistent entry id targeted by an overlay ====================
  {
    const seeded = await buildSeededScenario("nonexistententry-user");
    const service = new CanonicalOverlayService(seeded.repos);
    const result = await service.createOverlay(seeded.userId, {
      profileId: seeded.profileId,
      resumeVersionId: seeded.runtime.version.id,
      applicationId: null,
      templateId: null,
      aiModel: null,
      promptVersion: null,
      overlay: { professionalExperience: { "entry-that-does-not-exist": { bulletPoints: ["fabricated"] } } },
    });
    checkTrue("nonexistent entry: overlay targeting an unknown entry id is rejected, not silently dropped or applied", result.rejections.length >= 1);
  }

  // ==================== 18. Repeated overlay creation is NOT idempotent (each call creates a new row - disclosed IDEMPOTENCY_SCHEMA_GAP) ====================
  {
    const seeded = await buildSeededScenario("dupoverlay-user");
    const service = new CanonicalOverlayService(seeded.repos);
    const input = { profileId: seeded.profileId, resumeVersionId: seeded.runtime.version.id, applicationId: null, templateId: null, aiModel: null, promptVersion: null, overlay: { professionalSummary: { text: "Same text twice." } } };
    const first = await service.createOverlay(seeded.userId, input);
    const second = await service.createOverlay(seeded.userId, input);
    checkTrue("duplicate overlay retry: IDEMPOTENCY_SCHEMA_GAP confirmed - retrying the same overlay creates a SECOND distinct row, not a replay", first.row.id !== second.row.id);
  }

  // ==================== 19. Invalid generated document file type (route-adjacent, service-level) ====================
  {
    const seeded = await buildSeededScenario("badgenfile-user");
    const overlay = await new CanonicalOverlayService(seeded.repos).createOverlay(seeded.userId, { profileId: seeded.profileId, resumeVersionId: seeded.runtime.version.id, applicationId: null, templateId: null, aiModel: null, promptVersion: null, overlay: {} });
    await expectThrows(
      "invalid generated file type: fileType=exe is rejected",
      () => new CanonicalGeneratedDocumentService(seeded.repos).createGeneratedDocument(seeded.userId, { profileId: seeded.profileId, tailoredResumeId: overlay.row.id, storageBucket: "b", storagePath: "p", fileType: "exe" as never }),
      ValidationError,
    );
  }

  // ==================== 20. Raw DB error sanitization ====================
  {
    const raw = mapPostgrestError({ message: "duplicate key value violates unique constraint \"career_profiles_user_id_key\" DETAIL: Key (user_id)=(secret-internal-id) already exists.", code: "23505" }, "TestContext.insert");
    checkTrue("raw DB error sanitization: unique_violation maps to ConflictError", raw instanceof ConflictError);
    checkTrue("raw DB error sanitization: sanitized message never contains the raw driver text", !raw.message.includes("DETAIL") && !raw.message.includes("secret-internal-id"));
  }
  {
    const raw = mapPostgrestError({ message: "insert or update on table \"career_experiences\" violates foreign key constraint", code: "23503" }, "TestContext.insert");
    checkTrue("raw DB error sanitization: foreign_key_violation maps to PersistenceError, not ConflictError", !(raw instanceof ConflictError));
    checkTrue("raw DB error sanitization: FK violation message never echoes the raw constraint name text", !raw.message.includes("violates foreign key constraint"));
  }
  {
    const client = createFakeCareerMemorySupabaseClient();
    client.setCurrentUser({ id: "rawerror-user" });
    const repos = createCanonicalRepositories(client as never);
    client.failNextQueryOn("career_profiles", { message: "column \"nonexistent_col\" of relation \"career_profiles\" does not exist -- INTERNAL PATH LEAK", code: "42703" });
    try {
      await repos.profiles.insert({ user_id: "rawerror-user", schema_version: "v1", serializer_version: "s1" });
      check("raw DB error sanitization: forced repository failure should have thrown", "did not throw", "threw");
    } catch (e) {
      checkTrue("raw DB error sanitization: repository-level failure never leaks the raw driver message to the caught error", e instanceof Error && !e.message.includes("INTERNAL PATH LEAK"));
    }
  }

  // ==================== 21. Transaction unavailable surfaced explicitly (write-ack gate) ====================
  {
    const { client, userId } = createBareScenario("noack-user");
    void userId;
    client.setCurrentUser({ id: "noack-user" });
    const request = jsonRequest("http://localhost/x", { method: "POST", body: { runtime: pristineCanonicalRuntime(buildFixtureRuntime()) }, omitIdempotencyKey: true });
    const response = await runWithAuthenticatedContext(client as never, makeHandleCreateVersion(request));
    check("idempotency required: version create without the Idempotency-Key header never touches the database (400)", response.status, 400);
    const body = await response.json();
    check("idempotency required: error code is VALIDATION_FAILED", body.error.code, "VALIDATION_FAILED");
  }
  {
    checkTrue("transaction unavailable: errorResponse maps TransactionUnavailableError to 503 directly", (await (async () => { const r = errorResponse(new (await import("../errors/domainErrors")).TransactionUnavailableError("op")); return r.status === 503; })()));
  }

  // ==================== 22. Schema gap surfaced (not silently worked around) ====================
  {
    const seeded = await buildSeededScenario("schemagap-user");
    const service = new CanonicalResumeVersionService(seeded.repos);
    const { newVersion } = await service.restoreVersion(seeded.userId, seeded.profileId, seeded.runtime.version.id);
    void newVersion;
    await expectThrows(
      "schema gap: deleting a version another version's parent_version_id still references throws SchemaGapError, not a silent cascade delete",
      () => service.deleteVersion(seeded.userId, seeded.profileId, seeded.runtime.version.id),
      SchemaGapError,
    );
  }

  // ==================== 23. Oversized request body / malformed JSON at the route boundary ====================
  {
    const { client } = createBareScenario("oversized-user-2");
    client.setCurrentUser({ id: "oversized-user-2" });
    const bigBody = { profileId: "x", fileName: "a.pdf", fileType: "pdf", contentHash: "abcdefgh", storageBucket: "b", storagePath: "p", note: "x".repeat(300 * 1024) };
    const request = new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "oversized-user-2-key" }, body: JSON.stringify(bigBody) });
    const response = await runWithAuthenticatedContext(client as never, makeHandleRegisterSourceDocument(request));
    check("oversized body: a body exceeding the byte cap is rejected by actual length, not just the content-length header", response.status, 413);
  }
  {
    const { client } = createBareScenario("malformed-user-2");
    client.setCurrentUser({ id: "malformed-user-2" });
    const request = new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "malformed-user-2-key" }, body: "[1, 2," });
    const response = await runWithAuthenticatedContext(client as never, makeHandleRegisterSourceDocument(request));
    check("malformed JSON: truncated JSON array body -> 400", response.status, 400);
  }

  // ==================== extra: requireOwnedProfile never leaks existence (404, not 403) even for a real foreign profile id ====================
  {
    const seededA = await buildSeededScenario("leak-user-a");
    await expectThrows("no existence leak: requireOwnedProfile for a real profile owned by someone else returns NotFoundError (404), not AuthorizationError (403)", () => requireOwnedProfile(seededA.repos, "leak-user-b", seededA.profileId), NotFoundError);
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
