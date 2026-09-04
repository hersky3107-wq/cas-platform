-- ============================================================================
-- 대사기 — sales_records: sale_kind += paper_voucher; discount_amount;
--           seed a paper_voucher payment_channels row per existing user.
--
-- Paste in the Supabase SQL Editor (do not `supabase db push`).
-- Re-run safe: IF EXISTS / IF NOT EXISTS / DROP CONSTRAINT IF EXISTS.
--
-- After this script: run the VERIFICATION query at the bottom and check
-- every sales_records column + CHECK against what you expect.
-- ============================================================================

-- ── 1. Read the ACTUAL current sale_kind CHECK name (do not assume it) ──
-- Run this result set first in the Messages / Results panel.
select
  tc.constraint_name,
  tc.constraint_type,
  cc.check_clause
from information_schema.table_constraints tc
join information_schema.check_constraints cc
  on cc.constraint_schema = tc.constraint_schema
 and cc.constraint_name = tc.constraint_name
where tc.table_schema = 'public'
  and tc.table_name = 'sales_records'
  and tc.constraint_type = 'CHECK'
  and (
    cc.check_clause ilike '%sale_kind%'
    or tc.constraint_name ilike '%sale_kind%'
  )
order by tc.constraint_name;

-- Drop whatever sale_kind CHECK actually exists, then add the widened list.
-- (information_schema name — not a hardcoded constraint name.)
do $$
declare
  rec record;
  has_table boolean;
  has_kind boolean;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'sales_records'
  ) into has_table;
  if not has_table then
    raise notice 'public.sales_records does not exist — skip sale_kind CHECK';
    return;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sales_records'
      and column_name = 'sale_kind'
  ) into has_kind;
  if not has_kind then
    raise notice 'sales_records.sale_kind does not exist — skip sale_kind CHECK';
    return;
  end if;

  for rec in
    select tc.constraint_name
    from information_schema.table_constraints tc
    join information_schema.check_constraints cc
      on cc.constraint_schema = tc.constraint_schema
     and cc.constraint_name = tc.constraint_name
    where tc.table_schema = 'public'
      and tc.table_name = 'sales_records'
      and tc.constraint_type = 'CHECK'
      and (
        cc.check_clause ilike '%sale_kind%'
        or tc.constraint_name ilike '%sale_kind%'
      )
  loop
    raise notice 'dropping sale_kind CHECK %', rec.constraint_name;
    execute format(
      'alter table public.sales_records drop constraint if exists %I',
      rec.constraint_name
    );
  end loop;

  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'sales_records'
      and constraint_name = 'sales_records_sale_kind_chk'
  ) then
    alter table public.sales_records
      add constraint sales_records_sale_kind_chk
      check (sale_kind in (
        'card', 'app_voucher', 'manual_total', 'cash', 'paper_voucher'
      ));
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sales_records'
      and column_name = 'sale_kind'
  ) then
    comment on column public.sales_records.sale_kind is
      'How this sale is classified: card, app_voucher, manual_total, cash, paper_voucher (지류상품권).';
  end if;
end $$;

-- ── 2. discount_amount: nullable, no backfill, CHECK null or >= 0 ────────
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'sales_records'
  ) then
    raise notice 'public.sales_records does not exist — skip discount_amount';
    return;
  end if;

  alter table public.sales_records
    add column if not exists discount_amount numeric(14,2);

  alter table public.sales_records
    drop constraint if exists sales_records_discount_amount_chk;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sales_records'
      and column_name = 'discount_amount'
  ) then
    alter table public.sales_records
      add constraint sales_records_discount_amount_chk
      check (discount_amount is null or discount_amount >= 0);
    comment on column public.sales_records.discount_amount is
      'Optional discount in won. NULL = not recorded (not zero). When set, must be >= 0.';
  end if;
end $$;

-- ── 3. Read live payment_channels / rules shape (cash + app_voucher) ─────
select
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.numeric_precision,
  c.numeric_scale,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'payment_channels'
order by c.ordinal_position;

select
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.numeric_precision,
  c.numeric_scale,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'reconciliation_rules'
order by c.ordinal_position;

select id, user_id, name, channel_type, created_at
from public.payment_channels
where channel_type in ('cash', 'app_voucher')
order by channel_type, created_at;

select
  r.id,
  r.channel_id,
  c.channel_type,
  r.fee_type,
  r.fee_rate,
  r.settlement_days,
  r.tolerance_won,
  r.tolerance_days,
  r.effective_from,
  r.effective_to,
  r.notes,
  r.created_at
