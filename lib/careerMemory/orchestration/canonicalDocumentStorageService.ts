/*
  Phase 6G - real Storage upload for canonical PDF/DOCX bytes, service-
  role only (background-worker context, matches
  supabase/migrations/20260807000000's own new "generated-documents"
  bucket + owner-path-prefix RLS, mirroring the existing resumes/
  cover-letters bucket pattern exactly).

  Hard rule from the round spec's Document Storage requirement: a
  generated_resume_documents row is only ever recorded (via
  complete_canonical_generation, see canonicalRenderService.ts) AFTER
  a real upload here succeeds - this module never returns a storage
  path that wasn't actually written. If canonical_document_storage_enabled
  is false, or the upload itself fails, the caller must NOT proceed to
  record document metadata - LOCAL_OUTPUT_ONLY is the correct outcome,
  not a fabricated metadata row pointing at nothing.
*/
import type { SupabaseClient } from "@supabase/supabase-js";
import { isCanonicalDocumentStorageEnabled } from "./featureFlags";
import { isE2eAiModeActive } from "../../testing/e2eAiIsolation";

/*
  Phase 6I.6.35 Part AB/AE - test-only Storage-write fault injection,
  double-gated: isE2eAiModeActive() itself fails closed (never active in
  a Netlify runtime or against a non-local Supabase target - see that
  function's own header comment), AND this reads only a server-process
  environment variable (E2E_FAULT_INJECT_STORAGE_WRITE), never any
  client-supplied input (no query param, header, cookie, or request
  body is consulted here or anywhere in this call chain) - satisfying
  Part AE's "unacceptable: query param/client-controlled flag/public
  API toggle" constraint by construction. Value is "pdf" | "docx" |
  "both" to let tests target one artifact type independently.
*/
function isStorageWriteFaultInjected(fileType: "pdf" | "docx"): boolean {
  if (!isE2eAiModeActive()) return false;
  const target = process.env.E2E_FAULT_INJECT_STORAGE_WRITE;
  return target === fileType || target === "both";
}

export const GENERATED_DOCUMENTS_BUCKET = "generated-documents";

export type UploadGeneratedDocumentInput = {
  userId: string;
  applicationId: string;
  fileType: "pdf" | "docx";
  bytes: Buffer;
};

export type UploadGeneratedDocumentResult =
  | { uploaded: true; storageBucket: string; storagePath: string }
  | { uploaded: false; reason: "storage_disabled" | "upload_failed"; detail?: string };

function contentTypeFor(fileType: "pdf" | "docx"): string {
  return fileType === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

/*
  Path shape mirrors the existing resumes/cover-letters convention
  ("${user.id}/...") the RLS policies already assume - see
  storage_rls_owner_check's own (storage.foldername(name))[1] check,
  which this new bucket's policies replicate identically.
*/
export function buildGeneratedDocumentStoragePath(userId: string, applicationId: string, fileType: "pdf" | "docx"): string {
  return `${userId}/${applicationId}.${fileType}`;
}

export async function uploadGeneratedDocument(client: SupabaseClient, input: UploadGeneratedDocumentInput): Promise<UploadGeneratedDocumentResult> {
  if (!isCanonicalDocumentStorageEnabled()) {
    return { uploaded: false, reason: "storage_disabled" };
  }

  if (isStorageWriteFaultInjected(input.fileType)) {
    return { uploaded: false, reason: "upload_failed", detail: "E2E fault injection (Phase 6I.6.35, E2E_FAULT_INJECT_STORAGE_WRITE) - real Storage was never called." };
  }

  const storagePath = buildGeneratedDocumentStoragePath(input.userId, input.applicationId, input.fileType);
  const { error } = await client.storage.from(GENERATED_DOCUMENTS_BUCKET).upload(storagePath, input.bytes, {
    contentType: contentTypeFor(input.fileType),
    upsert: true,
  });

  if (error) {
    return { uploaded: false, reason: "upload_failed", detail: error.message };
  }

  return { uploaded: true, storageBucket: GENERATED_DOCUMENTS_BUCKET, storagePath };
}
