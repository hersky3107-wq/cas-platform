-- Crisis module core schema. Isolated from league, oracle, jeju, and gunpo.
--
-- DO NOT apply via supabase db push. Paste into the Supabase SQL Editor.
-- Rollback is in docs/crisis/APPLY_MIGRATION.md. Never drop postgis.

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- regions
-- ---------------------------------------------------------------------------

create table if not exists public.crisis_regions (
  id            bigserial primary key,
  level         smallint not null,
  iso3          text,
  admin1_code   text,
  name          text,
  name_local    text,
  parent_id     bigint references public.crisis_regions (id),
  geom          extensions.geometry(MultiPolygon, 4326) not null,
  centroid      extensions.geometry(Point, 4326),
  source        text default 'naturalearth',
  constraint crisis_regions_level_chk check (level in (0, 1)),
  constraint crisis_regions_level_iso3_admin1_key
    unique nulls not distinct (level, iso3, admin1_code)
);

comment on table public.crisis_regions is
  'Crisis module only. level 0 = country, level 1 = admin1. Natural Earth geometries, simplified before load.';

create index if not exists crisis_regions_geom_gix
  on public.crisis_regions using gist (geom);

create or replace function public.crisis_regions_fill_centroid()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.geom is not null then
    new.centroid := extensions.ST_PointOnSurface(new.geom);
  end if;
  return new;
end;
$$;

drop trigger if exists crisis_regions_fill_centroid on public.crisis_regions;
create trigger crisis_regions_fill_centroid
  before insert or update of geom on public.crisis_regions
  for each row
  execute function public.crisis_regions_fill_centroid();

-- ---------------------------------------------------------------------------
-- raw signals
-- ---------------------------------------------------------------------------

create table if not exists public.crisis_raw_signals (
  id            bigserial primary key,
  department    text not null,
  source        text not null,
  signal_type   text not null,
  title         text,
  lat           double precision,
  lon           double precision,
  geom          extensions.geometry(Point, 4326),
  country_iso3  text,
  region_id     bigint references public.crisis_regions (id),
  value_num     double precision,
  value_raw     jsonb,
  unit_raw      text,
  event_time    timestamptz,
  fetched_at    timestamptz not null default now(),
  url           text,
  dedupe_key    text not null unique
);

comment on table public.crisis_raw_signals is
  'Crisis module only. Service role writes. Sea points keep region_id and country_iso3 null.';

create index if not exists crisis_raw_signals_region_dept_time_idx
  on public.crisis_raw_signals (region_id, department, event_time desc);

create index if not exists crisis_raw_signals_dept_time_idx
  on public.crisis_raw_signals (department, event_time desc);

create index if not exists crisis_raw_signals_geom_gix
  on public.crisis_raw_signals using gist (geom);

create or replace function public.crisis_assign_signal()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  assigned bigint;
begin
  if new.lat is not null and new.lon is not null then
    new.geom := extensions.ST_SetSRID(extensions.ST_MakePoint(new.lon, new.lat), 4326);
  end if;

  if new.geom is not null and new.region_id is null then
    select r.id into assigned
    from public.crisis_regions r
    where r.level = 1
      and extensions.ST_Contains(r.geom, new.geom)
    order by extensions.ST_Area(r.geom) asc
    limit 1;

    if assigned is null then
      select r.id into assigned
      from public.crisis_regions r
      where r.level = 0
        and extensions.ST_Contains(r.geom, new.geom)
      limit 1;
    end if;

    new.region_id := assigned;
  end if;

  if new.country_iso3 is null and new.region_id is not null then
    select r.iso3 into new.country_iso3
    from public.crisis_regions r
    where r.id = new.region_id;
  end if;

  return new;
end;
$$;

drop trigger if exists crisis_assign_signal on public.crisis_raw_signals;
create trigger crisis_assign_signal
  before insert on public.crisis_raw_signals
  for each row
  execute function public.crisis_assign_signal();

