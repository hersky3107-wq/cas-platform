-- Extra-tier seats sit below scout and are graded, but isolated from the
-- official 41-AI consensus. Job stage has no CHECK; this constraint did.
alter table public.model_predictions
  drop constraint if exists model_predictions_league_tier_chk;

alter table public.model_predictions
  add constraint model_predictions_league_tier_chk
  check (league_tier in ('premier', 'challenger', 'world', 'scout', 'extra'));
