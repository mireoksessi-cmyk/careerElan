/*
  Phase 6I.1 - Canonical Resume Import / Upload Bridge.

  Converts an EXISTING, already-uploaded `resumes` row into a real
  Canonical Career Memory profile/version, reusing the Phase 1-5D
  Document Preservation Engine pipeline (analyzeDocument ->
  buildLosslessResumeDocument -> buildStructuredResume) exactly as
  lib/documentPreservation/runForApplication.ts already does for a real
  production Generate Package request - no second parser, no new
  layout/structuring logic here.

  Persistence reuses two already-transactional, already-idempotency-key-
  aware SQL RPCs unchanged: register_canonical_source_document() (via
  CanonicalSourceDocumentService) and save_canonical_runtime() (via
  CanonicalCareerMemoryService.saveCanonicalRuntimeAcknowledgingGap()).
  No new migration, no new RPC - see transactions/README.md.

  Applicability boundary (same one runForApplication.ts already
  discloses): only a resume with a real original PDF/DOCX file in
  Storage (`source_type = 'uploaded'`, `storage_path` +
  `original_file_type` both set) can be imported this round. A
  career_memory-sourced resume has no original document to preserve and
  is out of scope here, not silently coerced into a lossy import.

  No-automatic-merge rule (this round's explicit constraint): if the
  user already has ANY canonical profile/version, importing a
  DIFFERENT resume (different file content) is refused with a
  "conflict" result rather than silently creating a new version that
  supersedes the existing one. Re-importing the SAME resume (same file
  content, detected by a real SHA-256 hash - not resumeId, which lets a
  file re-uploaded under a new resumeId still be recognized) is treated
  as a safe, idempotent retry.
*/
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NotFoundError, ValidationError } from "../errors/domainErrors";
import type { CanonicalRepositoryBundle } from "../repositories/createRepositories";
import { supabaseAdmin } from "../../supabaseAdmin";
import { analyzeDocument } from "../../documentPreservation/layoutAnalysis";
import type { LayoutSourceFormat } from "../../documentPreservation/layoutAnalysis/types";
import { buildLosslessResumeDocument } from "../../documentPreservation/losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "../../documentPreservation/resumeStructured/buildStructuredResume";
import { createCanonicalRuntime, createRuntimeSourceDocument, createRuntimeVersion } from "../runtime/factory";
import { CANONICAL_RUNTIME_SERIALIZER_VERSION } from "../runtime/types";
import { CanonicalCareerMemoryService } from "./canonicalCareerMemoryService";
import { CanonicalSourceDocumentService } from "./canonicalSourceDocumentService";
import { ensureProfile } from "./profileAccess";

const SUPPORTED_SOURCE_FORMATS: LayoutSourceFormat[] = ["pdf", "docx"];
const RESUMES_STORAGE_BUCKET = "resumes";

export type ImportResumeResult =
  | {
      status: "imported";
      profileId: string;
      versionId: string;
      sourceDocumentId: string;
      roundTripValid: boolean;
      alreadyImported: boolean;
    }
  | {
      status: "conflict";
      reason: string;
    };

type ImportableResumeRow = {
  id: string;
  user_id: string;
  file_name: string | null;
  storage_path: string | null;
  original_file_type: string | null;
  source_type: string | null;
};

export class CanonicalResumeImportService {
  constructor(
    private readonly repos: CanonicalRepositoryBundle,
    /*
      The raw RLS-authenticated client (see routeGuard.ts's
      CanonicalRouteContext.client) - needed to read the legacy
      `resumes` table, which sits outside the canonical repository
      bundle. Ownership is enforced the same way every other existing
      route already enforces it: `.eq("user_id", userId)` on the read,
      not a separate trust-me check.
    */
    private readonly authClient: SupabaseClient
  ) {}

