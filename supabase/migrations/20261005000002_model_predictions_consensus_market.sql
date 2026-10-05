-- Consensus extra seat: where the direction came from (admin only).
-- Apply manually. Do not db push.
-- Official seats leave every column null.

alter table public.model_predictions
  add column if not exists consensus_source text,
  add column if not exists consensus_market_id text,
  add column if not exists consensus_market_outcome text,
  add column if not exists consensus_implied_probability numeric,
  add column if not exists consensus_relevance numeric;

alter table public.model_predictions
  drop constraint if exists model_predictions_consensus_source_chk;

alter table public.model_predictions
  add constraint model_predictions_consensus_source_chk
  check (
    consensus_source is null
    or consensus_source in ('kalshi', 'polymarket', 'search', 'none')
  );

comment on column public.model_predictions.consensus_source is
  'Consensus extra seat only: kalshi, polymarket, search, or none. Official seats stay null.';

comment on column public.model_predictions.consensus_market_id is
  'Matched venue market id or slug. Null unless consensus_source is kalshi or polymarket.';

comment on column public.model_predictions.consensus_market_outcome is
  'Matched outcome label (YES side or brand). Null unless a venue market was accepted.';

comment on column public.model_predictions.consensus_implied_probability is
  'YES price of the matched outcome, 0 to 1.';

comment on column public.model_predictions.consensus_relevance is
  'LLM relevance score, 0 to 1. Accepted matches are at least 0.7.';
