-- ============================================================================
-- AI Prediction League — anchor price (ADDITIVE, GRADING BASELINE).
--
-- WHY: the price the instrument was AT WHEN the round opened is what makes a
-- model's up/down call mean anything. It is used TWICE:
--   1. the card header shows it ("AAPL — $305.59 at prediction, Aug 18 12:44");
--   2. reconciliation GRADES against it — it is the baseline half of every
--      up/down verdict (see `lib/prediction/reconciliation.ts` and the pure
--      decision logic in `lib/prediction/resolution.ts`).
--
-- That price was already being fetched at generation time (`fetchDataPacket` in
-- `lib/league/market-data.ts`, used to build the model prompts) but was never
-- persisted — it lived only in the orchestrator's in-memory result for the
-- duration of one `generatePredictions()` call.
--
-- Two nullable columns, no backfill. Consequence, by design: a round with no
-- anchor_price CANNOT be graded and is left unresolved with every is_correct
-- null, rather than graded against a baseline re-derived at grading time. An
-- ungraded round is acceptable; a wrongly graded one is not.
-- ============================================================================

alter table public.prediction_rounds
  add column if not exists anchor_price numeric,
  add column if not exists anchor_price_at timestamptz;

comment on column public.prediction_rounds.anchor_price is
  'Instrument price at round-open time (from the data packet fetched for the model prompts). THE GRADING BASELINE: reconciliation compares the historical close inside (anchor_price_at, resolves_at] against this value to decide up/down (see lib/prediction/resolution.ts). Also shown in the card header. Null for rounds created before this column existed, or when the price feed was unavailable at open time — such rounds are left ungraded, never graded against a re-derived baseline.';

comment on column public.prediction_rounds.anchor_price_at is
  'Timestamp the anchor_price was observed. Null iff anchor_price is null. Grading-critical: it is the OPEN bound of the resolution window — only a session that closed strictly after this instant, and at or before resolves_at, may be used as the resolution price.';