  async importResume(userId: string, resumeId: string): Promise<ImportResumeResult> {
    const resume = await this.loadOwnedResume(userId, resumeId);
    const sourceFormat = this.requireImportableFormat(resume);

    const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage.from(RESUMES_STORAGE_BUCKET).download(resume.storage_path as string);
    if (downloadError || !fileBlob) {
      throw new ValidationError([`Could not download the original resume file for resume "${resumeId}": ${downloadError?.message ?? "no file returned"}.`]);
    }
    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    const contentHash = crypto.createHash("sha256").update(buffer).digest("hex");

    const memoryService = new CanonicalCareerMemoryService(this.repos);
    const existingRuntime = await memoryService.getCanonicalRuntime(userId);
    if (existingRuntime) {
      const sameResumeAlreadyImported = existingRuntime.sourceDocuments.some((doc) => doc.contentHash === contentHash);
      if (!sameResumeAlreadyImported) {
        return {
          status: "conflict",
          reason:
            "A Canonical Career Memory profile already exists for this account, built from a different resume. Automatic merge is not supported this round - importing a second, different resume would silently replace the existing canonical data.",
        };
      }
    }

    const layoutResult = await analyzeDocument("resume", sourceFormat, buffer);
    const losslessDoc = buildLosslessResumeDocument(layoutResult, {
      fileName: resume.file_name ?? "resume",
      fileType: sourceFormat,
    });
    if (!losslessDoc.validation.passed) {
      throw new ValidationError([`Layout analysis did not pass lossless validation for resume "${resumeId}": ${losslessDoc.validation.warnings.join("; ") || "unspecified failure"}.`]);
    }

    const structuredModel = buildStructuredResume(losslessDoc);
    if (!structuredModel.validation.passed) {
      throw new ValidationError([`Resume structuring did not pass validation for resume "${resumeId}": ${structuredModel.validation.warnings.join("; ") || "unspecified failure"}.`]);
    }

    const profile = await ensureProfile(this.repos, userId, {
      schemaVersion: structuredModel.schemaVersion,
      serializerVersion: CANONICAL_RUNTIME_SERIALIZER_VERSION,
    });

    const sourceDocService = new CanonicalSourceDocumentService(this.repos);
    const registeredDoc = await sourceDocService.registerSourceDocument(userId, {
      profileId: profile.id,
      fileName: resume.file_name ?? "resume",
      fileType: sourceFormat,
      byteSize: buffer.byteLength,
      contentHash,
      storageBucket: RESUMES_STORAGE_BUCKET,
      storagePath: resume.storage_path as string,
      // Deterministic per-resume key: a retried import of the SAME
      // resumeId always registers (or replays) the SAME source
      // document row, never a duplicate.
      idempotencyKey: `canonical-import-source-doc:${resumeId}`,
    });

    const nowIso = new Date().toISOString();
    const runtimeVersion = createRuntimeVersion({ id: crypto.randomUUID(), reason: "import", createdAt: nowIso });
    const runtimeSourceDocument = createRuntimeSourceDocument({
      id: registeredDoc.id,
      fileName: registeredDoc.original_file_name ?? resume.file_name ?? "resume",
      fileType: sourceFormat,
      contentHash,
      addedAt: registeredDoc.created_at,
    });
    const runtime = createCanonicalRuntime({
      resume: structuredModel,
      version: runtimeVersion,
      sourceDocuments: [runtimeSourceDocument],
    });

    const saveResult = await memoryService.saveCanonicalRuntimeAcknowledgingGap(userId, {
      runtime,
      // Deterministic per-resume key: a retried import of the SAME
      // resumeId replays the ORIGINAL save result rather than creating
      // a second version.
      idempotencyKey: `canonical-import-resume:${resumeId}`,
    });

    return {
      status: "imported",
      profileId: profile.id,
      versionId: saveResult.version.id,
      sourceDocumentId: registeredDoc.id,
      roundTripValid: saveResult.roundTripValid,
      alreadyImported: existingRuntime !== null,
    };
  }

  private async loadOwnedResume(userId: string, resumeId: string): Promise<ImportableResumeRow> {
    const { data: resume, error } = await this.authClient
      .from("resumes")
      .select("id, user_id, file_name, storage_path, original_file_type, source_type")
      .eq("id", resumeId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw new ValidationError([`Could not read resume "${resumeId}": ${error.message}.`]);
    if (!resume) throw new NotFoundError("Resume");
    return resume as ImportableResumeRow;
  }

  private requireImportableFormat(resume: ImportableResumeRow): LayoutSourceFormat {
    if (resume.source_type !== "uploaded" || !resume.storage_path || !resume.original_file_type) {
      throw new ValidationError([
        `Resume "${resume.id}" has no original uploaded file to import (source_type="${resume.source_type ?? "null"}"). Only uploaded PDF/DOCX resumes with a real original file can be imported into Canonical Career Memory this round - a career_memory-sourced resume has no original document layout to preserve.`,
      ]);
    }
    if (!SUPPORTED_SOURCE_FORMATS.includes(resume.original_file_type as LayoutSourceFormat)) {
      throw new ValidationError([`Resume "${resume.id}" has an unsupported original file type "${resume.original_file_type}" - only pdf/docx are analyzed.`]);
    }
    return resume.original_file_type as LayoutSourceFormat;
  }
}
