-- Apply the missing league grading columns, then backfill the AAPL round
-- that is stuck unresolvable for lack of a starting price.
--
-- Run this yourself (SQL editor / psql). Do not treat it as an automatic
-- migration — it writes a specific price for one known round.
--
-- 1) Anchor columns (migration 20260818000002)
alter table public.prediction_rounds
  add column if not exists anchor_price numeric,
  add column if not exists anchor_price_at timestamptz;

-- 2) Grading-state columns (migration 20260821000002)
--    Copy from supabase/migrations/20260821000002_prediction_grading_state.sql
--    if this block is out of date. Included here so one paste is enough.
alter table public.prediction_rounds
  add column if not exists grading_busy_until timestamptz,
  add column if not exists grading_attempted_at timestamptz,
  add column if not exists unresolvable_reason text,
  add column if not exists unresolvable_detail text;

-- 3) Resolution audit columns (migration 20260821000001) — needed to persist a grade
alter table public.prediction_rounds
  add column if not exists resolution_price numeric,
  add column if not exists resolution_session_date date;

-- 4) Backfill THIS AAPL round only.
--    Aug 17 close $305.59, timestamped at the round's opened_at.
update public.prediction_rounds
set
  anchor_price = 305.59,
  anchor_price_at = opened_at
where id = 'fffc1716-cd3d-45f2-883f-1242a373febc'
  and anchor_price is null;

-- After this, reload the card. Grade-on-read should claim the round and
-- resolve it against the last session close inside (anchor_price_at, resolves_at].
