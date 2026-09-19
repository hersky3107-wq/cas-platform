/**
 * Cache for the league-divination adapter. Keyed by prediction round id so
 * every viewer of a round reads the identical packed result.
 *
 * Oracle-owned. Not a new oracle session kind. No credit column.
 * No FK to prediction_rounds — oracle must not depend on the league ledger.
 */
create table if not exists public.oracle_league_divination_cache (
  round_id          text primary key,
  first_viewed_at   timestamptz not null,
  result            jsonb not null,
  created_at        timestamptz not null default now()
);

alter table public.oracle_league_divination_cache enable row level security;

drop policy if exists "oracle_league_divination_cache_select_authenticated" on public.oracle_league_divination_cache;
create policy "oracle_league_divination_cache_select_authenticated"
  on public.oracle_league_divination_cache
  for select
  to authenticated
  using (true);

drop policy if exists "oracle_league_divination_cache_service_write" on public.oracle_league_divination_cache;
create policy "oracle_league_divination_cache_service_write"
  on public.oracle_league_divination_cache
  for all
  to service_role
  using (true)
  with check (true);
