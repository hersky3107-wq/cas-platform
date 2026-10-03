-- Why: each seat now names the single strongest reason its direction
-- could be wrong. Admin grade reads it; the public card does not.
-- Apply manually (no db push).
alter table public.model_predictions
  add column if not exists strongest_counter text;

comment on column public.model_predictions.strongest_counter is
  'Pre-mortem reason for the chosen direction, 20 words or fewer. Null when the model omitted it. Never shown on the public card.';
