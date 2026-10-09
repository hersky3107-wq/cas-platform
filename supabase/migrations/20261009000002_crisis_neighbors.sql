-- Cross-border admin1 neighbours, tracked events, and global metrics.
--
-- DO NOT apply via supabase db push. Paste into the Supabase SQL Editor.
-- Rollback and the ledger insert are in docs/crisis/APPLY_PREEVENT.md.

create table if not exists public.crisis_region_neighbors (
  region_id     bigint not null references public.crisis_regions (id) on delete cascade,
  neighbor_id   bigint not null references public.crisis_regions (id) on delete cascade,
  shared_border boolean not null,
  primary key (region_id, neighbor_id),
  constraint crisis_region_neighbors_distinct_chk check (region_id <> neighbor_id)
);

comment on table public.crisis_region_neighbors is
  'Admin1 pairs that touch or lie within 0.05 degrees. Built by crisis_refresh_region_neighbors. Service role only.';

create index if not exists crisis_region_neighbors_neighbor_idx
  on public.crisis_region_neighbors (neighbor_id);

alter table public.crisis_region_neighbors enable row level security;

grant all on table public.crisis_region_neighbors to service_role;

-- One row per directed pair. shared_border is true when the polygons touch.
create or replace function public.crisis_refresh_region_neighbors()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  inserted integer;
begin
  truncate public.crisis_region_neighbors;
  insert into public.crisis_region_neighbors (region_id, neighbor_id, shared_border)
  select
    a.id,
    b.id,
    extensions.ST_Touches(a.geom, b.geom)
  from public.crisis_regions a
  join public.crisis_regions b
    on a.level = 1
   and b.level = 1
   and a.id <> b.id
   and a.geom is not null
   and b.geom is not null
   and (
     extensions.ST_Touches(a.geom, b.geom)
     or extensions.ST_DWithin(a.geom, b.geom, 0.05)
   );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

comment on function public.crisis_refresh_region_neighbors() is
  'Rebuild admin1 neighbour pairs with ST_Touches or ST_DWithin(geom, 0.05 degrees), across all countries.';

revoke all on function public.crisis_refresh_region_neighbors() from public, anon, authenticated;
grant execute on function public.crisis_refresh_region_neighbors() to service_role;

create or replace function public.crisis_touching_region_pairs()
returns table(a bigint, b bigint)
language sql
stable
security definer
set search_path = public
as $$
  select region_id, neighbor_id
  from public.crisis_region_neighbors
  where region_id < neighbor_id;
$$;

revoke all on function public.crisis_touching_region_pairs() from public, anon, authenticated;
grant execute on function public.crisis_touching_region_pairs() to service_role;

create table if not exists public.crisis_events (
  id               text primary key,
  kind             text not null,
  name             text not null,
  first_seen       timestamptz not null,
  last_seen        timestamptz not null,
  region_ids       bigint[] not null default '{}',
  metrics_history  jsonb not null default '[]'::jsonb,
  status           text not null,
  source_refs      jsonb not null default '[]'::jsonb,
  updated_at       timestamptz not null default now(),
  constraint crisis_events_kind_chk
    check (kind in ('cyclone', 'conflict', 'outbreak', 'fire_cluster', 'flood', 'volcano')),
  constraint crisis_events_status_chk
    check (status in ('growing', 'stable', 'fading'))
);

comment on table public.crisis_events is
  'Tracked hazards. status growing includes a fast pace recorded in source_refs. Service role only.';

create index if not exists crisis_events_kind_seen_idx
  on public.crisis_events (kind, last_seen desc);

alter table public.crisis_events enable row level security;

grant all on table public.crisis_events to service_role;

create table if not exists public.crisis_global_metrics (
  metric      text not null,
  valid_time  timestamptz not null,
  issued_at   timestamptz not null,
  value       double precision,
  unit        text,
  source      text not null,
  detail      jsonb not null default '{}'::jsonb,
  primary key (metric, valid_time, source)
);

