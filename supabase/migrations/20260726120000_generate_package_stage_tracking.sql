-- Real, worker-reported progress stages for the async Generate Package
-- flow - distinct from generation_status (pending/succeeded/failed), which
-- stays the source of truth for "is this attempt still in flight." This
-- column only ever moves forward through a fixed sequence while
-- generation_status = 'pending', giving the client something honest to
-- show besides an indeterminate spinner, without ever fabricating a
-- time-based percentage.
--
-- No DEFAULT (matches this project's established convention - see
-- generate_package_async_snapshot's own comment) - existing/older rows
-- stay NULL, which the status endpoint already treats as "no stage
-- information available" rather than an error.
alter table public.applications
  add column if not exists generation_stage text,
  add column if not exists generation_stage_updated_at timestamptz;

alter table public.applications
  add constraint applications_generation_stage_check
  check (
    generation_stage is null or generation_stage in (
      'queued',
      'claimed',
      'loading_inputs',
      'building_prompt',
      'generating',
      'validating',
      'saving'
    )
  );

comment on column public.applications.generation_stage is
  'Real worker-reported progress stage while generation_status = pending. Never set once succeeded/failed - the client infers 100%/failed from generation_status itself.';
comment on column public.applications.generation_stage_updated_at is
  'When generation_stage last changed - lets the client show elapsed-in-stage time without a separate column per stage.';

-- Worker-only stage update path, mirroring claim/complete/fail_generate_
-- package_* in 20260726020000_generate_package_worker_rpc.sql: service_role
-- has no direct GRANT on public.applications (see that migration's own
-- comment for why), so this SECURITY DEFINER function is the worker's only
-- way to record a stage transition. Scoped to (id, user_id) for the same
-- defense-in-depth reason as complete/fail. Additionally guarded to only
-- ever touch a row that is still generation_status = 'pending' - a stage
-- update racing in after another invocation already completed/failed this
-- same applicationId (e.g. a retried/duplicate worker invocation that lost
-- the atomic claim, per claim_generate_package_worker's own docstring)
-- must never resurrect stage text on an already-resolved row.
create or replace function public.update_generate_package_stage(
  p_application_id uuid,
  p_user_id uuid,
  p_stage text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.applications
  set generation_stage = p_stage,
      generation_stage_updated_at = now()
  where public.applications.id = p_application_id
    and public.applications.user_id = p_user_id
    and public.applications.generation_status = 'pending';
end;
$$;

revoke all on function public.update_generate_package_stage(uuid, uuid, text) from public;
grant execute on function public.update_generate_package_stage(uuid, uuid, text) to service_role;
