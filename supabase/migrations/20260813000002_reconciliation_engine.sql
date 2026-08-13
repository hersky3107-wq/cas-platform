-- ============================================================================
-- 대사기 (Reconciliation Engine) — Stage 0 Data Model (greenfield, ADDITIVE).
--
-- Scope: A-core (multimodal ingest -> AI parse -> reconcile).
--        C (security) folded into reconciliations.security_flag.
--        B (bank linkage) intentionally excluded at this stage.
--
-- This is a NEW, isolated feature: no existing table is read, written, or
-- referenced except auth.users (identity) — dropping every table below
-- leaves the rest of the app byte-for-byte identical.
--
-- ADJUSTMENTS from the original spec draft (see chat), for consistency with
-- the rest of this repo's migrations:
--   - No `create type ... as enum`: this codebase has no prior enum usage,
--     and enums can't be dropped/altered idempotently on re-run. Replaced
--     every enum with `text` + a named `check` constraint (same fixed set
--     of values, easier to extend later with a plain migration).
--   - Tables are schema-qualified (`public.xxx`) and use
--     `create table if not exists` / `create index if not exists`, matching
--     20260813000001_prediction_ledger.sql.
--   - `user_id` FKs to `auth.users(id)` (not `public.users(id)`): this app's
--     real identity table is Supabase Auth (confirmed: `resolveRouteAuth()`
--     resolves the same UUID as `auth.uid()`). `public.users` is a lazily-
--     created profile/credits mirror row, not guaranteed to exist yet for a
--     brand-new signup, so FK'ing to it risks insert failures.
--   - Owner-only `auth.uid()` RLS policies kept as drafted (this is personal
--     financial data — defense-in-depth beyond app-layer auth is correct
--     here), unlike the service-role-only pattern used for league/session
--     tables that have no direct end-user CRUD surface.
--
-- OPEN QUESTIONS carried over from the spec (not resolved here):
--   - raw_documents.raw_text: needs app-layer encryption (ENCRYPTION_SECRET)
--     before this ships, since it may contain account numbers.
--   - fee_type = 'tiered': needs a reconciliation_rule_tiers child table if
--     any real channel uses bracketed fees. Deferred until a concrete case
--     shows up.
--   - foreign_pay (Alipay/WeChat): confirm it's distinguishable as its own
--     channel inside domestic PG settlement before modeling it as one.
-- ============================================================================

-- ── 1. RAW DOCUMENTS (the "개떡" originals) ────────────────────────────────
-- Everything the user throws in, stored verbatim for re-parse & audit.
create table if not exists public.raw_documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  source_type   text not null,
  raw_text      text,            -- sms/kakao/email/manual (ENCRYPT AT APP LAYER: may hold acct numbers)
  storage_path  text,            -- receipt_image / handwritten / excel (Supabase Storage)
  parse_status  text not null default 'pending',
  parse_error   text,
  uploaded_at   timestamptz not null default now(),

  constraint raw_documents_source_type_chk check (source_type in (
    'sms', 'kakao', 'email', 'receipt_image', 'handwritten', 'excel', 'manual'
  )),
  constraint raw_documents_parse_status_chk check (parse_status in (
    'pending', 'parsing', 'parsed', 'failed'
  ))
);

-- ── 2. PAYMENT CHANNELS (결제수단 마스터) ──────────────────────────────────
-- Card, bank transfer, 지역상품권, 배달, 알리페이/위챗, 현금, 간편결제 ...
create table if not exists public.payment_channels (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,           -- e.g. '탐나는전', '배달의민족', '신한카드'
  channel_type text not null,           -- e.g. 'card','transfer','local_voucher','delivery','foreign_pay','cash'
  created_at   timestamptz not null default now(),

  constraint payment_channels_user_name_uniq unique (user_id, name)
);

-- ── 3. RECONCILIATION RULES (층2 심장: 채널별 수수료·정산주기) ────────────
-- Rules are DATA, not code. Effective-dated so rate changes don't break history.
create table if not exists public.reconciliation_rules (
  id               uuid primary key default gen_random_uuid(),
  channel_id       uuid not null references public.payment_channels(id) on delete cascade,
  fee_type         text not null default 'percent',
  fee_rate         numeric(8,4),        -- percent (e.g. 2.5000) or fixed amount, per fee_type
  settlement_days  integer not null default 0,  -- expected days from sale to deposit
  tolerance_won    integer not null default 0,  -- amount discrepancy tolerated before flagging
  tolerance_days   integer not null default 0,  -- date discrepancy tolerated before flagging
  effective_from   date not null default current_date,
  effective_to     date,                -- null = still in effect
  notes            text,
  created_at       timestamptz not null default now(),

  constraint reconciliation_rules_fee_type_chk check (fee_type in ('percent', 'fixed', 'tiered'))
);

