-- ============================================================================
-- AI Prediction League — KRSTOCK ANCHOR SOURCE (ADDITIVE).
--
-- Twelve Data daily close for KRX equals official TDD_CLSPRC when both exist,
-- but generate-time may fall back to Twelve Data before KRX has published.
-- This column records which source the persisted `anchor_price` came from so
-- a later sweep can verify (or park for admin review) without silently
-- rewriting the baseline.
-- ============================================================================

alter table public.prediction_rounds
  add column if not exists anchor_source text;

comment on column public.prediction_rounds.anchor_source is
  'KRSTOCK close source: krx_official | twelvedata | krx_official_verified. Null for other instruments. Never inferred.';
