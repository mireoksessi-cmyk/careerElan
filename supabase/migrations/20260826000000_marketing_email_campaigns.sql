/*
  Marketing Email M2A - one durable record per production campaign, and the
  thing that stops a campaign being sent twice.

  Before this, a marketing send left only an admin_audit_log entry with its
  counts. That says a send happened; it does not say what was sent, and it
  cannot stop the same submission running again. Pressing the button twice -
  or one browser retrying a request that had already reached the server -
  sent every opted-in person a second copy, and nothing recorded enough to
  notice.

  The idempotency key is what prevents that, and it is the DATABASE that
  prevents it, not the route: the unique constraint below is taken before a
  single message is sent, so two requests carrying the same key cannot both
  proceed no matter how they interleave. The loser of that race is rejected
  by Postgres, reads the existing row, and sends nothing.

  Deliberately counts, never recipients. No address, no auth id, no identity
  belonging to anyone who received a campaign is copied here - a marketing
  history is not a reason to build a second copy of the user table. The
  consequence is stated plainly rather than glossed: this proves a campaign
  ran and how many messages the provider accepted. It is NOT a per-recipient
  delivery ledger and cannot answer "did this particular person get it".
  That, and the provider webhooks it would need, are M2B.

  Service-role only, like admin_staff and admin_audit_log: revoked from anon
  and authenticated, reachable only through the admin route's own
  service-role client, which itself runs behind requireAdminPermission(
  "admin.marketing.send"). No policy is added for the authenticated role
  because no browser is meant to read this table directly.
*/

create table if not exists public.marketing_email_campaigns (
  id bigint generated always as identity primary key,

  /*
    Opaque, browser-generated, one per intended submission. Unique is the
    entire point - see the header above. Carries no email, no user id, no
    subject and no other content: it exists only to be compared with itself.
    The length bound matches the route's own format check so a malformed key
    is rejected in both places rather than only one.
  */
  idempotency_key text not null unique
    constraint marketing_email_campaigns_idempotency_key_length_check
    check (char_length(idempotency_key) between 8 and 128),

  /*
    Resolved from the authenticated admin context, never from request input.
    Kept on delete set null: losing the person does not erase the fact that
    the campaign was sent.
  */
  actor_admin_user_id uuid references auth.users(id) on delete set null,

  campaign_type text not null
    check (campaign_type in ('new_feature', 'promotion')),

  subject text not null,
  body text not null,

  /*
    SENDING is written before the first message goes out and is therefore
    also what an interrupted run leaves behind. A row still in SENDING is
    ambiguous on purpose - the route refuses to re-run it rather than
    guessing how far it got, because duplicate delivery is worse than
    incomplete accounting.
  */
  status text not null
    check (status in ('SENDING', 'COMPLETED', 'PARTIAL', 'FAILED')),

  /*
    Null until the run finishes. "accepted" is the provider accepting the
    message for delivery - not the message arriving in anyone's mailbox,
    which nothing here can observe.
  */
  eligible_count integer,
  attempted_count integer,
  accepted_count integer,
  failed_count integer,

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.marketing_email_campaigns is
  'Marketing Email M2A - one row per production campaign submission. Unique idempotency_key is claimed before any message is sent, so a repeated submission sends nothing. Stores counts only: no recipient address, id or identity is recorded here, so this is not a per-recipient delivery ledger.';

comment on column public.marketing_email_campaigns.accepted_count is
  'Messages the email provider accepted. Not proof of inbox delivery.';

/* Newest-first is the only way the admin history reads this. */
create index if not exists marketing_email_campaigns_created_at_idx
  on public.marketing_email_campaigns (created_at desc);

alter table public.marketing_email_campaigns enable row level security;

revoke all on public.marketing_email_campaigns from anon, authenticated;

grant select, insert, update on public.marketing_email_campaigns to service_role;
