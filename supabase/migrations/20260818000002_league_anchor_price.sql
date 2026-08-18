-- ============================================================================
-- AI Prediction League — anchor price (ADDITIVE, presentation-driven).
--
-- WHY: the card header needs to show the price the instrument was AT WHEN the
-- round was opened (the "anchor" that makes a model's up/down call legible),
-- e.g. "AAPL — $305.59 at prediction, Aug 18 12:44". That price was already
-- being fetched at generation time (`fetchDataPacket` in
-- `lib/league/market-data.ts`, used to build the model prompts) but was never
-- persisted — it lived only in the orchestrator's in-memory result for the
-- duration of one `generatePredictions()` call.
--
-- Two nullable columns, no backfill: old rounds simply render without an
-- anchor price (the UI must — and does — handle that gracefully). No change
-- to any existing column, constraint, or the grading/reconciliation path.
-- ============================================================================

alter table public.prediction_rounds
  add column if not exists anchor_price numeric,
  add column if not exists anchor_price_at timestamptz;

comment on column public.prediction_rounds.anchor_price is
  'Instrument price at round-open time (from the data packet fetched for the model prompts). Null for rounds created before this column existed, or when the price feed was unavailable at open time. Presentation only — never used for grading (see lib/prediction/reconciliation.ts, which resolves against a live quote at resolution time instead).';

comment on column public.prediction_rounds.anchor_price_at is
  'Timestamp the anchor_price was observed. Null iff anchor_price is null.';
