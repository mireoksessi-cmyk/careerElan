/*
  Phase 6E - test-only "fetch" adapter that routes a request straight
  into the REAL app/api/internal/canonical-career-memory/** route
  handler functions via routeGuard.runWithAuthenticatedContext() + a
  FakeSupabaseClient, exactly the same pattern
  lib/careerMemory/api/apiRoutes.test.ts already uses to test the
  routes themselves - applied here one layer up, so
  lib/canonicalCareerUi/apiClient.ts's request-building/response-
  parsing logic is exercised against the REAL route/service/repository
  code (domain validation, ownership checks, error mapping) without
  needing a live `next dev` server or a real cookie-based session.
  This is NOT a substitute for a real Postgres round-trip (that
  boundary is already covered, and disclosed, by
  fixtures/scripts/rpcTransactionIdempotency.realdb.test.mjs at the
  RPC layer) - it proves the UI's HTTP client talks to the real route
  contracts correctly, nothing more, nothing less.
*/
import { createFakeCareerMemorySupabaseClient } from "../../careerMemory/repositories/testSupport/fakeSupabaseClient";
import { runWithAuthenticatedContext } from "../../careerMemory/api/routeGuard";

import { handleGetProfile, makeHandleCreateProfile } from "../../../app/api/internal/canonical-career-memory/profile/route";
import { makeHandleListVersions, makeHandleCreateVersion } from "../../../app/api/internal/canonical-career-memory/versions/route";
import { makeHandleGetVersion } from "../../../app/api/internal/canonical-career-memory/versions/[id]/route";
import { makeHandleRestoreVersion } from "../../../app/api/internal/canonical-career-memory/versions/[id]/restore/route";
import { makeHandleListOverlays, makeHandleCreateOverlay } from "../../../app/api/internal/canonical-career-memory/overlays/route";
import { makeHandleDeleteOverlay } from "../../../app/api/internal/canonical-career-memory/overlays/[id]/route";
import { makeHandleListSourceDocuments, makeHandleRegisterSourceDocument } from "../../../app/api/internal/canonical-career-memory/source-documents/route";
import { makeHandleUpdateAnalysisStatus } from "../../../app/api/internal/canonical-career-memory/source-documents/[id]/status/route";
import { makeHandleListGeneratedDocuments, makeHandleCreateGeneratedDocument } from "../../../app/api/internal/canonical-career-memory/generated-documents/route";
import { makeHandleListUserEdits, makeHandleRecordUserEdit } from "../../../app/api/internal/canonical-career-memory/user-edits/route";

export type FakeClient = ReturnType<typeof createFakeCareerMemorySupabaseClient>;

/*
  Splits a request URL of the form
  /api/internal/canonical-career-memory/<rest> into segments + query,
  and dispatches to the matching real handler. Throws (a real bug, not
  a test-only condition) if a path this router doesn't recognize is
  requested - every path apiClient.ts can produce is covered below.
*/
function dispatch(request: Request): (ctx: Parameters<typeof runWithAuthenticatedContext>[1] extends (ctx: infer C) => unknown ? C : never) => Promise<Response> {
  const url = new URL(request.url);
  const prefix = "/api/internal/canonical-career-memory";
  if (!url.pathname.startsWith(prefix)) throw new Error(`routeFetch: unrecognized path ${url.pathname}`);
  const rest = url.pathname.slice(prefix.length).replace(/^\/+/, "");
  const segments = rest.length > 0 ? rest.split("/") : [];
  const method = request.method.toUpperCase();

  if (segments.length === 1 && segments[0] === "profile") {
    if (method === "GET") return handleGetProfile;
    if (method === "POST") return makeHandleCreateProfile(request);
  }
  if (segments.length === 1 && segments[0] === "versions") {
    if (method === "GET") return makeHandleListVersions(request);
    if (method === "POST") return makeHandleCreateVersion(request);
  }
  if (segments.length === 2 && segments[0] === "versions") {
    if (method === "GET") return makeHandleGetVersion(request, segments[1]);
  }
  if (segments.length === 3 && segments[0] === "versions" && segments[2] === "restore") {
    if (method === "POST") return makeHandleRestoreVersion(request, segments[1]);
  }
  if (segments.length === 1 && segments[0] === "overlays") {
    if (method === "GET") return makeHandleListOverlays(request);
    if (method === "POST") return makeHandleCreateOverlay(request);
  }
  if (segments.length === 2 && segments[0] === "overlays") {
    if (method === "DELETE") return makeHandleDeleteOverlay(request, segments[1]);
  }
  if (segments.length === 1 && segments[0] === "source-documents") {
    if (method === "GET") return makeHandleListSourceDocuments(request);
    if (method === "POST") return makeHandleRegisterSourceDocument(request);
  }
  if (segments.length === 3 && segments[0] === "source-documents" && segments[2] === "status") {
    if (method === "PATCH") return makeHandleUpdateAnalysisStatus(request, segments[1]);
  }
  if (segments.length === 1 && segments[0] === "generated-documents") {
    if (method === "GET") return makeHandleListGeneratedDocuments(request);
    if (method === "POST") return makeHandleCreateGeneratedDocument(request);
  }
  if (segments.length === 1 && segments[0] === "user-edits") {
    if (method === "GET") return makeHandleListUserEdits(request);
    if (method === "POST") return makeHandleRecordUserEdit(request);
  }

  throw new Error(`routeFetch: no route matches ${method} ${url.pathname}`);
}

/*
  Builds a fetch-compatible function bound to one fake client (one
  simulated user session). Pass the result as the `fetchImpl` param to
  any lib/canonicalCareerUi/apiClient.ts function.
*/
/*
  A route handler reads `new URL(request.url)`, which requires an
  absolute URL - real browser `fetch` resolves a relative path against
  `document.location` automatically, but Node's `Request` constructor
  does not, so a relative path passed through unchanged would throw
  before ever reaching a handler. This dummy origin exists ONLY to
  satisfy that parsing requirement in-process; no real network request
  is ever made against it.
*/
const DUMMY_ORIGIN = "http://canonical-career-ui.test";

export function createRouteFetch(client: FakeClient): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (input instanceof Request) {
      const handler = dispatch(input);
      return runWithAuthenticatedContext(client as never, handler as never);
    }
    const rawUrl = typeof input === "string" ? input : input.toString();
    const absoluteUrl = rawUrl.startsWith("http") ? rawUrl : `${DUMMY_ORIGIN}${rawUrl}`;
    const request = new Request(absoluteUrl, init);
    const handler = dispatch(request);
    return runWithAuthenticatedContext(client as never, handler as never);
  }) as typeof fetch;
}

export function freshRouteFetch(userId: string): { client: FakeClient; fetchImpl: typeof fetch } {
  const client = createFakeCareerMemorySupabaseClient();
  client.setCurrentUser({ id: userId });
  return { client, fetchImpl: createRouteFetch(client) };
}
