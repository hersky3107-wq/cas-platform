-- ============================================================================
-- AI Prediction League — widen prediction_rounds.category CHECK.
--
-- ORDER: apply this AFTER the TypeScript writers accept 'tech' and
-- 'ai_models' (PredictionCategory, CATEGORY_UNIVERSE, jurisdiction matrix,
-- CATEGORY_COLOR). A CHECK added before those writers accept the value
-- means a round INSERT fails after 40 model calls are already paid for.
--
-- Existing 15 values are KEPT so historical rows stay valid.
--   tech      — first subject-outcome adapter (this pass)
--   ai_models — ledger-only until its adapter lands (same trip so we do
--               not reopen this CHECK later)
--
-- Public chips are NOT added here. Cards tab stays 12 categories.
--
-- Verify AFTER applying (information_schema / pg_constraint, NOT PostgREST):
--
--   select conname, pg_get_constraintdef(oid), convalidated
--     from pg_constraint
--    where conname = 'prediction_rounds_category_chk';
-- ============================================================================

alter table public.prediction_rounds
  drop constraint if exists prediction_rounds_category_chk;

alter table public.prediction_rounds
  add constraint prediction_rounds_category_chk check (category in (
    'stock','etf_index','bond_rate','gold_metal','macro_econ',
    'commodity_energy','crypto_spot','fx','futures_derivatives',
    'politics_election','sports','entertainment_awards','memecoin',
    'crypto_perps','real_estate','tech','ai_models'
  ));
