/*
  Phase 6D - Source Document Service. Metadata registration only - no
  file upload, no Storage object read/write anywhere in this file (§12's
  own explicit instruction). "Storage object의 존재는 이번 라운드에서
  확인하지 않는다": storageBucket/storagePath are recorded as-given,
  never verified against a real bucket.
*/
import { NotFoundError, ValidationError } from "../errors/domainErrors";
import type { CareerSourceDocumentRow, SourceDocumentAnalysisStatus, SourceDocumentFileType } from "../persistence/types";
import type { CanonicalRepositoryBundle } from "../repositories/createRepositories";
import { requireOwnedProfile } from "./profileAccess";

export type RegisterSourceDocumentInput = {
  profileId: string;
  fileName: string;
  fileType: SourceDocumentFileType;
  mimeType?: string | null;
  byteSize?: number | null;
  contentHash: string;
  storageBucket: string;
  storagePath: string;
  parserVersion?: string | null;
  idempotencyKey?: string | null;
};

const ALLOWED_FILE_TYPES: SourceDocumentFileType[] = ["pdf", "docx"];
const CONTENT_HASH_PATTERN = /^[a-z0-9-]{8,128}$/i;

function validateRegisterInput(input: RegisterSourceDocumentInput): void {
  const issues: string[] = [];
  if (!ALLOWED_FILE_TYPES.includes(input.fileType)) issues.push(`fileType must be one of ${ALLOWED_FILE_TYPES.join("/")}`);
  if (input.byteSize !== undefined && input.byteSize !== null && input.byteSize < 0) issues.push("byteSize must be >= 0");
  if (!input.storageBucket || input.storageBucket.trim().length === 0) issues.push("storageBucket must be non-empty");
  if (!input.storagePath || input.storagePath.trim().length === 0) issues.push("storagePath must be non-empty");
  if (!CONTENT_HASH_PATTERN.test(input.contentHash)) issues.push("contentHash must be an 8-128 character hex/base36-like string");
  if (!input.fileName || input.fileName.trim().length === 0) issues.push("fileName must be non-empty");
  if (issues.length > 0) throw new ValidationError(issues);
}

export class CanonicalSourceDocumentService {
  constructor(private readonly repos: CanonicalRepositoryBundle) {}

  /*
    Phase 6D.1 - runs through the register_canonical_source_document()
    SQL RPC. Doubly idempotent: the real partial UNIQUE index on
    (profile_id, content_hash) (Phase 6B) still dedupes by content, and
    the RPC's own idempotency-key check dedupes a retry that hasn't
    computed a hash-bearing request identically twice.
  */
  async registerSourceDocument(userId: string, input: RegisterSourceDocumentInput): Promise<CareerSourceDocumentRow> {
    validateRegisterInput(input);
    await requireOwnedProfile(this.repos, userId, input.profileId);

    const rpcResult = await this.repos.transactions.registerSourceDocument({
      profileId: input.profileId,
      storageBucket: input.storageBucket,
      storagePath: input.storagePath,
      originalFileName: input.fileName,
      mimeType: input.mimeType ?? null,
      byteSize: input.byteSize ?? null,
      contentHash: input.contentHash,
      parserVersion: input.parserVersion ?? null,
      fileType: input.fileType,
      idempotencyKey: input.idempotencyKey ?? null,
    });
    if (rpcResult.status === "not_found") throw new NotFoundError("Career profile");

    const row = await this.repos.sourceDocuments.getById(rpcResult.sourceDocumentId);
    if (!row) throw new NotFoundError("Registered source document");
    return row;
  }

  async listSourceDocuments(userId: string, profileId: string): Promise<CareerSourceDocumentRow[]> {
    await requireOwnedProfile(this.repos, userId, profileId);
    return this.repos.sourceDocuments.listByProfileId(profileId);
  }

  async findByContentHash(userId: string, profileId: string, contentHash: string): Promise<CareerSourceDocumentRow | null> {
    await requireOwnedProfile(this.repos, userId, profileId);
    return this.repos.sourceDocuments.findByContentHash(profileId, contentHash);
  }

  async updateAnalysisStatus(userId: string, profileId: string, sourceDocumentId: string, status: SourceDocumentAnalysisStatus): Promise<CareerSourceDocumentRow> {
    await requireOwnedProfile(this.repos, userId, profileId);
    const row = await this.repos.sourceDocuments.getById(sourceDocumentId);
    if (!row || row.profile_id !== profileId) throw new ValidationError([`source document ${sourceDocumentId} does not belong to profile ${profileId}`]);
    return this.repos.sourceDocuments.updateAnalysisStatus(sourceDocumentId, status);
  }
}
