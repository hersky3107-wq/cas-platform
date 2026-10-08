-- Compact per-region-per-day stats, travel-advisory state, FEWS detail, batch assign.
--
-- DO NOT apply via supabase db push. Paste into the Supabase SQL Editor.
-- Rollback and the ledger insert are in docs/crisis/APPLY_2B2.md.

alter table public.crisis_region_metrics
  add column if not exists detail jsonb;

comment on column public.crisis_region_metrics.detail is
  'Optional extras. FEWS NET stores merged source unit names when several livelihood zones share one region PK.';

create table if not exists public.crisis_region_daily (
  region_id  bigint not null references public.crisis_regions (id),
  day        date not null,
  source     text not null,
  stats      jsonb not null,
  primary key (region_id, day, source)
);

comment on table public.crisis_region_daily is
  'Compact per-region-per-day store for high-volume sources (FIRMS, GDELT, wiki). Service role only.';

create index if not exists crisis_region_daily_source_day_idx
  on public.crisis_region_daily (source, day);

alter table public.crisis_region_daily enable row level security;

create table if not exists public.crisis_advisory_state (
  country_iso3  text not null,
  source        text not null,
  level         smallint not null,
  level_text    text,
  updated_at    timestamptz,
  fetched_at    timestamptz,
  primary key (country_iso3, source),
  constraint crisis_advisory_state_level_chk check (level >= 1 and level <= 4)
);

comment on table public.crisis_advisory_state is
  'Latest 1-4 travel-advisory level per country per source. Service role only.';

alter table public.crisis_advisory_state enable row level security;

create table if not exists public.crisis_advisory_history (
  id              bigserial primary key,
  country_iso3    text not null,
  source          text not null,
  level           smallint not null,
  level_text      text,
  changed_at      timestamptz not null,
  previous_level  smallint
);

comment on table public.crisis_advisory_history is
  'Append-only travel-advisory level changes. Service role only.';

create index if not exists crisis_advisory_history_country_source_idx
  on public.crisis_advisory_history (country_iso3, source, changed_at desc);

alter table public.crisis_advisory_history enable row level security;

grant all on table public.crisis_region_daily to service_role;
grant all on table public.crisis_advisory_state to service_role;
grant all on table public.crisis_advisory_history to service_role;
grant usage, select on sequence public.crisis_advisory_history_id_seq to service_role;

-- Land assignment for FIRMS / GDELT batches. ST_Contains admin1 then country (GIST).
-- Offshore leftovers are unassigned here; callers keep high-FRP FIRMS or map GDELT via FIPS.
create or replace function public.crisis_assign_latlon_batch(pts jsonb)
returns table (
  i integer,
  region_id bigint,
  country_iso3 text,
  method text,
  distance_km double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with input as (
    select
      (elem->>'i')::integer as i,
      extensions.ST_SetSRID(
        extensions.ST_MakePoint(
          (elem->>'lon')::double precision,
          (elem->>'lat')::double precision
        ),
        4326
      ) as geom
    from jsonb_array_elements(pts) as elem
    where elem->>'lat' is not null
      and elem->>'lon' is not null
  ),
  admin1 as (
    select distinct on (p.i)
      p.i,
      r.id as region_id,
      r.iso3 as country_iso3,
      'contains'::text as method,
      0::double precision as distance_km
    from input p
    join public.crisis_regions r
      on r.level = 1
     and extensions.ST_Contains(r.geom, p.geom)
    order by p.i, extensions.ST_Area(r.geom) asc
  ),
  country as (
    select distinct on (p.i)
      p.i,
      r.id as region_id,
      r.iso3 as country_iso3,
      'contains'::text as method,
      0::double precision as distance_km
    from input p
    join public.crisis_regions r
      on r.level = 0
     and extensions.ST_Contains(r.geom, p.geom)
    where not exists (select 1 from admin1 a where a.i = p.i)
    order by p.i
  )
  select * from admin1
  union all
  select * from country;
$$;

revoke all on function public.crisis_assign_latlon_batch(jsonb) from public;
grant execute on function public.crisis_assign_latlon_batch(jsonb) to service_role;

insert into public.crisis_sources (
  source_key, department, provider, license, commercial_allowed,
  attribution_text, attribution_url, auth_required, notes, fallback_source_key,
  license_class
) values
  (
    'ioda', 'connectivity', 'IODA / Georgia Tech InetIntel',
    'Public research API; attribution requested', 'yes',
    'IODA (Internet Outage Detection and Analysis), Georgia Tech',
    'https://ioda.inetintel.cc.gatech.edu/',
    false, 'Official v2 /outages/alerts and /outages/events. Country (and region if provided).', null,
    'attribution'
  ),
  (
    'gdelt_events', 'conflict', 'GDELT 2.0 Events export',
    'GDELT public data; attribution requested', 'yes',
    'The GDELT Project',
    'https://www.gdeltproject.org/',
    false, '15-minute export zip via lastupdate.txt. Aggregated daily; no individual events stored.', null,
    'attribution'
  ),
  (
    'wiki_top', 'media', 'Wikimedia REST pageviews top',
    'CC BY-SA; attribution required', 'yes',
    'Wikimedia Foundation pageview complete data',
    'https://wikimedia.org/api/rest_v1/',
    false, 'Daily top-1000 per language project. Hazard-term matches only.', null,
    'attribution'
  ),
  (
    'advisories', 'diplomacy', 'US State Department + UK FCDO',
    'US Government work (public domain) + Open Government Licence (UK)', 'yes',
    'U.S. Department of State travel advisories / UK Foreign, Commonwealth & Development Office',
    'https://travel.state.gov/',
    false, 'Normalized 1-4 levels. Divergence when sources differ by >=2 or one lags 72h.', null,
    'open'
  )
on conflict (source_key) do update
set
  license_class = excluded.license_class,
  notes = excluded.notes,
  fallback_source_key = excluded.fallback_source_key;
