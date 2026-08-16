-- League research-packet cache (Part 3: dynamic research gathering).
-- One row per (instrument, horizon, 6h UTC bucket): the assembled shared
-- research packet so repeated generations of the same round re-fetch nothing.
--
-- Security: RLS enabled with NO policies — default-deny for anon/authenticated;
-- only the service role (which bypasses RLS) reads/writes this internal cache.

create table if not exists public.league_research_packets (
  cache_key  text primary key,
  instrument text not null,
  horizon    text not null,
  payload    jsonb not null,
  cost_usd   numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table public.league_research_packets enable row level security;

comment on table public.league_research_packets is
  'Internal cache for the league research director (shared packet injected into premier/challenger/world). Service-role only.';
