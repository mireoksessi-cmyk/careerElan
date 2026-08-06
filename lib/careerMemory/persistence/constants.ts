/*
  Phase 6B - Persistence Layer constants. Table names (matching the
  migration exactly) and the documented Storage layout this schema
  expects buckets/paths to eventually follow - no bucket is created or
  modified anywhere in this round (§6's own instruction: "Storage
  Bucket 생성 금지... Storage Layout 문서화만 수행").
*/

export const CAREER_MEMORY_TABLE_NAMES = {
  careerProfiles: "career_profiles",
  careerSourceDocuments: "career_source_documents",
  careerResumeVersions: "career_resume_versions",
  careerExperiences: "career_experiences",
  careerLanguages: "career_languages",
  careerProjects: "career_projects",
  careerCredentials: "career_credentials",
  careerAwards: "career_awards",
  careerPublications: "career_publications",
  careerTailoredResumes: "career_tailored_resumes",
  careerUserEdits: "career_user_edits",
  generatedResumeDocuments: "generated_resume_documents",
} as const;

export type CareerMemoryTableName = (typeof CAREER_MEMORY_TABLE_NAMES)[keyof typeof CAREER_MEMORY_TABLE_NAMES];

/*
  Documented Storage layout (NOT created, NOT wired up). Mirrors the
  existing `resumes`/`cover-letters` buckets' own path convention
  ({user_id}/... path-ownership prefix, confirmed by the Phase 6A audit's
  storage_rls_owner_check.sql finding) so a future bucket-creation round
  can reuse the exact same RLS policy shape without redesigning it.

  - resume-sources/{profile_id}/{source_document_id}/original.{pdf|docx}
    One object per career_source_documents row - the untouched original
    upload, never overwritten in place (a re-upload creates a NEW
    source_document_id/row instead, per the Phase 6A.2 Versioning
    Contract's own "Resume Upload -> Version 생성" rule).

  - generated-resumes/{profile_id}/{tailored_resume_id}/resume.{pdf|docx}
    One object per generated_resume_documents row, keyed by the
    tailored_resume_id it was rendered from (never the profile_id
    directly), so multiple job-specific renders of the same profile
    never collide on a path.
*/
export const CAREER_MEMORY_STORAGE_LAYOUT = {
  sourceDocumentBucket: "resume-sources",
  sourceDocumentPathTemplate: "{profile_id}/{source_document_id}/original.{extension}",
  generatedResumeBucket: "generated-resumes",
  generatedResumePathTemplate: "{profile_id}/{tailored_resume_id}/resume.{extension}",
} as const;

export function buildSourceDocumentStoragePath(profileId: string, sourceDocumentId: string, fileType: "pdf" | "docx"): string {
  return `${profileId}/${sourceDocumentId}/original.${fileType}`;
}

export function buildGeneratedResumeStoragePath(profileId: string, tailoredResumeId: string, fileType: "pdf" | "docx"): string {
  return `${profileId}/${tailoredResumeId}/resume.${fileType}`;
}
