/*
  Phase 6B - Persistence Layer row types. Mirrors the 12 tables added by
  supabase/migrations/20260806010000_career_memory_persistence_layer.sql
  column-for-column (snake_case, matching the DB exactly) - these types
  describe what a Supabase client would actually receive/send for these
  tables, nothing more.

  Deliberately does NOT import anything from lib/careerMemory/runtime/**
  (Phase 6A.2's CanonicalResumeRuntime/ResumeStructuredModel types) -
  this file only knows about the DATABASE shape. Bridging a Row to/from
  a Runtime object is mappers.ts's job, and even that file only
  declares the contract this round (§8's own instruction: "Runtime
  Layer import 금지").

  Every table gets three type variants:
  - `<Name>Row` - what a SELECT returns (every column, non-optional
    where the DB itself guarantees a value via NOT NULL/DEFAULT).
  - `<Name>InsertInput` - what an INSERT needs (server-generated
    columns like `id`/`created_at`/`updated_at` are optional, since the
    DB default supplies them when omitted).
  - `<Name>UpdateInput` - every column optional (a partial patch).
*/

// ============================================================
// career_profiles
// ============================================================
export type CareerProfileRow = {
  id: string;
  user_id: string;
  identity: Record<string, unknown>;
  summary_text: string | null;
  preferences: Record<string, unknown>;
  schema_version: string;
  serializer_version: string;
  /*
    Phase 6I.2 - profile-level canonical template preference. NULL until
    the user explicitly picks one via PUT
    /api/internal/canonical-career-memory/template-preference - never
    auto-assigned. See supabase/migrations/
    20260808010000_canonical_default_template_id.sql for the CHECK
    constraint (same 4 ids as applications.selected_template_id, a
    deliberately separate column - see that migration's own comment).
  */
  default_template_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CareerProfileInsertInput = {
  id?: string;
  user_id: string;
  identity?: Record<string, unknown>;
  summary_text?: string | null;
  preferences?: Record<string, unknown>;
  schema_version: string;
  serializer_version: string;
  default_template_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CareerProfileUpdateInput = Partial<Omit<CareerProfileRow, "id" | "user_id">>;

// ============================================================
// career_source_documents
// ============================================================
export type SourceDocumentFileType = "pdf" | "docx";
export type SourceDocumentAnalysisStatus = "pending" | "processing" | "succeeded" | "failed";

export type CareerSourceDocumentRow = {
  id: string;
  profile_id: string;
  storage_bucket: string;
  storage_path: string;
  original_file_name: string | null;
  mime_type: string | null;
  byte_size: number | null;
  content_hash: string | null;
  parser_version: string | null;
  file_type: SourceDocumentFileType;
  analysis_status: SourceDocumentAnalysisStatus;
  created_at: string;
  updated_at: string;
};

export type CareerSourceDocumentInsertInput = {
  id?: string;
  profile_id: string;
  storage_bucket: string;
  storage_path: string;
  original_file_name?: string | null;
  mime_type?: string | null;
  byte_size?: number | null;
  content_hash?: string | null;
  parser_version?: string | null;
  file_type: SourceDocumentFileType;
  analysis_status?: SourceDocumentAnalysisStatus;
  created_at?: string;
  updated_at?: string;
};

export type CareerSourceDocumentUpdateInput = Partial<Omit<CareerSourceDocumentRow, "id" | "profile_id">>;

// ============================================================
// career_resume_versions
// ============================================================
export type ResumeVersionReason = "initial" | "reanalysis" | "user_edit" | "merge" | "import" | "restore";

export type CareerResumeVersionRow = {
  id: string;
  profile_id: string;
  source_document_id: string | null;
  parent_version_id: string | null;
  reason: ResumeVersionReason;
  snapshot: Record<string, unknown>;
  schema_version: string;
  serializer_version: string;
  created_at: string;
  updated_at: string;
};

export type CareerResumeVersionInsertInput = {
  id?: string;
  profile_id: string;
  source_document_id?: string | null;
  parent_version_id?: string | null;
  reason: ResumeVersionReason;
  snapshot: Record<string, unknown>;
  schema_version: string;
  serializer_version: string;
  created_at?: string;
  updated_at?: string;
};

export type CareerResumeVersionUpdateInput = Partial<Omit<CareerResumeVersionRow, "id" | "profile_id">>;

// ============================================================
// career_experiences
// ============================================================
export type CareerExperienceRow = {
  id: string;
  profile_id: string;
  source_document_id: string | null;
  organization: string | null;
  role: string | null;
  location: string | null;
  date_range_text: string | null;
  start_date_text: string | null;
  end_date_text: string | null;
  is_volunteer: boolean;
  content: unknown[];
  hierarchical_content: unknown[];
  has_hierarchical_structure: boolean;
  source_trace: Record<string, unknown> | null;
  confidence: number | null;
  is_uncertain: boolean;
  is_hidden: boolean;
  raw_header_text: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CareerExperienceInsertInput = {
  id?: string;
  profile_id: string;
  source_document_id?: string | null;
  organization?: string | null;
  role?: string | null;
  location?: string | null;
  date_range_text?: string | null;
  start_date_text?: string | null;
  end_date_text?: string | null;
  is_volunteer?: boolean;
  content?: unknown[];
  hierarchical_content?: unknown[];
  has_hierarchical_structure?: boolean;
  source_trace?: Record<string, unknown> | null;
  confidence?: number | null;
  is_uncertain?: boolean;
  is_hidden?: boolean;
  raw_header_text?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
};

export type CareerExperienceUpdateInput = Partial<Omit<CareerExperienceRow, "id" | "profile_id">>;

// ============================================================
// career_languages
// ============================================================
export type CareerLanguageRow = {
  id: string;
  profile_id: string;
  name: string;
  proficiency: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CareerLanguageInsertInput = {
  id?: string;
  profile_id: string;
  name: string;
  proficiency?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
};

export type CareerLanguageUpdateInput = Partial<Omit<CareerLanguageRow, "id" | "profile_id">>;

// ============================================================
// career_projects
// ============================================================
export type CareerProjectRow = {
  id: string;
  profile_id: string;
  source_document_id: string | null;
  name: string | null;
  role: string | null;
  date_range_text: string | null;
  technologies: unknown[];
  content: unknown[];
  source_trace: Record<string, unknown> | null;
  is_hidden: boolean;
  raw_header_text: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CareerProjectInsertInput = {
  id?: string;
  profile_id: string;
  source_document_id?: string | null;
  name?: string | null;
  role?: string | null;
  date_range_text?: string | null;
  technologies?: unknown[];
  content?: unknown[];
  source_trace?: Record<string, unknown> | null;
  is_hidden?: boolean;
  raw_header_text?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
};

export type CareerProjectUpdateInput = Partial<Omit<CareerProjectRow, "id" | "profile_id">>;

// ============================================================
// career_credentials
// ============================================================
export type CredentialKind = "certification" | "license" | "registration" | "unknown";

export type CareerCredentialRow = {
  id: string;
  profile_id: string;
  source_document_id: string | null;
  name: string | null;
  issuer: string | null;
  credential_id: string | null;
  issue_date_text: string | null;
  expiry_date_text: string | null;
  location: string | null;
  kind: CredentialKind;
  details: unknown[];
  source_trace: Record<string, unknown> | null;
  is_hidden: boolean;
  raw_header_text: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CareerCredentialInsertInput = {
  id?: string;
  profile_id: string;
  source_document_id?: string | null;
  name?: string | null;
  issuer?: string | null;
  credential_id?: string | null;
  issue_date_text?: string | null;
  expiry_date_text?: string | null;
  location?: string | null;
  kind?: CredentialKind;
  details?: unknown[];
  source_trace?: Record<string, unknown> | null;
  is_hidden?: boolean;
  raw_header_text?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
};

export type CareerCredentialUpdateInput = Partial<Omit<CareerCredentialRow, "id" | "profile_id">>;

// ============================================================
// career_awards
// ============================================================
export type CareerAwardRow = {
  id: string;
  profile_id: string;
  source_document_id: string | null;
  name: string | null;
  issuer: string | null;
  date_text: string | null;
  details: unknown[];
  source_trace: Record<string, unknown> | null;
  is_hidden: boolean;
  raw_header_text: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CareerAwardInsertInput = {
  id?: string;
  profile_id: string;
  source_document_id?: string | null;
  name?: string | null;
  issuer?: string | null;
  date_text?: string | null;
  details?: unknown[];
  source_trace?: Record<string, unknown> | null;
  is_hidden?: boolean;
  raw_header_text?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
};

export type CareerAwardUpdateInput = Partial<Omit<CareerAwardRow, "id" | "profile_id">>;

// ============================================================
// career_publications
// ============================================================
export type CareerPublicationRow = {
  id: string;
  profile_id: string;
  source_document_id: string | null;
  title: string | null;
  authors: unknown[];
  publisher_or_venue: string | null;
  date_text: string | null;
  url_or_doi: string | null;
  details: unknown[];
  source_trace: Record<string, unknown> | null;
  is_hidden: boolean;
  raw_header_text: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CareerPublicationInsertInput = {
  id?: string;
  profile_id: string;
  source_document_id?: string | null;
  title?: string | null;
  authors?: unknown[];
  publisher_or_venue?: string | null;
  date_text?: string | null;
  url_or_doi?: string | null;
  details?: unknown[];
  source_trace?: Record<string, unknown> | null;
  is_hidden?: boolean;
  raw_header_text?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
};

export type CareerPublicationUpdateInput = Partial<Omit<CareerPublicationRow, "id" | "profile_id">>;

// ============================================================
// career_tailored_resumes
// ============================================================
export type CareerTailoredResumeRow = {
  id: string;
  profile_id: string;
  application_id: string | null;
  resume_version_id: string | null;
  overlay: Record<string, unknown>;
  template_id: string | null;
  ai_model: string | null;
  prompt_version: string | null;
  created_at: string;
  updated_at: string;
};

export type CareerTailoredResumeInsertInput = {
  id?: string;
  profile_id: string;
  application_id?: string | null;
  resume_version_id?: string | null;
  overlay: Record<string, unknown>;
  template_id?: string | null;
  ai_model?: string | null;
  prompt_version?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CareerTailoredResumeUpdateInput = Partial<Omit<CareerTailoredResumeRow, "id" | "profile_id">>;

// ============================================================
// career_user_edits
// ============================================================
export type CareerUserEditRow = {
  id: string;
  profile_id: string;
  target_table: string;
  target_id: string;
  field_path: string;
  previous_value: unknown;
  new_value: unknown;
  edited_at: string;
  created_at: string;
  updated_at: string;
};

export type CareerUserEditInsertInput = {
  id?: string;
  profile_id: string;
  target_table: string;
  target_id: string;
  field_path: string;
  previous_value?: unknown;
  new_value?: unknown;
  edited_at?: string;
  created_at?: string;
  updated_at?: string;
};

export type CareerUserEditUpdateInput = Partial<Omit<CareerUserEditRow, "id" | "profile_id">>;

// ============================================================
// generated_resume_documents
// ============================================================
export type GeneratedResumeDocumentFileType = "pdf" | "docx";

export type GeneratedResumeDocumentRow = {
  id: string;
  tailored_resume_id: string;
  storage_bucket: string;
  storage_path: string;
  file_type: GeneratedResumeDocumentFileType;
  created_at: string;
  updated_at: string;
};

export type GeneratedResumeDocumentInsertInput = {
  id?: string;
  tailored_resume_id: string;
  storage_bucket: string;
  storage_path: string;
  file_type: GeneratedResumeDocumentFileType;
  created_at?: string;
  updated_at?: string;
};

export type GeneratedResumeDocumentUpdateInput = Partial<Omit<GeneratedResumeDocumentRow, "id" | "tailored_resume_id">>;
