-- ============================================================================
-- AI Prediction League — KR / US equity universe (popularity + groups).
--
-- Run in the Supabase SQL Editor. Do NOT `supabase db push`.
--
-- Security: RLS enabled with NO policies — default-deny for anon/authenticated;
-- only the service role (which bypasses RLS) reads/writes this table.
-- Same pattern as league_research_packets.
-- ============================================================================

create table if not exists public.league_kr_universe (
  market text not null check (market in ('KOSPI', 'KOSDAQ', 'US')),
  code text not null,
  name text not null,
  group_id text null,
  status text not null default 'auto' check (status in ('auto', 'pinned', 'hidden')),
  popularity_rank int null,
  avg_trdval_20d_eok bigint null,
  mktcap_eok bigint null,
  visible boolean not null default false,
  removed_at timestamptz null,
  flags text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (market, code)
);

create index if not exists league_kr_universe_market_visible_group_rank_idx
  on public.league_kr_universe (market, visible, group_id, popularity_rank);

alter table public.league_kr_universe enable row level security;

comment on table public.league_kr_universe is
  'Operator-curated KR/US equity universe. Visibility uses 20d trading-value rank hysteresis. Service-role only.';

comment on column public.league_kr_universe.group_id is
  'KR_GROUPS id (semis, battery, …, other). Null for US listings.';

comment on column public.league_kr_universe.flags is
  'Operator tags, e.g. theme_smallcap, foreign_issuer.';
