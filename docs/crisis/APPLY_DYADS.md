# Apply GDELT dyads and country days

Paste `supabase/migrations/20261009000003_crisis_dyads.sql` into the Supabase SQL editor after 20261009000002. Do **not** use supabase db push. Do **not** apply this file from the agent.

The live `gdelt_events` ingest writes these tables when they exist. Until then it keeps writing `crisis_region_daily` and skips the new tables.

After the paste:

1. Record the ledger row below.
2. Backfill: `npx tsx --env-file=.env.local scripts/crisis/backfill-gdelt.ts --days=90`
   A dry-run of two days does not write: `npx tsx --env-file=.env.local scripts/crisis/backfill-gdelt.ts --dry-run`

## Ledger

```sql
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20261009000003','20261009000003_crisis_dyads') ON CONFLICT DO NOTHING;
```

## Rollback

```sql
drop table if exists public.crisis_dyad_daily;
drop table if exists public.crisis_country_daily;
delete from supabase_migrations.schema_migrations
where version = '20261009000003';
```
