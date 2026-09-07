-- ============================================================================
-- AI Prediction League — operator grade EVIDENCE (ADDITIVE).
--
-- WHY: non-price categories have no automated result source. The operator
-- supplies a published URL and the observed fact; the PROGRAM maps that fact
-- onto the round's side pair and writes actual_outcome. This table is the
-- evidence, not the outcome. prediction_rounds.actual_outcome stays the
-- derived result. Price-round SELECT lists (ROUND_COLUMNS, card.ts) are
-- untouched so the twelve_data path stays byte-identical.
--
-- WRITE-ONCE: round_id is the primary key (same law as saveGraded).
-- Permanent fallback after official APIs land — historical operator evidence
-- remains inspectable.
--
-- Verify AFTER applying with information_schema / pg_constraint (NOT PostgREST):
--
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'prediction_round_grade_evidence'
--    order by ordinal_position;
--
--   select conname, pg_get_constraintdef(oid), convalidated
--     from pg_constraint
--    where conrelid = 'public.prediction_round_grade_evidence'::regclass
--    order by conname;
-- ============================================================================

create table if not exists public.prediction_round_grade_evidence (
  round_id        uuid primary key
                  references public.prediction_rounds(id) on delete cascade,
  source_url      text not null,
  observed_fact   text not null,
  derived_side    text not null,
  graded_by       uuid not null,
  graded_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),

  constraint grade_evidence_source_url_chk
    check (source_url ~ '^https://'),
  constraint grade_evidence_observed_fact_chk
    check (char_length(btrim(observed_fact)) between 1 and 500),
  constraint grade_evidence_derived_side_chk
    check (derived_side in ('up','down','yes','no','above','below'))
);

comment on table public.prediction_round_grade_evidence is
  'Operator-supplied EVIDENCE for a manual grade. The operator stores a published URL and the observed fact; derived_side is written by the program from the round side pair — never typed by the operator. Write-once (PK = round_id). Permanent fallback after API grade sources land.';

comment on column public.prediction_round_grade_evidence.source_url is
  'https URL of the published source the fact was read from. Required; the operator form cannot submit without one.';

comment on column public.prediction_round_grade_evidence.observed_fact is
  'The published observation (winner name, official print, final scoreline as printed) — not a side token and not "correct/incorrect".';

comment on column public.prediction_round_grade_evidence.derived_side is
  'Program-written side token after mapping observed_fact onto the round side pair.';

comment on column public.prediction_round_grade_evidence.graded_by is
  'Admin user id who submitted the evidence. No auth.users FK (same isolation as other league operator stamps).';

alter table public.prediction_round_grade_evidence enable row level security;

drop policy if exists "prediction_round_grade_evidence service only"
  on public.prediction_round_grade_evidence;
create policy "prediction_round_grade_evidence service only"
  on public.prediction_round_grade_evidence
  for all
  to service_role
  using (true)
  with check (true);
