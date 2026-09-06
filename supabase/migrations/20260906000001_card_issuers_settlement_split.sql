-- ============================================================================
-- 정산대사기 REDESIGN — STEP 1 of 2: SCHEMA ONLY.
--
-- Paste in the Supabase dashboard SQL Editor BLOCK BY BLOCK (blocks are
-- marked ═ BLOCK n ═ below; each has a verification query in chat).
-- Never `supabase db push`. No application code changes in this step.
--
-- DOMAIN SPLIT (from the store owner's spec):
--   대사 (reconciliation)  = only money that arrives LATER: card (PER ISSUER),
--        app voucher (탐나는전/온누리 app), barcode pay, delivery apps,
--        Alipay/WeChat, tax-free. Question: "did what I sold actually land?"
--   정산 (settlement/closing) = EVERYTHING incl. cash, bank transfer, paper
--        voucher. Question: "what did I really sell this month, by method?"
--   Cash / transfer / paper voucher must NEVER produce missing_deposit.
--
-- WHAT THIS MIGRATION ADDS
--   1. payment_method_defs  — global reference: 9 methods, each tagged
--      is_reconciled. (transfer is tagged settlement-only HERE; the running
--      engine still reconciles transfers until Step 2 swaps it — flagged.)
--   2. payment_channels.channel_type → FK to the defs (values pre-checked).
--   3. card_issuers — per-user issuer master (신한/삼성/NH/하나/…) with
--      per-issuer fee_rate (FRACTION: 0.0015 = 0.15%), settlement_days,
--      settlement_window_days, memo_aliases. Seeded per existing user.
--      ★ Seeded values are ESTIMATES — the user corrects them from real
--        card-company statements. Real sample measured ~0.149%, NOT the
--        2.5% the old CARD_RULE assumed.
--   4. sales_records.issuer_id — a card sale/refund is attributed to its
--      issuer. Refunds are NEGATIVE gross_amount rows (audit result: no SQL
--      CHECK ever blocked negatives; none widened — see chat report).
--   5. deposit_records.issuer_id + issuer_confidence + issuer_source —
--      the memo parser's guess ("NH15524303" → NH), user-correctable.
--      NO unique index anywhere on deposits: two genuine identical deposits
--      on the same day must stay insertable.
--   6. reconciliations.issuer_id + method_code — denormalized so the result
--      screen can say which issuer/method a result belongs to.
--
-- UNIT WARNING: reconciliation_rules.fee_rate is PERCENT (2.5 = 2.5%).
-- card_issuers.fee_rate is a FRACTION (0.0015 = 0.15%). Both are commented.
-- Step 2 gives card matching precedence: issuer row wins over channel rule.
--
-- Idempotent: create table/index if not exists, guarded FK adds,
-- insert … where not exists. Requires the Stage-0 tables to exist; if an
-- ALTER fails because a table is missing, stop and report — do not skip.
-- ============================================================================


-- ═ BLOCK 1 ═ payment_method_defs — the 대사/정산 method dimension ═══════════

create table if not exists public.payment_method_defs (
  code           text primary key,
  label_ko       text not null,
  label_en       text not null,
  -- true  → 대사 대상: money arrives later; matched against bank deposits.
  -- false → 정산 전용: counted in monthly closing only; NEVER produces
  --         missing_deposit and never appears in reconciliation results.
  is_reconciled  boolean not null,
  sort_order     integer not null default 100,
  notes          text,
  created_at     timestamptz not null default now()
);

comment on table public.payment_method_defs is
  'Global payment-method dimension for 정산대사기. is_reconciled=true → 대사 (deposit matching); false → 정산 전용 (monthly closing only, never missing_deposit). Rows are reference data managed by migrations; users do not edit.';

comment on column public.payment_method_defs.is_reconciled is
  'true = reconciled against bank deposits (card/app_voucher/barcode_pay/delivery_app/foreign_pay/tax_free). false = settlement-only (cash/transfer/paper_voucher).';

insert into public.payment_method_defs (code, label_ko, label_en, is_reconciled, sort_order, notes) values
  ('card',          '카드',            'Card',                true,  10,
   '대사는 카드사(issuer) 단위로 수행 — card_issuers 참조. 카드형 지역상품권은 카드 정산에 합산되어 들어옴.'),
  ('app_voucher',   '앱상품권',        'App voucher',         true,  20,
   '탐나는전·온누리 앱. ★입금 경로 주의: 상품권 명의의 직접이체로 올 수도 있고 카드사 정산에 실려 올 수도 있음 — 매처는 경로를 고정 가정하지 말 것.'),
  ('barcode_pay',   '바코드결제',      'Barcode pay',         true,  30,
   '★입금 경로 주의: 카드사 정산으로 올 수도, 사업자 명의 직접이체로 올 수도 있음 — 매처는 경로를 고정 가정하지 말 것.'),
  ('delivery_app',  '배달앱',          'Delivery app',        true,  40,
   '중개+결제+배달+광고 공제 후 주 단위 배치 입금. 수수료는 정산마다 달라 amount_mismatch가 정상 범주.'),
  ('foreign_pay',   '알리페이·위챗',   'Alipay/WeChat',       true,  50,
   'PG 경유 정산. 요율은 PG 계약에 따름.'),
  ('tax_free',      '택스프리',        'Tax-free',            true,  60,
   '카드 매출분만 대사 대상 (환급 수속분은 별도 흐름).'),
  ('cash',          '현금',            'Cash',                false, 70,
   '정산 전용. 은행 입금이 없음 — 대사 결과·missing_deposit에 절대 나타나지 않아야 함.'),
  ('transfer',      '계좌이체',        'Bank transfer',       false, 80,
   '정산 전용(스펙 확정). ※충돌 기록: 현행 엔진(Stage 1)은 transfer를 대사함 — Step 2에서 엔진 교체 시 해소. 기존 transfer 대사 이력 행은 그대로 둠.'),
  ('paper_voucher', '지류상품권',      'Paper voucher',       false, 90,
   '정산 전용. 은행에 넣는 날이 임의라 판매일 기준 매칭이 불가 — missing_deposit 금지.')
on conflict (code) do nothing;

alter table public.payment_method_defs enable row level security;

drop policy if exists "read_payment_method_defs" on public.payment_method_defs;
create policy "read_payment_method_defs" on public.payment_method_defs
  for select to authenticated using (true);

-- (verification query in chat: expect 9 rows, 6 reconciled / 3 settlement-only)


-- ═ BLOCK 2 ═ payment_channels.channel_type → FK to the defs ════════════════
-- channel_type was free text. All live values (transfer/card/app_voucher/
-- cash/paper_voucher) exist in the defs, so the FK is safe. Pre-check raises
-- with the offending values instead of failing cryptically.
-- NOTE: delivery-app / foreign-pay channels created via presets currently
-- carry channel_type='card'. They are NOT retyped here — the running engine
-- still matches them through the card pass. Step 2 retypes them together
-- with the engine swap.

do $$
declare
  bad text;
begin
  select string_agg(distinct c.channel_type, ', ')
    into bad
  from public.payment_channels c
  where not exists (
    select 1 from public.payment_method_defs d where d.code = c.channel_type
  );
  if bad is not null then
    raise exception
      'payment_channels has channel_type values not in payment_method_defs: % — add defs rows first, do not proceed',
      bad;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'payment_channels_channel_type_fkey'
  ) then
    alter table public.payment_channels
      add constraint payment_channels_channel_type_fkey
      foreign key (channel_type) references public.payment_method_defs(code);
  end if;
