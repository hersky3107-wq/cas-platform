-- ============================================================================
-- AI Prediction League — KRX investor flows / short / foreign ownership.
--
-- Run in the Supabase SQL Editor. Do NOT `supabase db push`.
--
-- Security: RLS enabled with NO policies — default-deny for anon/authenticated;
-- only the service role (which bypasses RLS) reads/writes these tables.
-- ============================================================================

create table if not exists public.league_krx_flows (
  bas_dd date not null,
  market text not null check (market in ('KOSPI', 'KOSDAQ')),
  code text not null,
  investor text not null check (
    investor in ('foreign', 'institution', 'individual', 'pension', 'financial_investment')
  ),
  net_volume bigint,
  net_value bigint,
  fetched_at timestamptz not null default now(),
  primary key (bas_dd, market, code, investor)
);

create index if not exists league_krx_flows_market_code_bas_dd_idx
  on public.league_krx_flows (market, code, bas_dd desc);

alter table public.league_krx_flows enable row level security;

comment on table public.league_krx_flows is
  'KRX investor net purchases by ticker. Service-role only. Emptiness is never cached.';

create table if not exists public.league_krx_short (
  bas_dd date not null,
  market text not null check (market in ('KOSPI', 'KOSDAQ')),
  code text not null,
  short_volume bigint,
  short_value bigint,
  short_ratio numeric,
  balance_qty bigint null,
  balance_value bigint null,
  balance_ratio numeric null,
  fetched_at timestamptz not null default now(),
  primary key (bas_dd, market, code)
);

create index if not exists league_krx_short_market_code_bas_dd_idx
  on public.league_krx_short (market, code, bas_dd desc);

alter table public.league_krx_short enable row level security;

comment on table public.league_krx_short is
  'KRX short volume (session) and short balance (published ~T+2). Service-role only.';

create table if not exists public.league_krx_foreign_own (
  bas_dd date not null,
  market text not null check (market in ('KOSPI', 'KOSDAQ')),
  code text not null,
  foreign_holding_ratio numeric,
  limit_exhaustion_ratio numeric,
  fetched_at timestamptz not null default now(),
  primary key (bas_dd, market, code)
);

create index if not exists league_krx_foreign_own_market_code_bas_dd_idx
  on public.league_krx_foreign_own (market, code, bas_dd desc);

alter table public.league_krx_foreign_own enable row level security;

comment on table public.league_krx_foreign_own is
  'KRX foreign ownership and limit exhaustion ratios. Service-role only.';
