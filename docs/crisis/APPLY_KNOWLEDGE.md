# Apply crisis knowledge: cascades and fragility atlas

Paste the SQL below into the Supabase SQL editor after 20261008000005. Do **not** use supabase db push. Do **not** apply this file from the agent.

The same statement is supabase/migrations/20261009000001_crisis_knowledge.sql. It is unapplied until this paste.

After it succeeds:

1. Record the ledger row at the bottom of this file.
2. Dry-run cascades: 
px tsx scripts/crisis/seed-cascades.ts
3. Dry-run fragility: 
px tsx scripts/crisis/load-fragility.ts
4. Write only after the paste: 
px tsx --env-file=.env.local scripts/crisis/seed-cascades.ts --apply
5. Then: 
px tsx --env-file=.env.local scripts/crisis/load-fragility.ts --apply

crisis_cascades is public read (anon, authenticated). crisis_fragility has no public policy; the service role bypasses RLS. Inserts leave 
egion_id null so crisis_assign_fragility assigns admin1, then country, then nearest within 300 km.

## SQL

`sql
-- Reference cascades and a fragility atlas (dams, plants, camps).
--
-- DO NOT apply via supabase db push. Paste into the Supabase SQL Editor.
-- Rollback and the ledger insert are in docs/crisis/APPLY_KNOWLEDGE.md.

create table if not exists public.crisis_cascades (
  id              text primary key,
  trigger_type    text not null,
  effect_type     text not null,
  lag_min_days    integer not null,
  lag_max_days    integer not null,
  conditions      jsonb not null default '{}'::jsonb,
  mechanism       text not null,
  evidence_level  text not null,
  sources         jsonb not null default '[]'::jsonb,
  notes           text,
  updated_at      timestamptz not null default now(),
  constraint crisis_cascades_evidence_chk
    check (evidence_level in ('sourced', 'hypothesis')),
  constraint crisis_cascades_lag_chk
    check (lag_min_days >= 0 and lag_max_days >= lag_min_days)
);

comment on table public.crisis_cascades is
  'Reference knowledge: trigger type to later effect, with lag and conditions. Public read, no public writes.';

alter table public.crisis_cascades enable row level security;

drop policy if exists crisis_cascades_public_select on public.crisis_cascades;
create policy crisis_cascades_public_select on public.crisis_cascades
  for select to anon, authenticated using (true);

grant select on public.crisis_cascades to anon, authenticated;
grant all on public.crisis_cascades to service_role;

create table if not exists public.crisis_fragility (
  id              bigserial primary key,
  region_id       bigint references public.crisis_regions (id),
  kind            text not null,
  name            text not null,
  lat             double precision not null,
  lon             double precision not null,
  geom            extensions.geometry(Point, 4326),
  attributes      jsonb not null default '{}'::jsonb,
  evidence        jsonb not null default '[]'::jsonb,
  confidence      text not null,
  source          text not null,
  source_license  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  dedupe_key      text generated always as (
    source || '|' || name || '|' || round(lat::numeric, 3)::text || '|' || round(lon::numeric, 3)::text
  ) stored,
  constraint crisis_fragility_kind_chk
    check (kind in (
      'dam', 'levee', 'glacial_lake', 'refugee_camp', 'nuclear_plant',
      'chemical_plant', 'port', 'power_plant', 'other'
    )),
  constraint crisis_fragility_confidence_chk
    check (confidence in ('dataset', 'candidate', 'confirmed', 'rejected')),
  constraint crisis_fragility_dedupe_key unique (dedupe_key)
);

comment on table public.crisis_fragility is
  'Hidden fragility points. Service role only. region_id is filled by crisis_assign_fragility.';

create index if not exists crisis_fragility_geom_gix
  on public.crisis_fragility using gist (geom);

create index if not exists crisis_fragility_region_kind_idx
  on public.crisis_fragility (region_id, kind);

alter table public.crisis_fragility enable row level security;

grant all on public.crisis_fragility to service_role;
grant usage, select on sequence public.crisis_fragility_id_seq to service_role;

-- Same contains-then-nearest rule as crisis_assign_signal in 20261008000003.
-- Self-contained so this table does not depend on crisis_assign_latlon_batch.
create or replace function public.crisis_assign_fragility()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  assigned bigint;
  pt extensions.geometry;
begin
  if new.lat is not null and new.lon is not null then
    new.geom := extensions.ST_SetSRID(extensions.ST_MakePoint(new.lon, new.lat), 4326);
  end if;

  if new.geom is not null and new.region_id is null then
    pt := new.geom;

    select r.id into assigned
    from public.crisis_regions r
    where r.level = 1
      and extensions.ST_Contains(r.geom, pt)
    order by extensions.ST_Area(r.geom) asc
    limit 1;

    if assigned is null then
      select r.id into assigned
      from public.crisis_regions r
      where r.level = 0
        and extensions.ST_Contains(r.geom, pt)
      limit 1;
    end if;

    if assigned is null then
      select nearest.id into assigned
      from (
        select
          r.id,
          extensions.ST_Distance(r.geom::extensions.geography, pt::extensions.geography) as dist_m
        from (
          select id, geom
          from public.crisis_regions
          where level = 1
          order by geom <-> pt
          limit 10
        ) r
      ) nearest
      where nearest.dist_m <= 300000
      order by nearest.dist_m asc
      limit 1;
    end if;

    if assigned is null then
      select nearest.id into assigned
      from (
        select
          r.id,
          extensions.ST_Distance(r.geom::extensions.geography, pt::extensions.geography) as dist_m
        from (
          select id, geom
          from public.crisis_regions
          where level = 0
          order by geom <-> pt
          limit 10
        ) r
      ) nearest
      where nearest.dist_m <= 300000
      order by nearest.dist_m asc
      limit 1;
    end if;

    new.region_id := assigned;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists crisis_fragility_assign on public.crisis_fragility;
create trigger crisis_fragility_assign
  before insert or update of lat, lon, region_id
  on public.crisis_fragility
  for each row
  execute function public.crisis_assign_fragility();
`

## Ledger

`sql
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20261009000001','20261009000001_crisis_knowledge') ON CONFLICT DO NOTHING;
`

## Rollback

`sql
drop trigger if exists crisis_fragility_assign on public.crisis_fragility;
drop function if exists public.crisis_assign_fragility();
drop table if exists public.crisis_fragility;
drop table if exists public.crisis_cascades;
delete from supabase_migrations.schema_migrations
where version = '20261009000001';
`
