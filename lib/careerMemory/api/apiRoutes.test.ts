/*
  Phase 6D gate test - exercises the actual route handler exports
  (makeHandleX / handleX) from app/api/internal/canonical-career-memory/**
  via routeGuard.runWithAuthenticatedContext() + a FakeSupabaseClient,
  the SAME auth/error-mapping code path a real request goes through,
  without a real Next.js request/cookie context (see routeGuard.ts's
  own header comment). Covers categories 16-20 (auth required,
  ownership, userId spoof rejection, cross-user access, status code
  mapping) and 29 (route handler tests). Category 30 (no production
  call-site imports) is a static grep check, not expressible as a
  runtime assertion - verified separately before commit.

  Run with `npx tsx lib/careerMemory/api/apiRoutes.test.ts`.
*/
import { createFakeCareerMemorySupabaseClient } from "../repositories/testSupport/fakeSupabaseClient";
import { createCanonicalRepositories } from "../repositories/createRepositories";
import { runWithAuthenticatedContext } from "./routeGuard";
import { errorResponse } from "./httpErrorMapping";
import { AuthenticationRequiredError, AuthorizationError, ConflictError, NotFoundError, PersistenceError, SchemaGapError, TransactionUnavailableError, ValidationError } from "../errors/domainErrors";
import { canonicalRuntimeToInsertBundle } from "../persistence/mappers";
import { buildFixtureRuntime } from "../persistence/testFixtures";

import { handleGetProfile, makeHandleCreateProfile } from "../../../app/api/internal/canonical-career-memory/profile/route";
import { makeHandleListVersions, makeHandleCreateVersion, WRITE_ACK_HEADER, WRITE_ACK_VALUE } from "../../../app/api/internal/canonical-career-memory/versions/route";
import { makeHandleGetVersion } from "../../../app/api/internal/canonical-career-memory/versions/[id]/route";
import { makeHandleRestoreVersion } from "../../../app/api/internal/canonical-career-memory/versions/[id]/restore/route";
import { makeHandleListSourceDocuments, makeHandleRegisterSourceDocument } from "../../../app/api/internal/canonical-career-memory/source-documents/route";
import { makeHandleUpdateAnalysisStatus } from "../../../app/api/internal/canonical-career-memory/source-documents/[id]/status/route";
import { makeHandleListOverlays, makeHandleCreateOverlay } from "../../../app/api/internal/canonical-career-memory/overlays/route";
import { makeHandleDeleteOverlay } from "../../../app/api/internal/canonical-career-memory/overlays/[id]/route";
import { makeHandleListUserEdits, makeHandleRecordUserEdit } from "../../../app/api/internal/canonical-career-memory/user-edits/route";
import { makeHandleListGeneratedDocuments, makeHandleCreateGeneratedDocument } from "../../../app/api/internal/canonical-career-memory/generated-documents/route";

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

function pristineCanonicalRuntime(runtime: ReturnType<typeof buildFixtureRuntime>) {
  return { ...runtime, sourceDocuments: [], overlayState: { ...runtime.overlayState, history: [] } };
}

