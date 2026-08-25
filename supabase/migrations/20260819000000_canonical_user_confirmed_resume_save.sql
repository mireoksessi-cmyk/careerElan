-- Atomic "user-confirmed resume" save.
--
-- Editing an imported resume has to move two authorities at once: the
-- career_memory row the 1-8 editor writes, and the canonical version
-- every downstream surface actually resolves (Dashboard, Generate
-- Package, tailoring). Until now nothing spanned both. save_canonical_
-- runtime() deliberately never touches career_memory - the Phase 6B
-- persistence migration says so in its own header - and there is no
-- transaction primitive above it, so a client doing "upsert memory,
-- then create version" could permanently commit the first and lose the
-- second. That leaves the editable mirror saying one thing and the
-- resolved resume saying another, with no way back.
--
-- This function is the missing boundary and nothing else. It adds no
-- table, no column, and no index, and it does not alter save_canonical_
-- runtime()'s signature or behaviour - it CALLS it. A plpgsql function
-- invoked from another runs inside the caller's transaction, so the
-- version insert and the career_memory upsert below either both commit
-- or both disappear.
--
-- Order matters and is deliberate: the version goes first because
-- save_canonical_runtime() performs its optimistic-concurrency check
-- BEFORE any write (its own header states this), so a 'conflict' comes
-- back having written nothing at all and career_memory is never
-- touched. Only a genuine failure - a constraint violation in either
-- half - raises, and that unwinds the whole transaction including the
-- version row and its five child tables.
--
-- 'replayed' returns early on purpose. The idempotency key belongs to
-- save_canonical_runtime(), so a replay means an earlier call already
-- committed both halves; re-running the upsert would rewrite
-- career_memory outside the transaction that owns that response.
create or replace function public.save_user_confirmed_resume(
  p_career_memory jsonb,
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
  v_save jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if p_career_memory is null or jsonb_typeof(p_career_memory) <> 'object' then
    raise exception using errcode = '22023', message = 'CAREER_MEMORY_PAYLOAD_REQUIRED';
  end if;

  v_save := public.save_canonical_runtime(
    p_profile_defaults,
    p_version_input,
    p_experiences,
    p_projects,
    p_credentials,
    p_awards,
    p_publications,
    p_check_expected_version,
    p_expected_current_version_id,
    p_idempotency_key
  );

  -- 'conflict' wrote nothing; 'replayed' was written by the call that
  -- owns the idempotency response. Neither should touch career_memory.
  if coalesce(v_save->>'status', '') <> 'success' then
    return v_save;
  end if;

  /*
    Only the columns the 1-8 editor owns. resume_template, cover_template,
    theme/font/text_size/tone, selected_resume_*, profile_strength and
    required_completed are deliberately absent: template choice is a
    separate authority from content, and editing a resume's words must
    not silently re-pick its design.
  */
  insert into public.career_memory as cm (
    user_id, first_name, last_name, email, phone, location, linkedin, headline, summary,
    skills, experience, volunteer_experience, education, certifications, projects, languages,
    target_roles, target_industry, target_location, salary_expectation, career_goal_summary,
    updated_at
  )
  values (
    v_user_id,
    p_career_memory->>'first_name',
    p_career_memory->>'last_name',
    p_career_memory->>'email',
    p_career_memory->>'phone',
    p_career_memory->>'location',
    p_career_memory->>'linkedin',
    p_career_memory->>'headline',
    p_career_memory->>'summary',
    case when p_career_memory ? 'skills'
      then (select coalesce(array_agg(value #>> '{}'), '{}'::text[]) from jsonb_array_elements(coalesce(p_career_memory->'skills', '[]'::jsonb)))
      else '{}'::text[] end,
    coalesce(p_career_memory->'experience', '[]'::jsonb),
    coalesce(p_career_memory->'volunteer_experience', '[]'::jsonb),
    coalesce(p_career_memory->'education', '[]'::jsonb),
    coalesce(p_career_memory->'certifications', '[]'::jsonb),
    coalesce(p_career_memory->'projects', '[]'::jsonb),
    coalesce(p_career_memory->'languages', '[]'::jsonb),
    case when p_career_memory ? 'target_roles'
      then (select coalesce(array_agg(value #>> '{}'), '{}'::text[]) from jsonb_array_elements(coalesce(p_career_memory->'target_roles', '[]'::jsonb)))
      else '{}'::text[] end,
    p_career_memory->>'target_industry',
    p_career_memory->>'target_location',
    p_career_memory->>'salary_expectation',
    p_career_memory->>'career_goal_summary',
    now()
  )
  on conflict (user_id) do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    email = excluded.email,
    phone = excluded.phone,
    location = excluded.location,
    linkedin = excluded.linkedin,
    headline = excluded.headline,
    summary = excluded.summary,
    skills = excluded.skills,
    experience = excluded.experience,
    volunteer_experience = excluded.volunteer_experience,
    education = excluded.education,
    certifications = excluded.certifications,
    projects = excluded.projects,
    languages = excluded.languages,
    target_roles = excluded.target_roles,
    target_industry = excluded.target_industry,
    target_location = excluded.target_location,
    salary_expectation = excluded.salary_expectation,
    career_goal_summary = excluded.career_goal_summary,
    updated_at = now()
  where cm.user_id = v_user_id;

  return v_save || jsonb_build_object('careerMemoryUpdated', true);
end;
$$;

revoke all on function public.save_user_confirmed_resume(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, uuid, text) from public;
grant execute on function public.save_user_confirmed_resume(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, uuid, text) to authenticated;
