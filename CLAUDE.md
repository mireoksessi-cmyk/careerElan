@AGENTS.md

# Career Élan Git / Preview / Production Release Policy

This is the DEFAULT workflow for all Career Élan development work. It does not
need to be restated per task.

A read-only audit that produces zero changes may stay on the current branch —
no branch is required to look at things.

An explicit one-off user instruction is stricter authority than this policy. If
the user says "commit only, do not push", that wins.

## Default branch workflow

- NEVER implement new work directly on `master`.
- NEVER commit new feature/fix work directly to `master`.
- Before starting implementation, confirm the current branch.
- For new work, create a dedicated branch from the current approved `master`,
  using an appropriate prefix such as:
  - `feature/...`
  - `fix/...`
  - `chore/...`
- Existing unrelated local residue must remain untouched unless the user
  explicitly scopes it into the task.

## Local implementation

- Implement and validate on the feature/fix branch.
- Do not opportunistically modify unrelated files or unrelated hunks.
- Do not use broad staging:
  - `git add .`
  - `git add -A`
  - `git add --all`
  - `git add -u`
  - `git commit -a`
- Stage only explicitly approved paths.
- No force push.
- No history rewrite unless the user explicitly authorizes it.

## Preview release

- After local validation, NEVER push directly to `master`.
- Push only the current feature/fix branch.
- A production release requires a preview-validation step first.
- Prefer a GitHub Pull Request so Netlify creates a Deploy Preview.
- The Netlify Deploy Preview is the required browser QA surface before
  production.
- Do not treat the production `.netlify.app` URL as a staging environment;
  `careerelan.com` and the production Netlify domain point at the same
  production deployment.
- Do not manually deploy to production merely to test a feature.

## User acceptance gate

- After the Deploy Preview is READY, report the preview URL/status to the user.
- Do NOT merge or push to `master` automatically.
- Wait for explicit user acceptance such as:
  - "확인했어"
  - "배포해"
  - "master에 올려"
  - "push 해"
  - or equivalent clear approval.
- If the user has not explicitly approved production, production release is
  forbidden.

## Production release

Only after explicit user approval:

1. Re-run required validation.
2. Re-audit exact changed-file scope.
3. Confirm no unrelated residue is staged.
4. Merge/fast-forward the approved work to `master` using the repository's
   established workflow.
5. Push `master` normally.
6. NEVER force push.
7. Let Netlify auto-deploy production.
8. Do not manually trigger a duplicate Netlify deploy.
9. Verify deployed commit SHA equals the approved `master` commit.
10. Verify production deployment status.
11. When requested, compare the full tracked source tree, not only changed
    files.

## Production meaning

The following are PRODUCTION surfaces and must be treated as the same release
authority:

- `https://careerelan.com`
- `https://www.careerelan.com` when redirected to the primary domain
- the project's production `*.netlify.app` URL

A change visible on the production Netlify deployment is already a production
change for `careerelan.com`.

## Database / Supabase rule

- A feature requiring a production Supabase migration must NOT deploy
  application code before the required production schema/RPC is compatible.
- Verify migration delivery order explicitly.
- Never run destructive production database commands without explicit user
  authorization.
- Do not use production data writes merely as a verification shortcut.

## Hard stop rule

HARD STOP instead of working around the policy if:

- preview deployment cannot be created or verified
- required validation fails
- unrelated files/hunks appear
- branch state is ambiguous
- production schema is incompatible
- push would be non-fast-forward
- explicit production approval has not been given.

Do not silently bypass this workflow.
