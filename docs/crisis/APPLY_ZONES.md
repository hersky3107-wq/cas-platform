# Apply crisis zone queue

Paste `supabase/migrations/20261010000004_crisis_zones.sql` into the Supabase SQL editor. Do **not** use supabase db push. Do **not** apply this file from the agent.

This lets `crisis_engine_requests.scope` be `zone` with a `zone_key`, lets `crisis_engine_runs.mode` be `zone`, and lets `crisis_unlocks.kind` be `zone` or `global` with a `zone_key`.

Restart `crisis:worker` after the paste.

## Ledger

```sql
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20261010000004','20261010000004_crisis_zones') ON CONFLICT DO NOTHING;
```

## Rollback

```sql
alter table public.crisis_engine_requests drop constraint if exists crisis_engine_requests_region_scope_chk;
alter table public.crisis_engine_requests drop constraint if exists crisis_engine_requests_scope_chk;
alter table public.crisis_engine_requests drop column if exists zone_key;
alter table public.crisis_engine_requests
  add constraint crisis_engine_requests_scope_chk check (scope in ('region', 'all'));
alter table public.crisis_engine_requests
  add constraint crisis_engine_requests_region_scope_chk
  check (
    (scope = 'region' and region_id is not null)
    or (scope = 'all' and region_id is null)
  );
alter table public.crisis_engine_runs drop constraint if exists crisis_engine_runs_mode_chk;
alter table public.crisis_engine_runs
  add constraint crisis_engine_runs_mode_chk check (mode in ('region', 'top', 'global'));
delete from supabase_migrations.schema_migrations where version = '20261010000004';
drop index if exists public.crisis_unlocks_zone_unique;
drop index if exists public.crisis_unlocks_global_unique;
alter table public.crisis_unlocks drop constraint if exists crisis_unlocks_kind_chk;
alter table public.crisis_unlocks drop column if exists zone_key;
alter table public.crisis_unlocks
  add constraint crisis_unlocks_kind_chk check (kind in ('brief', 'deep', 'deep_refund'));
```
