-- ============================================================================
-- AI Prediction League — SPORTS FIXTURE CACHE (ADDITIVE).
--
-- Run in the Supabase SQL Editor. Do NOT `supabase db push`.
--
-- One row per Odds-API event id (a whole league slate is 1 HTTP call, then
-- N upserts). TTL 5h for odds/stats. Confirmed lineups are stored on the same
-- row and treated as immutable by the application (we do not overwrite them).
-- ============================================================================

create table if not exists public.sports_fixture_cache (
  fixture_id     text primary key,
  league         text not null,
  teams          jsonb not null,
  kickoff        timestamptz not null,
  devigged_odds  jsonb,
  lineups        jsonb,
  stats          jsonb,
  fetched_at     timestamptz not null default now(),
  ttl            timestamptz not null
);

create index if not exists sports_fixture_cache_league_kickoff_idx
  on public.sports_fixture_cache (league, kickoff);

create index if not exists sports_fixture_cache_ttl_idx
  on public.sports_fixture_cache (ttl);

alter table public.sports_fixture_cache enable row level security;

comment on table public.sports_fixture_cache is
  'Internal sports data cache (devigged odds, lineups, xG/FIP/net-rating). Service-role only. Not a grading table.';

comment on column public.sports_fixture_cache.fixture_id is
  'The Odds API event id (one request returns the whole league slate).';

comment on column public.sports_fixture_cache.teams is
  '{ "home": "...", "away": "..." }';

comment on column public.sports_fixture_cache.devigged_odds is
  'Preferred-book (Pinnacle if present) h2h prices after Shin/multiplicative overround removal.';

comment on column public.sports_fixture_cache.lineups is
  'API-Sports snapshot. immutable=true once a confirmed 11-a-side XI is stored.';

comment on column public.sports_fixture_cache.ttl is
  'Odds/stats expiry (5–6h). Confirmed lineups stay on the row past this.';
