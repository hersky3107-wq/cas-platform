# Apply the crisis engine admin queue

Paste `supabase/migrations/20261010000001_crisis_engine_requests.sql` into the Supabase SQL editor after 20261009000005. Do **not** use supabase db push. Do **not** apply this file from the agent.

This adds the deletable admin queue `crisis_engine_requests`. It does not change the append-only proof ledger.

After the paste, start the worker in a separate process from `crisis:sweep`:

```text
npm run crisis:worker
```

The admin screen is `/admin/crisis`.

## Ledger

```sql
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20261010000001','20261010000001_crisis_engine_requests') ON CONFLICT DO NOTHING;
```

## Rollback

```sql
drop table if exists public.crisis_engine_requests;
delete from supabase_migrations.schema_migrations
where version = '20261010000001';
```
