# Apply CrisisWatch public access

Paste `supabase/migrations/20261010000002_crisis_public_access.sql` into the Supabase SQL editor after 20261010000001. Do **not** use supabase db push. Do **not** apply this file from the agent.

This lets a logged-in user insert and read their own `crisis_engine_requests` rows (scope `region` only) and adds `crisis_unlocks` for paid briefing / deep-analysis receipts. It does not change the append-only proof ledger.

## Ledger

```sql
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20261010000002','20261010000002_crisis_public_access') ON CONFLICT DO NOTHING;
```

## Rollback

```sql
drop policy if exists crisis_unlocks_user_select on public.crisis_unlocks;
drop table if exists public.crisis_unlocks;
drop policy if exists crisis_engine_requests_user_insert on public.crisis_engine_requests;
drop policy if exists crisis_engine_requests_user_select on public.crisis_engine_requests;
delete from supabase_migrations.schema_migrations
where version = '20261010000002';
```
