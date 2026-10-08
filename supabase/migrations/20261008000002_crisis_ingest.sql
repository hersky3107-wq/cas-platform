-- Crisis ingest: coastal region assignment, region metrics, run ledger.
--
-- DO NOT apply via supabase db push. Paste into the Supabase SQL Editor.
-- Rollback and the ledger insert are in docs/crisis/APPLY_2B1.md.
-- Touches only crisis_ objects created or replaced here. Never drop postgis.

-- ---------------------------------------------------------------------------
-- raw signals: assignment method + distance
-- ---------------------------------------------------------------------------

alter table public.crisis_raw_signals
  add column if not exists region_assign_method text;

alter table public.crisis_raw_signals
  add column if not exists region_distance_km double precision;

alter table public.crisis_raw_signals
  drop constraint if exists crisis_raw_signals_region_assign_method_chk;

alter table public.crisis_raw_signals
  add constraint crisis_raw_signals_region_assign_method_chk
    check (
      region_assign_method is null
      or region_assign_method in ('contains', 'nearest_coast', 'none')
    );

comment on column public.crisis_raw_signals.region_assign_method is
  'contains = ST_Contains hit (admin1 then country). nearest_coast = closest region within 300 km. none = no assignment.';

-- ---------------------------------------------------------------------------
-- region assignment: contains, then KNN + exact geography distance
--
-- Plan (target <20 ms/row):
--  1. ST_Contains on admin1 uses crisis_regions_geom_gix (GIST).
--  2. Same index for country (level=0, ~200 rows).
--  3. On miss: ORDER BY geom <-> point LIMIT 5 is a GIST KNN scan
--     (no sequential distance over every polygon). Exact ST_Distance
--     on geography runs on those 5 candidates only, then 300 km filter.
-- ---------------------------------------------------------------------------

create or replace function public.crisis_assign_signal()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  assigned bigint;
  method text := 'none';
  dist_km double precision;
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

    if assigned is not null then
      method := 'contains';
      dist_km := 0;
    else
      select r.id into assigned
      from public.crisis_regions r
      where r.level = 0
        and extensions.ST_Contains(r.geom, pt)
      limit 1;

      if assigned is not null then
        method := 'contains';
        dist_km := 0;
      else
        select nearest.id, nearest.dist_m / 1000.0
          into assigned, dist_km
        from (
          select
            r.id,
            extensions.ST_Distance(
              r.geom::extensions.geography,
              pt::extensions.geography
            ) as dist_m
          from (
            select id, geom
            from public.crisis_regions
            order by geom <-> pt
            limit 5
          ) r
        ) nearest
        where nearest.dist_m <= 300000
        order by nearest.dist_m asc
        limit 1;

        if assigned is not null then
          method := 'nearest_coast';
        else
          dist_km := null;
        end if;
      end if;
    end if;

    new.region_id := assigned;
    new.region_assign_method := method;
    new.region_distance_km := dist_km;
  else
    if new.region_assign_method is null then
      new.region_assign_method := case
        when new.region_id is not null then 'contains'
        else 'none'
      end;
    end if;
    if new.region_id is not null and new.region_distance_km is null
       and new.region_assign_method = 'contains' then
      new.region_distance_km := 0;
    end if;
  end if;

  if new.country_iso3 is null and new.region_id is not null then
    select r.iso3 into new.country_iso3
    from public.crisis_regions r
    where r.id = new.region_id;
  end if;

  if new.region_assign_method is null then
    new.region_assign_method := 'none';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- per-region forecast / gridded time series
-- ---------------------------------------------------------------------------

create table if not exists public.crisis_region_metrics (
  region_id   bigint not null references public.crisis_regions (id),
  metric      text not null,
  valid_time  timestamptz not null,
  issued_at   timestamptz not null,
  value       double precision,
  unit        text,
  source      text not null,
  primary key (region_id, metric, valid_time, issued_at)
);

comment on table public.crisis_region_metrics is
  'Crisis module forecast and gridded values at region centroids. Service role only.';

create index if not exists crisis_region_metrics_metric_valid_idx
  on public.crisis_region_metrics (metric, valid_time);

alter table public.crisis_region_metrics enable row level security;

-- ---------------------------------------------------------------------------
-- ingest run log + per-source cursor
-- ---------------------------------------------------------------------------

create table if not exists public.crisis_ingest_runs (
  id            bigserial primary key,
  source        text not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null,
  rows_in       integer,
  rows_written  integer,
  http_calls    integer,
  quota_note    text,
  error         text,
  constraint crisis_ingest_runs_status_chk
    check (status in ('ok', 'partial', 'error', 'skipped'))
);

comment on table public.crisis_ingest_runs is
  'Crisis module ingest run log. Service role only.';

create index if not exists crisis_ingest_runs_source_started_idx
  on public.crisis_ingest_runs (source, started_at desc);

alter table public.crisis_ingest_runs enable row level security;

create table if not exists public.crisis_ingest_state (
  source           text primary key,
  last_success_at  timestamptz,
  cursor           jsonb,
  next_due_at      timestamptz
);

comment on table public.crisis_ingest_state is
  'Crisis module per-source cursor and next due time. Service role only.';

alter table public.crisis_ingest_state enable row level security;

