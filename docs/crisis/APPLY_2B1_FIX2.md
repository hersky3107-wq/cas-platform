# Apply compact forecast storage

Paste the SQL below into the Supabase SQL editor after `20261008000003`. Do **not** use `supabase db push`.

The same statement is `supabase/migrations/20261008000004_crisis_region_forecasts.sql`.

Open-Meteo and GloFAS then upsert **one row per region per issued UTC date** into `crisis_region_forecasts`. INFORM and FEWS NET stay on `crisis_region_metrics`.

`crisis_region_flags` is created empty for a later anomaly job.

## Storage

Assumes ~4,600 forecast regions (admin1, plus country where that country has no admin1) and a 7-day horizon.

| layout | rows / day | rough size / month (30 days) |
| :--- | ---: | ---: |
| Old `crisis_region_metrics` (Open-Meteo only: 4,600 × 7 days × 4 fields) | ~128,800 | ~0.5–0.8 GB with indexes (about 150–200 bytes/row) |
| Old plus GloFAS discharge + ratio on half the regions | ~145,000 | ~0.6–0.9 GB |
| New `crisis_region_forecasts` (4,600 Open-Meteo + ~2,300 GloFAS) | ~6,900 | ~80–120 MB (jsonb series ~0.4–0.6 KB/row) |

That is about **19× fewer rows**.

Open-Meteo `series`: `dates`, `precip_mm`, `tmax_c`, `tmin_c`, `wind_max_ms` (API requested in m/s).

GloFAS `series`: `dates`, `discharge_m3s`, `ratio_to_30d_mean` (nulls until a 30-day mean exists).

## Quota

Shared ledger row `crisis_ingest_state.source = 'openmeteo_quota'`, cursor `{ "date_utc", "billed_today" }`.

Combined cap **9,000** billed calls/UTC day. Forecast may use up to **5,000**; GloFAS uses the remainder (cap 4,000). Dry-run and live runs both add the calls they actually make. A dry-run fetches **one** batch (≤100 locations), logs `dry-run sampled 1 batch`, and extrapolates the row count.

If `billed_today` is missing for **2026-10-08**, the first run records **4,586** already spent. Later UTC days start at 0. After the seed, forecast has **414** calls left today and GloFAS **4,000**, unless a run adds more.

A dry-run of `openmeteo_forecast` or `glofas` still spends about **100** billed calls. Skip those two sources today if you need the remaining quota untouched.

## SQL

```sql
-- Compact per-region forecast blobs. Do not apply via supabase db push.

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
```

## Ledger insert

```sql
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20261008000004','20261008000004_crisis_region_forecasts') ON CONFLICT DO NOTHING;
```

## Rollback

Drops only the two tables created here.

```sql
drop table if exists public.crisis_region_flags;
drop table if exists public.crisis_region_forecasts;

delete from supabase_migrations.schema_migrations
where version = '20261008000004';
```
