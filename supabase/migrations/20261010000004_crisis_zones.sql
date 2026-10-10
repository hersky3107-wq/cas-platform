-- Zone scope on the crisis engine queue.
--
-- DO NOT apply via supabase db push. Paste into the Supabase SQL Editor.
-- Rollback and the ledger insert are in docs/crisis/APPLY_ZONES.md.
--
-- Adds scope 'zone' and zone_key. 'all' is a batch marker that the worker
-- expands into the 15 zones. Also allows engine runs with mode 'zone'.

alter table public.crisis_engine_requests
  add column if not exists zone_key text;

alter table public.crisis_engine_requests
  drop constraint if exists crisis_engine_requests_scope_chk;

alter table public.crisis_engine_requests
  add constraint crisis_engine_requests_scope_chk
  check (scope in ('region', 'zone', 'all'));

alter table public.crisis_engine_requests
  drop constraint if exists crisis_engine_requests_region_scope_chk;

alter table public.crisis_engine_requests
  add constraint crisis_engine_requests_region_scope_chk
  check (
    (scope = 'region' and region_id is not null and zone_key is null)
    or (scope = 'zone' and region_id is null and zone_key is not null)
    or (scope = 'all' and region_id is null and zone_key is null)
  );

alter table public.crisis_engine_runs
  drop constraint if exists crisis_engine_runs_mode_chk;

alter table public.crisis_engine_runs
  add constraint crisis_engine_runs_mode_chk
  check (mode in ('region', 'top', 'global', 'zone'));

alter table public.crisis_unlocks
  add column if not exists zone_key text;

alter table public.crisis_unlocks
  drop constraint if exists crisis_unlocks_kind_chk;

alter table public.crisis_unlocks
  add constraint crisis_unlocks_kind_chk
  check (kind in ('brief', 'deep', 'deep_refund', 'zone', 'global'));

create unique index if not exists crisis_unlocks_zone_unique
  on public.crisis_unlocks (user_id, zone_key)
  where kind = 'zone' and zone_key is not null;

create unique index if not exists crisis_unlocks_global_unique
  on public.crisis_unlocks (user_id)
  where kind = 'global';
