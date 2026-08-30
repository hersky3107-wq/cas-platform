-- ============================================================================
-- 대사기 Stage 2 — local-voucher (지역상품권) fields on sales_records (ADDITIVE).
--
-- Card-type local vouchers (탐나는전 카드형) already land inside card sales
-- and stay indistinguishable there. App/barcode vouchers (탐나는전 앱, 온누리
-- 앱) deposit under the voucher name and must be trackable as their own sale
-- kind — or as a named portion of a card sale. This migration only widens
-- storage; no app / UI / other table is touched.
--
--   sale_kind        how this row is classified
--                    'card'          — card sales, including card-type local
--                                      vouchers already merged into the slip
--                    'app_voucher'   — app/barcode voucher that deposits
--                                      separately under the voucher name
--                    'manual_total'  — a lump daily total typed by hand
--   voucher_amount   optional voucher portion inside this sale
--                    (e.g. 50만 card sale of which 5만 is 탐나는전).
--                    NULL = the user did not track it.
--   voucher_type     free-text name ('탐나는전', '온누리', …). Only
--                    meaningful when voucher_amount is set; no enum yet.
--   entry_source     how the row was entered
--                    'pos_import'    — parsed from a POS export
--                    'voucher_tally' — from a voucher tally sheet
--                    'manual'        — typed by hand
--
-- Existing rows (if any) pick up sale_kind='card' and entry_source='manual'
-- via the column defaults — the pre-Stage-2 meaning of every sale.
--
-- Idempotent: `add column if not exists` + drop/add named CHECKs.
-- Only touches public.sales_records.
-- ============================================================================

alter table public.sales_records
  add column if not exists sale_kind text not null default 'card';

alter table public.sales_records
  add column if not exists voucher_amount numeric(14,2);

alter table public.sales_records
  add column if not exists voucher_type text;

alter table public.sales_records
  add column if not exists entry_source text not null default 'manual';

alter table public.sales_records
  drop constraint if exists sales_records_sale_kind_chk;
alter table public.sales_records
  add constraint sales_records_sale_kind_chk
  check (sale_kind in ('card', 'app_voucher', 'manual_total'));

alter table public.sales_records
  drop constraint if exists sales_records_entry_source_chk;
alter table public.sales_records
  add constraint sales_records_entry_source_chk
  check (entry_source in ('pos_import', 'voucher_tally', 'manual'));

-- A voucher amount without a type is invalid. Type-without-amount is allowed
-- (the type is only meaningful when an amount is set; it is not required).
alter table public.sales_records
  drop constraint if exists sales_records_voucher_pair_chk;
alter table public.sales_records
  add constraint sales_records_voucher_pair_chk
  check (voucher_amount is null or voucher_type is not null);

-- When present, the voucher portion cannot be negative or exceed the sale.
alter table public.sales_records
  drop constraint if exists sales_records_voucher_amount_chk;
alter table public.sales_records
  add constraint sales_records_voucher_amount_chk
  check (
    voucher_amount is null
    or (voucher_amount >= 0 and voucher_amount <= gross_amount)
  );

comment on column public.sales_records.sale_kind is
  'How this sale is classified: card (incl. card-type local vouchers merged in), app_voucher (app/barcode voucher that deposits under the voucher name), manual_total (lump daily total typed by hand).';

comment on column public.sales_records.voucher_amount is
  'Optional voucher portion inside this sale (e.g. 5만 of a 50만 card sale). NULL = not tracked. When set, must be >= 0, <= gross_amount, and voucher_type must also be set.';

comment on column public.sales_records.voucher_type is
  'Free-text voucher name (탐나는전, 온누리, …). Only meaningful when voucher_amount is set.';

comment on column public.sales_records.entry_source is
  'How the row was entered: pos_import (parsed POS export), voucher_tally (voucher tally sheet), manual (typed).';
