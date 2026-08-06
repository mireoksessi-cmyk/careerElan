/*
  Phase 6E - the ONLY place the new Canonical Career Memory UI talks to
  the network. Every function here calls a real internal API route
  under /api/internal/canonical-career-memory/** (lib/careerMemory/api/**
  + app/api/internal/canonical-career-memory/**) - never Supabase
  directly, never raw SQL (spec section 4). No function here fabricates
  data; every response is passed straight through after parsing.

  Each function accepts a `fetchImpl` override (defaults to the global
  `fetch`) purely so tests can point requests at the real Next.js route
  handlers in-process via routeGuard.runWithAuthenticatedContext() + a
  FakeSupabaseClient (see testSupport/routeFetch.ts) instead of a live
  HTTP server - the SAME pattern lib/careerMemory/api/apiRoutes.test.ts
  already uses to test the routes themselves, applied one layer up to
  test this client's request/response handling against the real route
  code without needing `next dev` running.
*/
import { apiErrorFromResponseBody, networkError, type CanonicalApiError } from "./errors";
import type {
  CareerProfileRow,
  CareerSourceDocumentRow,
  CareerResumeVersionRow,
  CareerTailoredResumeRow,
  CareerUserEditRow,
  GeneratedResumeDocumentRow,
  CanonicalResumeRuntime,
  TailoredMergeRejection,
} from "./types";

export type FetchImpl = typeof fetch;

