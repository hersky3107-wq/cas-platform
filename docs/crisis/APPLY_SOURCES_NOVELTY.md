# Apply the new sources and novelty index

Paste `supabase/migrations/20261009000005_crisis_sources_novelty.sql` into the Supabase SQL editor after 20261009000004. Do **not** use supabase db push. Do **not** apply this file from the agent.

This adds:

- an index on `crisis_raw_signals (source, country_iso3, event_time desc)` for the engine's novelty coverage (ReliefWeb, GDACS, Metaculus per country, last 30 days);
- `crisis_sources` rows for `eia`, `nasa_imerg`, and `nasa_black_marble` (unavailable, with the exact blocker);
- updated notes for `reliefweb`, `metaculus` (restricted token tier, probability hidden), `cloudflare_radar`, and `acled` (the exact `invalid_grant` response; HDX stays the conflict fallback).

The ingest code runs without this migration. The index only speeds up the engine's coverage reads.

## Ledger

```sql
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20261009000005','20261009000005_crisis_sources_novelty') ON CONFLICT DO NOTHING;
```

## Rollback

```sql
drop index if exists public.crisis_raw_signals_source_country_time_idx;
delete from public.crisis_sources where source_key in ('eia', 'nasa_imerg', 'nasa_black_marble');
delete from supabase_migrations.schema_migrations
where version = '20261009000005';
```

The notes on `reliefweb`, `metaculus`, `cloudflare_radar`, and `acled` are text only. Rolling back leaves the new notes in place.