from public.reconciliation_rules r
join public.payment_channels c on c.id = r.channel_id
where c.channel_type in ('cash', 'app_voucher')
order by c.channel_type, r.created_at;

-- Seed one paper_voucher channel per user who already has cash and/or
-- app_voucher, using only the columns those rows actually use
-- (user_id, name, channel_type — id / created_at have defaults).
-- Fee 0 + settlement_days 0 live on reconciliation_rules, not on the channel.
do $$
declare
  has_channels boolean;
  has_rules boolean;
  col_names text;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'payment_channels'
  ) into has_channels;
  if not has_channels then
    raise notice 'public.payment_channels does not exist — skip paper_voucher seed';
    return;
  end if;

  select string_agg(column_name, ', ' order by ordinal_position)
    into col_names
  from information_schema.columns
  where table_schema = 'public' and table_name = 'payment_channels';
  raise notice 'payment_channels columns: %', col_names;

  insert into public.payment_channels (user_id, name, channel_type)
  select distinct src.user_id, '지류상품권', 'paper_voucher'
  from public.payment_channels src
  where src.channel_type in ('cash', 'app_voucher')
    and not exists (
      select 1
      from public.payment_channels already
      where already.user_id = src.user_id
        and (
          already.channel_type = 'paper_voucher'
          or already.name = '지류상품권'
        )
    );

  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'reconciliation_rules'
  ) into has_rules;
  if not has_rules then
    raise notice 'public.reconciliation_rules does not exist — skip paper_voucher rules';
    return;
  end if;

  select string_agg(column_name, ', ' order by ordinal_position)
    into col_names
  from information_schema.columns
  where table_schema = 'public' and table_name = 'reconciliation_rules';
  raise notice 'reconciliation_rules columns: %', col_names;

  -- Mirror a live cash/app_voucher rule row when one exists; otherwise the
  -- same 0-fee / 0-day shape those channels use in-app when no row is stored.
  insert into public.reconciliation_rules (
    channel_id,
    fee_type,
    fee_rate,
    settlement_days,
    tolerance_won,
    tolerance_days,
    effective_from,
    effective_to,
    notes
  )
  select
    pv.id,
    coalesce(tmpl.fee_type, 'percent'),
    0,
    0,
    coalesce(tmpl.tolerance_won, 0),
    coalesce(tmpl.tolerance_days, 0),
    current_date,
    null,
    'paper_voucher: fee_rate 0, settlement_days 0 (지류상품권)'
  from public.payment_channels pv
  left join lateral (
    select r.fee_type, r.tolerance_won, r.tolerance_days
    from public.reconciliation_rules r
    join public.payment_channels c on c.id = r.channel_id
    where c.channel_type in ('cash', 'app_voucher')
    order by case c.channel_type when 'cash' then 0 else 1 end, r.created_at
    limit 1
  ) tmpl on true
  where pv.channel_type = 'paper_voucher'
    and not exists (
      select 1
      from public.reconciliation_rules r2
      where r2.channel_id = pv.id
    );
end $$;

-- ── VERIFICATION (run after; confirm column-by-column) ────────────────────
select
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.numeric_precision,
  c.numeric_scale,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'sales_records'
order by c.ordinal_position;

select
  tc.constraint_name,
  tc.constraint_type,
  cc.check_clause,
  kcu.column_name as key_column
from information_schema.table_constraints tc
left join information_schema.check_constraints cc
  on cc.constraint_schema = tc.constraint_schema
 and cc.constraint_name = tc.constraint_name
left join information_schema.key_column_usage kcu
  on kcu.constraint_schema = tc.constraint_schema
 and kcu.constraint_name = tc.constraint_name
 and kcu.table_name = tc.table_name
where tc.table_schema = 'public'
  and tc.table_name = 'sales_records'
order by tc.constraint_type, tc.constraint_name, kcu.ordinal_position;

select
  con.conname as constraint_name,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'sales_records'
order by con.contype, con.conname;

select id, user_id, name, channel_type, created_at
from public.payment_channels
where channel_type = 'paper_voucher' or name = '지류상품권'
order by created_at;

select
  r.id,
  r.channel_id,
  c.user_id,
  c.name,
  c.channel_type,
  r.fee_type,
  r.fee_rate,
  r.settlement_days,
  r.tolerance_won,
  r.tolerance_days,
  r.effective_from,
  r.effective_to,
  r.notes
from public.reconciliation_rules r
join public.payment_channels c on c.id = r.channel_id
where c.channel_type = 'paper_voucher'
order by r.created_at;
