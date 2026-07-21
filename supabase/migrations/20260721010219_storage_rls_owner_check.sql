-- Fixes a pre-existing gap: the resume/cover-letter storage policies only
-- checked bucket_id, with no auth.uid() path-prefix check. Any authenticated
-- user could address any object in these buckets, not just their own
-- "${user.id}/..." prefix. Tightens all 8 policies to also require the
-- object's first path segment to match the caller's auth.uid().
-- Upload paths already always use "${user.id}/...", so this is a pure
-- tightening with no behavior change for legitimate use.

drop policy "cover_storage_delete" on "storage"."objects";
drop policy "cover_storage_insert" on "storage"."objects";
drop policy "cover_storage_select" on "storage"."objects";
drop policy "cover_storage_update" on "storage"."objects";
drop policy "resume_storage_delete" on "storage"."objects";
drop policy "resume_storage_insert" on "storage"."objects";
drop policy "resume_storage_select" on "storage"."objects";
drop policy "resume_storage_update" on "storage"."objects";

create policy "cover_storage_delete"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
  using (
    bucket_id = 'cover-letters'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

create policy "cover_storage_insert"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
  with check (
    bucket_id = 'cover-letters'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

create policy "cover_storage_select"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
  using (
    bucket_id = 'cover-letters'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

create policy "cover_storage_update"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
  using (
    bucket_id = 'cover-letters'
    and (storage.foldername(name))[1] = (auth.uid())::text
  )
  with check (
    bucket_id = 'cover-letters'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

create policy "resume_storage_delete"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

create policy "resume_storage_insert"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

create policy "resume_storage_select"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

create policy "resume_storage_update"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (auth.uid())::text
  )
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );
