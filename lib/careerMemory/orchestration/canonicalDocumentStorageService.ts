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
