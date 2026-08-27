/*
  Marketing Email M2B - evidence for marketing consent, and the controlled
  way it is allowed to change.

  Eligibility is still profiles.marketing_notifications and nothing else.
  This migration does not introduce a second flag to disagree with it; it
  records WHEN a preference changed, WHERE the change came from, and under
  WHICH policy version, none of which the boolean can express on its own.

  Nothing here is backfilled. A user who is opted in today keeps that
  preference untouched and keeps null evidence columns, because there is no
  honest value to put in them - the moment they consented was never
  recorded, and inventing one (signup date, migration date) would be
  manufacturing the exact evidence the feature exists to provide. Their
  history stays legitimately unknown until they next act on it themselves.

  Both mutation paths go through a function rather than a direct UPDATE, for
  one reason: the preference and its evidence must not drift apart. A route
  that writes the row and then writes the event can be interrupted between
  them. A function cannot.

  The consent version is written by the database, not passed in. /settings
  runs in the browser and a browser-supplied policy version is not evidence
  of anything - it is whatever the caller typed. The literal below is the
  only place the settings path gets its version from; changing it later
  means a new migration alongside the server's own version, deliberately, in
  one reviewed step.
*/

/* ---------- current-state evidence on the profile ---------- */

alter table public.profiles
  add column if not exists marketing_consented_at timestamptz,
  add column if not exists marketing_withdrawn_at timestamptz,
  add column if not exists marketing_consent_source text,
  add column if not exists marketing_consent_version text;

alter table public.profiles
  add constraint profiles_marketing_consent_source_check
  check (
    marketing_consent_source is null
    or marketing_consent_source in ('settings', 'email_footer', 'email_one_click')
  );

comment on column public.profiles.marketing_consented_at is
  'M2B - when the CURRENT marketing consent was given. NULL means no recorded consent instance: either never opted in, or opted in before this evidence existed. Never backfilled.';

comment on column public.profiles.marketing_consent_version is
  'M2B - marketing policy version in force when the current consent was given. NULL for legacy opt-ins that predate this column.';

/* ---------- durable chronological ledger ---------- */

create table if not exists public.marketing_consent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('CONSENT', 'WITHDRAW')),

  /*
    Chosen by the database from the flow that called it, never accepted from
    a caller. 'settings' is the signed-in preference toggle; the two email
    values are the visible footer link and the RFC one-click header.
  */
  source text not null
    check (source in ('settings', 'email_footer', 'email_one_click')),

  /* Null on a withdrawal of a legacy consent that never had a version. */
  consent_version text,

  created_at timestamptz not null default now()
);

comment on table public.marketing_consent_events is
  'M2B - append-only evidence of marketing consent changes. Holds no email, login id, provider, IP or device data: the user id and the fact of the change are the whole record.';

create index if not exists marketing_consent_events_user_created_idx
  on public.marketing_consent_events (user_id, created_at desc);

/*
  Service-role only for direct access, exactly like admin_staff and
  admin_audit_log. Ordinary users never touch this table directly - they
  reach it only through set_marketing_consent() below, which is what makes
  the ledger append-only in practice: there is no granted path to update or
  delete a row, and no path at all to write a row for somebody else.
*/
alter table public.marketing_consent_events enable row level security;

revoke all on public.marketing_consent_events from anon, authenticated;

grant select, insert on public.marketing_consent_events to service_role;

/* ---------- /settings mutation ---------- */

/*
  The only way the signed-in preference toggle is allowed to change consent.

  Identity comes from auth.uid(); there is no user parameter, so a caller
  cannot aim this at anyone but themselves. Source and version are literals
  chosen here rather than arguments, so neither can be supplied by a
  browser. The row is locked before it is read so two concurrent saves
  cannot both decide they are the transition.

  A save that does not change the boolean records nothing. Re-saving an
  unchanged preference is not a new act of consent and should not look like
  one in the ledger.
*/
create or replace function public.set_marketing_consent(p_opt_in boolean)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id uuid := auth.uid();
  v_current boolean;
  v_version text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select marketing_notifications, marketing_consent_version
    into v_current, v_version
    from public.profiles
   where id = v_user_id
     for update;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if coalesce(v_current, false) = coalesce(p_opt_in, false) then
    return 'NO_CHANGE';
  end if;

  if p_opt_in then
    update public.profiles
       set marketing_notifications = true,
           marketing_consented_at = now(),
           marketing_withdrawn_at = null,
           marketing_consent_source = 'settings',
           marketing_consent_version = 'marketing-v1'
     where id = v_user_id;

    insert into public.marketing_consent_events
      (user_id, action, source, consent_version)
    values
      (v_user_id, 'CONSENT', 'settings', 'marketing-v1');

    return 'CONSENT';
  end if;

  /*
    marketing_consent_version is deliberately left as it was. The version
    recorded against a withdrawal is the version being withdrawn from, not
    whatever policy happens to be current.
  */
  update public.profiles
     set marketing_notifications = false,
         marketing_withdrawn_at = now()
   where id = v_user_id;

  insert into public.marketing_consent_events
    (user_id, action, source, consent_version)
  values
    (v_user_id, 'WITHDRAW', 'settings', v_version);

  return 'WITHDRAW';
end;
$$;

revoke all on function public.set_marketing_consent(boolean) from public, anon;

grant execute on function public.set_marketing_consent(boolean) to authenticated;

/* ---------- unsubscribe mutation ---------- */

/*
  Withdrawal from an email link. Called only by the unsubscribe route's
  service-role client, which has already opened an encrypted token; this
  function is what makes the decision, not that route.

  p_consent_epoch is the consent instance the token was minted against, and
  it is compared with `is distinct from` so that null matches null. That one
  comparison is the whole re-consent defence: a token issued for a legacy
  opt-in carries null, a token from a real consent carries its timestamp,
  and either way a LATER consent moves the epoch and leaves the old token
  matching nothing. An expired campaign link cannot revoke a consent the
  person gave afterwards.

  Withdrawing something already withdrawn returns ALREADY and writes
  nothing - a mail client that follows the same one-click header twice must
  not produce two withdrawals.

  Never enables marketing. There is no path through this function that sets
  the flag true.
*/
create or replace function public.withdraw_marketing_consent(
  p_user_id uuid,
  p_source text,
  p_consent_epoch timestamptz
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_current boolean;
  v_epoch timestamptz;
  v_version text;
begin
  if p_source is null or p_source not in ('email_footer', 'email_one_click') then
    raise exception 'Unsupported consent source' using errcode = '22023';
  end if;

  select marketing_notifications, marketing_consented_at, marketing_consent_version
    into v_current, v_epoch, v_version
    from public.profiles
   where id = p_user_id
     for update;

  if not found then
    return 'INVALID';
  end if;

  if v_epoch is distinct from p_consent_epoch then
    return 'STALE';
  end if;

  if coalesce(v_current, false) = false then
    return 'ALREADY';
  end if;

  update public.profiles
     set marketing_notifications = false,
         marketing_withdrawn_at = now()
   where id = p_user_id;

  insert into public.marketing_consent_events
    (user_id, action, source, consent_version)
  values
    (p_user_id, 'WITHDRAW', p_source, v_version);

  return 'WITHDRAWN';
end;
$$;

revoke all on function public.withdraw_marketing_consent(uuid, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.withdraw_marketing_consent(uuid, text, timestamptz)
  to service_role;
