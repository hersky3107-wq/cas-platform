-- ============================================================================
-- 대사기 — allow Excel/CSV objects in the existing private deposit bucket.
--
-- Bucket `reconciliation-deposits` was created image-only. Spreadsheet ingest
-- reuses the same private bucket + `{auth.uid()}/…` ownership. This only
-- widens allowed_mime_types. `raw_documents.source_type` already includes
-- 'excel' — no CHECK change.
--
-- Paste in the Supabase SQL Editor. Do not supabase db push.
-- Idempotent.
-- ============================================================================

update storage.buckets
set
  public = false,
  file_size_limit = 8388608,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'text/csv',
    'text/plain',
    'text/tab-separated-values',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
where id = 'reconciliation-deposits';
