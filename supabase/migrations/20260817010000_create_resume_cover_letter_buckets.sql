-- Confirmed infrastructure gap: app/career-memory/page.tsx uploads to
-- storage.from("resumes") / storage.from("cover-letters"), and
-- 20260721010219_storage_rls_owner_check.sql already defines owner-path-
-- scoped RLS policies (resume_storage_*/cover_storage_*) targeting these
-- exact bucket ids - but no migration has ever created the buckets
-- themselves (they only ever existed as manually-created rows on
-- Production, never captured in version control, matching the same class
-- of gap already found for service_role default privileges). A database
-- built solely from committed migrations has neither bucket, so any
-- resume/cover-letter upload fails immediately at the Storage upload
-- call. Mirrors the existing 'generated-documents' bucket creation
-- pattern (20260807000000_canonical_generate_package_integration.sql)
-- exactly - private, id/name/public columns only, no file_size_limit or
-- allowed_mime_types (neither is used by the existing bucket either).
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('cover-letters', 'cover-letters', false)
on conflict (id) do nothing;
