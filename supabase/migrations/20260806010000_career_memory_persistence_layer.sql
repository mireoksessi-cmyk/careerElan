-- Phase 6B - Canonical Career Memory Persistence Layer (schema only).
--
-- Adds 12 new tables that give the Phase 6A.2 Runtime Layer
-- (lib/careerMemory/runtime/**, NOT modified by this migration) a real
-- place to eventually be persisted. This migration is additive only:
-- it does not touch the existing `career_memory`, `resumes`, or
-- `applications` tables in any way - no ALTER TABLE against any of
-- them, only a few new FK REFERENCES pointing AT `applications(id)`
-- from the new tables below, which does not modify that table's own
-- definition.
--
-- Not wired into any application code in this round - see
-- lib/careerMemory/persistence/** for the (interface-only) repository/
-- mapper layer that will eventually read/write these tables.
--
-- Design conventions, matched deliberately to this project's existing
-- migrations (confirmed via the Phase 6A/6A.1 audit rounds):
--   - No native `CREATE TYPE ... AS ENUM` anywhere in this codebase's
--     prior migrations - every closed-value column here is `text` +
--     a `CHECK (... IN (...))` constraint instead, for consistency.
--   - Every user-owned row traces back to `auth.users` via
--     `career_profiles.user_id`, `ON DELETE CASCADE` - deleting a user
--     cascades through every table below with zero orphaned rows,
--     closing the gap the Phase 6A audit found on several EXISTING
--     tables (`analytics_cache`, `subscriptions`, etc. lack this FK).
--   - `gen_random_uuid()` for every PK default (matches every existing
--     uuid PK in this schema; `uuid-ossp`'s `uuid_generate_v4()` is
--     installed but unused anywhere in this project's own migrations).
--   - JSONB columns default to an empty array/object rather than NULL,
--     so application code can always safely iterate them.

-- ============================================================
-- career_profiles - one row per user, the canonical snapshot root.
-- ============================================================
create table if not exists public.career_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,

  identity jsonb not null default '{}'::jsonb,
  summary_text text,
  preferences jsonb not null default '{}'::jsonb,

  schema_version text not null,
  serializer_version text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists career_profiles_user_id_idx on public.career_profiles(user_id);

alter table public.career_profiles enable row level security;

create policy "career_profiles_select" on public.career_profiles
  for select to authenticated
  using (user_id = auth.uid());

create policy "career_profiles_insert" on public.career_profiles
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "career_profiles_update" on public.career_profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "career_profiles_delete" on public.career_profiles
  for delete to authenticated
  using (user_id = auth.uid());


-- ============================================================
-- career_source_documents - original file metadata (Storage path,
-- checksum, analysis status). Storage bucket/object creation is
-- explicitly OUT OF SCOPE for this migration - only path/bucket NAME
-- columns are declared here (see lib/careerMemory/persistence/README.md
-- for the documented, not-yet-created bucket layout).
-- ============================================================
create table if not exists public.career_source_documents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.career_profiles(id) on delete cascade,

  storage_bucket text not null,
  storage_path text not null,
  original_file_name text,
  mime_type text,
  byte_size bigint,
  content_hash text,
  parser_version text,

  file_type text not null,
  analysis_status text not null default 'pending',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint career_source_documents_file_type_check
    check (file_type in ('pdf', 'docx')),
  constraint career_source_documents_analysis_status_check
    check (analysis_status in ('pending', 'processing', 'succeeded', 'failed')),
  constraint career_source_documents_byte_size_check
    check (byte_size is null or byte_size >= 0)
);

create index if not exists career_source_documents_profile_id_idx on public.career_source_documents(profile_id);
create unique index if not exists career_source_documents_profile_content_hash_uidx
  on public.career_source_documents(profile_id, content_hash)
  where content_hash is not null;

alter table public.career_source_documents enable row level security;

create policy "career_source_documents_select" on public.career_source_documents
  for select to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_source_documents.profile_id and p.user_id = auth.uid()));

create policy "career_source_documents_insert" on public.career_source_documents
  for insert to authenticated
  with check (exists (select 1 from public.career_profiles p where p.id = career_source_documents.profile_id and p.user_id = auth.uid()));

create policy "career_source_documents_update" on public.career_source_documents
  for update to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_source_documents.profile_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.career_profiles p where p.id = career_source_documents.profile_id and p.user_id = auth.uid()));

create policy "career_source_documents_delete" on public.career_source_documents
  for delete to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_source_documents.profile_id and p.user_id = auth.uid()));


-- ============================================================
-- career_resume_versions - immutable snapshot history. `snapshot`
-- holds a full serialized ResumeStructuredModel-shaped payload (this
-- migration never imports or depends on that TypeScript type - it is
-- simply stored as opaque JSONB here).
-- ============================================================
create table if not exists public.career_resume_versions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.career_profiles(id) on delete cascade,
  source_document_id uuid references public.career_source_documents(id) on delete set null,
  parent_version_id uuid references public.career_resume_versions(id) on delete set null,

  reason text not null,
  snapshot jsonb not null,
  schema_version text not null,
  serializer_version text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint career_resume_versions_reason_check
    check (reason in ('initial', 'reanalysis', 'user_edit', 'merge', 'import', 'restore'))
);

create index if not exists career_resume_versions_profile_id_idx on public.career_resume_versions(profile_id);
create index if not exists career_resume_versions_source_document_id_idx on public.career_resume_versions(source_document_id);
create index if not exists career_resume_versions_parent_version_id_idx on public.career_resume_versions(parent_version_id);
create index if not exists career_resume_versions_profile_created_idx on public.career_resume_versions(profile_id, created_at);

alter table public.career_resume_versions enable row level security;

create policy "career_resume_versions_select" on public.career_resume_versions
  for select to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_resume_versions.profile_id and p.user_id = auth.uid()));

create policy "career_resume_versions_insert" on public.career_resume_versions
  for insert to authenticated
  with check (exists (select 1 from public.career_profiles p where p.id = career_resume_versions.profile_id and p.user_id = auth.uid()));

create policy "career_resume_versions_update" on public.career_resume_versions
  for update to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_resume_versions.profile_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.career_profiles p where p.id = career_resume_versions.profile_id and p.user_id = auth.uid()));

create policy "career_resume_versions_delete" on public.career_resume_versions
  for delete to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_resume_versions.profile_id and p.user_id = auth.uid()));


-- ============================================================
-- career_experiences - normalized professional/volunteer entries.
-- `content`/`hierarchical_content` hold the SAME JSON shapes as
-- ExperienceEntry.content[]/hierarchicalContent[] (Phase 5D.7) -
-- stored as opaque JSONB, never validated against that TypeScript
-- type by this migration.
-- ============================================================
create table if not exists public.career_experiences (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.career_profiles(id) on delete cascade,
  source_document_id uuid references public.career_source_documents(id) on delete set null,

  organization text,
  role text,
  location text,
  date_range_text text,
  start_date_text text,
  end_date_text text,
  is_volunteer boolean not null default false,

  content jsonb not null default '[]'::jsonb,
  hierarchical_content jsonb not null default '[]'::jsonb,
  has_hierarchical_structure boolean not null default false,

  source_trace jsonb,
  confidence numeric,
  is_uncertain boolean not null default false,
  is_hidden boolean not null default false,
  raw_header_text text,

  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists career_experiences_profile_id_idx on public.career_experiences(profile_id);
create index if not exists career_experiences_source_document_id_idx on public.career_experiences(source_document_id);
create index if not exists career_experiences_profile_sort_idx on public.career_experiences(profile_id, sort_order);

alter table public.career_experiences enable row level security;

create policy "career_experiences_select" on public.career_experiences
  for select to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_experiences.profile_id and p.user_id = auth.uid()));

create policy "career_experiences_insert" on public.career_experiences
  for insert to authenticated
  with check (exists (select 1 from public.career_profiles p where p.id = career_experiences.profile_id and p.user_id = auth.uid()));

create policy "career_experiences_update" on public.career_experiences
  for update to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_experiences.profile_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.career_profiles p where p.id = career_experiences.profile_id and p.user_id = auth.uid()));

create policy "career_experiences_delete" on public.career_experiences
  for delete to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_experiences.profile_id and p.user_id = auth.uid()));


-- ============================================================
-- career_languages
-- ============================================================
create table if not exists public.career_languages (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.career_profiles(id) on delete cascade,

  name text not null,
  proficiency text,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists career_languages_profile_id_idx on public.career_languages(profile_id);

alter table public.career_languages enable row level security;

create policy "career_languages_select" on public.career_languages
  for select to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_languages.profile_id and p.user_id = auth.uid()));

create policy "career_languages_insert" on public.career_languages
  for insert to authenticated
  with check (exists (select 1 from public.career_profiles p where p.id = career_languages.profile_id and p.user_id = auth.uid()));

create policy "career_languages_update" on public.career_languages
  for update to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_languages.profile_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.career_profiles p where p.id = career_languages.profile_id and p.user_id = auth.uid()));

create policy "career_languages_delete" on public.career_languages
  for delete to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_languages.profile_id and p.user_id = auth.uid()));


-- ============================================================
-- career_projects
-- ============================================================
create table if not exists public.career_projects (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.career_profiles(id) on delete cascade,
  source_document_id uuid references public.career_source_documents(id) on delete set null,

  name text,
  role text,
  date_range_text text,
  technologies jsonb not null default '[]'::jsonb,
  content jsonb not null default '[]'::jsonb,

  source_trace jsonb,
  is_hidden boolean not null default false,
  raw_header_text text,

  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists career_projects_profile_id_idx on public.career_projects(profile_id);
create index if not exists career_projects_source_document_id_idx on public.career_projects(source_document_id);

alter table public.career_projects enable row level security;

create policy "career_projects_select" on public.career_projects
  for select to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_projects.profile_id and p.user_id = auth.uid()));

create policy "career_projects_insert" on public.career_projects
  for insert to authenticated
  with check (exists (select 1 from public.career_profiles p where p.id = career_projects.profile_id and p.user_id = auth.uid()));

create policy "career_projects_update" on public.career_projects
  for update to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_projects.profile_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.career_profiles p where p.id = career_projects.profile_id and p.user_id = auth.uid()));

create policy "career_projects_delete" on public.career_projects
  for delete to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_projects.profile_id and p.user_id = auth.uid()));


-- ============================================================
-- career_credentials
-- ============================================================
create table if not exists public.career_credentials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.career_profiles(id) on delete cascade,
  source_document_id uuid references public.career_source_documents(id) on delete set null,

  name text,
  issuer text,
  credential_id text,
  issue_date_text text,
  expiry_date_text text,
  location text,
  kind text not null default 'unknown',
  details jsonb not null default '[]'::jsonb,

  source_trace jsonb,
  is_hidden boolean not null default false,
  raw_header_text text,

  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint career_credentials_kind_check
    check (kind in ('certification', 'license', 'registration', 'unknown'))
);

create index if not exists career_credentials_profile_id_idx on public.career_credentials(profile_id);
create index if not exists career_credentials_source_document_id_idx on public.career_credentials(source_document_id);

alter table public.career_credentials enable row level security;

create policy "career_credentials_select" on public.career_credentials
  for select to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_credentials.profile_id and p.user_id = auth.uid()));

create policy "career_credentials_insert" on public.career_credentials
  for insert to authenticated
  with check (exists (select 1 from public.career_profiles p where p.id = career_credentials.profile_id and p.user_id = auth.uid()));

create policy "career_credentials_update" on public.career_credentials
  for update to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_credentials.profile_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.career_profiles p where p.id = career_credentials.profile_id and p.user_id = auth.uid()));

create policy "career_credentials_delete" on public.career_credentials
  for delete to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_credentials.profile_id and p.user_id = auth.uid()));


-- ============================================================
-- career_awards
-- ============================================================
create table if not exists public.career_awards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.career_profiles(id) on delete cascade,
  source_document_id uuid references public.career_source_documents(id) on delete set null,

  name text,
  issuer text,
  date_text text,
  details jsonb not null default '[]'::jsonb,

  source_trace jsonb,
  is_hidden boolean not null default false,
  raw_header_text text,

  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists career_awards_profile_id_idx on public.career_awards(profile_id);
create index if not exists career_awards_source_document_id_idx on public.career_awards(source_document_id);

alter table public.career_awards enable row level security;

create policy "career_awards_select" on public.career_awards
  for select to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_awards.profile_id and p.user_id = auth.uid()));

create policy "career_awards_insert" on public.career_awards
  for insert to authenticated
  with check (exists (select 1 from public.career_profiles p where p.id = career_awards.profile_id and p.user_id = auth.uid()));

create policy "career_awards_update" on public.career_awards
  for update to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_awards.profile_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.career_profiles p where p.id = career_awards.profile_id and p.user_id = auth.uid()));

create policy "career_awards_delete" on public.career_awards
  for delete to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_awards.profile_id and p.user_id = auth.uid()));


-- ============================================================
-- career_publications
-- ============================================================
create table if not exists public.career_publications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.career_profiles(id) on delete cascade,
  source_document_id uuid references public.career_source_documents(id) on delete set null,

  title text,
  authors jsonb not null default '[]'::jsonb,
  publisher_or_venue text,
  date_text text,
  url_or_doi text,
  details jsonb not null default '[]'::jsonb,

  source_trace jsonb,
  is_hidden boolean not null default false,
  raw_header_text text,

  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists career_publications_profile_id_idx on public.career_publications(profile_id);
create index if not exists career_publications_source_document_id_idx on public.career_publications(source_document_id);

alter table public.career_publications enable row level security;

create policy "career_publications_select" on public.career_publications
  for select to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_publications.profile_id and p.user_id = auth.uid()));

create policy "career_publications_insert" on public.career_publications
  for insert to authenticated
  with check (exists (select 1 from public.career_profiles p where p.id = career_publications.profile_id and p.user_id = auth.uid()));

create policy "career_publications_update" on public.career_publications
  for update to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_publications.profile_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.career_profiles p where p.id = career_publications.profile_id and p.user_id = auth.uid()));

create policy "career_publications_delete" on public.career_publications
  for delete to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_publications.profile_id and p.user_id = auth.uid()));


-- ============================================================
-- career_tailored_resumes - job-specific overlay, kept structurally
-- SEPARATE from career_experiences/etc (never overwrites a canonical
-- row - matches the Phase 6A.2 Runtime Layer's own Overlay Contract,
-- where mergeTailoredOverlay never mutates its input model either).
-- `application_id` references the EXISTING `applications` table by id
-- only - this migration does not alter that table's own definition.
-- ============================================================
create table if not exists public.career_tailored_resumes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.career_profiles(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null,
  resume_version_id uuid references public.career_resume_versions(id) on delete set null,

  overlay jsonb not null,
  template_id text,
  ai_model text,
  prompt_version text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists career_tailored_resumes_profile_id_idx on public.career_tailored_resumes(profile_id);
create index if not exists career_tailored_resumes_application_id_idx on public.career_tailored_resumes(application_id);
create index if not exists career_tailored_resumes_resume_version_id_idx on public.career_tailored_resumes(resume_version_id);

alter table public.career_tailored_resumes enable row level security;

create policy "career_tailored_resumes_select" on public.career_tailored_resumes
  for select to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_tailored_resumes.profile_id and p.user_id = auth.uid()));

create policy "career_tailored_resumes_insert" on public.career_tailored_resumes
  for insert to authenticated
  with check (exists (select 1 from public.career_profiles p where p.id = career_tailored_resumes.profile_id and p.user_id = auth.uid()));

create policy "career_tailored_resumes_update" on public.career_tailored_resumes
  for update to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_tailored_resumes.profile_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.career_profiles p where p.id = career_tailored_resumes.profile_id and p.user_id = auth.uid()));

create policy "career_tailored_resumes_delete" on public.career_tailored_resumes
  for delete to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_tailored_resumes.profile_id and p.user_id = auth.uid()));


-- ============================================================
-- career_user_edits - provenance trail for direct user edits to any
-- canonical field, keyed generically by (target_table, target_id,
-- field_path) rather than one column per editable field, so this
-- table never needs a migration of its own when a new editable field
-- is added elsewhere.
-- ============================================================
create table if not exists public.career_user_edits (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.career_profiles(id) on delete cascade,

  target_table text not null,
  target_id uuid not null,
  field_path text not null,
  previous_value jsonb,
  new_value jsonb,

  edited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists career_user_edits_profile_id_idx on public.career_user_edits(profile_id);
create index if not exists career_user_edits_target_idx on public.career_user_edits(target_table, target_id);

alter table public.career_user_edits enable row level security;

create policy "career_user_edits_select" on public.career_user_edits
  for select to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_user_edits.profile_id and p.user_id = auth.uid()));

create policy "career_user_edits_insert" on public.career_user_edits
  for insert to authenticated
  with check (exists (select 1 from public.career_profiles p where p.id = career_user_edits.profile_id and p.user_id = auth.uid()));

create policy "career_user_edits_update" on public.career_user_edits
  for update to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_user_edits.profile_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.career_profiles p where p.id = career_user_edits.profile_id and p.user_id = auth.uid()));

create policy "career_user_edits_delete" on public.career_user_edits
  for delete to authenticated
  using (exists (select 1 from public.career_profiles p where p.id = career_user_edits.profile_id and p.user_id = auth.uid()));


-- ============================================================
-- generated_resume_documents - PDF/DOCX output metadata for one
-- tailored resume. Two levels removed from career_profiles, so its
-- RLS policy EXISTS-joins through career_tailored_resumes.
-- ============================================================
create table if not exists public.generated_resume_documents (
  id uuid primary key default gen_random_uuid(),
  tailored_resume_id uuid not null references public.career_tailored_resumes(id) on delete cascade,

  storage_bucket text not null,
  storage_path text not null,
  file_type text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint generated_resume_documents_file_type_check
    check (file_type in ('pdf', 'docx'))
);

create index if not exists generated_resume_documents_tailored_resume_id_idx on public.generated_resume_documents(tailored_resume_id);

alter table public.generated_resume_documents enable row level security;

create policy "generated_resume_documents_select" on public.generated_resume_documents
  for select to authenticated
  using (exists (
    select 1 from public.career_tailored_resumes t
    join public.career_profiles p on p.id = t.profile_id
    where t.id = generated_resume_documents.tailored_resume_id and p.user_id = auth.uid()
  ));

create policy "generated_resume_documents_insert" on public.generated_resume_documents
  for insert to authenticated
  with check (exists (
    select 1 from public.career_tailored_resumes t
    join public.career_profiles p on p.id = t.profile_id
    where t.id = generated_resume_documents.tailored_resume_id and p.user_id = auth.uid()
  ));

create policy "generated_resume_documents_update" on public.generated_resume_documents
  for update to authenticated
  using (exists (
    select 1 from public.career_tailored_resumes t
    join public.career_profiles p on p.id = t.profile_id
    where t.id = generated_resume_documents.tailored_resume_id and p.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.career_tailored_resumes t
    join public.career_profiles p on p.id = t.profile_id
    where t.id = generated_resume_documents.tailored_resume_id and p.user_id = auth.uid()
  ));

create policy "generated_resume_documents_delete" on public.generated_resume_documents
  for delete to authenticated
  using (exists (
    select 1 from public.career_tailored_resumes t
    join public.career_profiles p on p.id = t.profile_id
    where t.id = generated_resume_documents.tailored_resume_id and p.user_id = auth.uid()
  ));
