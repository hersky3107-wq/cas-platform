-- Crisis: ReliefWeb, Metaculus, Cloudflare Radar, EIA, NASA IMERG live; Black Marble and ACLED blocked.
-- Paste in the Supabase SQL editor after 20261009000004. Do not use supabase db push.

-- Novelty coverage reads ReliefWeb / GDACS / Metaculus rows per country for the last 30 days.
create index if not exists crisis_raw_signals_source_country_time_idx
  on public.crisis_raw_signals (source, country_iso3, event_time desc);

insert into public.crisis_sources (
  source_key, department, provider, license, commercial_allowed,
  attribution_text, attribution_url, auth_required, notes, fallback_source_key,
  license_class, contract_status
) values
  (
    'eia', 'economy_food', 'U.S. Energy Information Administration (EIA API v2)',
    'Public Domain (U.S. Government Work)', 'yes',
    'U.S. Energy Information Administration',
    'https://www.eia.gov/opendata/',
    true,
    'Live 2026-10-09: GET /v2/petroleum/pri/spt/data/ facets RBRTE (Brent) and RWTC (WTI), daily, 90 rows. Stored as global metrics brent_usd / wti_usd. Card context only for the conflict watchlist and oil-dependent economies.',
    null, 'open', 'none'
  ),
  (
    'nasa_imerg', 'hydro_weather', 'NASA GES DISC GPM IMERG V07 daily (Late, Early fallback)',
    'NASA Earth science data: no restrictions on use; cite the dataset', 'yes',
    'Huffman, G.J., et al. GPM IMERG Final/Late/Early Precipitation L3 1 day 0.1 degree V07, NASA GES DISC',
    'https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGDL_07/summary',
    true,
    'Live 2026-10-09: CMR granules.json (GPM_3IMERGDL / GPM_3IMERGDE, version 07) then DAP2 .ascii point reads on opendap.earthdata.nasa.gov with an Earthdata Login bearer token. Only regions at stage >= 2 today, rain forecast first, capped at 100 points per day. Late lags about 2 days, Early about 1 day. Stored as imerg_precip_1d and imerg_precip_3d in crisis_region_metrics.',
    null, 'open', 'none'
  ),
  (
    'nasa_black_marble', 'connectivity', 'NASA LAADS VIIRS Black Marble VNP46A2',
    'NASA Earth science data: no restrictions on use; cite the dataset', 'yes',
    'Román, M.O., et al. NASA Black Marble VNP46A2, LAADS DAAC',
    'https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VNP46A2/',
    true,
    'unavailable. Probe 2026-10-09: LAADS OPeNDAP point subsetting with an Earthdata bearer token redirects (HTTP 302) to the interactive Earthdata Login page; opendap.earthdata.nasa.gov returns 404 "does not identify a granule in CMR" for VNP46A2; GIBS serves only visualised or annual DNB layers, not the moon-corrected daily product. Only full HDF5 tiles download (HEAD 200 with bearer, about 18.8 MB per 10 degree tile per day), which needs an HDF5 decoder and about 30 tiles per region for a baseline. Not ingested.',
    null, 'open', 'unavailable'
  )
on conflict (source_key) do update
set
  department = excluded.department,
  provider = excluded.provider,
  license = excluded.license,
  commercial_allowed = excluded.commercial_allowed,
  attribution_text = excluded.attribution_text,
  attribution_url = excluded.attribution_url,
  auth_required = excluded.auth_required,
  notes = excluded.notes,
  license_class = excluded.license_class,
  contract_status = excluded.contract_status;

update public.crisis_sources
set
  notes = 'Live 2026-10-09: POST https://api.reliefweb.int/v2/reports and /v2/disasters with the approved appname. Range filters reject milliseconds, so dates are sent as +00:00. Reports every 3 h from a cursor (30-day backfill), disasters changed in the last 30 days. Stored as reliefweb_report signals; the engine uses the last 30 days per country as mainstream coverage for novelty.',
  license_class = 'attribution',
  contract_status = 'none'
where source_key = 'reliefweb';

update public.crisis_sources
set
  notes = 'Live 2026-10-09: GET /api/posts/?statuses=open&categories=geopolitics|health-pandemics|environment-climate|nuclear with a user token. users/me reports api_access_tier="restricted", so the community probability is hidden; stored as null with probability_hidden=true. Title, url, close date, and countries inferred from the title are stored daily. A matching question makes novelty also_seen_elsewhere.',
  license_class = 'noncommercial',
  contract_status = 'none'
where source_key = 'metaculus';

update public.crisis_sources
set
  notes = 'Live 2026-10-09: GET /client/v4/radar/annotations/outages?dateRange=7d with a Bearer token, every 30 min. One internet_outage signal per annotation and country (source cloudflare). Score uses either IODA or Cloudflare and marks corroborated when both agree. Commercial embedding terms are unclear.',
  license_class = 'unclear',
  contract_status = 'none'
where source_key = 'cloudflare_radar';

update public.crisis_sources
set
  notes = 'Blocked. Probe 2026-10-09: POST https://acleddata.com/oauth/token (grant_type=password, client_id=acled) returned HTTP 400 {"error":"invalid_grant","error_description":"The user credentials were incorrect."}, with and without scope and trimming. Legacy api.acleddata.com: fetch failed. Conflict stays on HDX aggregates. Open tier is aggregated data only.',
  contract_status = 'blocked'
where source_key = 'acled';
