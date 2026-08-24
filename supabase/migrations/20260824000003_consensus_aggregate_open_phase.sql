-- Consensus dual-store + open_phase tagging (2026-08-24).
--
-- consensus_* columns freeze majority vote AND log-odds aggregate at
-- generation end so the two methods can be compared retrospectively even if
-- the live card recomputes from model rows.
--
-- open_phase tags when the round was opened relative to the instrument's
-- exchange session. Tagging only — does not gate generation.

alter table public.prediction_rounds
  add column if not exists open_phase text,
  add column if not exists consensus_majority_direction text,
  add column if not exists consensus_majority_probability numeric,
  add column if not exists consensus_aggregate_direction text,
  add column if not exists consensus_aggregate_probability numeric;

alter table public.prediction_rounds
  drop constraint if exists prediction_rounds_open_phase_chk;

alter table public.prediction_rounds
  add constraint prediction_rounds_open_phase_chk
  check (
    open_phase is null
    or open_phase in ('pre_open', 'intraday', 'after_close', 'weekend')
  );

alter table public.prediction_rounds
  drop constraint if exists prediction_rounds_consensus_majority_direction_chk;

alter table public.prediction_rounds
  add constraint prediction_rounds_consensus_majority_direction_chk
  check (
    consensus_majority_direction is null
    or consensus_majority_direction in ('up', 'down')
  );

alter table public.prediction_rounds
  drop constraint if exists prediction_rounds_consensus_aggregate_direction_chk;

alter table public.prediction_rounds
  add constraint prediction_rounds_consensus_aggregate_direction_chk
  check (
    consensus_aggregate_direction is null
    or consensus_aggregate_direction in ('up', 'down')
  );

comment on column public.prediction_rounds.open_phase is
  'Market session phase at round creation: pre_open | intraday | after_close | weekend (instrument exchange). Tagging only — generation is not gated on this.';

comment on column public.prediction_rounds.consensus_majority_direction is
  'Persisted majority-vote direction (up/down) among binary model answers at generation end. Parallel to consensus_aggregate_*.';

comment on column public.prediction_rounds.consensus_majority_probability is
  'Mean stated probability among binary callers (majority method).';

comment on column public.prediction_rounds.consensus_aggregate_direction is
  'Persisted confidence-weighted log-odds aggregate direction. Headline uses this; method name is never shown in UI.';

comment on column public.prediction_rounds.consensus_aggregate_probability is
  'Persisted confidence in consensus_aggregate_direction after inverse-logit (0–100).';
