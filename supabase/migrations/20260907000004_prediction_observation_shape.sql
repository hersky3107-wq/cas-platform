-- ============================================================================
-- AI Prediction League — persist observation_shape on prediction_rounds.
--
-- WHY: binary_subject_outcome covers two mapping rules. Name-equality with
-- subject_label is the sports-winner rule. Tech (and most corporate events)
-- is an occurrence: the operator reports whether the stated thing happened.
-- Treating them as one silently inverted tech grades.
--
-- The adapter DECLARES the shape at compose time. This column is the
-- grade-time source of truth so a later adapter edit cannot reinterpret a
-- historical round. NULL + binary_subject_outcome = legacy name_match.
--
-- Verify AFTER applying:
--
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'prediction_rounds'
--      and column_name = 'observation_shape';
--
--   select conname, pg_get_constraintdef(oid), convalidated
--     from pg_constraint
--    where conname = 'prediction_rounds_observation_shape_chk';
-- ============================================================================

alter table public.prediction_rounds
  add column if not exists observation_shape text;

alter table public.prediction_rounds
  drop constraint if exists prediction_rounds_observation_shape_chk;

alter table public.prediction_rounds
  add constraint prediction_rounds_observation_shape_chk
  check (observation_shape is null or observation_shape in ('name_match', 'occurrence'));

comment on column public.prediction_rounds.observation_shape is
  'How operator evidence maps onto the side pair for binary_subject_outcome: name_match (winner/electee/honoree equals subject_label) or occurrence (structured occurred|did_not_occur). Adapter-authored at compose; NULL on subject-outcome is the legacy sports default (name_match).';
