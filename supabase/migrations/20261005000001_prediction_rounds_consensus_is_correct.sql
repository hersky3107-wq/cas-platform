-- AI 종합 track record + brand_table aggregate picks (2026-10-05).
--
-- consensus_is_correct is stamped when a round is graded (and backfilled
-- for already-graded rounds). Null when ungraded, voided, or no pick.
--
-- Direction CHECKs previously allowed only up/down/yes/no/above/below.
-- brand_table stores the predicted #1 brand as the aggregate pick, so the
-- columns accept any short non-empty token.

alter table public.prediction_rounds
  add column if not exists consensus_is_correct boolean;

comment on column public.prediction_rounds.consensus_is_correct is
  'Whether consensus_aggregate_direction matches the graded actual_outcome (AI 종합). Null when ungraded, voided, or no consensus pick.';

alter table public.prediction_rounds
  drop constraint if exists prediction_rounds_consensus_majority_direction_chk;

alter table public.prediction_rounds
  add constraint prediction_rounds_consensus_majority_direction_chk
  check (
    consensus_majority_direction is null
    or char_length(btrim(consensus_majority_direction)) between 1 and 80
  );

alter table public.prediction_rounds
  drop constraint if exists prediction_rounds_consensus_aggregate_direction_chk;

alter table public.prediction_rounds
  add constraint prediction_rounds_consensus_aggregate_direction_chk
  check (
    consensus_aggregate_direction is null
    or char_length(btrim(consensus_aggregate_direction)) between 1 and 80
  );
