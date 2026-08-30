-- ============================================================================
-- 대사기 — advisory discrepancy explanation on reconciliations (ADDITIVE).
--
-- Stores a single-AI ESTIMATE of why an amount_mismatch exists
-- ({estimated_cause, confidence, reasoning}). The column is nullable jsonb
-- and does NOT participate in matching. Matcher status stays
-- amount_mismatch until a human confirms — this value is never an
-- auto-accept.
--
-- Idempotent. Only touches public.reconciliations.
-- Paste in the Supabase SQL Editor (do not supabase db push).
-- ============================================================================

alter table public.reconciliations
  add column if not exists discrepancy_advisory jsonb;

comment on column public.reconciliations.discrepancy_advisory is
  'Advisory-only AI estimate of an amount_mismatch cause. Does not change status. Shape: {estimated_cause, confidence (low|medium|high), reasoning}.';
