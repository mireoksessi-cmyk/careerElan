/*
  Phase 6D.1 - the ONLY place any of the 5 SQL RPCs from
  supabase/migrations/20260806020000_career_memory_transaction_idempotency.sql
  are called. Every write this class exposes runs as a single Postgres
  function invocation - real atomicity (rollback on any mid-function
  failure) and real idempotency-key deduplication, not simulated in
  application code. Services call THIS, never `.from(table).insert()`,
  for the 5 operations covered here - see each RPC's own header comment
  in the migration for what it guarantees.
*/
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapPostgrestError } from "./postgrestErrors";
import type {
  CareerAwardInsertInput,
  CareerCredentialInsertInput,
  CareerExperienceInsertInput,
  CareerProjectInsertInput,
  CareerPublicationInsertInput,
  CareerResumeVersionInsertInput,
  SourceDocumentFileType,
  GeneratedResumeDocumentFileType,
} from "../persistence/types";

export type SaveCanonicalRuntimeRpcResult =
  | { status: "success"; profileId: string; versionId: string; parentVersionId: string | null; createdAt: string }
  | { status: "conflict"; expectedCurrentVersionId: string | null; actualCurrentVersionId: string | null };

export type RestoreVersionRpcResult = { status: "not_found"; reason: string } | { status: "success"; versionId: string; restoredFromVersionId: string; parentVersionId: string | null; createdAt: string };

export type CreateOverlayRpcResult = { status: "not_found"; reason: string } | { status: "success"; overlayId: string; createdAt: string };

export type RegisterSourceDocumentRpcResult = { status: "not_found"; reason: string } | { status: "success"; sourceDocumentId: string; createdAt: string };

export type CreateGeneratedDocumentRpcResult = { status: "not_found"; reason: string } | { status: "success"; generatedDocumentId: string; createdAt: string };

export class CanonicalTransactionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async saveCanonicalRuntime(input: {
    profileDefaults: { schemaVersion: string; serializerVersion: string };
    versionInput: CareerResumeVersionInsertInput;
    experiences: CareerExperienceInsertInput[];
    projects: CareerProjectInsertInput[];
    credentials: CareerCredentialInsertInput[];
    awards: CareerAwardInsertInput[];
    publications: CareerPublicationInsertInput[];
    checkExpectedVersion: boolean;
    expectedCurrentVersionId: string | null;
    idempotencyKey: string | null;
  }): Promise<SaveCanonicalRuntimeRpcResult> {
    const { data, error } = await this.client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: input.profileDefaults.schemaVersion, serializer_version: input.profileDefaults.serializerVersion },
      p_version_input: input.versionInput,
      p_experiences: input.experiences,
      p_projects: input.projects,
      p_credentials: input.credentials,
      p_awards: input.awards,
      p_publications: input.publications,
      p_check_expected_version: input.checkExpectedVersion,
      p_expected_current_version_id: input.expectedCurrentVersionId,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw mapPostgrestError(error, "CanonicalTransactionRepository.saveCanonicalRuntime");
    return data as SaveCanonicalRuntimeRpcResult;
  }

  async restoreVersion(input: { profileId: string; targetVersionId: string; idempotencyKey: string | null }): Promise<RestoreVersionRpcResult> {
    const { data, error } = await this.client.rpc("restore_canonical_version", {
      p_profile_id: input.profileId,
      p_target_version_id: input.targetVersionId,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw mapPostgrestError(error, "CanonicalTransactionRepository.restoreVersion");
    return data as RestoreVersionRpcResult;
  }

  async createOverlay(input: {
    profileId: string;
    applicationId: string | null;
    resumeVersionId: string | null;
    templateId: string | null;
    aiModel: string | null;
    promptVersion: string | null;
    overlayRecord: Record<string, unknown>;
    idempotencyKey: string | null;
  }): Promise<CreateOverlayRpcResult> {
    const { data, error } = await this.client.rpc("create_canonical_overlay", {
      p_profile_id: input.profileId,
      p_application_id: input.applicationId,
      p_resume_version_id: input.resumeVersionId,
      p_template_id: input.templateId,
      p_ai_model: input.aiModel,
      p_prompt_version: input.promptVersion,
      p_overlay_record: input.overlayRecord,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw mapPostgrestError(error, "CanonicalTransactionRepository.createOverlay");
    return data as CreateOverlayRpcResult;
  }

  async registerSourceDocument(input: {
    profileId: string;
    storageBucket: string;
    storagePath: string;
    originalFileName: string | null;
    mimeType: string | null;
    byteSize: number | null;
    contentHash: string;
    parserVersion: string | null;
    fileType: SourceDocumentFileType;
    idempotencyKey: string | null;
  }): Promise<RegisterSourceDocumentRpcResult> {
    const { data, error } = await this.client.rpc("register_canonical_source_document", {
      p_profile_id: input.profileId,
      p_storage_bucket: input.storageBucket,
      p_storage_path: input.storagePath,
      p_original_file_name: input.originalFileName,
      p_mime_type: input.mimeType,
      p_byte_size: input.byteSize,
      p_content_hash: input.contentHash,
      p_parser_version: input.parserVersion,
      p_file_type: input.fileType,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw mapPostgrestError(error, "CanonicalTransactionRepository.registerSourceDocument");
    return data as RegisterSourceDocumentRpcResult;
  }

  async createGeneratedDocument(input: {
    profileId: string;
    tailoredResumeId: string;
    storageBucket: string;
    storagePath: string;
    fileType: GeneratedResumeDocumentFileType;
    idempotencyKey: string | null;
  }): Promise<CreateGeneratedDocumentRpcResult> {
    const { data, error } = await this.client.rpc("create_canonical_generated_document", {
      p_profile_id: input.profileId,
      p_tailored_resume_id: input.tailoredResumeId,
      p_storage_bucket: input.storageBucket,
      p_storage_path: input.storagePath,
      p_file_type: input.fileType,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw mapPostgrestError(error, "CanonicalTransactionRepository.createGeneratedDocument");
    return data as CreateGeneratedDocumentRpcResult;
  }
}
