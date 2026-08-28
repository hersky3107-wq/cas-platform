-- Visible reasoning block (v2 output contract): closed-book models must emit a
-- four-line reasoning block (CHAIN / EVIDENCE / BASE RATE / COUNTER) before
-- their answer JSON. This column stores that pre-JSON text verbatim (fences
-- stripped, capped at 4000 chars by the orchestrator).
--
-- reasoning_snippet is NOT repurposed: it stays the one-line display rationale
-- shown on card tiles and keyed by rationale_translations. reasoning_text is
-- the raw material for reasoning-quality surfaces (허풍 랭킹, 근거 카드) and is
-- never read by grading.
alter table public.model_predictions
  add column if not exists reasoning_text text;

comment on column public.model_predictions.reasoning_text is
  'Verbatim pre-JSON visible reasoning block (CHAIN/EVIDENCE/BASE RATE/COUNTER), capped at 4000 chars by the orchestrator. Null for error rows and legacy JSON-only outputs. Display rationale stays in reasoning_snippet.';
