-- ============================================================================
-- 정산대사기 REDESIGN — STEP 2 PART A: ENGINE SUPPORT SQL.
--
-- Paste in the Supabase dashboard SQL Editor BLOCK BY BLOCK — this repo
-- applies migrations BY HAND, never `supabase db push`. Each block ends with
-- a verification query (the editor shows only the last result set).
--
-- The Step-2 engine code DEGRADES GRACEFULLY until this is applied
-- (deterministic reconcile works; it just can't tag source= or write AI
-- proposals), but the AI routes (infer-matches / proposals / resolve-issuers
-- AI pass) REQUIRE blocks 1–3 and return a clear 503 naming the block
-- until they exist.
--
--   BLOCK 1: deposit_records.issuer_source CHECK += 'ai'   (memo-resolve)
--   BLOCK 2: retype preset channels card → delivery_app / foreign_pay
--   BLOCK 3: reconciliation_match_proposals                (AI proposals)
--   BLOCK 4: reconciliations.source                        (path labeling)
-- ============================================================================


-- ═ BLOCK 1 ═ issuer_source may now be 'ai' (multi-model memo resolution) ════
-- Step 1 allowed ('parser','user'). The AI layer distinguishes an alias hit
-- ('parser') from a model-consensus resolution ('ai') so the UI can show
-- what decided each attribution honestly.

alter table public.deposit_records
  drop constraint if exists deposit_records_issuer_source_chk;
alter table public.deposit_records
  add constraint deposit_records_issuer_source_chk
  check (issuer_source is null or issuer_source in ('parser', 'user', 'ai'));

comment on column public.deposit_records.issuer_source is
  'Who resolved the issuer: parser (memo alias hit), ai (multi-model consensus), user (manual fix). NULL = unresolved.';

-- verify: expect the constraint definition to list parser/user/ai
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conname = 'deposit_records_issuer_source_chk';


-- ═ BLOCK 2 ═ retype preset channels off the lumped 'card' bucket ════════════
-- Step-2 req. E: delivery apps → 'delivery_app', Alipay/WeChat →
-- 'foreign_pay' (both codes already exist in payment_method_defs, both
-- is_reconciled=true, and the payment_channels_channel_type_fkey accepts
-- them). Only the four preset names are touched, and only while they still
-- sit on 'card' — user-created channels with other names are not guessed at.
-- History is safe: reconciliation rows reference channels by id, and the
-- unified engine matches these channels through their per-channel rules
-- (fee/settlement unchanged) — they simply stop being lumped as card.

update public.payment_channels
   set channel_type = 'delivery_app'
 where channel_type = 'card'
   and name in ('배달의민족', '쿠팡이츠');

update public.payment_channels
   set channel_type = 'foreign_pay'
 where channel_type = 'card'
   and name in ('알리페이', '위챗페이');

-- verify: preset-named channels now carry their first-class types
select name, channel_type, count(*) as channels
from public.payment_channels
where name in ('배달의민족', '쿠팡이츠', '알리페이', '위챗페이')
group by name, channel_type
order by name;


-- ═ BLOCK 3 ═ reconciliation_match_proposals — AI proposes, owner confirms ═══
-- An AI-inferred match is a PROPOSAL row, never a reconciliation. The owner
-- approves (→ proposals-db creates the reconciliation, source='ai_confirmed'),
-- rejects (stored as learning for the next inference round), or the
-- deterministic engine supersedes it by matching the rows first.

create table if not exists public.reconciliation_match_proposals (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  deposit_record_id  uuid not null references public.deposit_records(id) on delete cascade,
  issuer_id          uuid references public.card_issuers(id) on delete set null,
  method_code        text references public.payment_method_defs(code),
  -- The sale set the models converged on (uuid[] — matches are only created
  -- on approval, so no join table until then).
  proposed_sale_ids  uuid[] not null,
  -- What the owner actually confirmed; differs from proposed when edited.
  approved_sale_ids  uuid[],
  expected_net_total numeric(14,2),
  deposit_amount     numeric(14,2) not null,
  -- expected_net_total − deposit_amount at proposal time (signed).
  residual_won       numeric(14,2),
  confidence         text not null check (confidence in ('low','medium','high')),
  -- "3/3" = models proposing the winning set / models that responded.
  agreement          text,
  -- Every model's independent vote: [{model, sale_ids, confidence, reasoning}].
  per_model          jsonb,
  reasoning          text,
  status             text not null default 'pending'
                     check (status in ('pending','approved','rejected','superseded')),
  correction_note    text,
  reconciliation_id  uuid references public.reconciliations(id) on delete set null,
  created_at         timestamptz not null default now(),
  decided_at         timestamptz
);

comment on table public.reconciliation_match_proposals is
  'AI-inferred match proposals (multi-model, bounded candidate sets). NEVER auto-committed: the owner approves → reconciliation (source=ai_confirmed), rejects → learning data, or the deterministic engine supersedes. Decided rows (rejections, approve-with-edit) are shown to the next inference round as owner corrections.';

comment on column public.reconciliation_match_proposals.residual_won is
  'expected_net_total − deposit_amount at proposal time. Large residuals demote confidence in the engine; the authoritative recompute happens at approval.';

-- One PENDING proposal per deposit (a decided one may be replaced by a new
-- run). Partial index — decided history stays unlimited.
create unique index if not exists match_proposals_pending_deposit_uniq
  on public.reconciliation_match_proposals (deposit_record_id)
  where status = 'pending';

create index if not exists match_proposals_user_status_idx
  on public.reconciliation_match_proposals (user_id, status, created_at desc);

alter table public.reconciliation_match_proposals enable row level security;

drop policy if exists "own_match_proposals" on public.reconciliation_match_proposals;
create policy "own_match_proposals" on public.reconciliation_match_proposals
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- verify: table + the partial unique index exist
select indexname, indexdef
from pg_indexes
where tablename = 'reconciliation_match_proposals'
order by indexname;


-- ═ BLOCK 4 ═ reconciliations.source — which path produced each result ═══════
-- 'deterministic' (engine certainty) vs 'ai_confirmed' (owner-approved AI
-- proposal). Default backfills existing rows as deterministic — every
-- pre-redesign row was rule-produced. Req. 4: "report clearly which results
-- came from which path" — this is that, queryable.

alter table public.reconciliations
  add column if not exists source text not null default 'deterministic';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reconciliations_source_chk'
  ) then
    alter table public.reconciliations
      add constraint reconciliations_source_chk
      check (source in ('deterministic', 'ai_confirmed'));
  end if;
end $$;

comment on column public.reconciliations.source is
  'deterministic = engine-certain match/flag. ai_confirmed = AI proposal the OWNER approved (see reconciliation_match_proposals.reconciliation_id). AI output is never committed without the owner.';

-- verify: column present with the CHECK
select column_name, column_default, is_nullable
from information_schema.columns
where table_name = 'reconciliations' and column_name = 'source';
