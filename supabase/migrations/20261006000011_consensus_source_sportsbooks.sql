-- Consensus extra seat: de-vigged sports odds as a market baseline source.
-- Apply manually. Do not db push.
-- Until applied, a sports baseline row fails this check and is saved without
-- the consensus_* columns (the direction and rationale still land).

alter table public.model_predictions
  drop constraint if exists model_predictions_consensus_source_chk;

alter table public.model_predictions
  add constraint model_predictions_consensus_source_chk
  check (
    consensus_source is null
    or consensus_source in ('kalshi', 'polymarket', 'odds_api', 'api_football', 'search', 'none')
  );

comment on column public.model_predictions.consensus_source is
  'Consensus extra seat only: kalshi, polymarket, odds_api, api_football, search, or none. Official seats stay null.';

comment on column public.model_predictions.consensus_market_id is
  'Matched market id: Kalshi event ticker, Polymarket slug, or the sports fixture id. Null for search and none.';

comment on column public.model_predictions.consensus_implied_probability is
  'YES probability of the matched outcome, 0 to 1. Sports books are de-vigged before storage.';

comment on column public.model_predictions.consensus_relevance is
  'Match relevance, 0 to 1 (LLM score for event markets, window alignment for daily markets, 1 for the round''s own fixture). Accepted matches are at least 0.7.';
