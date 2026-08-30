-- ============================================================================
-- 대사기 Stage 2b — split-payment groups on sales_records.
--
-- A single checkout can be split across methods (e.g. 5만 = 상품권 2만 +
-- 카드 3만). Each piece is its own sales_records row on its own channel so
-- the existing per-channel matcher stays unchanged. Rows that belong to the
-- same checkout share sale_group_id; a non-split sale leaves it NULL.
--
-- The old per-row voucher-portion columns (voucher_amount / voucher_type)
-- become redundant and are dropped, along with their CHECKs. sale_kind and
-- entry_source stay — each split piece still has its own kind/source.
--
-- PRE-CHECK (run in SQL Editor FIRST, do not skip):
--   select count(*) as voucher_rows
--   from public.sales_records
--   where voucher_amount is not null or voucher_type is not null;
-- If that count is > 0, STOP — do not run this migration.
--
-- The DO block below re-checks at apply time and aborts if any such row
-- still exists (idempotent if the columns are already gone).
--
-- Idempotent: add column if not exists, create index if not exists,
-- drop constraint if exists, drop column if exists.
-- Only touches public.sales_records.
-- ============================================================================

alter table public.sales_records
  add column if not exists sale_group_id uuid;

create index if not exists sales_records_user_group_idx
  on public.sales_records (user_id, sale_group_id);

comment on column public.sales_records.sale_group_id is
  'Shared id for split-payment pieces of one checkout. NULL = a standalone (non-split) sale.';

do $$
declare
  n integer := 0;
  has_amount boolean;
  has_type boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_records' and column_name = 'voucher_amount'
  ) into has_amount;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_records' and column_name = 'voucher_type'
  ) into has_type;

  if has_amount or has_type then
    execute
      'select count(*) from public.sales_records where '
      || case when has_amount then 'voucher_amount is not null' else 'false' end
      || ' or '
      || case when has_type then 'voucher_type is not null' else 'false' end
    into n;
    if n > 0 then
      raise exception
        'sales_records has % row(s) with voucher_amount or voucher_type set; refusing to drop those columns',
        n;
    end if;
  end if;
end $$;

alter table public.sales_records
  drop constraint if exists sales_records_voucher_pair_chk;

alter table public.sales_records
  drop constraint if exists sales_records_voucher_amount_chk;

alter table public.sales_records
  drop column if exists voucher_amount;

alter table public.sales_records
  drop column if exists voucher_type;
