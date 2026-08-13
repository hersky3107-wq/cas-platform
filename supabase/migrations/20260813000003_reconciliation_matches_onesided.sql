-- ============================================================================
-- 대사기 Stage 1 — allow ONE-SIDED reconciliation_matches (ADDITIVE).
--
-- Stage 0 gave reconciliation_matches a composite PK
-- (reconciliation_id, sales_record_id, deposit_record_id). PK columns are
-- implicitly NOT NULL, so a `missing_deposit` result (a sale with no deposit)
-- or an `unmatched_deposit` result (a deposit with no sale) could not be linked
-- to the row it concerns — and without a link the reconcile pass can't tell a
-- sale is already handled, so it would re-flag it on every run.
--
-- This migration:
--   - replaces the composite PK with a surrogate `id`,
--   - keeps sales_record_id / deposit_record_id nullable (they already were,
--     the PK is what forced them NOT NULL),
--   - adds a guard that at least ONE side is present,
--   - adds a partial unique index so the same (recon, sale, deposit) triple
--     can't be linked twice.
--
-- Idempotent: safe to re-run. Only touches reconciliation_matches.
-- ============================================================================

alter table public.reconciliation_matches
  drop constraint if exists reconciliation_matches_pkey;

alter table public.reconciliation_matches
  add column if not exists id uuid not null default gen_random_uuid();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reconciliation_matches_pkey'
  ) then
    alter table public.reconciliation_matches
      add constraint reconciliation_matches_pkey primary key (id);
  end if;
end $$;

alter table public.reconciliation_matches
  drop constraint if exists reconciliation_matches_side_chk;
alter table public.reconciliation_matches
  add constraint reconciliation_matches_side_chk
  check (sales_record_id is not null or deposit_record_id is not null);

-- One link per (reconciliation, sale, deposit); nulls collapse to a sentinel so
-- e.g. two "sale X, no deposit" links under the same reconciliation are rejected.
create unique index if not exists reconciliation_matches_triple_uniq
  on public.reconciliation_matches (
    reconciliation_id,
    coalesce(sales_record_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(deposit_record_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists reconciliation_matches_sale_idx
  on public.reconciliation_matches (sales_record_id);
create index if not exists reconciliation_matches_deposit_idx
  on public.reconciliation_matches (deposit_record_id);
