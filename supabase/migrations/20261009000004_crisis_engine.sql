-- Crisis engine working tables, and a chunked neighbour rebuild.
--
-- DO NOT apply via supabase db push. Paste into the Supabase SQL Editor.
-- Rollback and the ledger insert are in docs/crisis/APPLY_ENGINE.md.
--
-- crisis_engine_runs / crisis_engine_steps are deletable working tables.
-- They are not part of the append-only public ledger (crisis_hypotheses).

-- ---------------------------------------------------------------------------
-- Neighbours: one country, or one admin1 batch of at most 200, per call.
-- Bbox prefilter, then touch / distance. No iso3 filter, so a border pair
-- is stored when either side's country is processed.
-- ---------------------------------------------------------------------------

create or replace function public.crisis_refresh_neighbor_batch(batch bigint[])
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  inserted integer;
begin
  perform set_config('statement_timeout', '120000', true);

  if batch is null or cardinality(batch) = 0 then
    return 0;
  end if;
  if cardinality(batch) > 200 then
    raise exception 'neighbor batch larger than 200';
  end if;

  delete from public.crisis_region_neighbors
  where region_id = any(batch);

  insert into public.crisis_region_neighbors (region_id, neighbor_id, shared_border)
  select
    a.id,
    b.id,
    extensions.ST_Touches(a.geom, b.geom)
  from public.crisis_regions a
  join public.crisis_regions b
    on b.level = 1
   and b.id <> a.id
   and b.geom is not null
   and extensions.ST_Expand(a.geom, 0.05) && b.geom
   and (
     extensions.ST_Touches(a.geom, b.geom)
     or extensions.ST_DWithin(a.geom, b.geom, 0.05)
   )
  where a.id = any(batch)
    and a.level = 1
    and a.geom is not null;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

comment on function public.crisis_refresh_neighbor_batch(bigint[]) is
  'Replace outgoing admin1 neighbour pairs for one batch of at most 200 regions. ST_Expand bbox prefilter, then ST_Touches or ST_DWithin 0.05 degrees, including other countries.';

revoke all on function public.crisis_refresh_neighbor_batch(bigint[]) from public, anon, authenticated;
grant execute on function public.crisis_refresh_neighbor_batch(bigint[]) to service_role;

-- ---------------------------------------------------------------------------
-- Engine working tables. Service role only. Safe to delete.
-- ---------------------------------------------------------------------------

create table if not exists public.crisis_engine_runs (
  id uuid primary key default gen_random_uuid(),
  region_id bigint references public.crisis_regions (id) on delete set null,
  horizon text not null,
  mode text not null,
  status text not null,
  triggered_by text not null,
  user_id uuid,
  roster jsonb,
  cost_usd numeric(12, 6),
  tokens_in integer,
  tokens_out integer,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  result jsonb,
  published_hypothesis_ids bigint[] not null default '{}',
  cache_key text,
  created_at timestamptz not null default now(),
  constraint crisis_engine_runs_horizon_chk check (horizon in ('7d', '30d', '180d')),
  constraint crisis_engine_runs_mode_chk check (mode in ('region', 'top', 'global')),
  constraint crisis_engine_runs_status_chk check (status in ('queued', 'running', 'done', 'error')),
  constraint crisis_engine_runs_triggered_by_chk check (triggered_by in ('admin', 'system', 'user'))
);

comment on table public.crisis_engine_runs is
  'Deletable engine working rows. cache_key is region|horizon|UTC date. Not the public proof ledger.';

create index if not exists crisis_engine_runs_cache_key_idx
  on public.crisis_engine_runs (cache_key);

create index if not exists crisis_engine_runs_region_created_idx
  on public.crisis_engine_runs (region_id, created_at desc);

alter table public.crisis_engine_runs enable row level security;

grant all on table public.crisis_engine_runs to service_role;

create table if not exists public.crisis_engine_steps (
  id bigserial primary key,
  run_id uuid not null references public.crisis_engine_runs (id) on delete cascade,
  role text not null,
  model text,
  provider text,
  prompt_hash text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(12, 6),
  latency_ms integer,
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  constraint crisis_engine_steps_role_chk
    check (role in ('dept_analyst', 'query_writer', 'search', 'hunter', 'red_team', 'judge'))
);

comment on table public.crisis_engine_steps is
  'One model or search call inside an engine run. Deleted with the run.';

create index if not exists crisis_engine_steps_run_idx
  on public.crisis_engine_steps (run_id, id);

alter table public.crisis_engine_steps enable row level security;

grant all on table public.crisis_engine_steps to service_role;
grant usage, select on sequence public.crisis_engine_steps_id_seq to service_role;
