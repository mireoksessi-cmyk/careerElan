-- Adds legal consent tracking to public.profiles and extends the existing
-- handle_new_user() trigger (fires AFTER INSERT ON auth.users) to record
-- consent atomically for email/password signups, using the server's own
-- now() - never a client-supplied timestamp - and hardcoded document
-- version strings, never values passed through raw_user_meta_data.
--
-- OAuth signups (Google/Facebook/LinkedIn) cannot pass custom
-- raw_user_meta_data through supabase.auth.signInWithOAuth() (unlike
-- signUp(), it has no options.data), so their consent is instead recorded
-- by app/auth/callback/route.ts after a verified session exchange - see
-- that file's own comments. Both paths write the same five columns.
--
-- All five columns are nullable with no default: existing rows (created
-- before this feature existed) stay NULL, which is unambiguous and
-- requires no backfill.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS legal_terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS legal_terms_version text,
  ADD COLUMN IF NOT EXISTS privacy_policy_version text,
  ADD COLUMN IF NOT EXISTS cookie_policy_version text,
  ADD COLUMN IF NOT EXISTS consent_source text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_consent_source_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_consent_source_check
  CHECK (
    consent_source IS NULL
    OR consent_source IN (
      'email_signup',
      'google_oauth',
      'facebook_oauth',
      'linkedin_oauth'
    )
  );

/*
  Only the INSERT branch is extended - the ON CONFLICT UPDATE branch
  deliberately does NOT touch the five consent columns (see its own
  comment below), so a second AFTER INSERT firing for the same id (not a
  real-world case today - auth.users.id is always a fresh UUID for a
  genuine new signup - but kept as the existing defensive fallback) can
  never overwrite a row's consent record.

  legal_consent must be the literal string 'true' (as JSON-stringified
  booleans arrive via raw_user_meta_data) AND consent_source must be one
  of the four allowed values, or every consent column stays NULL - a
  malformed/missing value only skips recording, it never fails signup or
  produces a CHECK-constraint violation.
*/
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  consent_given boolean;
  consent_source_value text;
begin
  consent_given := (new.raw_user_meta_data ->> 'legal_consent') = 'true';
  consent_source_value := new.raw_user_meta_data ->> 'consent_source';

  if consent_source_value not in (
    'email_signup', 'google_oauth', 'facebook_oauth', 'linkedin_oauth'
  ) then
    consent_source_value := null;
  end if;

  insert into public.profiles (
    id,
    full_name,
    phone,
    login_id,
    email,
    created_at,
    legal_terms_accepted_at,
    legal_terms_version,
    privacy_policy_version,
    cookie_policy_version,
    consent_source
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    lower(
      coalesce(
        new.raw_user_meta_data ->> 'login_id',
        split_part(new.email, '@', 1)
      )
    ),
    lower(coalesce(new.email, '')),
    now(),
    case when consent_given and consent_source_value is not null then now() else null end,
    case when consent_given and consent_source_value is not null then '2026-07-26' else null end,
    case when consent_given and consent_source_value is not null then '2026-07-26' else null end,
    case when consent_given and consent_source_value is not null then '2026-07-26' else null end,
    case when consent_given then consent_source_value else null end
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    phone = excluded.phone,
    login_id = excluded.login_id,
    email = excluded.email;
    -- Consent columns intentionally omitted here - never overwritten by
    -- the conflict branch, matching the "record once, never overwrite"
    -- rule the OAuth callback's UPDATE ... WHERE legal_terms_accepted_at
    -- IS NULL also enforces.

  return new;
end;
$function$;