create or replace function public.crisis_lookup_point(p_lat double precision, p_lon double precision)
returns table (
  id bigint,
  level smallint,
  iso3 text,
  admin1_code text,
  name text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with pt as (
    select extensions.ST_SetSRID(extensions.ST_MakePoint(p_lon, p_lat), 4326) as geom
  ),
  admin1 as (
    select r.id, r.level, r.iso3, r.admin1_code, r.name
    from public.crisis_regions r, pt
    where r.level = 1
      and extensions.ST_Contains(r.geom, pt.geom)
    order by extensions.ST_Area(r.geom) asc
    limit 1
  ),
  country as (
    select r.id, r.level, r.iso3, r.admin1_code, r.name
    from public.crisis_regions r, pt
    where r.level = 0
      and extensions.ST_Contains(r.geom, pt.geom)
    limit 1
  )
  select * from admin1
  union all
  select * from country where not exists (select 1 from admin1);
$$;

revoke all on function public.crisis_lookup_point(double precision, double precision) from public, anon, authenticated;
grant execute on function public.crisis_lookup_point(double precision, double precision) to service_role;

-- ---------------------------------------------------------------------------
-- source registry
-- ---------------------------------------------------------------------------

create table if not exists public.crisis_sources (
  source_key           text primary key,
  department           text,
  provider             text,
  license              text,
  commercial_allowed   text,
  attribution_text     text,
  attribution_url      text,
  auth_required        boolean,
  notes                text,
  fallback_source_key  text,
  contract_status      text default 'none',
  constraint crisis_sources_commercial_chk
    check (commercial_allowed in ('yes', 'no', 'unclear'))
);

comment on table public.crisis_sources is
  'Crisis module source registry. Licenses marked unclear must not be treated as commercial clearance.';

insert into public.crisis_sources (
  source_key, department, provider, license, commercial_allowed,
  attribution_text, attribution_url, auth_required, notes, fallback_source_key
) values
  (
    'usgs', 'geology', 'USGS Earthquake Hazards Program',
    'Public Domain (U.S. Government Work)', 'yes',
    'U.S. Geological Survey', 'https://earthquake.usgs.gov/',
    false, 'Public domain. Probe OK, point, near real-time.', null
  ),
  (
    'nasa_eonet', 'geology', 'NASA EONET v3',
    'NASA Open Data Policy (Public Domain / US Government work)', 'yes',
    'NASA Earth Observatory Natural Event Tracker', 'https://eonet.gsfc.nasa.gov/',
    false, 'Probe OK.', null
  ),
  (
    'gdacs', 'hydro_weather', 'GDACS (EC-JRC / UN OCHA)',
    'CC BY 4.0', 'yes',
    'European Commission Joint Research Centre / UN OCHA', 'https://www.gdacs.org/',
    false, 'Probe OK via RSS https://www.gdacs.org/xml/rss.xml.', null
  ),
  (
    'open_meteo_forecast', 'hydro_weather', 'Open-Meteo Forecast API',
    'CC BY 4.0 for the free non-commercial tier; commercial use requires a paid subscription', 'unclear',
    'Open-Meteo', 'https://open-meteo.com/',
    false, 'Free tier is non-commercial. No commercial contract on file.', null
  ),
  (
    'open_meteo_flood', 'hydro_weather', 'Open-Meteo Flood API (GloFAS / Copernicus)',
    'CC BY 4.0 (GloFAS / Copernicus); free tier is non-commercial', 'unclear',
    'Copernicus / ECMWF GloFAS via Open-Meteo', 'https://open-meteo.com/en/docs/flood-api',
    false, 'Free tier is non-commercial. No commercial contract on file.', 'open_meteo_forecast'
  ),
  (
    'nasa_firms', 'fire', 'NASA FIRMS',
    'NASA Open Data Policy (free for public and commercial use with attribution)', 'yes',
    'NASA FIRMS', 'https://firms.modaps.eosdis.nasa.gov/',
    true, 'MAP_KEY required. Probe returned HTTP 400 without a key.', null
  ),
  (
    'who_don', 'health', 'WHO Disease Outbreak News',
    'CC BY-NC-SA 3.0 IGO', 'no',
    'World Health Organization', 'https://www.who.int/emergencies/disease-outbreak-news',
    false, 'Non-commercial. Probe OK via the public OData endpoint.', null
  ),
  (
    'gdelt', 'conflict', 'GDELT Project',
    'Open access / public research. Commercial product terms not stated.', 'unclear',
    'GDELT Project', 'https://www.gdeltproject.org/',
    false, 'Probe FAIL HTTP 429. Do not treat as cleared for commercial use.', null
  ),
  (
    'ucdp', 'conflict', 'Uppsala Conflict Data Program',
    'CC BY 4.0', 'yes',
    'UCDP / Uppsala University', 'https://ucdp.uu.se/',
    true, 'Token pending (header x-ucdp-access-token). Mandatory citation. Probe HTTP 401.', 'views'
  ),
  (
    'views', 'conflict', 'ViEWS (Violence Early-Warning System)',
    'Open access for academic and non-commercial research', 'no',
    'ViEWS Consortium', 'https://viewsforecasting.org/',
    false, 'Probe OK. Non-commercial research terms.', null
  ),
  (
    'acled', 'conflict', 'ACLED',
    'ACLED Open tier. Aggregated data only.', 'no',
    'ACLED', 'https://acleddata.com/',
    true, 'Open tier: aggregated data only. Do not store or republish raw event rows.', 'ucdp'
  ),
  (
    'opensky', 'aviation', 'OpenSky Network',
    'Non-commercial. Cite Schäfer et al. 2014 IPSN.', 'no',
    'Schäfer, Strohmeier, Lenders, Martinovic, Wilhelm. Bringing up OpenSky: A large-scale ADS-B sensor network for research. IPSN 2014.',
    'https://opensky-network.org',
    false, 'Anonymous tier verified. Commercial licensing is via the OpenSky Association and is not in place.', null
  ),
  (
    'gfw', 'maritime', 'Global Fishing Watch',
    'CC BY-NC 4.0', 'no',
    'Powered by Global Fishing Watch', 'https://globalfishingwatch.org',
    true, 'Token server-side only. Attribution must read "Powered by Global Fishing Watch" and link to https://globalfishingwatch.org. Gateway TLS failed from the probe host; docs site responded.', null
  ),
  (
    'ioda', 'connectivity', 'IODA (Georgia Tech / CAIDA)',
    'Free for non-commercial research and monitoring with attribution', 'no',
    'Georgia Tech Research Corporation / CAIDA', 'https://ioda.inetintel.cc.gatech.edu/',
    false, 'Probe OK. Country code is ISO2, not ISO3.', 'cloudflare_radar'
  ),
  (
    'cloudflare_radar', 'connectivity', 'Cloudflare Radar',
    'Cloudflare Terms of Service', 'unclear',
    'Cloudflare Radar', 'https://radar.cloudflare.com/',
    true, 'Bearer token required. Probe HTTP 400. Commercial embedding terms are unclear.', 'ioda'
  ),
  (
    'us_state_travel', 'diplomacy', 'US Department of State Travel Advisories',
    'Public Domain (17 U.S.C. 105)', 'yes',
    'U.S. Department of State', 'https://travel.state.gov/',
    false, 'Probe OK via RSS.', null
  ),
  (
    'open_er_api', 'economy_food', 'ExchangeRate-API open endpoint',
    'Free for personal and commercial use with attribution', 'yes',
    'ExchangeRate-API', 'https://www.exchangerate-api.com/',
    false, 'Probe OK. No key on the open endpoint.', null
  ),
  (
    'wfp_vam', 'economy_food', 'WFP VAM / HungerMap',
    'WFP terms of use / humanitarian data', 'unclear',
    'UN World Food Programme VAM', 'https://api.vam.wfp.org/',
    true, 'Subscription key required. Probe HTTP 401. Commercial terms unclear.', 'hdx_hapi_wfp'
  ),
  (
    'fao_fpma', 'economy_food', 'FAO FPMA',
    'CC BY-NC-SA 3.0 IGO', 'no',
    'Food and Agriculture Organization of the United Nations', 'https://fpma.fao.org/',
    false, 'UNVERIFIED. Probe found no public REST API (web UI and bulk export only).', 'hdx_hapi_wfp'
  ),
  (
    'hdx_hapi_wfp', 'economy_food', 'HDX HAPI / WFP food prices',
    'CC BY-IGO', 'yes',
    'HDX / World Food Programme', 'https://hapi.humdata.org/',
    true, 'App registration expected. Not probed live in crisis-probe.', 'wfp_vam'
  ),
  (
    'unhcr', 'displacement', 'UNHCR Population Statistics',
    'CC BY 4.0', 'yes',
    'United Nations High Commissioner for Refugees', 'https://www.unhcr.org/',
    false, 'Probe OK. Country rows require coo_all=true.', null
  ),
  (
    'polymarket', 'crowd_forecast', 'Polymarket',
    'Polymarket Terms of Service', 'unclear',
    'Polymarket', 'https://polymarket.com/',
    true, 'Probe HTTP 451 geoblock. Not usable from this region without a compliance review.', 'metaculus'
  ),
  (
    'metaculus', 'crowd_forecast', 'Metaculus',
    'Metaculus community terms / CC BY-NC-SA 4.0 for non-commercial aggregate use', 'no',
    'Metaculus', 'https://www.metaculus.com/',
    true, 'Token required. Probe HTTP 403.', null
  ),
  (
    'reliefweb', 'humanitarian', 'ReliefWeb (UN OCHA)',
    'CC BY 4.0', 'yes',
    'United Nations Office for the Coordination of Humanitarian Affairs', 'https://reliefweb.int/',
    true, 'Approved appname required. API v1 is decommissioned; v2 returned HTTP 403 without an approved appname.', null
  )
on conflict (source_key) do nothing;

-- ---------------------------------------------------------------------------
-- append-only proof ledger
-- ---------------------------------------------------------------------------

create table if not exists public.crisis_hypotheses (
  id                   bigserial primary key,
  created_at           timestamptz not null default now(),
  region_ids           bigint[] not null,
  stage                smallint,
  confidence           text,
  novelty              text,
  title                text not null,
  body                 text not null,
  evidence_signal_ids  bigint[] default '{}',
  evidence_snapshot    jsonb not null,
  ai_roster            jsonb not null,
  prev_hash            text,
  content_hash         text not null,
  constraint crisis_hypotheses_stage_chk check (stage between 1 and 5),
  constraint crisis_hypotheses_confidence_chk check (confidence in ('low', 'medium', 'high')),
  constraint crisis_hypotheses_novelty_chk check (novelty in ('only_us', 'also_seen_elsewhere', 'unknown'))
);

comment on table public.crisis_hypotheses is
  'Crisis module append-only proof ledger. UPDATE and DELETE are rejected.';

create or replace function public.crisis_hypotheses_before_insert()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  payload text;
begin
  perform pg_advisory_xact_lock(748291003);

  if new.created_at is null then
    new.created_at := now();
  end if;

  select h.content_hash into new.prev_hash
  from public.crisis_hypotheses h
  order by h.id desc
  limit 1;

  payload :=
    coalesce(new.prev_hash, '') ||
    new.created_at::text ||
    coalesce(new.region_ids::text, '') ||
    coalesce(new.stage::text, '') ||
    coalesce(new.confidence, '') ||
    coalesce(new.title, '') ||
    coalesce(new.body, '') ||
    coalesce(new.evidence_snapshot::text, '');

  new.content_hash := encode(extensions.digest(payload, 'sha256'), 'hex');
  return new;
end;
$$;

drop trigger if exists crisis_hypotheses_before_insert on public.crisis_hypotheses;
create trigger crisis_hypotheses_before_insert
  before insert on public.crisis_hypotheses
  for each row
  execute function public.crisis_hypotheses_before_insert();

create or replace function public.crisis_reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

drop trigger if exists crisis_hypotheses_reject_mutation on public.crisis_hypotheses;
create trigger crisis_hypotheses_reject_mutation
  before update or delete on public.crisis_hypotheses
  for each row
  execute function public.crisis_reject_mutation();

create table if not exists public.crisis_hypothesis_outcomes (
  id                 bigserial primary key,
  hypothesis_id      bigint not null references public.crisis_hypotheses (id),
  recorded_at        timestamptz not null default now(),
  outcome            text,
  event_description  text,
  event_date         date,
  source_urls        text[],
  lead_time_days     integer,
  constraint crisis_hypothesis_outcomes_outcome_chk
    check (outcome in ('happened', 'partially', 'not_yet', 'did_not_happen'))
);

comment on table public.crisis_hypothesis_outcomes is
  'Crisis module append-only outcomes. No hash chain. UPDATE and DELETE are rejected.';

drop trigger if exists crisis_hypothesis_outcomes_reject_mutation on public.crisis_hypothesis_outcomes;
create trigger crisis_hypothesis_outcomes_reject_mutation
  before update or delete on public.crisis_hypothesis_outcomes
  for each row
  execute function public.crisis_reject_mutation();

-- ---------------------------------------------------------------------------
-- RLS. Public read on the four published tables. No public write.
-- crisis_raw_signals has no policy: service role only (service role bypasses RLS).
-- ---------------------------------------------------------------------------

alter table public.crisis_regions enable row level security;
alter table public.crisis_raw_signals enable row level security;
alter table public.crisis_sources enable row level security;
alter table public.crisis_hypotheses enable row level security;
alter table public.crisis_hypothesis_outcomes enable row level security;

drop policy if exists crisis_regions_public_select on public.crisis_regions;
create policy crisis_regions_public_select on public.crisis_regions
  for select to anon, authenticated using (true);

drop policy if exists crisis_sources_public_select on public.crisis_sources;
create policy crisis_sources_public_select on public.crisis_sources
  for select to anon, authenticated using (true);

drop policy if exists crisis_hypotheses_public_select on public.crisis_hypotheses;
create policy crisis_hypotheses_public_select on public.crisis_hypotheses
  for select to anon, authenticated using (true);

drop policy if exists crisis_hypothesis_outcomes_public_select on public.crisis_hypothesis_outcomes;
create policy crisis_hypothesis_outcomes_public_select on public.crisis_hypothesis_outcomes
  for select to anon, authenticated using (true);
