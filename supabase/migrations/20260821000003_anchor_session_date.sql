-- ============================================================================
-- AI Prediction League — ANCHOR SESSION DATE (ADDITIVE).
--
-- `anchor_price_at` is when the baseline was OBSERVED (a timestamptz). That is
-- not the session whose close the price is. Printing its calendar date as if
-- it were the close date is what made the AAPL audit sentence say Aug 18 for
-- a $305.59 Aug 17 close.
--
-- This column is the session date (YYYY-MM-DD, UTC-dated daily bar) of
-- `anchor_price`. Populated at round creation from the same data packet.
-- Nullable so older rounds stay readable; the UI must never invent a session
-- date from `anchor_price_at` or `resolves_at` when this is null.
-- ============================================================================

alter table public.prediction_rounds
  add column if not exists anchor_session_date date;

comment on column public.prediction_rounds.anchor_session_date is
  'UTC-dated daily session whose close is stored in anchor_price. THE date the audit sentence may name as the starting close. Null when the packet had no dated bar — never inferred from anchor_price_at.';
