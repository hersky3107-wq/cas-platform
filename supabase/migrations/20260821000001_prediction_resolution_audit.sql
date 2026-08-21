-- ============================================================================
-- AI Prediction League — resolution AUDIT TRAIL (ADDITIVE, grading-critical).
--
-- WHY: the leaderboard's whole claim is that a grade is irrefutable. That only
-- holds if the exact number and the exact session a round was graded against
-- are inspectable after the fact. `actual_outcome` carries a human-readable
-- summary; these two columns carry the machine-checkable pair.
--
-- Written together with `actual_outcome` / `resolved_at` by
-- `lib/prediction/reconciliation.ts`. Grading is refused (round left
-- unresolved, every is_correct left null) if these columns are absent, so a
-- grade can never exist without its audit trail.
--
-- Two nullable columns, no backfill: rounds graded before this existed keep
-- their `actual_outcome` string and simply have no structured audit pair.
-- ============================================================================

alter table public.prediction_rounds
  add column if not exists resolution_price numeric,
  add column if not exists resolution_session_date date;

comment on column public.prediction_rounds.resolution_price is
  'The exact close the round was GRADED against: the close of the last session inside (anchor_price_at, resolves_at], fetched from the historical time_series endpoint (never a live quote). Compared against anchor_price to produce actual_outcome. Null for rounds resolved before this column existed.';

comment on column public.prediction_rounds.resolution_session_date is
  'The session date (UTC-dated daily bar) whose close is stored in resolution_price. Together with anchor_price/anchor_price_at this makes every grade re-checkable against the provider after the fact.';