const BASE = "/api/internal/canonical-career-memory";
const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  fetchImpl?: FetchImpl;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.idempotencyKey) headers[IDEMPOTENCY_KEY_HEADER] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetchImpl(`${BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (cause) {
    throw networkError(cause instanceof Error ? cause.message : String(cause));
  }

  let parsedBody: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      parsedBody = JSON.parse(text);
    } catch {
      parsedBody = null;
    }
  }

  if (!response.ok) {
    throw apiErrorFromResponseBody(response.status, parsedBody);
  }
  return parsedBody as T;
}

/* ---------------------------------------------------------------
   Profile
   --------------------------------------------------------------- */
export async function getProfile(fetchImpl?: FetchImpl): Promise<CareerProfileRow | null> {
  try {
    const data = await request<{ profile: CareerProfileRow }>("/profile", { fetchImpl });
    return data.profile;
  } catch (error) {
    if ((error as CanonicalApiError).code === "NOT_FOUND") return null;
    throw error;
  }
}

export async function createProfile(input: { schemaVersion: string; serializerVersion?: string }, fetchImpl?: FetchImpl): Promise<CareerProfileRow> {
  const data = await request<{ profile: CareerProfileRow }>("/profile", { method: "POST", body: input, fetchImpl });
  return data.profile;
}

/* ---------------------------------------------------------------
   Versions
   --------------------------------------------------------------- */
export async function listVersions(profileId: string, fetchImpl?: FetchImpl): Promise<CareerResumeVersionRow[]> {
  const data = await request<{ versions: CareerResumeVersionRow[] }>(`/versions?profileId=${encodeURIComponent(profileId)}`, { fetchImpl });
  return data.versions;
}

export async function getVersion(profileId: string, versionId: string, fetchImpl?: FetchImpl): Promise<CareerResumeVersionRow> {
  const data = await request<{ version: CareerResumeVersionRow }>(`/versions/${encodeURIComponent(versionId)}?profileId=${encodeURIComponent(profileId)}`, { fetchImpl });
  return data.version;
}

export type SaveVersionResult = { version: CareerResumeVersionRow; roundTripValid: boolean };

export async function saveVersion(
  input: { runtime: CanonicalResumeRuntime; expectedCurrentVersionId?: string | null },
  idempotencyKey: string,
  fetchImpl?: FetchImpl
): Promise<SaveVersionResult> {
  return request<SaveVersionResult>("/versions", { method: "POST", body: input, idempotencyKey, fetchImpl });
}

export type RestoreVersionResult = { version: CareerResumeVersionRow; restoredFromVersionId: string };

export async function restoreVersion(profileId: string, targetVersionId: string, idempotencyKey: string, fetchImpl?: FetchImpl): Promise<RestoreVersionResult> {
  return request<RestoreVersionResult>(`/versions/${encodeURIComponent(targetVersionId)}/restore`, {
    method: "POST",
    body: { profileId },
    idempotencyKey,
    fetchImpl,
  });
}

/* ---------------------------------------------------------------
   Overlays
   --------------------------------------------------------------- */
export async function listOverlays(profileId: string, fetchImpl?: FetchImpl): Promise<CareerTailoredResumeRow[]> {
  const data = await request<{ overlays: CareerTailoredResumeRow[] }>(`/overlays?profileId=${encodeURIComponent(profileId)}`, { fetchImpl });
  return data.overlays;
}

export type CreateOverlayInput = {
  profileId: string;
  resumeVersionId?: string | null;
  applicationId?: string | null;
  templateId?: string | null;
  aiModel?: string | null;
  promptVersion?: string | null;
  overlay: unknown;
};

export type CreateOverlayResult = { overlay: CareerTailoredResumeRow; appliedEntryIds: string[]; rejections: TailoredMergeRejection[] };

export async function createOverlay(input: CreateOverlayInput, idempotencyKey: string, fetchImpl?: FetchImpl): Promise<CreateOverlayResult> {
  return request<CreateOverlayResult>("/overlays", { method: "POST", body: input, idempotencyKey, fetchImpl });
}

export async function deleteOverlay(profileId: string, overlayId: string, fetchImpl?: FetchImpl): Promise<void> {
  await request<{ deleted: true }>(`/overlays/${encodeURIComponent(overlayId)}?profileId=${encodeURIComponent(profileId)}`, { method: "DELETE", fetchImpl });
}

/* ---------------------------------------------------------------
   Source documents
   --------------------------------------------------------------- */
export async function listSourceDocuments(profileId: string, fetchImpl?: FetchImpl): Promise<CareerSourceDocumentRow[]> {
  const data = await request<{ sourceDocuments: CareerSourceDocumentRow[] }>(`/source-documents?profileId=${encodeURIComponent(profileId)}`, { fetchImpl });
  return data.sourceDocuments;
}

export type RegisterSourceDocumentInput = {
  profileId: string;
  fileName: string;
  fileType: "pdf" | "docx";
  contentHash: string;
  storageBucket: string;
  storagePath: string;
  mimeType?: string | null;
  byteSize?: number | null;
  parserVersion?: string | null;
};

export async function registerSourceDocument(input: RegisterSourceDocumentInput, idempotencyKey: string, fetchImpl?: FetchImpl): Promise<CareerSourceDocumentRow> {
  const data = await request<{ sourceDocument: CareerSourceDocumentRow }>("/source-documents", { method: "POST", body: input, idempotencyKey, fetchImpl });
  return data.sourceDocument;
}

/* ---------------------------------------------------------------
   Generated documents
   --------------------------------------------------------------- */
export async function listGeneratedDocuments(profileId: string, tailoredResumeId: string, fetchImpl?: FetchImpl): Promise<GeneratedResumeDocumentRow[]> {
  const data = await request<{ generatedDocuments: GeneratedResumeDocumentRow[] }>(
    `/generated-documents?profileId=${encodeURIComponent(profileId)}&tailoredResumeId=${encodeURIComponent(tailoredResumeId)}`,
    { fetchImpl }
  );
  return data.generatedDocuments;
}

export type CreateGeneratedDocumentInput = {
  profileId: string;
  tailoredResumeId: string;
  storageBucket: string;
  storagePath: string;
  fileType: "pdf" | "docx";
};

export async function createGeneratedDocument(input: CreateGeneratedDocumentInput, idempotencyKey: string, fetchImpl?: FetchImpl): Promise<GeneratedResumeDocumentRow> {
  const data = await request<{ generatedDocument: GeneratedResumeDocumentRow }>("/generated-documents", { method: "POST", body: input, idempotencyKey, fetchImpl });
  return data.generatedDocument;
}

/* ---------------------------------------------------------------
   User edits (audit trail - append only, read-only in this UI round)
   --------------------------------------------------------------- */
export async function listUserEdits(profileId: string, fetchImpl?: FetchImpl): Promise<CareerUserEditRow[]> {
  const data = await request<{ userEdits: CareerUserEditRow[] }>(`/user-edits?profileId=${encodeURIComponent(profileId)}`, { fetchImpl });
  return data.userEdits;
}
