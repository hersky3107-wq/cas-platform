-- Magnitude as a decoration on the binary proposition (2026-08-24).
--
-- Adds the model's stated expected percent move (signed to match its own
-- direction) alongside the existing direction/probability columns. The
-- GRADED proposition is unchanged — still exactly up/down
-- (model_predictions.is_correct). Magnitude is presentation-only and is
-- never read by grading/reconciliation or by any hit/win-rate calculation:
-- lib/league/round-hit.ts and lib/league/win-rate.ts take no magnitude
-- argument at all, and lib/prediction/resolution.ts grades on the SIGN of
-- the anchor/resolution difference, never this percent figure.
--
-- Per-horizon sanity bounds (1d ±30% / 1w ±60% / 1m ±120% / 3m ±250%) and
-- the direction-sign check are enforced app-side at write time
-- (lib/league/magnitude.ts's validateMagnitude, called from
-- lib/league/orchestrator.ts before every upsert). The CHECK constraints
-- below are a much wider DB-level backstop, not the primary gate — they
-- exist so a future write path cannot silently skip validation and still
-- persist an inverted-sign or physically-impossible value.
--
-- consensus_aggregate_magnitude_pct / _n mirror the existing
-- consensus_aggregate_direction/_probability pair added in
-- 20260824000003_consensus_aggregate_open_phase.sql: a best-effort audit
-- snapshot written once at generation end. The LIVE card recomputes the same
-- aggregate from model rows on every read (card-aggregate.ts's
-- buildConsensus -> lib/league/magnitude.ts's aggregateMagnitude), so these
-- two columns are never the sole source of truth.
--
-- Verify AFTER applying with information_schema / pg catalogs:
--
--   select column_name, data_type
--     from information_schema.columns
--    where table_name = 'model_predictions' and column_name = 'predicted_magnitude_pct';
--
--   select column_name, data_type
--     from information_schema.columns
--    where table_name = 'prediction_rounds'
--      and column_name in ('consensus_aggregate_magnitude_pct', 'consensus_aggregate_magnitude_n');
--
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.model_predictions'::regclass
--      and conname like 'model_predictions_magnitude%';

alter table public.model_predictions
  add column if not exists predicted_magnitude_pct numeric;

alter table public.model_predictions
  drop constraint if exists model_predictions_magnitude_bound_chk;

alter table public.model_predictions
  add constraint model_predictions_magnitude_bound_chk
  check (
    predicted_magnitude_pct is null
    or abs(predicted_magnitude_pct) <= 500
  );

alter table public.model_predictions
  drop constraint if exists model_predictions_magnitude_sign_chk;

alter table public.model_predictions
  add constraint model_predictions_magnitude_sign_chk
  check (
    predicted_magnitude_pct is null
    or predicted_direction is null
    or predicted_direction = 'flat'
    or (predicted_direction = 'up' and predicted_magnitude_pct >= 0)
    or (predicted_direction = 'down' and predicted_magnitude_pct <= 0)
  );

comment on column public.model_predictions.predicted_magnitude_pct is
  'Model-stated expected percent change over the round horizon, signed to match predicted_direction (positive for up, negative for down). Decoration on the binary proposition — presentation only, never read by grading (is_correct) or any hit/win-rate calculation. Per-horizon sanity bounds are enforced app-side (lib/league/magnitude.ts); the CHECK constraints here are a wide DB-level backstop only.';

alter table public.prediction_rounds
  add column if not exists consensus_aggregate_magnitude_pct numeric,
  add column if not exists consensus_aggregate_magnitude_n integer;

comment on column public.prediction_rounds.consensus_aggregate_magnitude_pct is
  'Median predicted magnitude among models whose OWN direction matches consensus_aggregate_direction (median, not a mean, so an opposite-direction outlier cannot cancel it toward 0 and a single extreme value cannot skew it). Audit snapshot at generation end; the live card recomputes the same figure from model rows.';

comment on column public.prediction_rounds.consensus_aggregate_magnitude_n is
  'Count of models whose magnitude fed consensus_aggregate_magnitude_pct (direction-agreeing, numeric magnitude present). A small n on a close vote is expected and not itself an error.';