function jsonRequest(url: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Request {
  const init: RequestInit = { method: opts.method ?? "GET", headers: { "content-type": "application/json", ...(opts.headers ?? {}) } };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  return new Request(url, init);
}

async function freshClient(userId?: string) {
  const client = createFakeCareerMemorySupabaseClient();
  if (userId) client.setCurrentUser({ id: userId });
  const repos = createCanonicalRepositories(client as never);
  return { client, repos };
}

async function seedProfileWithVersion(userId: string) {
  const { client, repos } = await freshClient(userId);
  const runtime = pristineCanonicalRuntime(buildFixtureRuntime());
  const profile = await repos.profiles.insert({ user_id: userId, schema_version: runtime.metadata.schemaVersion, serializer_version: runtime.metadata.serializerVersion });
  const insertBundle = canonicalRuntimeToInsertBundle(userId, profile.id, runtime);
  const version = await repos.resumeVersions.insert(insertBundle.resumeVersion);
  await repos.experiences.replaceForProfile(profile.id, insertBundle.experiences);
  return { client, repos, profileId: profile.id, versionId: version.id, runtime };
}

async function main() {
  // ==================== 16. Auth required (401) ====================
  {
    const { client } = await freshClient(); // no setCurrentUser -> unauthenticated
    const response = await runWithAuthenticatedContext(client as never, handleGetProfile);
    check("auth required: GET profile unauthenticated -> 401", response.status, 401);
    const body = await response.json();
    check("auth required: 401 body carries AUTHENTICATION_REQUIRED code", body.error.code, "AUTHENTICATION_REQUIRED");
  }
  {
    const { client } = await freshClient();
    const request = jsonRequest("http://localhost/api/internal/canonical-career-memory/versions?profileId=whatever");
    const response = await runWithAuthenticatedContext(client as never, makeHandleListVersions(request));
    check("auth required: GET versions unauthenticated -> 401", response.status, 401);
  }
  {
    const { client } = await freshClient();
    const request = jsonRequest("http://localhost/api/internal/canonical-career-memory/overlays/some-id?profileId=whatever", { method: "DELETE" });
    const response = await runWithAuthenticatedContext(client as never, makeHandleDeleteOverlay(request, "some-id"));
    check("auth required: DELETE overlay unauthenticated -> 401", response.status, 401);
  }

  // ==================== 17/19. Ownership + cross-user access (404, never leaks existence) ====================
  {
    const seeded = await seedProfileWithVersion("owner-user");
    const { repos: attackerRepos } = await freshClient("attacker-user");
    // attacker calls through their OWN repos (same fake DB instance would be needed for a real
    // cross-user attempt; use the seeded client directly with a DIFFERENT authenticated userId
    // to simulate a session mismatch against someone else's profileId - the realistic attack shape).
    void attackerRepos;

    const request = jsonRequest(`http://localhost/api/internal/canonical-career-memory/versions?profileId=${seeded.profileId}`);
    const response = await runWithAuthenticatedContext(seeded.client as never, async (ctx) => makeHandleListVersions(request)({ ...ctx, userId: "attacker-user" }));
    check("cross-user: listing another user's versions by profileId -> 404 (not 403, no existence leak)", response.status, 404);
  }
  {
    const seeded = await seedProfileWithVersion("owner-user-2");
    const request = jsonRequest(`http://localhost/api/internal/canonical-career-memory/versions/${seeded.versionId}?profileId=${seeded.profileId}`);
    const response = await runWithAuthenticatedContext(seeded.client as never, async (ctx) => makeHandleGetVersion(request, seeded.versionId)({ ...ctx, userId: "attacker-user-2" }));
    check("cross-user: getting another user's version -> 404", response.status, 404);
  }
  {
    const seeded = await seedProfileWithVersion("owner-user-3");
    const request = jsonRequest(`http://localhost/api/internal/canonical-career-memory/source-documents?profileId=${seeded.profileId}`);
    const response = await runWithAuthenticatedContext(seeded.client as never, async (ctx) => makeHandleListSourceDocuments(request)({ ...ctx, userId: "attacker-user-3" }));
    check("cross-user: listing another user's source documents -> 404", response.status, 404);
  }
  {
    const seeded = await seedProfileWithVersion("owner-user-4");
    const request = jsonRequest(`http://localhost/api/internal/canonical-career-memory/overlays?profileId=${seeded.profileId}`);
    const response = await runWithAuthenticatedContext(seeded.client as never, async (ctx) => makeHandleListOverlays(request)({ ...ctx, userId: "attacker-user-4" }));
    check("cross-user: listing another user's overlays -> 404", response.status, 404);
  }
  {
    const seeded = await seedProfileWithVersion("owner-user-5");
    const request = jsonRequest(`http://localhost/api/internal/canonical-career-memory/user-edits?profileId=${seeded.profileId}`);
    const response = await runWithAuthenticatedContext(seeded.client as never, async (ctx) => makeHandleListUserEdits(request)({ ...ctx, userId: "attacker-user-5" }));
    check("cross-user: listing another user's user-edits -> 404", response.status, 404);
  }
  {
    const seeded = await seedProfileWithVersion("owner-user-6");
    const request = jsonRequest(`http://localhost/api/internal/canonical-career-memory/generated-documents?profileId=${seeded.profileId}&tailoredResumeId=whatever`);
    const response = await runWithAuthenticatedContext(seeded.client as never, async (ctx) => makeHandleListGeneratedDocuments(request)({ ...ctx, userId: "attacker-user-6" }));
    check("cross-user: listing another user's generated documents -> 404", response.status, 404);
  }
  {
    const seeded = await seedProfileWithVersion("owner-user-7");
    const request = jsonRequest(`http://localhost/api/internal/canonical-career-memory/versions/${seeded.versionId}/restore`, { method: "POST", body: { profileId: seeded.profileId } });
    const response = await runWithAuthenticatedContext(seeded.client as never, async (ctx) => makeHandleRestoreVersion(request, seeded.versionId)({ ...ctx, userId: "attacker-user-7" }));
    check("cross-user: restoring another user's version -> 404", response.status, 404);
  }
  {
    const seeded = await seedProfileWithVersion("owner-user-8");
    const request = jsonRequest(`http://localhost/api/internal/canonical-career-memory/overlays/nonexistent?profileId=${seeded.profileId}`, { method: "DELETE" });
    const response = await runWithAuthenticatedContext(seeded.client as never, async (ctx) => makeHandleDeleteOverlay(request, "nonexistent")({ ...ctx, userId: "attacker-user-8" }));
    check("cross-user: deleting another user's overlay -> 404", response.status, 404);
  }

  // ==================== 18. userId/user_id spoof rejection ====================
  {
    const { client } = await freshClient("real-user-1");
    const request = jsonRequest("http://localhost/api/internal/canonical-career-memory/profile", { method: "POST", body: { schemaVersion: "v1", serializerVersion: "s1", userId: "spoofed-user-id", user_id: "spoofed-user-id" } });
    const response = await runWithAuthenticatedContext(client as never, makeHandleCreateProfile(request));
    check("userId spoof: create profile ignores body userId/user_id -> 201", response.status, 201);
    const body = await response.json();
    check("userId spoof: created profile.user_id is the SESSION user, not the spoofed body value", body.profile.user_id, "real-user-1");
  }
  {
    const seeded = await seedProfileWithVersion("real-user-2");
    const request = jsonRequest("http://localhost/api/internal/canonical-career-memory/user-edits", {
      method: "POST",
      body: { profileId: seeded.profileId, targetTable: "career_experiences", targetId: "exp-1", fieldPath: "role", previousValue: "A", newValue: "B", userId: "spoofed", user_id: "spoofed" },
    });
    const response = await runWithAuthenticatedContext(seeded.client as never, makeHandleRecordUserEdit(request));
    check("userId spoof: record user-edit ignores body userId/user_id -> 201", response.status, 201);
  }

  // ==================== 20. Status code mapping ====================
  {
    check("status mapping: AuthenticationRequiredError -> 401", errorResponse(new AuthenticationRequiredError()).status, 401);
    check("status mapping: AuthorizationError -> 403", errorResponse(new AuthorizationError()).status, 403);
    check("status mapping: NotFoundError -> 404", errorResponse(new NotFoundError("Thing")).status, 404);
    check("status mapping: ValidationError -> 422", errorResponse(new ValidationError(["bad"])).status, 422);
    check("status mapping: ConflictError -> 409", errorResponse(new ConflictError("conflict")).status, 409);
    check("status mapping: PersistenceError -> 500", errorResponse(new PersistenceError("detail")).status, 500);
    check("status mapping: TransactionUnavailableError -> 503", errorResponse(new TransactionUnavailableError("op")).status, 503);
    check("status mapping: SchemaGapError -> 501", errorResponse(new SchemaGapError("GAP", "detail")).status, 501);
    check("status mapping: unrecognized raw Error -> 500, no raw message leaked", errorResponse(new Error("raw stack-bearing message")).status, 500);
    const rawBody = await errorResponse(new Error("raw stack-bearing message")).json();
    check("status mapping: raw Error body never echoes the original message", rawBody.error.message.includes("stack-bearing"), false);
  }
  {
    // reachable-via-route mappings
    const request400 = new Request("http://localhost/api/internal/canonical-career-memory/profile", { method: "POST", headers: { "content-type": "application/json" }, body: "{not valid json" });
    const { client } = await freshClient("json-user");
    const response400 = await runWithAuthenticatedContext(client as never, makeHandleCreateProfile(request400));
    check("status mapping: malformed JSON body -> 400", response400.status, 400);

    const requestOversized = new Request("http://localhost/api/internal/canonical-career-memory/profile", { method: "POST", headers: { "content-type": "application/json", "content-length": String(300 * 1024) } });
    const responseOversized = await runWithAuthenticatedContext(client as never, makeHandleCreateProfile(requestOversized));
    check("status mapping: oversized body (content-length header) -> 413", responseOversized.status, 413);

    const requestNoProfileId = jsonRequest("http://localhost/api/internal/canonical-career-memory/versions");
    const response422 = await runWithAuthenticatedContext(client as never, makeHandleListVersions(requestNoProfileId));
    check("status mapping: missing required query param -> 422", response422.status, 422);

    const requestNoAck = jsonRequest("http://localhost/api/internal/canonical-career-memory/versions", { method: "POST", body: { runtime: {} } });
    const response503 = await runWithAuthenticatedContext(client as never, makeHandleCreateVersion(requestNoAck));
    check("status mapping: version create without write-ack header -> 503", response503.status, 503);

    const seededDup = await seedProfileWithVersion("dup-user");
    const dupRequest = jsonRequest("http://localhost/api/internal/canonical-career-memory/source-documents", {
      method: "POST",
      body: { profileId: seededDup.profileId, fileName: "resume.pdf", fileType: "pdf", contentHash: "same-hash-value", storageBucket: "b", storagePath: "p1" },
    });
    await runWithAuthenticatedContext(seededDup.client as never, makeHandleRegisterSourceDocument(dupRequest));
    const dupRequest2 = jsonRequest("http://localhost/api/internal/canonical-career-memory/source-documents", {
      method: "POST",
      body: { profileId: seededDup.profileId, fileName: "resume2.pdf", fileType: "pdf", contentHash: "same-hash-value", storageBucket: "b", storagePath: "p2" },
    });
    const responseDup = await runWithAuthenticatedContext(seededDup.client as never, makeHandleRegisterSourceDocument(dupRequest2));
    check("status mapping: duplicate content hash re-register is idempotent, NOT a 409", responseDup.status, 201);
  }

  // ==================== 29. Route handler happy-path coverage (via runWithAuthenticatedContext + fake client) ====================
  {
    const { client } = await freshClient("happy-user-1");
    const created = await runWithAuthenticatedContext(client as never, makeHandleCreateProfile(jsonRequest("http://localhost/x", { method: "POST", body: { schemaVersion: "v1", serializerVersion: "s1" } })));
    check("route: POST profile -> 201", created.status, 201);
    const fetched = await runWithAuthenticatedContext(client as never, handleGetProfile);
    check("route: GET profile after create -> 200", fetched.status, 200);
  }
  {
    const { client } = await freshClient("happy-user-2");
    const notFound = await runWithAuthenticatedContext(client as never, handleGetProfile);
    check("route: GET profile before any create -> 404", notFound.status, 404);
  }
  {
    const seeded = await seedProfileWithVersion("happy-user-3");
    const request = jsonRequest(`http://localhost/x?profileId=${seeded.profileId}`);
    const response = await runWithAuthenticatedContext(seeded.client as never, makeHandleListVersions(request));
    check("route: GET versions (owned) -> 200", response.status, 200);
    const body = await response.json();
    check("route: GET versions returns exactly the seeded version", body.versions.map((v: { id: string }) => v.id), [seeded.versionId]);
  }
  {
    const seeded = await seedProfileWithVersion("happy-user-4");
    const corrupted = { ...seeded.runtime, resume: { ...seeded.runtime.resume, professionalExperience: "not-an-array" } };
    const request = jsonRequest("http://localhost/x", { method: "POST", body: { runtime: corrupted }, headers: { [WRITE_ACK_HEADER]: WRITE_ACK_VALUE } });
    const response = await runWithAuthenticatedContext(seeded.client as never, makeHandleCreateVersion(request));
    check("route: POST version with invalid runtime.resume -> 422 (validated before service call)", response.status, 422);
  }
  {
    const runtime = pristineCanonicalRuntime(buildFixtureRuntime());
    const { client } = await freshClient("happy-user-5");
    const request = jsonRequest("http://localhost/x", { method: "POST", body: { runtime }, headers: { [WRITE_ACK_HEADER]: WRITE_ACK_VALUE } });
    const response = await runWithAuthenticatedContext(client as never, makeHandleCreateVersion(request));
    check("route: POST version with write-ack + valid runtime -> 201", response.status, 201);
    const body = await response.json();
    checkTrue("route: POST version response carries roundTripValid=true", body.roundTripValid === true);
  }
  {
    const seeded = await seedProfileWithVersion("happy-user-6");
    const request = jsonRequest(`http://localhost/x/${seeded.versionId}?profileId=${seeded.profileId}`);
    const response = await runWithAuthenticatedContext(seeded.client as never, makeHandleGetVersion(request, seeded.versionId));
    check("route: GET single version (owned) -> 200", response.status, 200);
  }
  {
    const seeded = await seedProfileWithVersion("happy-user-7");
    const request = jsonRequest(`http://localhost/x/${seeded.versionId}/restore`, { method: "POST", body: { profileId: seeded.profileId } });
    const response = await runWithAuthenticatedContext(seeded.client as never, makeHandleRestoreVersion(request, seeded.versionId));
    check("route: POST restore version (owned) -> 201", response.status, 201);
    const body = await response.json();
    check("route: restore response restoredFromVersionId matches target", body.restoredFromVersionId, seeded.versionId);
  }
  {
    const seeded = await seedProfileWithVersion("happy-user-8");
    const request = jsonRequest("http://localhost/x", {
      method: "POST",
      body: { profileId: seeded.profileId, fileName: "resume.pdf", fileType: "pdf", contentHash: "hash-happy-8", storageBucket: "resume-sources", storagePath: `${seeded.profileId}/doc/original.pdf` },
    });
    const response = await runWithAuthenticatedContext(seeded.client as never, makeHandleRegisterSourceDocument(request));
    check("route: POST source document (owned) -> 201", response.status, 201);
    const body = await response.json();
    const statusRequest = jsonRequest(`http://localhost/x/${body.sourceDocument.id}/status`, { method: "PATCH", body: { profileId: seeded.profileId, status: "processing" } });
    const statusResponse = await runWithAuthenticatedContext(seeded.client as never, makeHandleUpdateAnalysisStatus(statusRequest, body.sourceDocument.id));
    check("route: PATCH source document status (owned) -> 200", statusResponse.status, 200);

    const listRequest = jsonRequest(`http://localhost/x?profileId=${seeded.profileId}`);
    const listResponse = await runWithAuthenticatedContext(seeded.client as never, makeHandleListSourceDocuments(listRequest));
    check("route: GET source documents (owned) -> 200", listResponse.status, 200);
  }
  {
    const badStatusSeeded = await seedProfileWithVersion("happy-user-8b");
    const registerRequest = jsonRequest("http://localhost/x", {
      method: "POST",
      body: { profileId: badStatusSeeded.profileId, fileName: "resume.pdf", fileType: "pdf", contentHash: "hash-happy-8b", storageBucket: "b", storagePath: "p" },
    });
    const registerResponse = await runWithAuthenticatedContext(badStatusSeeded.client as never, makeHandleRegisterSourceDocument(registerRequest));
    const registerBody = await registerResponse.json();
    const badStatusRequest = jsonRequest(`http://localhost/x/${registerBody.sourceDocument.id}/status`, { method: "PATCH", body: { profileId: badStatusSeeded.profileId, status: "not-a-real-status" } });
    const badStatusResponse = await runWithAuthenticatedContext(badStatusSeeded.client as never, makeHandleUpdateAnalysisStatus(badStatusRequest, registerBody.sourceDocument.id));
    check("route: PATCH source document with invalid status enum -> 422", badStatusResponse.status, 422);
  }
  {
    const seeded = await seedProfileWithVersion("happy-user-9");
    const overlayBody = { profileId: seeded.profileId, resumeVersionId: seeded.versionId, overlay: { professionalSummary: { text: "Updated summary." } } };
    const request = jsonRequest("http://localhost/x", { method: "POST", body: overlayBody });
    const response = await runWithAuthenticatedContext(seeded.client as never, makeHandleCreateOverlay(request));
    check("route: POST overlay (owned, valid) -> 201", response.status, 201);
    const body = await response.json();

    const listRequest = jsonRequest(`http://localhost/x?profileId=${seeded.profileId}`);
    const listResponse = await runWithAuthenticatedContext(seeded.client as never, makeHandleListOverlays(listRequest));
    check("route: GET overlays (owned) -> 200", listResponse.status, 200);

    const deleteRequest = jsonRequest(`http://localhost/x/${body.overlay.id}?profileId=${seeded.profileId}`, { method: "DELETE" });
    const deleteResponse = await runWithAuthenticatedContext(seeded.client as never, makeHandleDeleteOverlay(deleteRequest, body.overlay.id));
    check("route: DELETE overlay (owned) -> 200", deleteResponse.status, 200);
  }
  {
    const seeded = await seedProfileWithVersion("happy-user-10");
    const request = jsonRequest("http://localhost/x", { method: "POST", body: { profileId: seeded.profileId, resumeVersionId: seeded.versionId, overlay: { identity: { fullName: "Changed" } } } });
    const response = await runWithAuthenticatedContext(seeded.client as never, makeHandleCreateOverlay(request));
    check("route: POST overlay with a protected-field attempt still returns 201 (rejection recorded, not an HTTP error)", response.status, 201);
    const body = await response.json();
    checkTrue("route: protected-field overlay response carries at least 1 rejection", body.rejections.length >= 1);
  }
  {
    const seeded = await seedProfileWithVersion("happy-user-11");
    const request = jsonRequest("http://localhost/x", { method: "POST", body: { profileId: seeded.profileId, overlay: "not-an-object" } });
    const response = await runWithAuthenticatedContext(seeded.client as never, makeHandleCreateOverlay(request));
    check("route: POST overlay with non-object overlay shape -> 422", response.status, 422);
  }
  {
    const seeded = await seedProfileWithVersion("happy-user-12");
    const request = jsonRequest("http://localhost/x", {
      method: "POST",
      body: { profileId: seeded.profileId, targetTable: "career_experiences", targetId: "exp-1", fieldPath: "role", previousValue: "Old", newValue: "New" },
    });
    const response = await runWithAuthenticatedContext(seeded.client as never, makeHandleRecordUserEdit(request));
    check("route: POST user-edit (owned) -> 201", response.status, 201);

    const listRequest = jsonRequest(`http://localhost/x?profileId=${seeded.profileId}`);
    const listResponse = await runWithAuthenticatedContext(seeded.client as never, makeHandleListUserEdits(listRequest));
    check("route: GET user-edits (owned) -> 200", listResponse.status, 200);
  }
  {
    const seeded = await seedProfileWithVersion("happy-user-13");
    const overlayRequest = jsonRequest("http://localhost/x", { method: "POST", body: { profileId: seeded.profileId, resumeVersionId: seeded.versionId, overlay: {} } });
    const overlayResponse = await runWithAuthenticatedContext(seeded.client as never, makeHandleCreateOverlay(overlayRequest));
    const overlayBody = await overlayResponse.json();

    const genRequest = jsonRequest("http://localhost/x", {
      method: "POST",
      body: { profileId: seeded.profileId, tailoredResumeId: overlayBody.overlay.id, storageBucket: "generated-resumes", storagePath: `${seeded.profileId}/${overlayBody.overlay.id}/resume.pdf`, fileType: "pdf" },
    });
    const genResponse = await runWithAuthenticatedContext(seeded.client as never, makeHandleCreateGeneratedDocument(genRequest));
    check("route: POST generated document (owned, valid tailoredResumeId) -> 201", genResponse.status, 201);

    const listRequest = jsonRequest(`http://localhost/x?profileId=${seeded.profileId}&tailoredResumeId=${overlayBody.overlay.id}`);
    const listResponse = await runWithAuthenticatedContext(seeded.client as never, makeHandleListGeneratedDocuments(listRequest));
    check("route: GET generated documents (owned) -> 200", listResponse.status, 200);
  }
  {
    const seeded = await seedProfileWithVersion("happy-user-14");
    const genRequest = jsonRequest("http://localhost/x", {
      method: "POST",
      body: { profileId: seeded.profileId, tailoredResumeId: "nonexistent-tailored-resume-id", storageBucket: "generated-resumes", storagePath: "p", fileType: "pdf" },
    });
    const genResponse = await runWithAuthenticatedContext(seeded.client as never, makeHandleCreateGeneratedDocument(genRequest));
    check("route: POST generated document with a tailoredResumeId belonging to no overlay -> 404", genResponse.status, 404);
  }
  {
    const seeded = await seedProfileWithVersion("happy-user-15");
    const request = jsonRequest(`http://localhost/x?profileId=${seeded.profileId}`);
    const response = await runWithAuthenticatedContext(seeded.client as never, makeHandleListGeneratedDocuments(request));
    check("route: GET generated documents missing required tailoredResumeId query param -> 422", response.status, 422);
  }

  // ==================== Missing required body/query fields per route (422) ====================
  {
    const { client } = await freshClient("missingfield-user-1");
    const response = await runWithAuthenticatedContext(client as never, makeHandleCreateProfile(jsonRequest("http://localhost/x", { method: "POST", body: {} })));
    check("missing field: create profile without schemaVersion -> 422", response.status, 422);
  }
  {
    const seeded = await seedProfileWithVersion("missingfield-user-2");
    const response = await runWithAuthenticatedContext(seeded.client as never, makeHandleCreateOverlay(jsonRequest("http://localhost/x", { method: "POST", body: { overlay: {} } })));
    check("missing field: create overlay without profileId -> 422", response.status, 422);
  }
  {
    const seeded = await seedProfileWithVersion("missingfield-user-3");
    const response = await runWithAuthenticatedContext(seeded.client as never, makeHandleRecordUserEdit(jsonRequest("http://localhost/x", { method: "POST", body: { profileId: seeded.profileId } })));
    check("missing field: record user-edit without targetTable/targetId/fieldPath -> 422", response.status, 422);
  }
  {
    const seeded = await seedProfileWithVersion("missingfield-user-4");
    const response = await runWithAuthenticatedContext(seeded.client as never, makeHandleCreateGeneratedDocument(jsonRequest("http://localhost/x", { method: "POST", body: { profileId: seeded.profileId } })));
    check("missing field: create generated document without tailoredResumeId/storageBucket/storagePath/fileType -> 422", response.status, 422);
  }
  {
    const seeded = await seedProfileWithVersion("missingfield-user-5");
    const response = await runWithAuthenticatedContext(seeded.client as never, makeHandleRegisterSourceDocument(jsonRequest("http://localhost/x", { method: "POST", body: { profileId: seeded.profileId } })));
    check("missing field: register source document without fileName/fileType/contentHash/storageBucket/storagePath -> 422", response.status, 422);
  }
  {
    const seeded = await seedProfileWithVersion("missingfield-user-6");
    const response = await runWithAuthenticatedContext(seeded.client as never, makeHandleUpdateAnalysisStatus(jsonRequest("http://localhost/x", { method: "PATCH", body: { profileId: seeded.profileId } }), "some-doc-id"));
    check("missing field: update analysis status without status -> 422", response.status, 422);
  }
  {
    const { client } = await freshClient("missingfield-user-7");
    const response = await runWithAuthenticatedContext(client as never, makeHandleListOverlays(jsonRequest("http://localhost/x")));
    check("missing field: list overlays without profileId query param -> 422", response.status, 422);
  }
  {
    const { client } = await freshClient("missingfield-user-8");
    const response = await runWithAuthenticatedContext(client as never, makeHandleListUserEdits(jsonRequest("http://localhost/x")));
    check("missing field: list user-edits without profileId query param -> 422", response.status, 422);
  }
  {
    const { client } = await freshClient("missingfield-user-9");
    const response = await runWithAuthenticatedContext(client as never, makeHandleListSourceDocuments(jsonRequest("http://localhost/x")));
    check("missing field: list source documents without profileId query param -> 422", response.status, 422);
  }
  {
    const { client } = await freshClient("missingfield-user-10");
    const response = await runWithAuthenticatedContext(client as never, makeHandleDeleteOverlay(jsonRequest("http://localhost/x", { method: "DELETE" }), "some-id"));
    check("missing field: delete overlay without profileId query param -> 422", response.status, 422);
  }
  {
    const { client } = await freshClient("missingfield-user-11");
    const response = await runWithAuthenticatedContext(client as never, makeHandleGetVersion(jsonRequest("http://localhost/x"), "some-id"));
    check("missing field: get version without profileId query param -> 422", response.status, 422);
  }

  // ==================== Cross-user via the ACTUAL HTTP status/restore/register routes (not just services) ====================
  {
    const seeded = await seedProfileWithVersion("crossuser-status");
    const registerResponse = await runWithAuthenticatedContext(
      seeded.client as never,
      makeHandleRegisterSourceDocument(jsonRequest("http://localhost/x", { method: "POST", body: { profileId: seeded.profileId, fileName: "a.pdf", fileType: "pdf", contentHash: "cross-user-hash-1", storageBucket: "b", storagePath: "p" } })),
    );
    const registerBody = await registerResponse.json();
    const statusRequest = jsonRequest(`http://localhost/x/${registerBody.sourceDocument.id}/status`, { method: "PATCH", body: { profileId: seeded.profileId, status: "processing" } });
    const statusResponse = await runWithAuthenticatedContext(seeded.client as never, async (ctx) => makeHandleUpdateAnalysisStatus(statusRequest, registerBody.sourceDocument.id)({ ...ctx, userId: "attacker-status-user" }));
    check("cross-user: updating another user's source document analysis status -> 404", statusResponse.status, 404);
  }
  {
    const seeded = await seedProfileWithVersion("crossuser-gendoc");
    const overlayResponse = await runWithAuthenticatedContext(seeded.client as never, makeHandleCreateOverlay(jsonRequest("http://localhost/x", { method: "POST", body: { profileId: seeded.profileId, resumeVersionId: seeded.versionId, overlay: {} } })));
    const overlayBody = await overlayResponse.json();
    const genRequest = jsonRequest("http://localhost/x", { method: "POST", body: { profileId: seeded.profileId, tailoredResumeId: overlayBody.overlay.id, storageBucket: "b", storagePath: "p", fileType: "pdf" } });
    const genResponse = await runWithAuthenticatedContext(seeded.client as never, async (ctx) => makeHandleCreateGeneratedDocument(genRequest)({ ...ctx, userId: "attacker-gendoc-user" }));
    check("cross-user: creating a generated document under another user's profileId -> 404", genResponse.status, 404);
  }

  // ==================== cache-control: no-store on every response ====================
  {
    const { client } = await freshClient("cache-user");
    const response = await runWithAuthenticatedContext(client as never, handleGetProfile);
    check("observability: 404 response carries cache-control: no-store", response.headers.get("cache-control"), "no-store");
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
