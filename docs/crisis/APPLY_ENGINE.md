# Apply the crisis engine working tables

Paste `supabase/migrations/20261009000004_crisis_engine.sql` into the Supabase SQL editor after 20261009000003. Do **not** use supabase db push. Do **not** apply this file from the agent.

This adds deletable working tables (`crisis_engine_runs`, `crisis_engine_steps`) and `crisis_refresh_neighbor_batch`. It does not change the append-only proof ledger.

The neighbour script no longer calls the one-shot `crisis_refresh_region_neighbors()` (that statement timed out). After this paste:

```text
npx tsx --env-file=.env.local scripts/crisis/build-neighbors.ts --apply
```

That walks one country, or one admin1 batch of at most 200 regions, per statement. It is resumable. Leave it until the GDELT backfill has finished.

## Ledger

```sql
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20261009000004','20261009000004_crisis_engine') ON CONFLICT DO NOTHING;
```

## Rollback

```sql
drop table if exists public.crisis_engine_steps;
drop table if exists public.crisis_engine_runs;
drop function if exists public.crisis_refresh_neighbor_batch(bigint[]);
delete from supabase_migrations.schema_migrations
where version = '20261009000004';
```
