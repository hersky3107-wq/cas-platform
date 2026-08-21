-- ============================================================================
-- AI Prediction League — GRADING TRIGGER STATE (ADDITIVE).
--
-- WHY: grading moved from "a cron someone may or may not have run" to
-- GRADE-ON-READ plus an admin sweep. Both need two things the ledger could not
-- express before:
--
--  1. A CLAIM so concurrent readers of the same due round cannot double-grade
--     it. Same shape as `league_deep_runs.busy_until`: a short lease, taken by
--     a conditional UPDATE, that expires on its own if the process dies.
--
--  2. An HONEST UNGRADED STATE. `actual_outcome is null` used to mean both
--     "not due yet" and "we tried and could not grade it". Recording the
--     refusal reason lets the card and the leaderboard say which, instead of
--     silently hiding the round.
--
-- Derived states (see lib/prediction/grading-state.ts — nothing is stored as a
-- status string, so these can never drift out of sync with the data):
--   not_due       resolves_at is in the future
--   grading       grading_busy_until is in the future (a claim is in flight)
--   graded        actual_outcome / resolved_at set
--   unresolvable  due, ungraded, and unresolvable_reason recorded
--   due_ungraded  due, ungraded, never attempted (or the reason was cleared)
--
-- `unresolvable_reason` is the LAST ATTEMPT's refusal, not a terminal verdict:
-- a round left unresolvable for `missing_anchor` grades normally on the next
-- pass once its anchor_price is backfilled. `grading_attempted_at` throttles
-- the read path so a permanently-unresolvable round cannot be re-attempted on
-- every page view; the admin sweep ignores that throttle.
-- ============================================================================

alter table public.prediction_rounds
  add column if not exists grading_busy_until   timestamptz,
  add column if not exists grading_attempted_at timestamptz,
  add column if not exists unresolvable_reason  text,
  add column if not exists unresolvable_detail  text;

comment on column public.prediction_rounds.grading_busy_until is
  'Grading CLAIM lease. Set by the conditional UPDATE that claims a due, ungraded round; only the claim holder grades it. Expiry (not an explicit release) is what makes a crashed grader self-healing. Same pattern as league_deep_runs.busy_until.';

comment on column public.prediction_rounds.grading_attempted_at is
  'When grading was last ATTEMPTED (set at claim time, whether or not the attempt produced a grade). Used only to throttle the grade-on-read path so an unresolvable round is not retried on every page view; the admin sweep deliberately ignores it.';

comment on column public.prediction_rounds.unresolvable_reason is
  'Why the last grading attempt refused to grade: missing_anchor | invalid_window | series_unavailable | no_series_data | no_session_in_window | equal_close | not_price_instrument (see lib/prediction/resolution.ts). NOT terminal — cleared automatically when a later attempt succeeds. Surfaced in the UI so an ungraded round is visible rather than hidden.';

comment on column public.prediction_rounds.unresolvable_detail is
  'Human-readable detail for unresolvable_reason (the specific window, provider error, or session dates seen). Operator diagnostics; never shown as user-facing copy.';

-- The grade-on-read and sweep scans both look for "due and ungraded". The
-- existing prediction_rounds_due_idx (resolves_at where actual_outcome is null)
-- already covers that predicate.
