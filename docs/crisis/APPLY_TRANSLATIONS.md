# Apply CrisisWatch card translations

Paste `supabase/migrations/20261010000003_crisis_card_translations.sql` into the Supabase SQL editor after 20261010000002. Do **not** use supabase db push. Do **not** apply this file from the agent.

This stores one translated AI card payload per `(card_id, lang)`. Korean is written when a card is published so it is ready on first Korean view. Other languages are translated on first view with a cheap flash-lite model and reused after. Evidence link titles stay in their original language.

## Ledger

```sql
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20261010000003','20261010000003_crisis_card_translations') ON CONFLICT DO NOTHING;
```

## Rollback

```sql
drop policy if exists crisis_card_translations_user_select on public.crisis_card_translations;
drop table if exists public.crisis_card_translations;
delete from supabase_migrations.schema_migrations
where version = '20261010000003';
```
