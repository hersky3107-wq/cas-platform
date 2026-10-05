-- ============================================================================
-- AI Prediction League — official housing-index prints.
--
-- Run in the Supabase SQL Editor. Do NOT `supabase db push`.
--
-- The FIRST row for a (country, region, metric, ref_period) is the grading
-- vintage. Later revisions are extra rows and must not update that value.
--
-- Security: RLS enabled with NO policies — default-deny for anon/authenticated.
-- Only the service role (which bypasses RLS) reads and writes.
-- ============================================================================

create table if not exists public.league_housing_index_prints (
  id                  uuid primary key default gen_random_uuid(),
  country             text not null,
  region_code         text not null,
  metric              text not null,
  series_id           text not null,
  ref_period          text not null,
  value               numeric not null,
  vintage             text not null,
  first_published_at  timestamptz not null,
  fetched_at          timestamptz not null default now(),
  source              text not null,
  source_url          text,

  constraint league_housing_index_prints_period_chk
    check (ref_period ~ '^\d{4}-\d{2}$'),
  constraint league_housing_index_prints_vintage_chk
    check (vintage in ('first', 'revision'))
);

create unique index if not exists league_housing_index_prints_first_uidx
  on public.league_housing_index_prints (country, region_code, metric, ref_period)
  where vintage = 'first';

create index if not exists league_housing_index_prints_lookup_idx
  on public.league_housing_index_prints (country, region_code, metric, ref_period);

alter table public.league_housing_index_prints enable row level security;

comment on table public.league_housing_index_prints is
  'Official housing-index levels. vintage=first is the grading print and is never updated. Revisions are separate rows.';
