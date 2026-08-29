-- Contract-neutral side tokens in the prediction ledger (2026-08-29).
--
-- The answer contract moved behind proposition_kind (lib/league/answer-contract.ts):
-- three contracts cover all chips — binary_close_higher (up|down),
-- binary_subject_outcome (yes|no about a NAMED subject), binary_threshold
-- (above|below). This migration makes a non-price answer STORABLE and
-- GRADEABLE; render surfaces / i18n are deliberately NOT part of this pass.
--
-- ORDER MATTERS — WRITERS BEFORE CONSTRAINTS. Every change below is a
-- WIDENING: the current writers (orchestrator upserts up/down/null, grading
-- writes is_correct, consensus writes up/down) satisfy every new constraint,
-- so this schema can be applied before, with, or after the code deploy
-- without a single INSERT failing mid-run. (The 2026-08-24 incident was the
-- reverse: a constraint that rejected what the writers still produced.)
--
-- THE TWO-ANSWERS LAW: 'flat' is deliberately ABSENT from the widened
-- direction CHECK — every proposition has exactly two answers; flat/abstain
-- is rejected at parse (contract validate, one-retry-then-error) and stored
-- as NULL. Production history holds exactly ONE 'flat' row (early ledger,
-- pre-two-answers hardening; counted 2026-08-29: 129 up / 27 down / 3 null /
-- 1 flat). The ledger is immutable, so that row is not rewritten — the CHECK
-- is added NOT VALID: it binds every future INSERT and UPDATE while
-- grandfathering the historical row. Do not VALIDATE this constraint; it
-- would fail on that row by design.
--
-- MAGNITUDE SIGN CHECK: rescoped by side token instead of dropped. The sign
-- rule is close_higher semantics, and the side vocabularies are disjoint by
-- design (up/down ⟂ yes/no ⟂ above/below), so scoping by token IS scoping by
-- kind — expressible in a single-row CHECK without a cross-table trigger.
-- Dropping it entirely would weaken the 2026-08-24 defense-in-depth for the
-- exact path it was built to protect; app-side validateMagnitude remains the
-- primary gate.
--
-- Verify AFTER applying with pg catalogs (NOT PostgREST):
--
--   select conname, pg_get_constraintdef(oid), convalidated
--     from pg_constraint
--    where conrelid in ('public.model_predictions'::regclass,
--                       'public.prediction_rounds'::regclass)
--      and contype = 'c'
--    order by conname;
--
--   select table_name, column_name, data_type, column_default
--     from information_schema.columns
--    where table_schema = 'public'
--      and ((table_name = 'prediction_rounds'
--            and column_name in ('proposition_kind', 'subject_label'))
--        or (table_name = 'model_predictions'
--            and column_name = 'predicted_qualifier_text'));

-- ── 1. model_predictions: contract-neutral side tokens ─────────────────────

alter table public.model_predictions
  drop constraint if exists model_predictions_direction_chk;

alter table public.model_predictions
  add constraint model_predictions_direction_chk
  check (
    predicted_direction is null
    or predicted_direction in ('up', 'down', 'yes', 'no', 'above', 'below')
  ) not valid;

comment on column public.model_predictions.predicted_direction is
  'Contract-neutral side token: up|down (binary_close_higher), yes|no (binary_subject_outcome), above|below (binary_threshold); null for no-answer rows. Rendering words come from the round''s (proposition_kind, subject_label, side) — never from this token alone. flat is not writable (two-answers law; CHECK is NOT VALID only to grandfather one pre-hardening row).';

-- ── 2. model_predictions: display-only text qualifier ──────────────────────

alter table public.model_predictions
  add column if not exists predicted_qualifier_text text;

alter table public.model_predictions
  drop constraint if exists model_predictions_qualifier_text_len_chk;

alter table public.model_predictions
  add constraint model_predictions_qualifier_text_len_chk
  check (
    predicted_qualifier_text is null
    or char_length(predicted_qualifier_text) <= 80
  );

comment on column public.model_predictions.predicted_qualifier_text is
  'Display-only qualifier for non-numeric contracts: predicted scoreline "2-1", vote margin "5.2%p", predicted print. Required at parse for subject/threshold contracts, stored here verbatim. NEVER read by grading (is_correct) or any hit/win-rate calculation — same law as predicted_magnitude_pct, which stays the close_higher-only signed percent.';

-- ── 3. model_predictions: magnitude sign CHECK rescoped by side token ──────

alter table public.model_predictions
  drop constraint if exists model_predictions_magnitude_sign_chk;

alter table public.model_predictions
  add constraint model_predictions_magnitude_sign_chk
  check (
    predicted_magnitude_pct is null
    or predicted_direction is null
    or (predicted_direction = 'up' and predicted_magnitude_pct >= 0)
    or (predicted_direction = 'down' and predicted_magnitude_pct <= 0)
    or predicted_direction not in ('up', 'down', 'flat')
  );

-- ── 4. prediction_rounds: the round carries its contract kind + subject ────

alter table public.prediction_rounds
  add column if not exists proposition_kind text not null default 'binary_close_higher',
  add column if not exists subject_label text;

alter table public.prediction_rounds
  drop constraint if exists prediction_rounds_proposition_kind_chk;

alter table public.prediction_rounds
  add constraint prediction_rounds_proposition_kind_chk
  check (proposition_kind in ('binary_close_higher', 'binary_subject_outcome', 'binary_threshold'));

comment on column public.prediction_rounds.proposition_kind is
  'Which answer contract this round runs under (lib/league/answer-contract.ts). Every existing round is binary_close_higher (the default). Grading maps the resolution''s binary outcome onto the contract''s side pair via this column.';

comment on column public.prediction_rounds.subject_label is
  'Display name of the NAMED subject for binary_subject_outcome rounds ("Manchester United", "Candidate A") so any surface renders words from (kind, subject, side) rather than from the stored token. Null for price/threshold rounds.';

-- ── 5. prediction_rounds: consensus columns take the same side tokens ──────

alter table public.prediction_rounds
  drop constraint if exists prediction_rounds_consensus_majority_direction_chk;

alter table public.prediction_rounds
  add constraint prediction_rounds_consensus_majority_direction_chk
  check (
    consensus_majority_direction is null
    or consensus_majority_direction in ('up', 'down', 'yes', 'no', 'above', 'below')
  );

alter table public.prediction_rounds
  drop constraint if exists prediction_rounds_consensus_aggregate_direction_chk;

alter table public.prediction_rounds
  add constraint prediction_rounds_consensus_aggregate_direction_chk
  check (
    consensus_aggregate_direction is null
    or consensus_aggregate_direction in ('up', 'down', 'yes', 'no', 'above', 'below')
  );
