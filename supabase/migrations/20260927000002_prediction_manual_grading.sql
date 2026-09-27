-- ============================================================================
-- AI Prediction League — MANUAL GRADING QUEUE (ADDITIVE).
--
-- Run in the Supabase SQL Editor. Do NOT `supabase db push`.
--
-- WHY: instrument categories (stock / crypto / fx / gold / index / commodities
-- / memecoin) stay fully auto via Twelve Data. Freeform categories (sports /
-- politics / entertainment / real-estate HPI, plus tech) have no price
-- executor — they must wait for an admin YES/NO/VOID instead of being retried
-- as `not_price_instrument` on every sweep.
--
-- ALREADY PRESENT (do not re-add): actual_outcome, resolved_at,
-- grading_attempted_at, unresolvable_reason (see 20260813000001 and
-- 20260821000002). This migration only adds the status machine + admin audit.
--
-- States:
--   auto           default. Auto-executor may grade. Sweep still sees the row.
--   needs_grading  due freeform round parked for /admin/league/grade.
--   graded         actual_outcome written (auto OR admin YES/NO).
--   voided         event cancelled/postponed. is_correct stays NULL; credits refunded.
-- ============================================================================

alter table public.prediction_rounds
  add column if not exists grading_status text not null default 'auto',
  add column if not exists graded_by uuid,
  add column if not exists graded_evidence_url text,
  add column if not exists graded_note text;

alter table public.prediction_rounds
  drop constraint if exists prediction_rounds_grading_status_chk;

alter table public.prediction_rounds
  add constraint prediction_rounds_grading_status_chk
  check (grading_status in ('auto', 'needs_grading', 'graded', 'voided'));

comment on column public.prediction_rounds.grading_status is
  'auto = Twelve Data (or equivalent) may grade; needs_grading = due freeform round waiting for admin YES/NO/VOID; graded = actual_outcome written; voided = event cancelled, predictions ungraded, creator refunded.';

comment on column public.prediction_rounds.graded_by is
  'Admin auth.users.id who confirmed YES/NO/VOID. Null on auto-graded price rounds.';

comment on column public.prediction_rounds.graded_evidence_url is
  'Optional https URL the admin cited when confirming a freeform outcome.';

comment on column public.prediction_rounds.graded_note is
  'Optional operator note (scoreline, postponement reason, refund remark).';

-- Badge count: SELECT count(*) WHERE grading_status = 'needs_grading'
create index if not exists prediction_rounds_needs_grading_idx
  on public.prediction_rounds (grading_status)
  where grading_status = 'needs_grading';