end $$;

comment on column public.payment_channels.channel_type is
  'FK to payment_method_defs.code. Determines 대사 vs 정산 전용 via defs.is_reconciled. Free-text values are no longer accepted.';

-- (verification query in chat: expect the FK in the constraint list)


-- ═ BLOCK 3 ═ card_issuers — per-user issuer master + seed ══════════════════
-- The root defect of the old model was a single 'card' bucket. Bank memos
-- carry the ISSUER ("하나90343621", "NH15524303"), fees differ per issuer
-- (~0.149% measured at this store, not 2.5%), and settlement lag differs per
-- issuer (하나 T+1, NH T+2 in the same sample) and crosses month boundaries.

create table if not exists public.card_issuers (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  name                     text not null,               -- 신한, 삼성, NH, 하나, …
  -- FRACTION of gross, NOT percent: 0.0015 = 0.15%.
  -- (Deliberately different from reconciliation_rules.fee_rate, which stores
  --  PERCENT units, 2.5 = 2.5%. The CHECK < 1 catches percent-style entry.)
  fee_rate                 numeric(7,6) not null default 0.0015,
  -- Expected days from sale to deposit (T+n). Editable per issuer.
  settlement_days          integer not null default 2,
  -- Matching searches a WINDOW, not a single date: deposits are accepted in
  -- [sale_date, sale_date + settlement_days + settlement_window_days].
  -- Window search is what lets late-August sales match early-September
  -- deposits (month boundaries are irrelevant to the matcher).
  settlement_window_days   integer not null default 3,
  -- Memo fragments that identify this issuer in a bank line
  -- ("NH15524303" → NH). Engine matches longest-alias-first, case-insensitive.
  memo_aliases             text[] not null default '{}',
  -- Retire an issuer without deleting history. App layer must refuse to
  -- delete an issuer that sales/deposits still reference.
  is_active                boolean not null default true,
  display_order            integer not null default 100,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint card_issuers_user_name_uniq unique (user_id, name),
  constraint card_issuers_fee_rate_chk check (fee_rate >= 0 and fee_rate < 1),
  constraint card_issuers_settlement_days_chk check (settlement_days >= 0),
  constraint card_issuers_window_days_chk check (settlement_window_days >= 0)
);

