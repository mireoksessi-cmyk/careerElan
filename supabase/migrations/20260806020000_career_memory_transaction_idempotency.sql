-- Phase 6D.1 - Canonical Transaction & Idempotency Hardening.
--
-- Purely additive: one new table (career_idempotency_keys) and five new
-- SQL functions (RPCs). No ALTER/DROP against career_profiles,
-- career_resume_versions, career_experiences, career_projects,
-- career_credentials, career_awards, career_publications,
-- career_source_documents, career_tailored_resumes,
-- career_user_edits, generated_resume_documents, or any pre-existing
-- table (career_memory/resumes/applications included). Every RPC is
-- `security invoker` (the Postgres default, stated explicitly here) -
-- it runs with the CALLING role's own privileges, so the existing RLS
-- policies on every table below still apply exactly as they do for a
-- direct insert; this migration does not bypass RLS anywhere.
--
-- A PL/pgSQL function body invoked as a single statement (which is how
-- PostgREST/supabase-js .rpc() calls it) runs inside one implicit
-- transaction: if the function raises an unhandled exception at any
-- point, every write already performed inside that same call is rolled
-- back automatically by Postgres - this is what gives
-- save_canonical_runtime() real atomicity across 1 version row + 5
-- child-table replacements, closing the TRANSACTION_SCHEMA_GAP the
-- Phase 6D report disclosed (no application-level compensating
-- rollback needed anymore for this path).

-- ============================================================
-- Real bug found while wiring these RPCs against a live database
-- (never surfaced by prior FakeSupabaseClient-only testing, which
-- bypasses table-level privileges entirely): the Phase 6B migration
-- (20260806010000) enabled RLS and wrote policies for every
-- career_* table it created, but never issued the underlying
-- table-level privilege statement to `authenticated` - RLS policies
-- are irrelevant until that coarser table-level privilege is present
-- first, so every one of those 12 tables was actually unreachable by
-- any real authenticated request (PostgREST or this file's own RPCs) -
-- table structure was correct, RLS was correct, but the privilege
-- statement was simply missing. Fixed here additively (a privilege
-- statement, not a schema change) rather than by editing the existing
-- migration file. generated_resume_documents' own policies route
-- through career_tailored_resumes, so its access shape mirrors that
-- table's (select/insert/update/delete).
-- ============================================================
grant select, insert, update, delete on public.career_profiles to authenticated;
grant select, insert, update, delete on public.career_source_documents to authenticated;
grant select, insert, update, delete on public.career_resume_versions to authenticated;
grant select, insert, update, delete on public.career_experiences to authenticated;
grant select, insert, update, delete on public.career_languages to authenticated;
grant select, insert, update, delete on public.career_projects to authenticated;
grant select, insert, update, delete on public.career_credentials to authenticated;
grant select, insert, update, delete on public.career_awards to authenticated;
grant select, insert, update, delete on public.career_publications to authenticated;
grant select, insert, update, delete on public.career_tailored_resumes to authenticated;
grant select, insert, update, delete on public.career_user_edits to authenticated;
grant select, insert, update, delete on public.generated_resume_documents to authenticated;


-- ============================================================
-- career_idempotency_keys - one row per (user, request_key, operation).
-- A caller-supplied Idempotency-Key header maps to `request_key` here.
-- Storing the full response body (not just a hash, despite the
-- Phase 6D.1 spec's own example column name "response_hash") is a
-- deliberate deviation: a hash alone cannot be replayed back to a
-- retrying caller, only compared against - full storage of the
-- serialized boolean/uuid response is what actually restores the
-- Phase 6D.1 spec's own "기존 결과 반환" requirement on retry.
-- ============================================================
create table if not exists public.career_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  request_key text not null,
  operation text not null,
  response_body jsonb not null,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),

  constraint career_idempotency_keys_request_key_check
    check (length(request_key) between 1 and 200),
  constraint career_idempotency_keys_operation_check
    check (operation in ('save_canonical_runtime', 'restore_canonical_version', 'create_canonical_overlay', 'register_canonical_source_document', 'create_canonical_generated_document'))
);

