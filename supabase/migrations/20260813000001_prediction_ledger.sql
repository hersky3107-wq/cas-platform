-- ============================================================================
-- AIMANI AI Prediction League — prediction ledger (greenfield, ADDITIVE).
--
-- SUPERSEDES the earlier single-table `model_predictions` draft: this is a
-- normalized TWO-table design — one shared proposition per question
-- (prediction_rounds) and one row per model per question (model_predictions).
--
-- ISOLATION INVARIANT: this system is fully parallel to Verdict Predict. It
-- does NOT read, write, or reference the generic session tables (sessions,
-- scores, session_participants, ai_responses, session_results). Dropping these
-- two tables leaves every existing mode byte-for-byte identical.
--
-- Access is server-only via the service-role client (supabaseAdmin), which
-- bypasses RLS. RLS is enabled with an explicit service_role-only policy so
-- anon/authenticated clients can neither read nor write (default deny).
-- Population is done later by an engine-layer generation job that does not
-- exist yet; there is intentionally NO user-facing insert path.
-- ============================================================================

-- ── TABLE 1: prediction_rounds (the shared proposition, one row per question) ──
create table if not exists public.prediction_rounds (
  id                    uuid primary key default gen_random_uuid(),
  -- FK target (a seasons table) does not exist yet — column only, no constraint.
  season_id             uuid,
  -- Identical-conditions cache key: a repeated question under the same
  -- conditions reuses the round ("cache hit = cost 0").
  cache_key             text unique,
  proposition_text      text not null,
  category              text not null,
  -- Denormalized traffic-light bucket derived from category (green/yellow/red).
  color_bucket          text not null,
  item_type             text not null,
  -- e.g. '005930.KS', 'BTC-USD', 'MATCH:TOT-vs-ARS'.
  instrument            text not null,
  -- e.g. '24h' | '7d' | '1m' (kept as free text so new horizons need no migration).
  horizon               text not null,
  -- Snapshot of how the round is judged, e.g. 'KRX close price'.
  resolution_rule       text not null,
  -- SET EXPLICITLY by the caller: the event datetime for event categories, or
  -- opened_at + horizon for price categories. NOT a generated column.
  resolves_at           timestamptz not null,
  -- on_demand rounds are user-triggered one-offs that never count toward league
  -- scoring; ranked rounds do. Generated so it can never drift from item_type.
  excluded_from_scoring boolean generated always as (item_type = 'on_demand') stored,
  -- Filled by reconciliation: the raw resolved value (price, score, result…).
  actual_outcome        text,
  resolved_at           timestamptz,
  opened_at             timestamptz not null default now(),
  created_at            timestamptz not null default now(),

  constraint prediction_rounds_category_chk check (category in (
    'stock','etf_index','bond_rate','gold_metal','macro_econ',
    'commodity_energy','crypto_spot','fx','futures_derivatives',
    'politics_election','sports','entertainment_awards','memecoin','crypto_perps'
  )),
  constraint prediction_rounds_color_bucket_chk check (color_bucket in ('green','yellow','red')),
  constraint prediction_rounds_item_type_chk check (item_type in ('ranked','on_demand'))
);

-- Fast lookup by category within a season (league boards).
create index if not exists prediction_rounds_category_season_idx
  on public.prediction_rounds (category, season_id);

-- The reconciliation job scans for DUE, UNRESOLVED rounds — a partial index on
-- resolves_at keeps that scan cheap as the resolved history grows.
create index if not exists prediction_rounds_due_idx
  on public.prediction_rounds (resolves_at)
  where actual_outcome is null;

-- ── TABLE 2: model_predictions (one row per model per round) ──────────────────
create table if not exists public.model_predictions (
  id                  uuid primary key default gen_random_uuid(),
  round_id            uuid not null references public.prediction_rounds(id) on delete cascade,
  -- e.g. 'gpt-5.6-sol'.
  model_id            text not null,
  -- e.g. 'OpenAI'.
  brand               text not null,
  -- East/West aggregate axis: 'us' | 'china' | 'other'.
  camp                text not null,
  league_tier         text not null,
  -- 'up' | 'down' | 'flat'; null for non-directional / scout rows.
  predicted_direction text,
  -- Probability 0-100 or a magnitude, depending on the round.
  predicted_value     numeric,
  -- Short rationale / citations (primarily the scout league's scoring axis).
  reasoning_snippet   text,
  -- Filled by reconciliation: predicted_direction vs the round's actual
  -- direction. Stays null for scout (scored on citation accuracy, deferred).
  is_correct          boolean,
  prompt_tokens       integer,
  completion_tokens   integer,
  -- Hidden reasoning tokens — a real cost driver for premier/scout models.
  reasoning_tokens    integer,
  -- Per-prediction cost, for pricing and B2B reporting.
  cost_usd            numeric,
  predicted_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),

  constraint model_predictions_camp_chk check (camp in ('us','china','other')),
  constraint model_predictions_league_tier_chk check (league_tier in ('premier','challenger','world','scout')),
  constraint model_predictions_direction_chk
    check (predicted_direction is null or predicted_direction in ('up','down','flat')),
  constraint model_predictions_round_model_uniq unique (round_id, model_id)
);

create index if not exists model_predictions_model_round_idx
  on public.model_predictions (model_id, round_id);

create index if not exists model_predictions_league_tier_idx
  on public.model_predictions (league_tier);

-- ── RLS: service-role only (default deny for anon/authenticated) ──────────────
alter table public.prediction_rounds enable row level security;
alter table public.model_predictions enable row level security;

drop policy if exists "prediction_rounds service only" on public.prediction_rounds;
create policy "prediction_rounds service only"
  on public.prediction_rounds
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "model_predictions service only" on public.model_predictions;
create policy "model_predictions service only"
  on public.model_predictions
  for all
  to service_role
  using (true)
  with check (true);
