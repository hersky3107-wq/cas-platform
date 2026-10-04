-- ============================================================================
-- AI Prediction League — per-locale propositions on prediction_rounds.
--
-- Run in the Supabase SQL Editor. Do NOT `supabase db push`.
-- ============================================================================

alter table public.prediction_rounds
  add column if not exists propositions jsonb;

comment on column public.prediction_rounds.propositions is
  'Per-locale proposition text dictionary { [locale]: text }, populated at compose time or backfilled on read.';