comment on table public.card_issuers is
  '카드사 마스터 (per user). Per-issuer fee_rate + settlement window replace the single card bucket. ★SEEDED VALUES ARE ESTIMATES: fee 0.0015 (0.15%) and T+2 are placeholders to be corrected from the store''s real card-company statements (measured sample: ~0.149%, 하나 T+1, NH T+2).';

comment on column public.card_issuers.fee_rate is
  'FRACTION of gross (0.0015 = 0.15%), NOT percent. Unlike reconciliation_rules.fee_rate which is percent units. User-editable; never hardcode.';

comment on column public.card_issuers.settlement_window_days is
  'Matching slack: deposits accepted in [sale_date, sale_date + settlement_days + settlement_window_days]. Per-issuer window search — never a single expected date.';

comment on column public.card_issuers.memo_aliases is
  'Bank-memo fragments identifying this issuer ("NH15524303" → NH). Longest-first, case-insensitive matching in the parser. User-correctable data, not code.';

create index if not exists card_issuers_user_active_idx
  on public.card_issuers (user_id, is_active, display_order);

alter table public.card_issuers enable row level security;

drop policy if exists "own_card_issuers" on public.card_issuers;
create policy "own_card_issuers" on public.card_issuers
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Seed the common Korean issuers for every user who has touched 대사기
-- (has at least one payment_channels row). EDITABLE DEFAULTS — estimates
-- to be corrected from real statements. New users are seeded at app layer
-- in Step 2 (re-running this block also back-fills newcomers safely).
insert into public.card_issuers
  (user_id, name, fee_rate, settlement_days, settlement_window_days, memo_aliases, display_order)
select u.user_id, s.name, 0.0015, 2, 3, s.aliases, s.ord
from (select distinct user_id from public.payment_channels) u
cross join (
  values
    ('신한',       array['신한','신한카드','SHINHAN'],          10),
    ('삼성',       array['삼성','삼성카드','SAMSUNG'],          20),
    ('NH',         array['NH','농협','NH농협','엔에이치'],      30),
    ('하나',       array['하나','하나카드','HANA'],             40),
    ('국민',       array['국민','KB','KB국민','케이비'],        50),
    ('BC',         array['BC','비씨','BC카드','비씨카드'],      60),
    ('롯데',       array['롯데','롯데카드','LOTTE'],            70),
    ('현대',       array['현대','현대카드','HYUNDAI'],          80),
    ('우리',       array['우리','우리카드','WOORI'],            90),
    ('씨티',       array['씨티','시티','CITI','씨티카드'],     100),
    ('카카오뱅크', array['카카오뱅크','카뱅'],                  110)
) as s(name, aliases, ord)
where not exists (
  select 1 from public.card_issuers ci
  where ci.user_id = u.user_id and ci.name = s.name
);

-- (verification query in chat: expect 11 issuer names × seeded-user count)


-- ═ BLOCK 4 ═ sales_records — issuer attribution + refund audit ═════════════
-- AUDIT RESULT (negative sales / refunds): sales_records has NO CHECK that
-- blocks a negative gross_amount or expected_net_amount — nothing to widen
-- at the SQL layer. The only >= 0 CHECK is sales_records_discount_amount_chk
-- (discount_amount is null or >= 0), KEPT ON PURPOSE: a discount is an
-- absolute reduction and stays non-negative even on a refund row.
-- The ">0" assumptions live in APP code (UI input min="0", parser drops
-- amount<=0 rows) — Step 2 items. A refund is a NEGATIVE-gross sales row on
-- the SAME issuer; it nets against that issuer's sales inside the matching
-- window (it is NOT settlement-only).

alter table public.sales_records
  add column if not exists issuer_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sales_records_issuer_id_fkey'
  ) then
    alter table public.sales_records
      add constraint sales_records_issuer_id_fkey
      foreign key (issuer_id) references public.card_issuers(id) on delete set null;
  end if;
end $$;