-- ── 4. SALES RECORDS (판 것) ───────────────────────────────────────────────
create table if not exists public.sales_records (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  raw_document_id       uuid references public.raw_documents(id) on delete set null,  -- provenance
  channel_id            uuid references public.payment_channels(id) on delete set null,
  sale_date             date not null,
  gross_amount          numeric(14,2) not null,       -- what was sold
  expected_net_amount   numeric(14,2),                -- computed from rule (after fees)
  expected_deposit_date date,                         -- computed from rule (settlement)
  confidence            numeric(4,3),                 -- AI parse confidence 0..1
  confirm_status        text not null default 'pending',
  created_at            timestamptz not null default now(),

  constraint sales_records_confirm_status_chk check (confirm_status in ('pending', 'confirmed', 'edited'))
);

-- ── 5. DEPOSIT RECORDS (실제 들어온 것) ────────────────────────────────────
create table if not exists public.deposit_records (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  raw_document_id  uuid references public.raw_documents(id) on delete set null,
  deposit_date     date not null,
  actual_amount    numeric(14,2) not null,
  channel_hint     uuid references public.payment_channels(id) on delete set null,  -- AI's guess of source
  confidence       numeric(4,3),
  confirm_status   text not null default 'pending',
  created_at       timestamptz not null default now(),

  constraint deposit_records_confirm_status_chk check (confirm_status in ('pending', 'confirmed', 'edited'))
);

-- ── 6. RECONCILIATIONS (대사 결과 + 판정) ──────────────────────────────────
create table if not exists public.reconciliations (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  status              text not null,
  discrepancy_amount  numeric(14,2) default 0,    -- signed: expected - actual
  discrepancy_reason  text,
  security_flag       text not null default 'none',
  resolved            boolean not null default false,  -- user has acknowledged/handled
  created_at          timestamptz not null default now(),

  constraint reconciliations_status_chk check (status in (
    'matched', 'missing_deposit', 'amount_mismatch', 'date_anomaly', 'unmatched_deposit'
  )),
  constraint reconciliations_security_flag_chk check (security_flag in (
    'none', 'fake_deposit_suspected', 'anomaly'
  ))
);

-- ── 7. RECONCILIATION MATCHES (N:M link) ───────────────────────────────────
-- One deposit can settle many sales (delivery/card batch); a missing deposit
-- leaves deposit_record_id null. This join table is what makes batch settlement work.
create table if not exists public.reconciliation_matches (
  reconciliation_id  uuid not null references public.reconciliations(id) on delete cascade,
  sales_record_id    uuid references public.sales_records(id) on delete cascade,
  deposit_record_id  uuid references public.deposit_records(id) on delete cascade,
  primary key (reconciliation_id, sales_record_id, deposit_record_id)
);

-- ── INDEXES ─────────────────────────────────────────────────────────────────
create index if not exists raw_documents_user_status_idx      on public.raw_documents (user_id, parse_status);
create index if not exists sales_records_user_date_idx        on public.sales_records (user_id, sale_date);
create index if not exists sales_records_confirm_idx          on public.sales_records (user_id, confirm_status);
create index if not exists deposit_records_user_date_idx      on public.deposit_records (user_id, deposit_date);
create index if not exists reconciliations_user_status_idx    on public.reconciliations (user_id, status, resolved);
create index if not exists reconciliation_rules_channel_idx   on public.reconciliation_rules (channel_id, effective_from, effective_to);

-- ============================================================================
-- ROW LEVEL SECURITY — owner-only via auth.uid() on every user table.
-- (Personal financial data: no row is ever visible cross-user, even via a
-- leaked anon-key client call.) Rules & matches inherit ownership through
-- their parent row (channel / reconciliation) since they carry no user_id.
-- ============================================================================
alter table public.raw_documents          enable row level security;
alter table public.payment_channels       enable row level security;
alter table public.sales_records          enable row level security;
alter table public.deposit_records        enable row level security;
alter table public.reconciliations        enable row level security;
alter table public.reconciliation_rules   enable row level security;
alter table public.reconciliation_matches enable row level security;

drop policy if exists "own_raw_documents" on public.raw_documents;
create policy "own_raw_documents" on public.raw_documents
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_payment_channels" on public.payment_channels;
create policy "own_payment_channels" on public.payment_channels
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_sales_records" on public.sales_records;
create policy "own_sales_records" on public.sales_records
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_deposit_records" on public.deposit_records;
create policy "own_deposit_records" on public.deposit_records
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_reconciliations" on public.reconciliations;
create policy "own_reconciliations" on public.reconciliations
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- rules: user owns them via the channel
drop policy if exists "own_reconciliation_rules" on public.reconciliation_rules;
create policy "own_reconciliation_rules" on public.reconciliation_rules
  using (exists (
    select 1 from public.payment_channels c
    where c.id = reconciliation_rules.channel_id and c.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.payment_channels c
    where c.id = reconciliation_rules.channel_id and c.user_id = auth.uid()
  ));

-- matches: user owns them via the reconciliation
drop policy if exists "own_reconciliation_matches" on public.reconciliation_matches;
create policy "own_reconciliation_matches" on public.reconciliation_matches
  using (exists (
    select 1 from public.reconciliations r
    where r.id = reconciliation_matches.reconciliation_id and r.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.reconciliations r
    where r.id = reconciliation_matches.reconciliation_id and r.user_id = auth.uid()
  ));
