-- Compact per-region forecast blobs. Do not apply via supabase db push.
-- Rollback and the ledger insert are in docs/crisis/APPLY_2B1_FIX2.md.

create table if not exists public.crisis_region_forecasts (
  region_id     bigint not null references public.crisis_regions (id),
  source        text not null,
  issued_date   date not null,
  issued_at     timestamptz not null,
  horizon_days  smallint not null,
  series        jsonb not null,
  primary key (region_id, source, issued_date)
);

comment on table public.crisis_region_forecasts is
  'One forecast blob per region per source per issued UTC date. Open-Meteo and GloFAS. Service role only.';

create index if not exists crisis_region_forecasts_source_issued_idx
  on public.crisis_region_forecasts (source, issued_date);

alter table public.crisis_region_forecasts enable row level security;

create table if not exists public.crisis_region_flags (
  region_id   bigint not null references public.crisis_regions (id),
  flag_date   date not null,
  flag        text not null,
  value       double precision,
  detail      jsonb,
  primary key (region_id, flag_date, flag)
);

comment on table public.crisis_region_flags is
  'Derived anomaly flags. Empty until a later job fills it. Service role only.';

alter table public.crisis_region_flags enable row level security;

grant all on table public.crisis_region_forecasts to service_role;
grant all on table public.crisis_region_flags to service_role;
