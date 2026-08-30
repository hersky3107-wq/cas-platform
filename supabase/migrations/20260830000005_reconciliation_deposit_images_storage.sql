-- ============================================================================
-- 대사기 — private Storage bucket for deposit-alert screenshots / passbook photos.
--
-- Bucket: reconciliation-deposits (NOT public).
-- Object keys are `{auth.uid()}/{uuid}.{ext}` so owner-only policies work.
-- Uploads in this feature go through supabaseAdmin after withOwnedScope;
-- the policies below are defense-in-depth if an authenticated client ever
-- talks to Storage directly. Anon has no access. No public read.
--
-- Paste in the Supabase SQL Editor (Storage + SQL). Do not supabase db push.
-- Idempotent.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reconciliation-deposits',
  'reconciliation-deposits',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "recon_deposits_select_own" on storage.objects;
create policy "recon_deposits_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'reconciliation-deposits'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "recon_deposits_insert_own" on storage.objects;
create policy "recon_deposits_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'reconciliation-deposits'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "recon_deposits_update_own" on storage.objects;
create policy "recon_deposits_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'reconciliation-deposits'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'reconciliation-deposits'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "recon_deposits_delete_own" on storage.objects;
create policy "recon_deposits_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'reconciliation-deposits'
  and (storage.foldername(name))[1] = auth.uid()::text
);
