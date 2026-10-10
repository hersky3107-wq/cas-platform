-- Monthly ERA5 normals for heat, cold, and drought. Paste in the SQL editor if the rescore did not create it.
-- Service role only.

create table if not exists public.crisis_region_climate (
  region_id bigint not null,
  month smallint not null check (month between 1 and 12),
  tmax_p95 double precision,
  tmax_p5 double precision,
  tmin_p95 double precision,
  tmin_p5 double precision,
  tmax_mean double precision,
  tmin_mean double precision,
  precip_daily_mean double precision,
  soil_mean double precision,
  precip_30d double precision,
  precip_30d_base double precision,
  precip_90d double precision,
  precip_90d_base double precision,
  soil_recent double precision,
  sample_days integer,
  computed_at timestamptz not null default now(),
  primary key (region_id, month)
);

alter table public.crisis_region_climate enable row level security;

grant select, insert, update, delete on public.crisis_region_climate to service_role;

notify pgrst, 'reload schema';