create index if not exists sales_records_user_issuer_date_idx
  on public.sales_records (user_id, issuer_id, sale_date);

comment on column public.sales_records.issuer_id is
  'Card issuer this sale (or refund) settles through. NULL for non-card methods or an unattributed lump. Matching is per (issuer, window) — never on a lumped card total.';

comment on column public.sales_records.gross_amount is
  'Signed. NEGATIVE = refund/cancellation, attributed to the same issuer_id; it reduces what that issuer settles and nets against sales in the same matching window. No sign CHECK by design.';

comment on column public.sales_records.discount_amount is
  '정산 전용 (settlement-only): reporting field. NEVER enters expected_net_amount or matching. Stays >= 0 even on refund rows (leave null there).';

-- (verification query in chat: constraint list + issuer_id presence)


-- ═ BLOCK 5 ═ deposit_records — resolved issuer from the memo ═══════════════
-- The memo carries the issuer name ("NH15524303" → NH). The parser's guess
-- is STORED (issuer_id + confidence + source) and user-correctable, not
-- re-derived on every read.
-- ★NO UNIQUE INDEX is added anywhere on deposit_records: two genuine
-- identical deposits on the same day must remain insertable (duplicate
-- detection stays HITL, per 20260904000002).

alter table public.deposit_records
  add column if not exists issuer_id uuid;

alter table public.deposit_records
  add column if not exists issuer_confidence numeric(4,3);

alter table public.deposit_records
  add column if not exists issuer_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'deposit_records_issuer_id_fkey'
  ) then
    alter table public.deposit_records
      add constraint deposit_records_issuer_id_fkey
      foreign key (issuer_id) references public.card_issuers(id) on delete set null;
  end if;
end $$;

alter table public.deposit_records
  drop constraint if exists deposit_records_issuer_confidence_chk;
alter table public.deposit_records
  add constraint deposit_records_issuer_confidence_chk
  check (issuer_confidence is null or (issuer_confidence >= 0 and issuer_confidence <= 1));

alter table public.deposit_records
  drop constraint if exists deposit_records_issuer_source_chk;
alter table public.deposit_records
  add constraint deposit_records_issuer_source_chk
  check (issuer_source is null or issuer_source in ('parser', 'user'));

create index if not exists deposit_records_user_issuer_date_idx
  on public.deposit_records (user_id, issuer_id, deposit_date);

comment on column public.deposit_records.issuer_id is
  'Resolved card issuer for this deposit (parser guess from memo, user-correctable). ★App-voucher/barcode money may arrive EITHER via a card issuer OR as a direct transfer under the voucher''s own name — the matcher must not assume a fixed route, so this stays nullable for any method.';

comment on column public.deposit_records.issuer_confidence is
  'Parser''s confidence (0..1) in the memo → issuer resolution. NULL when unresolved or user-set.';

comment on column public.deposit_records.issuer_source is
  'Who resolved the issuer: parser (memo aliases) or user (manual fix). NULL = unresolved.';

-- (verification query in chat: columns + index list — confirm nothing unique)


-- ═ BLOCK 6 ═ reconciliations — issuer/method on the result row ═════════════
-- Denormalized so the result screen can label each result ("NH: 9/1 매출
-- 31,500 → 9/3 입금 31,453") without walking matches→sales per row.
-- reconciliation_matches stays the source of truth; the engine fills these
-- in Step 2. Existing rows keep NULL. Settlement-only methods must never
-- gain rows here at all (engine guarantee, Step 2 + regression test).

alter table public.reconciliations
  add column if not exists issuer_id uuid;

alter table public.reconciliations
  add column if not exists method_code text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reconciliations_issuer_id_fkey'
  ) then
    alter table public.reconciliations
      add constraint reconciliations_issuer_id_fkey
      foreign key (issuer_id) references public.card_issuers(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'reconciliations_method_code_fkey'
  ) then
    alter table public.reconciliations
      add constraint reconciliations_method_code_fkey
      foreign key (method_code) references public.payment_method_defs(code) on delete set null;
  end if;
end $$;

create index if not exists reconciliations_user_issuer_idx
  on public.reconciliations (user_id, issuer_id);

comment on column public.reconciliations.issuer_id is
  'Card issuer this result concerns (NULL for non-card methods and legacy rows). Filled by the Step-2 per-issuer engine; matches remain the source of truth.';

comment on column public.reconciliations.method_code is
  'payment_method_defs.code this result concerns. Must only ever hold is_reconciled=true methods — settlement-only methods (cash/transfer/paper_voucher) never produce reconciliation rows (Step-2 engine guarantee).';

-- (verification query in chat: columns + FK list)
