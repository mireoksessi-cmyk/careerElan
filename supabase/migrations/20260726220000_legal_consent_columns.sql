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

  KNOWN LIMITATION / FUTURE IMPROVEMENT: for the email_signup path,
  legal_consent and consent_source arrive via raw_user_meta_data, which
  is set by the client's own supabase.auth.signUp({options:{data:...}})
  call (see app/page.tsx's handleEmailSignup()) - the same trust level as
  every other field already passed that way (full_name, phone, login_id).
  A request crafted directly against Supabase's API (bypassing this
  app's own checkbox-gated UI) could in principle claim legal_consent:
  true without the user ever having seen the checkbox. This is NOT a
  privilege-escalation or data-access risk (it only affects what gets
  recorded about the caller's own new account), but it does mean this
  column records "our own client code decided to send this flag," not a
  cryptographic attestation that the checkbox was actually seen and
  checked. If a stronger guarantee is ever needed, the recommended
  approach is a server-signed attestation instead of a bare metadata
  flag: e.g. a short-lived endpoint (mirroring
  app/api/auth/consent-intent/route.ts's pattern for OAuth) that the
  client calls only after the checkbox is checked, which mints a signed
  token the email signup flow must present back - verified server-side
  before the trigger (or an equivalent server-side check after signUp())
  treats consent as given. Not implemented here - explicitly out of
  scope for this change, per instruction to document rather than
  restructure.

  SECURITY DEFINER + SET search_path TO '' (deliberately empty, not
  'public'): this function runs with the privileges of its owner
  regardless of who triggers it, so an empty search_path is required to
  prevent a search_path-hijacking attack (a malicious role creating an
  object - e.g. a same-named function - earlier in what would otherwise
  be a resolvable path). With an empty search_path, every table
  reference in this function must be fully schema-qualified (already
  true here - `public.profiles`, unchanged from before this migration)
  or resolve to pg_catalog, which stays implicitly searched regardless of
  the search_path setting (so built-ins like coalesce/lower/split_part/now
  still resolve correctly).
*/
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
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
