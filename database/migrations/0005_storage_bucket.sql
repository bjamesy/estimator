-- Original documents bucket (see docs/architecture.md -> Document Storage).
-- Private bucket; objects are only reachable via the app or a signed URL.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Objects are stored under a `{company_id}/...` path prefix. Policies check
-- that prefix against the uploading/reading user's companies, so storage
-- access follows the same company-scoping boundary as everything else.
create policy "company access to own documents"
  on storage.objects for all
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1]::uuid in (select auth_company_ids())
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1]::uuid in (select auth_company_ids())
  );