comment on table public.crisis_global_metrics is
  'Metrics that are not tied to one region. ENSO is the first row. Service role only.';

alter table public.crisis_global_metrics enable row level security;

grant all on table public.crisis_global_metrics to service_role;

insert into public.crisis_sources (
  source_key, department, provider, license, commercial_allowed,
  attribution_text, attribution_url, auth_required, notes, fallback_source_key,
  license_class, contract_status
) values
  (
    'nhc_outlook', 'hydro_weather', 'NOAA National Hurricane Center',
    'Public Domain (U.S. Government Work)', 'yes',
    'NOAA / National Hurricane Center',
    'https://www.nhc.noaa.gov/gis/',
    false,
    'Probe 2026-10-09 HTTP 200. Graphical Tropical Weather Outlook KMZ: /xgtwo/gtwo_atl.kmz and /xgtwo/gtwo_pac.kmz. 48 h and 7-day formation chances in ExtendedData.',
    null, 'open', 'none'
  ),
  (
    'jtwc_tcfa', 'hydro_weather', 'JTWC via public text, mirrored on NWS tgftp',
    'U.S. Government work on the NWS raw feed. JTWC site says products are intended for U.S. government agencies.',
    'unclear',
    'Joint Typhoon Warning Center / NWS',
    'https://tgftp.nws.noaa.gov/data/raw/ab/abpw10.pgtw..txt',
    false,
    'Probe 2026-10-09: abpwweb.txt and abioweb.txt HTTP 200, and the NWS tgftp copies HTTP 200. wtpn21web.txt returned 403, so formation text is taken from the Significant Tropical Weather Advisories (ABPW10, ABIO10), not an invented TCFA filename.',
    null, 'unclear', 'none'
  ),
  (
    'enso', 'hydro_weather', 'NOAA Climate Prediction Center',
    'Public Domain (U.S. Government Work)', 'yes',
    'NOAA / Climate Prediction Center',
    'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml',
    false,
    'Probe 2026-10-09 HTTP 200. Diagnostic discussion plus sstoi.indices Niño-3.4 anomaly. Stored as a global metric and a signal. Score uses it only as card context.',
    null, 'open', 'none'
  ),
  (
    'volcano_unrest', 'geology', 'Derived from stored USGS/EMSC quakes and the volcano source list',
    'Derived. No new fetch.', 'yes',
    'USGS / EMSC / Smithsonian GVP signals already stored',
    'https://earthquake.usgs.gov/',
    false,
    'No HTTP. Quakes within 15 km of a stored volcano, 10 or more in 72 h, or a USGS HANS alert increase.',
    'volcano', 'open', 'none'
  ),
  (
    'locust', 'food', 'FAO Desert Locust / Locust Hub',
    'Catalog record says CC BY 4.0. The current swarm and band query is not publicly readable. Locust Hub text limits some layers to non-commercial products.',
    'unclear',
    'FAO Desert Locust Information Service',
    'https://locust-hub-hqfao.hub.arcgis.com/',
    false,
    'unavailable. Probe 2026-10-09: Swarm_last_month bigquery returned HTTP 502 Access Denied. adults_2020.csv is a 2020 extract, not a daily warning feed. Not ingested.',
    null, 'unclear', 'unavailable'
  ),
  (
    'animal_disease', 'health', 'WOAH WAHIS',
    'Public interface described by WOAH. No working public API confirmed.',
    'unclear',
    'World Organisation for Animal Health',
    'https://wahis.woah.org/',
    false,
    'unavailable. Probe 2026-10-09: POST https://wahis.woah.org/pi/getAllOutbreaks returned 405; GET returned 404. Not ingested.',
    null, 'unclear', 'unavailable'
  )
on conflict (source_key) do update
set
  license = excluded.license,
  commercial_allowed = excluded.commercial_allowed,
  notes = excluded.notes,
  license_class = excluded.license_class,
  contract_status = excluded.contract_status,
  attribution_url = excluded.attribution_url;
