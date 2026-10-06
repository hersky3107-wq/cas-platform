-- Official and scout seats store the analysis lens assigned for that round.
-- Null on extras and on rows written before lenses. Apply before the next
-- generation so the upsert does not fail on an unknown column.

alter table public.model_predictions
  add column if not exists analysis_lens text;

comment on column public.model_predictions.analysis_lens is
  'Analysis lens id for an official or scout seat (trend_momentum, form, …). Null on extras and on pre-lens rows.';
