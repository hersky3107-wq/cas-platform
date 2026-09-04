-- ============================================================================
-- 대사기 — deposit_records.memo (counterparty / 적요)
--
-- Needed so overlapping internet-banking captures can be compared on
-- (deposit_date, actual_amount, normalized memo) in the review UI.
-- Duplicate detection is HITL only — this column is NOT unique.
-- Two genuine identical deposits on the same day must remain insertable.
--
-- Paste in the Supabase SQL Editor (do not `supabase db push`).
-- Re-run safe: IF NOT EXISTS.
-- ============================================================================

alter table public.deposit_records
  add column if not exists memo text;

comment on column public.deposit_records.memo is
  'Counterparty / 적요 from the bank line. Used for human-in-the-loop duplicate detection with (deposit_date, actual_amount). Null allowed. Not unique.';
