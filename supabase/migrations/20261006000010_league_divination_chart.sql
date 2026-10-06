-- ============================================================================
-- AI Prediction League — divination seat 사주 / 구성기학 chart.
--
-- Run in the Supabase SQL Editor. Do NOT `supabase db push`.
--
-- model_predictions.divination_chart: display-only chart behind the
-- divination tile's small line (사주 연주·월주 for tech / politics /
-- entertainment, 구성기학 centre star + direction for real estate). Null on
-- every other seat. The verdict stays the oracle code vote.
--
-- league_divination_subject_cache: Wikidata birth / founding month per
-- subject (`<category>:<normalized name>`). `result` null = not found or
-- ambiguous. Not a reading cache — readings stay in
-- oracle_league_divination_cache.
--
-- Both are optional at runtime: writes and reads retry without them.
--
-- Security: RLS enabled with NO policies on the cache — service role only.
-- ============================================================================

alter table public.model_predictions
  add column if not exists divination_chart jsonb;

comment on column public.model_predictions.divination_chart is
  'Divination seat only: 사주 (subject + period 연주·월주) or 구성기학 (年盤/月盤 centre star, direction, 殺) chart for the tile line. Display only.';

create table if not exists public.league_divination_subject_cache (
  subject_key text primary key,
  subject_label text not null,
  result jsonb,
  fetched_at timestamptz not null default now()
);

alter table public.league_divination_subject_cache enable row level security;

comment on table public.league_divination_subject_cache is
  'Wikidata birth/founding month per divination subject (person P569, party P571, company CEO P169→P569 else P571). Service-role only.';
