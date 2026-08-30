-- ============================================================================
-- 대사기 — allow sale_kind = 'cash' on sales_records (ADDITIVE).
--
-- Cash is identified by payment_channels.channel_type = 'cash' (already
-- unconstrained text — no change there). This only widens the sale_kind
-- CHECK so a cash row is not forced to pretend it is 'card' or
-- 'manual_total'.
--
-- Idempotent. Only touches public.sales_records.
-- Paste in the Supabase SQL Editor (do not supabase db push).
-- ============================================================================

alter table public.sales_records
  drop constraint if exists sales_records_sale_kind_chk;

alter table public.sales_records
  add constraint sales_records_sale_kind_chk
  check (sale_kind in ('card', 'app_voucher', 'manual_total', 'cash'));

comment on column public.sales_records.sale_kind is
  'How this sale is classified: card, app_voucher, manual_total (lump daily total), cash (revenue only — no bank deposit to reconcile).';
