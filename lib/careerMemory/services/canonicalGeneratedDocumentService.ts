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
};

const ALLOWED_FILE_TYPES: GeneratedResumeDocumentFileType[] = ["pdf", "docx"];

export class CanonicalGeneratedDocumentService {
  constructor(private readonly repos: CanonicalRepositoryBundle) {}

  async createGeneratedDocument(userId: string, input: CreateGeneratedDocumentInput): Promise<GeneratedResumeDocumentRow> {
    await requireOwnedProfile(this.repos, userId, input.profileId);

    if (!ALLOWED_FILE_TYPES.includes(input.fileType)) throw new ValidationError([`fileType must be one of ${ALLOWED_FILE_TYPES.join("/")}`]);
    if (!input.storageBucket.trim() || !input.storagePath.trim()) throw new ValidationError(["storageBucket and storagePath must be non-empty"]);

    const tailoredResume = await this.repos.tailoredResumes.getById(input.tailoredResumeId);
    if (!tailoredResume || tailoredResume.profile_id !== input.profileId) throw new NotFoundError("Tailored resume");

    return this.repos.generatedResumeDocuments.insert({
      tailored_resume_id: input.tailoredResumeId,
      storage_bucket: input.storageBucket,
      storage_path: input.storagePath,
      file_type: input.fileType,
    });
  }

  async listGeneratedDocuments(userId: string, profileId: string, tailoredResumeId: string): Promise<GeneratedResumeDocumentRow[]> {
    await requireOwnedProfile(this.repos, userId, profileId);
    const tailoredResume = await this.repos.tailoredResumes.getById(tailoredResumeId);
    if (!tailoredResume || tailoredResume.profile_id !== profileId) throw new NotFoundError("Tailored resume");
    return this.repos.generatedResumeDocuments.listByTailoredResumeId(tailoredResumeId);
  }
}
