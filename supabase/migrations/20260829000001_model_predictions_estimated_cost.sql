-- League cost ledger: keep the token×list-price estimate next to the
-- authoritative billed figure in cost_usd. Without this column a provider
-- that reports real USD (xAI cost_in_usd_ticks, Perplexity usage.cost,
-- OpenRouter usage.cost) overwrites the estimate and we cannot see how far
-- off the roster price was.
--
-- server_side_tools_used is the xAI Agent Tools invocation count for the
-- scout live-search seat. Null for every other model.
alter table public.model_predictions
  add column if not exists estimated_cost_usd numeric,
  add column if not exists server_side_tools_used integer;

comment on column public.model_predictions.estimated_cost_usd is
  'Token × roster list-price fallback. cost_usd stores billed USD when the provider reported one; this column always stores the estimate so the two can be compared.';

comment on column public.model_predictions.server_side_tools_used is
  'xAI Agent Tools num_server_side_tools_used for grok-4.6-livesearch. Null for models that do not expose a tool-invocation count.';
