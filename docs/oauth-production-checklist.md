# OAuth Production Checklist

This is a **configuration checklist**, not a description of anything already
verified. Every value below is a placeholder — none of these dashboards
(Supabase Authentication settings, Google Cloud Console, Facebook Developer
Console) were accessible from the environment that wrote this checklist. See
the "OAuth redirect diagnostics" investigation for what *was* confirmed from
code and Production DB/logs instead.

Replace `<CURRENT_PRODUCTION_DOMAIN>` and `<CURRENT_NETLIFY_APP_DOMAIN>` with
this site's actual values before using this checklist. This project's
Supabase project ref is `oiciiyejpftuejyebsaa` (confirmed via
`mcp__supabase__get_project_url`); the two domain placeholders were not
determined — no hardcoded reference to either exists anywhere in this
repository.

## Supabase (Authentication → URL Configuration)

**Site URL:**
```
https://<CURRENT_PRODUCTION_DOMAIN>
```

**Additional Redirect URLs** (exact-match list, per Supabase's own docs):
```
https://<CURRENT_PRODUCTION_DOMAIN>/auth/callback
https://<CURRENT_NETLIFY_APP_DOMAIN>/auth/callback
```

The app's own code (`app/page.tsx`'s `signInWithProvider()` and
`lib/auth/auth.ts`, unused) always computes `redirectTo` as
`${window.location.origin}/auth/callback` at click time — it never hardcodes
a domain. If a user can reach the login page from more than one origin
(a custom domain *and* the raw `*.netlify.app` domain), **both** must appear
in this list, or Supabase will silently fall back to the Site URL above
instead of honoring the actual `redirectTo` it was sent — this is the
leading hypothesis for "Google login shows an old/different version."

If Deploy Preview logins are officially supported, add a preview-specific
entry here (Supabase supports wildcard redirect URLs per its own docs, e.g.
`https://deploy-preview-*--<netlify-site-name>.netlify.app/auth/callback`) —
document that decision explicitly rather than adding a broad wildcard by
default.

## Google Cloud Console (APIs & Services → Credentials → OAuth client)

**Authorized JavaScript origins:**
```
https://<CURRENT_PRODUCTION_DOMAIN>
https://<CURRENT_NETLIFY_APP_DOMAIN>
```

**Authorized redirect URI** — this is Supabase's own provider callback URL,
**not** this app's `/auth/callback` route. Do not confuse the two:
```
https://oiciiyejpftuejyebsaa.supabase.co/auth/v1/callback
```
The flow is: Google → Supabase's `/auth/v1/callback` → Supabase redirects to
whatever `redirectTo` the app requested (validated against the Supabase
Additional Redirect URLs list above) → this app's own `/auth/callback` route.
Google never talks to this app's `/auth/callback` directly.

## Facebook Developer Console (App Settings → Basic / Facebook Login → Settings)

**App Domains:**
```
<CURRENT_PRODUCTION_DOMAIN>
<CURRENT_NETLIFY_APP_DOMAIN>
```

**Valid OAuth Redirect URIs** — same Supabase provider callback URL as
Google, for the same reason:
```
https://oiciiyejpftuejyebsaa.supabase.co/auth/v1/callback
```

## Supabase Dashboard — provider enablement (Authentication → Providers)

Confirm each of the following directly in the dashboard before assuming any
OAuth provider works in Production:

- [ ] Facebook provider **enabled** (not just App Domains/Redirect URIs set
      on Facebook's side — Supabase also has its own enable toggle)
- [ ] Facebook Client ID set
- [ ] Facebook Client secret set
- [ ] Google provider **enabled**
- [ ] Google Client ID set
- [ ] Google Client secret set
- [ ] Site URL (above) does **not** point at an old/stale domain
- [ ] Additional Redirect URLs (above) includes every domain real users can
      actually land the login page on today

**Known local/Production gap already found in code**: this repo's local
`supabase/config.toml` (used only by `supabase start`, not by the hosted
Production project) has `[auth.external.google]` configured but **no**
`[auth.external.facebook]` or `[auth.external.linkedin_oidc]` section at
all. If Production's hosted Supabase project has the same gap, Facebook
login fails immediately with an inline "provider not enabled"-style error
(surfaced directly by `oauth_sign_in_request_failed` in the browser console)
rather than any redirect happening — this matches a reported "Facebook login
fails" symptom more closely than a redirect/domain mismatch would.

## How to use the diagnostic logs added alongside this checklist

1. Open the browser console, click "Continue with Google" (or Facebook) on
   the login modal. Read the `oauth_sign_in_started` line —
   confirms `browserOrigin` and `redirectHostname`.
   - If `signInWithOAuth` itself errors (provider not enabled, misconfigured
     client), `oauth_sign_in_request_failed` appears immediately, with no
     redirect at all.
2. After completing the provider's login screen, check server logs
   (`app/auth/callback/route.ts`) for `oauth_callback_received` — confirms
   `requestHostname`/`requestProtocol`/`hasCode`/`hasError` for the actual
   callback request.
3. If `oauth_callback_exchange_failed` appears instead of
   `oauth_callback_session_exchanged`, the authorization code itself was
   rejected — check the Google/Facebook redirect URI configuration above,
   not the Supabase Redirect URLs list.
4. Compare `oauth_callback_received.requestHostname` against
   `oauth_sign_in_started.browserOrigin`'s hostname from step 1 — if they
   differ, the browser was redirected to a different domain than it
   started on, which points directly at a Supabase Redirect URLs /
   Site URL mismatch rather than an app code bug.
