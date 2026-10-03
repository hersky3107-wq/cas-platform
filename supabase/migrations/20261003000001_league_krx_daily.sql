-- ============================================================================
-- AI Prediction League — official KRX daily closes (KOSPI / KOSDAQ).
--
-- Run in the Supabase SQL Editor. Do NOT `supabase db push`.
--
-- Security: RLS enabled with NO policies — default-deny for anon/authenticated;
-- only the service role (which bypasses RLS) reads/writes this table.
-- Same pattern as league_research_packets / league_kr_universe.
-- ============================================================================

create table if not exists public.league_krx_daily (
  bas_dd date not null,
  market text not null check (market in ('KOSPI', 'KOSDAQ')),
  code text not null,
  name text,
  open numeric,
  high numeric,
  low numeric,
  close numeric not null,
  volume bigint,
  trdval bigint,
  mktcap bigint,
  fetched_at timestamptz not null default now(),
  primary key (bas_dd, market, code)
);

create index if not exists league_krx_daily_market_code_bas_dd_idx
  on public.league_krx_daily (market, code, bas_dd desc);

alter table public.league_krx_daily enable row level security;

comment on table public.league_krx_daily is
  'Official KRX daily OHLCV per KOSPI/KOSDAQ code. Service-role only. Emptiness is never cached.';
