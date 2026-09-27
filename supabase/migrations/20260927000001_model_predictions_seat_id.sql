-- ============================================================================
-- AI Prediction League — SEAT-BASED TRACK RECORD CONTINUITY (ADDITIVE).
--
-- Adds seat_id to public.model_predictions to decouple the fixed competitive
-- roster slot (e.g. premier:openai, world:thinking-machines) from the specific
-- model that occupies it over time.
--
-- Enables:
--  1. Track-record continuity across model swaps (official seat ranking)
--  2. Individual model benchmark preservation (pure model specs)
--  3. Retired model archive (historical tenures)
-- ============================================================================

alter table public.model_predictions
  add column if not exists seat_id text;

-- Fast lookup by seat across rounds (official seat leaderboard & streaks)
create index if not exists model_predictions_seat_round_idx
  on public.model_predictions (seat_id, round_id);

-- Backfill known retired tenures to preserve seat continuity across swaps:
-- 1. LG EXAONE -> Thinking Machines Inkling (World)
update public.model_predictions
   set seat_id = 'world:thinking-machines'
 where model_id in ('k-exaone-2.0', 'inkling')
   and seat_id is null;

-- 2. Moonshot AI kimi-k2.6 -> Tencent Hunyuan 3 (Challenger)
update public.model_predictions
   set seat_id = 'challenger:tencent'
 where model_id in ('kimi-k2.6', 'hunyuan-3')
   and seat_id is null;

-- 3. DeepSeek v3.2 -> DeepSeek Flash first-party (Challenger)
update public.model_predictions
   set seat_id = 'challenger:deepseek'
 where model_id in ('deepseek-v3.2', 'deepseek-flash')
   and seat_id is null;

-- 4. Qwen qwen3.5-plus -> Meta Llama 4 Maverick (Challenger)
update public.model_predictions
   set seat_id = 'challenger:meta'
 where model_id in ('qwen3.5-plus', 'llama-4-maverick')
   and league_tier = 'challenger'
   and seat_id is null;

-- 5. Baidu ERNIE -> Google Gemma 4 31B (World)
update public.model_predictions
   set seat_id = 'world:google-gemma'
 where model_id in ('ernie-4.5-vl', 'ernie-4.5', 'gemma-4-31b-it')
   and seat_id is null;

-- 6. IBM Granite -> Mistral Small (World)
update public.model_predictions
   set seat_id = 'world:mistral'
 where model_id in ('granite-4.2-8b', 'mistral-small-3.2-24b')
   and seat_id is null;

-- 7. Extra seats
update public.model_predictions
   set seat_id = 'extra:' || model_id
 where league_tier = 'extra'
   and seat_id is null;

-- 8. General default backfill for all other rows: league_tier || ':' || lower(brand-slug)
update public.model_predictions
   set seat_id = league_tier || ':' || btrim(lower(regexp_replace(brand, '[^a-zA-Z0-9]+', '-', 'g')), '-')
 where seat_id is null;

comment on column public.model_predictions.seat_id is
  'The roster seat slot identifier (e.g. premier:openai, world:thinking-machines). Decoupled from model_id for track-record continuity across model version swaps.';
