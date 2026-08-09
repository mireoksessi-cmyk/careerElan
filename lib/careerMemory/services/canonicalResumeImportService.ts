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

  Phase 6I.5 policy update - the original Phase 6I.1 "no automatic
  merge" rule (refuse a second, different resume outright with a
  "conflict" result) is REPLACED by an explicit versioning policy:
  uploading a new resume for a user who already has a canonical profile
  no longer errors. It creates a NEW career_resume_versions row (via
  save_canonical_runtime(), which already always INSERTS a new version
  chained to the current one rather than overwriting it - see
  supabase/migrations/20260806020000_career_memory_transaction_
  idempotency.sql) that becomes the profile's current/latest version.
  The OLD version, and the source document that produced it, are never
  deleted or mutated - only superseded by created_at ordering, exactly
  the versioning contract runtime/types.ts's RuntimeVersionReason
  already documents ("import" is a listed version event). Only ONE case
  still short-circuits without writing a new version: the new resume's
  content is IDENTICAL (by SHA-256 hash) to the source that produced
  the profile's CURRENT LATEST version - a genuine no-op replay, not a
  new resume. This is deliberately narrower than the old "matches ANY
  previously-seen resume" check: re-uploading an OLDER, no-longer-
  current resume is treated as a fresh "this is now current again"
  event (a new version), not silently ignored, since the entire point
  of importing is "make this the active canonical source." Identity is
  resolved by SHA-256 content hash, never resumeId or any other UI/
  session state - two different resumeId rows can be the exact same
  bytes (idempotent replay, no duplicate version) and a retried request
  for the same resumeId never produces two versions for one real
  upload (registerSourceDocument's own content_hash unique index, plus
  a content-hash-keyed idempotency key on the version save below).
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
import { classifyLosslessValidationFailure, classifyStructuredValidationFailure } from "./canonicalImportFailureClassifier";
import { MAX_UPLOAD_BYTES, UploadValidationError, withParseTimeout } from "../../documentAnalysis/uploadValidation";

const SUPPORTED_SOURCE_FORMATS: LayoutSourceFormat[] = ["pdf", "docx"];
const RESUMES_STORAGE_BUCKET = "resumes";

/*
  Phase 6I.6.32 Part N/AT - this bridge re-parses an already-validated
  upload through the full DPE layout analyzer, which (per this phase's
  audit) has no page cap or timeout of its own, unlike
  app/api/process-resume-design/route.ts's own 45s bound for the same
  underlying analyzeDocument() call. This mirrors that existing bound
  rather than inventing a new one. A true zip-bomb/decompression-ratio
  resource limit is out of scope here - see uploadValidation.ts's
  withParseTimeout docstring - this is the wall-clock mitigation, reported
  as DOCX_ARCHIVE_RESOURCE_LIMIT_REQUIRES_FOLLOWUP, not a complete fix.
*/
const LAYOUT_ANALYSIS_TIMEOUT_MS = 45_000;

export type ImportResumeResult = {
  status: "imported";
  profileId: string;
  versionId: string;
  sourceDocumentId: string;
  roundTripValid: boolean;
  // true only for the genuine no-op replay case (same content as the
  // profile's current latest version already) - a NEW version (whether
  // this is the profile's first version ever, or a new one superseding
  // an older resume) is always alreadyImported: false.
  alreadyImported: boolean;
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

    if (buffer.byteLength === 0 || buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new ValidationError([
        `Resume "${resumeId}" could not be imported: the stored file is empty or exceeds the maximum supported size.`,
      ]);
    }

    const contentHash = crypto.createHash("sha256").update(buffer).digest("hex");

    const memoryService = new CanonicalCareerMemoryService(this.repos);

    /*
      Phase 6I.5 - short-circuit ONLY when this content is already the
      profile's CURRENT LATEST version's own source (a genuine replay of
      the active resume), not "any resume this profile has ever seen."
      Looked up via the raw repos (not getCanonicalRuntime(), which
      returns the mapped Runtime and does not expose which source
      document produced the current version) so this stays a cheap
      existence check with no parsing before we know a real import is
      even needed.
    */
    const existingProfile = await this.repos.profiles.getByUserId(userId);
    if (existingProfile) {
      const currentLatestVersion = await this.repos.resumeVersions.getLatestByProfileId(existingProfile.id);
      const currentLatestSourceDoc = currentLatestVersion?.source_document_id
        ? await this.repos.sourceDocuments.getById(currentLatestVersion.source_document_id)
        : null;
      if (currentLatestVersion && currentLatestSourceDoc && currentLatestSourceDoc.content_hash === contentHash) {
        return {
          status: "imported",
          profileId: existingProfile.id,
          versionId: currentLatestVersion.id,
          sourceDocumentId: currentLatestSourceDoc.id,
          roundTripValid: true,
          alreadyImported: true,
        };
      }
    }

    let layoutResult;
    try {
      layoutResult = await withParseTimeout(
        analyzeDocument("resume", sourceFormat, buffer),
        LAYOUT_ANALYSIS_TIMEOUT_MS,
        "IMPORT_ANALYSIS_TIMEOUT",
        "This resume took too long to process for import. Please try again or upload a simpler file."
      );
    } catch (timeoutError) {
      if (timeoutError instanceof UploadValidationError) {
        throw new ValidationError([`${timeoutError.code}: ${timeoutError.message}`]);
      }
      throw timeoutError;
    }
    const losslessDoc = buildLosslessResumeDocument(layoutResult, {
      fileName: resume.file_name ?? "resume",
      fileType: sourceFormat,
    });
    if (!losslessDoc.validation.passed) {
      const { code, summary } = classifyLosslessValidationFailure(losslessDoc.validation);
      throw new ValidationError([`${code}: ${summary}`]);
    }

    const structuredModel = buildStructuredResume(losslessDoc);
    if (!structuredModel.validation.passed) {
      const { code, summary } = classifyStructuredValidationFailure(structuredModel.validation);
      throw new ValidationError([`${code}: ${summary}`]);
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
      /*
        Phase 6I.5 - keyed by contentHash, not resumeId: two different
        resumeId rows holding the exact same file bytes (e.g. a re-
        upload after the original resumes row was deleted) must
        register/replay the SAME source document row, never a
        duplicate. registerSourceDocument's own (profile_id,
        content_hash) unique index already enforces this at the DB
        level - this idempotency key is the defense-in-depth layer on
        top, matching that same real identity instead of the transient
        resumeId.
      */
      idempotencyKey: `canonical-import-source-doc:${contentHash}`,
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
      /*
        Phase 6I.5 - keyed by contentHash, not resumeId, for the same
        reason as registerSourceDocument's key above: this is the
        version-level idempotency guard for a genuinely concurrent/
        retried request for the SAME content (the request-level race,
        not the "is this already the current version" check already
        handled above) - it must key off the real identity (the bytes),
        not the transient resumeId, so two different resumeId rows for
        identical content can never race their way into two versions.
      */
      idempotencyKey: `canonical-import-resume:${contentHash}`,
    });

    return {
      status: "imported",
      profileId: profile.id,
      versionId: saveResult.version.id,
      sourceDocumentId: registeredDoc.id,
      roundTripValid: saveResult.roundTripValid,
      alreadyImported: false,
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
