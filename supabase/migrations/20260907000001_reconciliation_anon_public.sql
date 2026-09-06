-- ============================================================================
-- 정산대사기 contest public access — anonymous workspaces.
--
-- Paste in the Supabase dashboard SQL Editor BLOCK BY BLOCK.
-- Never `supabase db push`. Do NOT run this from the app.
--
-- WHY: every recon table's user_id currently REFERENCES auth.users(id).
-- Anonymous judges have no auth.users row, so inserts would fail (23503)
-- even after the cookie workspace is issued. This migration:
--   1. Drops those FKs (user_id stays uuid NOT NULL — app-layer scope is unchanged)
--   2. Adds reconciliation_anon_workspaces for mint tracking + daily AI caps
--
-- Reversible: after judging, set RECONCILIATION_PUBLIC=false. Optionally
-- re-add the FKs once anon rows are deleted (BLOCK 3, do NOT run now).
-- ============================================================================


-- ═ BLOCK 1 ═ drop auth.users FKs on reconciliation user_id columns ══════════
-- Only constraints that point at auth.users are dropped. user_id stays
-- uuid NOT NULL. App code still filters every query by OwnedScope.userId.

do $$
declare r record;
begin
  for r in
    select t.relname as tbl, c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and c.contype = 'f'
      and t.relname in (
        'raw_documents',
        'payment_channels',
        'sales_records',
        'deposit_records',
        'reconciliations',
        'card_issuers',
        'reconciliation_match_proposals'
      )
      and pg_get_constraintdef(c.oid) ilike '%auth.users%'
  loop
    execute format('alter table public.%I drop constraint if exists %I', r.tbl, r.conname);
  end loop;
end $$;

-- verify: expect 0 rows (no remaining auth.users FKs on those tables)
select t.relname as table_name, c.conname, pg_get_constraintdef(c.oid) as definition
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and c.contype = 'f'
  and t.relname in (
    'raw_documents',
    'payment_channels',
    'sales_records',
    'deposit_records',
    'reconciliations',
    'card_issuers',
    'reconciliation_match_proposals'
  )
  and pg_get_constraintdef(c.oid) ilike '%auth.users%';


-- ═ BLOCK 2 ═ anonymous workspace mint + daily AI counters ═══════════════════
-- Service-role only (RLS on, no policies). Cookie id is the primary key and
-- is written into recon tables' user_id.

create table if not exists public.reconciliation_anon_workspaces (
  id               uuid primary key,
  created_at       timestamptz not null default now(),
  created_kst_date date not null,
  usage_kst_date   date not null,
  classify_count   integer not null default 0,
  infer_count      integer not null default 0,
  ask_count        integer not null default 0
);

create index if not exists reconciliation_anon_workspaces_created_kst_idx
  on public.reconciliation_anon_workspaces (created_kst_date);

comment on table public.reconciliation_anon_workspaces is
  'Contest anonymous workspaces for /reconciliation public access. id is stored in the recon_ws cookie and used as user_id on recon tables. Daily AI caps live here.';

alter table public.reconciliation_anon_workspaces enable row level security;

-- verify: table exists, RLS on, 0 policies
select c.relname, c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'reconciliation_anon_workspaces';

select polname from pg_policy
where polrelid = 'public.reconciliation_anon_workspaces'::regclass;


-- ═ BLOCK 3 ═ DO NOT RUN NOW — optional restore after judging ════════════════
-- After RECONCILIATION_PUBLIC=false and after deleting leftover anon rows:
--
-- delete from public.reconciliation_anon_workspaces;
-- delete from public.sales_records where user_id not in (select id from auth.users);
-- ...repeat for the other 6 tables...
-- then:
-- alter table public.raw_documents
--   add constraint raw_documents_user_id_fkey
--   foreign key (user_id) references auth.users(id) on delete cascade;
-- (same for payment_channels, sales_records, deposit_records,
--  reconciliations, card_issuers, reconciliation_match_proposals)
