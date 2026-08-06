/*
  Phase 6D - Generated Document metadata Service. Never generates a
  real PDF/DOCX, never touches Storage, never calls a Template renderer
  or a signed-URL API (§16's own explicit prohibitions) - metadata rows
  only.
*/
import { NotFoundError, ValidationError } from "../errors/domainErrors";
import type { GeneratedResumeDocumentFileType, GeneratedResumeDocumentRow } from "../persistence/types";
import type { CanonicalRepositoryBundle } from "../repositories/createRepositories";
import { requireOwnedProfile } from "./profileAccess";

export type CreateGeneratedDocumentInput = {
  profileId: string;
  tailoredResumeId: string;
  storageBucket: string;
  storagePath: string;
  fileType: GeneratedResumeDocumentFileType;
  idempotencyKey?: string | null;
};

const ALLOWED_FILE_TYPES: GeneratedResumeDocumentFileType[] = ["pdf", "docx"];

export class CanonicalGeneratedDocumentService {
  constructor(private readonly repos: CanonicalRepositoryBundle) {}

  /*
    Phase 6D.1 - runs through the create_canonical_generated_document()
    SQL RPC (idempotency-key aware). Not one of §2's named "4 write
    workflows" but added per §7's own explicit idempotency requirement
    for generated documents.
  */
  async createGeneratedDocument(userId: string, input: CreateGeneratedDocumentInput): Promise<GeneratedResumeDocumentRow> {
    await requireOwnedProfile(this.repos, userId, input.profileId);

    if (!ALLOWED_FILE_TYPES.includes(input.fileType)) throw new ValidationError([`fileType must be one of ${ALLOWED_FILE_TYPES.join("/")}`]);
    if (!input.storageBucket.trim() || !input.storagePath.trim()) throw new ValidationError(["storageBucket and storagePath must be non-empty"]);

    const rpcResult = await this.repos.transactions.createGeneratedDocument({
      profileId: input.profileId,
      tailoredResumeId: input.tailoredResumeId,
      storageBucket: input.storageBucket,
      storagePath: input.storagePath,
      fileType: input.fileType,
      idempotencyKey: input.idempotencyKey ?? null,
    });
    if (rpcResult.status === "not_found") throw new NotFoundError("Tailored resume");

    const row = await this.repos.generatedResumeDocuments.getById(rpcResult.generatedDocumentId);
    if (!row) throw new NotFoundError("Created generated document");
    return row;
  }

  async listGeneratedDocuments(userId: string, profileId: string, tailoredResumeId: string): Promise<GeneratedResumeDocumentRow[]> {
    await requireOwnedProfile(this.repos, userId, profileId);
    const tailoredResume = await this.repos.tailoredResumes.getById(tailoredResumeId);
    if (!tailoredResume || tailoredResume.profile_id !== profileId) throw new NotFoundError("Tailored resume");
    return this.repos.generatedResumeDocuments.listByTailoredResumeId(tailoredResumeId);
  }
}
