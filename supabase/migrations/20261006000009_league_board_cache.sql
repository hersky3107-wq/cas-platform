-- ============================================================================
-- AI Prediction League — leaderboard board cache.
--
-- Run in the Supabase SQL Editor. Do NOT `supabase db push`.
--
-- One row per (board, signature). The signature names the round set the
-- board was computed from: `<scope>|h=<horizon>|p=<period>`. Public pages read
-- only this table. Rebuilt after grading batches and hourly by the
-- league-generate cron; rebuild once by hand with
--   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/rebuild-leaderboard-cache.ts
--
-- Reserved boards: `_meta` (build stamp + categories with data), `_summary`
-- (round count per signature), `_lease` (one rebuild at a time; computed_at
-- is the lease expiry).
--
-- Security: RLS enabled with NO policies — default-deny for anon/authenticated;
-- only the service role (which bypasses RLS) reads/writes this table.
-- ============================================================================

create table if not exists public.league_board_cache (
  board text not null,
  signature text not null,
  payload jsonb not null,
  refresh_id text not null,
  computed_at timestamptz not null default now(),
  primary key (board, signature)
);

create index if not exists league_board_cache_signature_idx
  on public.league_board_cache (signature);

create index if not exists league_board_cache_refresh_idx
  on public.league_board_cache (refresh_id);

alter table public.league_board_cache enable row level security;

comment on table public.league_board_cache is
  'Precomputed leaderboard boards keyed by (board, signature). Service-role only. Public reads never compute.';
