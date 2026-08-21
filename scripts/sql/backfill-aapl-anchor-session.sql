-- Persist the session date of the AAPL anchor close. $305.59 is the
-- 2026-08-17 session, not the calendar date of anchor_price_at.
-- Run after migration 20260821000003_anchor_session_date.sql.

alter table public.prediction_rounds
  add column if not exists anchor_session_date date;

update public.prediction_rounds
set anchor_session_date = '2026-08-17'
where id = 'fffc1716-cd3d-45f2-883f-1242a373febc'
  and anchor_price = 305.59
  and anchor_session_date is null;
