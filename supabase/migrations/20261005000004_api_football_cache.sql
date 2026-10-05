-- ============================================================================
-- AI Prediction League — API-FOOTBALL HTTP CACHE + DAILY USAGE (ADDITIVE).
--
-- Run in the Supabase SQL Editor. Do NOT `supabase db push`.
--
-- The client (`lib/league/sports/api-football.ts`) upserts both tables.
-- If they are missing it falls back to in-process memo + a console usage log.
-- ============================================================================

create table if not exists public.api_football_http_cache (
  cache_key  text primary key,
  payload    jsonb not null,
  fetched_at timestamptz not null default now(),
  ttl        timestamptz not null
);

create index if not exists api_football_http_cache_ttl_idx
  on public.api_football_http_cache (ttl);

create table if not exists public.api_football_usage (
  day           date primary key,
  request_count integer not null default 0
);

alter table public.api_football_http_cache enable row level security;
alter table public.api_football_usage enable row level security;

comment on table public.api_football_http_cache is
  'API-Football (v3.football.api-sports.io) JSON cache. Service-role only. Not a grading table.';

comment on table public.api_football_usage is
  'UTC-day request counts for API-Football. Service-role only.';
