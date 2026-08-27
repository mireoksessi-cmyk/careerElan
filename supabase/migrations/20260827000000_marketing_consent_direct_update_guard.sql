/*
  Marketing Email M2C - close the last way to change marketing consent
  without leaving evidence of it.

  M2B routed both legitimate paths through set_marketing_consent() and
  withdraw_marketing_consent(), so the preference and its ledger entry move
  in one transaction. What it did not do is stop somebody going around them.
  public.profiles grants authenticated DELETE, INSERT, SELECT and UPDATE, and
  the profile_update policy allows any of it against your own row, so a
  signed-in user holding their own Supabase session could set
  marketing_notifications directly and no CONSENT or WITHDRAW event would
  ever be written. Worse, they could write marketing_consented_at,
  marketing_consent_source and marketing_consent_version themselves -
  fabricating the exact record the evidence feature exists to produce.

  Enforced here rather than in the application because the application is not
  what an attacker would be using. A check in /settings, a disabled button or
  a guard in an API route are all bypassed by talking to PostgREST directly
  with a legitimate session. Only the database sees every path.

  The rule is narrow on purpose: five columns, and only when their values
  actually change. Every other profile column - name, phone, timezone,
  notification preferences, legal consent, suspension, plan and the rest -
  updates exactly as before, including in the same statement as an unchanged
  marketing column. This is a consent-integrity boundary, not a lock on the
  profile.

  Roles, all verified against production before this was written:

    set_marketing_consent       SECURITY DEFINER, owned by postgres
    withdraw_marketing_consent  SECURITY DEFINER, owned by postgres

  A SECURITY DEFINER function runs with its owner as current_user, and a
  trigger fired inside one inherits that, so both approved paths reach this
  guard as postgres and pass. A direct PostgREST call arrives as anon or
  authenticated and is refused. service_role is left alone deliberately: it
  legitimately updates suspension columns from the admin console, and no
  service-role path in this codebase writes any marketing column.

  Nothing about the caller's own input decides this. There is no session
  variable, header or flag to set - a client-settable bypass would be no
  boundary at all, since the client is exactly who is being restrained.

  Additive only. No existing row is read or written, no preference is
  changed, no consent timestamp is filled in, and no consent event is
  created. Legacy evidence stays exactly as M2B left it.
*/

create or replace function public.guard_marketing_consent_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  /*
    Deliberately SECURITY INVOKER. The whole test is which role is actually
    speaking, and a definer function would replace that with its own owner
    every time, so the guard would pass for everybody and protect nobody.

    Anything that is not an ordinary client role - postgres running the
    consent functions, service_role running the admin console, the signup
    trigger - is not what this exists to stop.
  */
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  /*
    A profile row is created by handle_new_user() as postgres, which returns
    above. Reaching here as a client means an inserted row is being given
    consent state at creation - including after deleting an existing profile
    to start over - so consent must arrive at its default: off, with no
    evidence.
  */
  if tg_op = 'INSERT' then
    if coalesce(new.marketing_notifications, false)
       or new.marketing_consented_at is not null
       or new.marketing_withdrawn_at is not null
       or new.marketing_consent_source is not null
       or new.marketing_consent_version is not null
    then
      raise exception
        'Marketing consent cannot be set directly. Use the marketing consent functions.'
        using errcode = '42501';
    end if;

    return new;
  end if;

  /*
    Changed, not merely present. A client updating their phone number sends
    the whole row back with marketing_notifications at its existing value,
    and that must keep working - so the comparison is per column and uses
    `is distinct from`, which treats null the same on both sides rather than
    reading an unchanged null as a change.
  */
  if new.marketing_notifications is distinct from old.marketing_notifications
     or new.marketing_consented_at is distinct from old.marketing_consented_at
     or new.marketing_withdrawn_at is distinct from old.marketing_withdrawn_at
     or new.marketing_consent_source is distinct from old.marketing_consent_source
     or new.marketing_consent_version is distinct from old.marketing_consent_version
  then
    /*
      Refused, never silently corrected. Quietly discarding the change would
      leave the caller believing it took effect, and this is not a case where
      guessing at intent is safe. The message names no role, no id and no
      history.
    */
    raise exception
      'Marketing consent cannot be changed directly. Use the marketing consent functions.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_marketing_consent_columns() is
  'M2C - refuses direct anon/authenticated writes to the five marketing consent columns on public.profiles. The approved paths (set_marketing_consent, withdraw_marketing_consent) run SECURITY DEFINER as postgres and are unaffected, as are service_role operations and all non-marketing profile edits.';

create trigger guard_marketing_consent_columns
  before insert or update on public.profiles
  for each row
  execute function public.guard_marketing_consent_columns();