grant all on table public.crisis_region_metrics to service_role;
grant all on table public.crisis_ingest_runs to service_role;
grant all on table public.crisis_ingest_state to service_role;
grant usage, select on sequence public.crisis_ingest_runs_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- source registry: license_class + 2B-1 keys
-- ---------------------------------------------------------------------------

alter table public.crisis_sources
  add column if not exists license_class text;

alter table public.crisis_sources
  drop constraint if exists crisis_sources_license_class_chk;

alter table public.crisis_sources
  add constraint crisis_sources_license_class_chk
    check (
      license_class is null
      or license_class in ('open', 'attribution', 'noncommercial', 'unclear')
    );

insert into public.crisis_sources (
  source_key, department, provider, license, commercial_allowed,
  attribution_text, attribution_url, auth_required, notes, fallback_source_key,
  license_class
) values
  (
    'emsc', 'geology', 'EMSC / CSEM Seismic Portal',
    'Public FDSN service; attribution requested', 'yes',
    'EMSC/CSEM', 'https://www.seismicportal.eu/fdsn-wsevent.html',
    false, 'Keep both EMSC and USGS catalogs. Dedupe within EMSC only.', null,
    'attribution'
  ),
  (
    'eonet', 'geology', 'NASA EONET v3',
    'NASA Open Data Policy (Public Domain / US Government work)', 'yes',
    'NASA Earth Observatory Natural Event Tracker', 'https://eonet.gsfc.nasa.gov/',
    false, 'Ingest key for nasa_eonet.', 'nasa_eonet',
    'open'
  ),
  (
    'nhc_jtwc', 'hydro_weather', 'NOAA NHC + JTWC',
    'U.S. Government work (public domain) for NHC. JTWC public products on metoc.navy.mil.', 'yes',
    'NOAA National Hurricane Center / Joint Typhoon Warning Center',
    'https://www.nhc.noaa.gov/',
    false, 'Forecast track points stored as cyclone_forecast_point.', null,
    'open'
  ),
  (
    'tsunami', 'geology', 'NOAA PTWC / NTWC',
    'U.S. Government work (public domain)', 'yes',
    'NOAA/NWS Tsunami Warning Centers', 'https://www.tsunami.gov/',
    false, 'Atom feeds PHEB (PTWC) and PAAQ (NTWC).', null,
    'open'
  ),
  (
    'volcano', 'geology', 'Smithsonian GVP + USGS HANS',
    'Cite GVP Volcanoes of the World; USGS HANS is US Government work', 'yes',
    'Smithsonian Global Volcanism Program / USGS Volcano Hazards Program',
    'https://volcano.si.edu/database/webservices.cfm',
    false, 'GVP WFS + USGS HANS elevated volcanoes.', null,
    'attribution'
  ),
  (
    'firms', 'fire', 'NASA FIRMS VIIRS',
    'NASA Open Data Policy (free for public and commercial use with attribution)', 'yes',
    'NASA FIRMS', 'https://firms.modaps.eosdis.nasa.gov/',
    true, 'FIRMS_MAP_KEY required. High/nominal confidence only.', 'nasa_firms',
    'open'
  ),
  (
    'openmeteo_forecast', 'hydro_weather', 'Open-Meteo Forecast API',
    'CC BY 4.0 free non-commercial tier; commercial use requires a paid plan', 'no',
    'Open-Meteo', 'https://open-meteo.com/',
    false, 'Daily forecast at region centroids. Free tier is non-commercial.', 'open_meteo_forecast',
    'noncommercial'
  ),
  (
    'glofas', 'hydro_weather', 'Open-Meteo Flood API (GloFAS / Copernicus)',
    'CC BY 4.0 (GloFAS / Copernicus); free tier is non-commercial', 'no',
    'Copernicus / ECMWF GloFAS via Open-Meteo', 'https://open-meteo.com/en/docs/flood-api',
    false, 'River discharge for the high-INFORM half of forecast regions.', 'open_meteo_flood',
    'noncommercial'
  ),
  (
    'fewsnet', 'hydro_weather', 'FEWS NET Data Warehouse',
    'FEWS NET / USAID public series — use with attribution', 'unclear',
    'FEWS NET / USAID', 'https://help.fews.net/fdw/fews-net-api',
    false, 'IPC ML1/ML2 projections mapped by country/admin name.', null,
    'attribution'
  ),
  (
    'inform', 'hydro_weather', 'INFORM Risk Index (EU JRC / DRMKC)',
    'Open public good (INFORM partnership; JRC scientific lead)', 'yes',
    'INFORM / European Commission JRC', 'https://drmkc.jrc.ec.europa.eu/inform-index/About',
    false, 'Country risk, hazard, exposure, vulnerability, coping scores.', null,
    'attribution'
  )
on conflict (source_key) do update
set
  license_class = excluded.license_class,
  notes = excluded.notes,
  fallback_source_key = excluded.fallback_source_key;

update public.crisis_sources set license_class = 'open' where source_key in ('usgs', 'nasa_eonet', 'nasa_firms');
update public.crisis_sources set license_class = 'attribution' where source_key in ('gdacs', 'emsc', 'fewsnet', 'inform', 'volcano');
update public.crisis_sources set license_class = 'noncommercial' where source_key in ('open_meteo_forecast', 'open_meteo_flood', 'openmeteo_forecast', 'glofas');
update public.crisis_sources set license_class = 'open' where source_key in ('eonet', 'nhc_jtwc', 'tsunami', 'firms');
