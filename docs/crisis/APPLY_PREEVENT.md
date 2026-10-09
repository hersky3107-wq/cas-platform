# Apply pre-event bundle A: neighbours, events, global metrics

Paste `supabase/migrations/20261009000002_crisis_neighbors.sql` into the Supabase SQL editor after 20261009000001. Do **not** use supabase db push. Do **not** apply this file from the agent.

After it succeeds:

1. Record the ledger row at the bottom of this file.
2. Build neighbours: `npx tsx --env-file=.env.local scripts/crisis/build-neighbors.ts --apply`
3. The score job reads `crisis_region_neighbors` when the table has rows. Until then it keeps the same-country fallback.

`locust` and `animal_disease` are inserted as `contract_status = unavailable`. Do not ingest them.

## Ledger

```sql
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20261009000002','20261009000002_crisis_neighbors') ON CONFLICT DO NOTHING;
```

## Rollback

```sql
drop function if exists public.crisis_touching_region_pairs();
drop function if exists public.crisis_refresh_region_neighbors();
drop table if exists public.crisis_region_neighbors;
drop table if exists public.crisis_events;
drop table if exists public.crisis_global_metrics;
delete from public.crisis_sources
where source_key in ('nhc_outlook', 'jtwc_tcfa', 'enso', 'volcano_unrest', 'locust', 'animal_disease');
delete from supabase_migrations.schema_migrations
where version = '20261009000002';
```
