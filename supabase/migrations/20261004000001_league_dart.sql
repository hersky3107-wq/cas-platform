-- ============================================================================
-- AI Prediction League — OpenDART corp map + disclosure/fundamentals cache.
--
-- Run in the Supabase SQL Editor. Do NOT `supabase db push`.
--
-- Security: RLS enabled with NO policies — default-deny for anon/authenticated;
-- only the service role (which bypasses RLS) reads/writes these tables.
-- The API key is never stored here. Payloads are derived filing facts for
-- the shared KRSTOCK packet, not a public redistribution of raw filings.
-- ============================================================================

create table if not exists public.league_dart_corp (
  stock_code text primary key,
  corp_code text not null,
  corp_name text not null,
  updated_at timestamptz not null default now()
);

create index if not exists league_dart_corp_corp_code_idx
  on public.league_dart_corp (corp_code);

alter table public.league_dart_corp enable row level security;

comment on table public.league_dart_corp is
  'OpenDART corp_code for each KOSPI/KOSDAQ league_kr_universe stock_code. Service-role only.';

create table if not exists public.league_dart_cache (
  corp_code text not null,
  kind text not null check (kind in ('disclosures', 'fundamentals')),
  period text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (corp_code, kind, period)
);

alter table public.league_dart_cache enable row level security;

comment on table public.league_dart_cache is
  'OpenDART disclosure (6h) and fundamentals (daily re-check) cache. Service-role only. Failures are not stored.';