create unique index if not exists career_idempotency_keys_unique
  on public.career_idempotency_keys(user_id, request_key, operation);
create index if not exists career_idempotency_keys_expires_at_idx
  on public.career_idempotency_keys(expires_at);

alter table public.career_idempotency_keys enable row level security;

drop policy if exists "career_idempotency_keys_select" on public.career_idempotency_keys;
create policy "career_idempotency_keys_select" on public.career_idempotency_keys
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "career_idempotency_keys_insert" on public.career_idempotency_keys;
create policy "career_idempotency_keys_insert" on public.career_idempotency_keys
  for insert to authenticated
  with check (user_id = auth.uid());

-- No update/delete policy - idempotency records are append-only and
-- expire by predicate (expires_at), never mutated in place.

-- Table-level privilege for the two operations its RLS policies allow
-- (select/insert only) - see this file's earlier note on why RLS alone
-- is not sufficient without this statement too.
grant select, insert on public.career_idempotency_keys to authenticated;


-- ============================================================
-- save_canonical_runtime - the one write with a real multi-table
-- atomicity requirement: 1 career_resume_versions row + up to 5
-- child-table full replacements (career_experiences/projects/
-- credentials/awards/publications). Validation of the resume shape
-- itself (validateCanonicalCoverage) stays in TypeScript - this
-- function only persists an ALREADY-VALIDATED bundle; it never
-- re-implements that validation in SQL.
--
-- Returns jsonb with a `status` field:
--   'replayed' - an idempotency key matched a prior successful call;
--                the ORIGINAL response is returned verbatim, no new
--                write of any kind happened this call.
--   'conflict' - expectedCurrentVersionId didn't match the actual
--                latest version; checked BEFORE any write, so a
--                conflict never leaves a partial write behind.
--   'success'  - the full bundle was written; every table listed
--                above was touched in this one function invocation.
-- Any other failure (bad snapshot shape hitting a NOT NULL/CHECK
-- constraint, etc.) raises a real Postgres exception, which rolls back
-- everything this call had already written - there is no code path
-- that returns from this function having written only SOME of the six
-- tables it's responsible for.
-- ============================================================
create or replace function public.save_canonical_runtime(
  p_profile_defaults jsonb,
  p_version_input jsonb,
  p_experiences jsonb default '[]'::jsonb,
  p_projects jsonb default '[]'::jsonb,
  p_credentials jsonb default '[]'::jsonb,
  p_awards jsonb default '[]'::jsonb,
  p_publications jsonb default '[]'::jsonb,
  p_check_expected_version boolean default false,
  p_expected_current_version_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
set search_path = ''
security invoker
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.career_profiles%rowtype;
  v_current_latest public.career_resume_versions%rowtype;
  v_new_version public.career_resume_versions%rowtype;
  v_idem_response jsonb;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if p_idempotency_key is not null then
    select response_body into v_idem_response
      from public.career_idempotency_keys
      where user_id = v_user_id and request_key = p_idempotency_key and operation = 'save_canonical_runtime' and expires_at > now();
    if found then
      return v_idem_response;
    end if;
  end if;

  select * into v_profile from public.career_profiles where user_id = v_user_id;
  if not found then
    insert into public.career_profiles (user_id, schema_version, serializer_version)
    values (v_user_id, p_profile_defaults->>'schema_version', p_profile_defaults->>'serializer_version')
    returning * into v_profile;
  end if;

  /* Real concurrency bug found via a genuine concurrent-request test
     against this live database (not caught by any earlier fake-client
     test, since those run single-threaded): without a lock here, two
     transactions running this function concurrently for the SAME
     profile can both read the same "current latest version" before
     either commits, so both pass the optimistic-concurrency check and
     both insert a new version - two siblings sharing one
     parent_version_id, not the conflict/success pair the caller
     expects. A transaction-scoped advisory lock keyed by profile id
     serializes concurrent callers for the SAME profile (blocks the
     second until the first's transaction commits or rolls back, so it
     then sees the first call's real result); it never blocks callers
     for DIFFERENT profiles, and needs no manual unlock - Postgres
     releases it automatically at transaction end either way. */
  perform pg_advisory_xact_lock(hashtext(v_profile.id::text));

  select * into v_current_latest from public.career_resume_versions
    where profile_id = v_profile.id
    order by created_at desc, id desc
    limit 1;

  if p_check_expected_version and (v_current_latest.id is distinct from p_expected_current_version_id) then
    return jsonb_build_object(
      'status', 'conflict',
      'expectedCurrentVersionId', p_expected_current_version_id,
      'actualCurrentVersionId', v_current_latest.id
    );
  end if;

  insert into public.career_resume_versions (
    profile_id, source_document_id, parent_version_id, reason, snapshot, schema_version, serializer_version
  ) values (
    v_profile.id,
    nullif(p_version_input->>'source_document_id', '')::uuid,
    v_current_latest.id,
    p_version_input->>'reason',
    p_version_input->'snapshot',
    p_version_input->>'schema_version',
    p_version_input->>'serializer_version'
  )
  returning * into v_new_version;

  delete from public.career_experiences where profile_id = v_profile.id;
  insert into public.career_experiences (
    profile_id, source_document_id, organization, role, location, date_range_text, start_date_text, end_date_text,
    is_volunteer, content, hierarchical_content, has_hierarchical_structure, source_trace, confidence, is_uncertain,
    is_hidden, raw_header_text, sort_order
  )
  select
    v_profile.id, nullif(e->>'source_document_id', '')::uuid, e->>'organization', e->>'role', e->>'location',
    e->>'date_range_text', e->>'start_date_text', e->>'end_date_text',
    coalesce((e->>'is_volunteer')::boolean, false), coalesce(e->'content', '[]'::jsonb), coalesce(e->'hierarchical_content', '[]'::jsonb),
    coalesce((e->>'has_hierarchical_structure')::boolean, false), e->'source_trace', nullif(e->>'confidence', '')::numeric,
    coalesce((e->>'is_uncertain')::boolean, false), coalesce((e->>'is_hidden')::boolean, false), e->>'raw_header_text',
    coalesce((e->>'sort_order')::int, 0)
  from jsonb_array_elements(coalesce(p_experiences, '[]'::jsonb)) as e;

  delete from public.career_projects where profile_id = v_profile.id;
  insert into public.career_projects (
    profile_id, source_document_id, name, role, date_range_text, technologies, content, source_trace, is_hidden, raw_header_text, sort_order
  )
  select
    v_profile.id, nullif(p->>'source_document_id', '')::uuid, p->>'name', p->>'role', p->>'date_range_text',
    coalesce(p->'technologies', '[]'::jsonb), coalesce(p->'content', '[]'::jsonb), p->'source_trace',
    coalesce((p->>'is_hidden')::boolean, false), p->>'raw_header_text', coalesce((p->>'sort_order')::int, 0)
  from jsonb_array_elements(coalesce(p_projects, '[]'::jsonb)) as p;

  delete from public.career_credentials where profile_id = v_profile.id;
  insert into public.career_credentials (
    profile_id, source_document_id, name, issuer, credential_id, issue_date_text, expiry_date_text, location, kind,
    details, source_trace, is_hidden, raw_header_text, sort_order
  )
  select
    v_profile.id, nullif(c->>'source_document_id', '')::uuid, c->>'name', c->>'issuer', c->>'credential_id',
    c->>'issue_date_text', c->>'expiry_date_text', c->>'location', coalesce(c->>'kind', 'unknown'),
    coalesce(c->'details', '[]'::jsonb), c->'source_trace', coalesce((c->>'is_hidden')::boolean, false),
    c->>'raw_header_text', coalesce((c->>'sort_order')::int, 0)
  from jsonb_array_elements(coalesce(p_credentials, '[]'::jsonb)) as c;

  delete from public.career_awards where profile_id = v_profile.id;
  insert into public.career_awards (
    profile_id, source_document_id, name, issuer, date_text, details, source_trace, is_hidden, raw_header_text, sort_order
  )
  select
    v_profile.id, nullif(a->>'source_document_id', '')::uuid, a->>'name', a->>'issuer', a->>'date_text',
    coalesce(a->'details', '[]'::jsonb), a->'source_trace', coalesce((a->>'is_hidden')::boolean, false),
    a->>'raw_header_text', coalesce((a->>'sort_order')::int, 0)
  from jsonb_array_elements(coalesce(p_awards, '[]'::jsonb)) as a;

  delete from public.career_publications where profile_id = v_profile.id;
  insert into public.career_publications (
    profile_id, source_document_id, title, authors, publisher_or_venue, date_text, url_or_doi, details, source_trace,
    is_hidden, raw_header_text, sort_order
  )
  select
    v_profile.id, nullif(pub->>'source_document_id', '')::uuid, pub->>'title', coalesce(pub->'authors', '[]'::jsonb),
    pub->>'publisher_or_venue', pub->>'date_text', pub->>'url_or_doi', coalesce(pub->'details', '[]'::jsonb),
    pub->'source_trace', coalesce((pub->>'is_hidden')::boolean, false), pub->>'raw_header_text', coalesce((pub->>'sort_order')::int, 0)
  from jsonb_array_elements(coalesce(p_publications, '[]'::jsonb)) as pub;

  v_result := jsonb_build_object(
    'status', 'success',
    'profileId', v_profile.id,
    'versionId', v_new_version.id,
    'parentVersionId', v_new_version.parent_version_id,
    'createdAt', v_new_version.created_at
  );

  if p_idempotency_key is not null then
    insert into public.career_idempotency_keys (user_id, request_key, operation, response_body)
    values (v_user_id, p_idempotency_key, 'save_canonical_runtime', v_result)
    on conflict (user_id, request_key, operation) do nothing;
  end if;

  return v_result;
end;
$$;

revoke all on function public.save_canonical_runtime(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, uuid, text) from public;
grant execute on function public.save_canonical_runtime(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, uuid, text) to authenticated;


-- ============================================================
-- restore_canonical_version - single-table write (career_resume_versions
-- only, matching the existing service's own documented scope decision
-- not to also replace the six child tables on restore - see
-- canonicalResumeVersionService.ts's own header comment). Already
-- atomic as a single INSERT; this RPC's real value here is the
-- idempotency-key layer, so a retried restore never creates a second
-- version row.
-- ============================================================
create or replace function public.restore_canonical_version(
  p_profile_id uuid,
  p_target_version_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
set search_path = ''
security invoker
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.career_profiles%rowtype;
  v_target public.career_resume_versions%rowtype;
  v_latest public.career_resume_versions%rowtype;
  v_new_version public.career_resume_versions%rowtype;
  v_idem_response jsonb;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if p_idempotency_key is not null then
    select response_body into v_idem_response
      from public.career_idempotency_keys
      where user_id = v_user_id and request_key = p_idempotency_key and operation = 'restore_canonical_version' and expires_at > now();
    if found then
      return v_idem_response;
    end if;
  end if;

  select * into v_profile from public.career_profiles where id = p_profile_id and user_id = v_user_id;
  if not found then
    return jsonb_build_object('status', 'not_found', 'reason', 'profile');
  end if;

  select * into v_target from public.career_resume_versions where id = p_target_version_id and profile_id = v_profile.id;
  if not found then
    return jsonb_build_object('status', 'not_found', 'reason', 'target_version');
  end if;

  select * into v_latest from public.career_resume_versions
    where profile_id = v_profile.id order by created_at desc, id desc limit 1;

  insert into public.career_resume_versions (
    profile_id, source_document_id, parent_version_id, reason, snapshot, schema_version, serializer_version
  ) values (
    v_profile.id, v_target.source_document_id, v_latest.id, 'restore', v_target.snapshot, v_target.schema_version, v_target.serializer_version
  )
  returning * into v_new_version;

  v_result := jsonb_build_object(
    'status', 'success',
    'versionId', v_new_version.id,
    'restoredFromVersionId', v_target.id,
    'parentVersionId', v_new_version.parent_version_id,
    'createdAt', v_new_version.created_at
  );

  if p_idempotency_key is not null then
    insert into public.career_idempotency_keys (user_id, request_key, operation, response_body)
    values (v_user_id, p_idempotency_key, 'restore_canonical_version', v_result)
    on conflict (user_id, request_key, operation) do nothing;
  end if;

  return v_result;
end;
$$;

revoke all on function public.restore_canonical_version(uuid, uuid, text) from public;
grant execute on function public.restore_canonical_version(uuid, uuid, text) to authenticated;


-- ============================================================
-- create_canonical_overlay - single-table write (career_tailored_resumes).
-- The overlay MERGE computation (protected-field checks, entry
-- existence checks) stays entirely in TypeScript via the untouched
-- lib/documentPreservation/resumeStructured/tailoredOverlay.ts contract
-- (lib/careerMemory/runtime/overlayRuntime.ts's applyOverlay()) - this
-- function is handed the ALREADY-COMPUTED overlay history record and
-- only persists it idempotently. It never re-derives appliedEntryIds/
-- rejections itself.
-- ============================================================
create or replace function public.create_canonical_overlay(
  p_profile_id uuid,
  p_application_id uuid,
  p_resume_version_id uuid,
  p_template_id text,
  p_ai_model text,
  p_prompt_version text,
  p_overlay_record jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
set search_path = ''
security invoker
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.career_profiles%rowtype;
  v_row public.career_tailored_resumes%rowtype;
  v_idem_response jsonb;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if p_idempotency_key is not null then
    select response_body into v_idem_response
      from public.career_idempotency_keys
      where user_id = v_user_id and request_key = p_idempotency_key and operation = 'create_canonical_overlay' and expires_at > now();
    if found then
      return v_idem_response;
    end if;
  end if;

  select * into v_profile from public.career_profiles where id = p_profile_id and user_id = v_user_id;
  if not found then
    return jsonb_build_object('status', 'not_found', 'reason', 'profile');
  end if;

  insert into public.career_tailored_resumes (
    profile_id, application_id, resume_version_id, overlay, template_id, ai_model, prompt_version
  ) values (
    v_profile.id, p_application_id, p_resume_version_id, p_overlay_record, p_template_id, p_ai_model, p_prompt_version
  )
  returning * into v_row;

  v_result := jsonb_build_object('status', 'success', 'overlayId', v_row.id, 'createdAt', v_row.created_at);

  if p_idempotency_key is not null then
    insert into public.career_idempotency_keys (user_id, request_key, operation, response_body)
    values (v_user_id, p_idempotency_key, 'create_canonical_overlay', v_result)
    on conflict (user_id, request_key, operation) do nothing;
  end if;

  return v_result;
end;
$$;

revoke all on function public.create_canonical_overlay(uuid, uuid, uuid, text, text, text, jsonb, text) from public;
grant execute on function public.create_canonical_overlay(uuid, uuid, uuid, text, text, text, jsonb, text) to authenticated;


-- ============================================================
-- register_canonical_source_document - single-table write
-- (career_source_documents). Already idempotent via the REAL
-- partial-unique index on (profile_id, content_hash) added in Phase
-- 6B - this RPC layers a general Idempotency-Key check on top so a
-- retry never depends solely on the caller resending the exact same
-- content_hash (e.g. a client-generated key for a not-yet-hashed
-- upload-in-progress).
-- ============================================================
create or replace function public.register_canonical_source_document(
  p_profile_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_original_file_name text,
  p_mime_type text,
  p_byte_size bigint,
  p_content_hash text,
  p_parser_version text,
  p_file_type text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
set search_path = ''
security invoker
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.career_profiles%rowtype;
  v_existing public.career_source_documents%rowtype;
  v_row public.career_source_documents%rowtype;
  v_idem_response jsonb;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if p_idempotency_key is not null then
    select response_body into v_idem_response
      from public.career_idempotency_keys
      where user_id = v_user_id and request_key = p_idempotency_key and operation = 'register_canonical_source_document' and expires_at > now();
    if found then
      return v_idem_response;
    end if;
  end if;

  select * into v_profile from public.career_profiles where id = p_profile_id and user_id = v_user_id;
  if not found then
    return jsonb_build_object('status', 'not_found', 'reason', 'profile');
  end if;

  select * into v_existing from public.career_source_documents
    where profile_id = v_profile.id and content_hash = p_content_hash;
  if found then
    v_result := jsonb_build_object('status', 'success', 'sourceDocumentId', v_existing.id, 'createdAt', v_existing.created_at);
  else
    insert into public.career_source_documents (
      profile_id, storage_bucket, storage_path, original_file_name, mime_type, byte_size, content_hash, parser_version, file_type, analysis_status
    ) values (
      v_profile.id, p_storage_bucket, p_storage_path, p_original_file_name, p_mime_type, p_byte_size, p_content_hash, p_parser_version, p_file_type, 'pending'
    )
    returning * into v_row;
    v_result := jsonb_build_object('status', 'success', 'sourceDocumentId', v_row.id, 'createdAt', v_row.created_at);
  end if;

  if p_idempotency_key is not null then
    insert into public.career_idempotency_keys (user_id, request_key, operation, response_body)
    values (v_user_id, p_idempotency_key, 'register_canonical_source_document', v_result)
    on conflict (user_id, request_key, operation) do nothing;
  end if;

  return v_result;
end;
$$;

revoke all on function public.register_canonical_source_document(uuid, text, text, text, text, bigint, text, text, text, text) from public;
grant execute on function public.register_canonical_source_document(uuid, text, text, text, text, bigint, text, text, text, text) to authenticated;


-- ============================================================
-- create_canonical_generated_document - single-table write
-- (generated_resume_documents). Not one of Phase 6D.1 section 2's
-- named "4 write workflows", but section 7 explicitly requires
-- "새 generated document 생성 금지" under a duplicate request - added
-- for that reason, disclosed here rather than silently expanding scope.
-- ============================================================
create or replace function public.create_canonical_generated_document(
  p_profile_id uuid,
  p_tailored_resume_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_file_type text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
set search_path = ''
security invoker
as $$
declare
  v_user_id uuid := auth.uid();
  v_tailored public.career_tailored_resumes%rowtype;
  v_row public.generated_resume_documents%rowtype;
  v_idem_response jsonb;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if p_idempotency_key is not null then
    select response_body into v_idem_response
      from public.career_idempotency_keys
      where user_id = v_user_id and request_key = p_idempotency_key and operation = 'create_canonical_generated_document' and expires_at > now();
    if found then
      return v_idem_response;
    end if;
  end if;

  select t.* into v_tailored
    from public.career_tailored_resumes t
    join public.career_profiles p on p.id = t.profile_id
    where t.id = p_tailored_resume_id and t.profile_id = p_profile_id and p.user_id = v_user_id;
  if not found then
    return jsonb_build_object('status', 'not_found', 'reason', 'tailored_resume');
  end if;

  insert into public.generated_resume_documents (tailored_resume_id, storage_bucket, storage_path, file_type)
  values (v_tailored.id, p_storage_bucket, p_storage_path, p_file_type)
  returning * into v_row;

  v_result := jsonb_build_object('status', 'success', 'generatedDocumentId', v_row.id, 'createdAt', v_row.created_at);

  if p_idempotency_key is not null then
    insert into public.career_idempotency_keys (user_id, request_key, operation, response_body)
    values (v_user_id, p_idempotency_key, 'create_canonical_generated_document', v_result)
    on conflict (user_id, request_key, operation) do nothing;
  end if;

  return v_result;
end;
$$;

revoke all on function public.create_canonical_generated_document(uuid, uuid, text, text, text, text) from public;
grant execute on function public.create_canonical_generated_document(uuid, uuid, text, text, text, text) to authenticated;
