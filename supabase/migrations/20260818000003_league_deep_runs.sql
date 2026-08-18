-- ============================================================================
-- AI Prediction League — durable deep-analysis runs.
--
-- WHY: open (50 credits) and debate (70 credits) are charged up front and
-- take several minutes. Without a durable row keyed by
-- (round_id, product, user_id), a closed tab or a platform timeout is
-- paid-and-lost. This table is the structural fix:
--   - completed result is replayed with no second charge
--   - an in-progress run is resumed (never a second start / second charge)
--   - partial stage state lives in `state` so a killed HTTP request can
--     continue from the last finished stage
--
-- Service-role only. RLS on, no policies. Presentation / commentary store —
-- never written to model_predictions, never graded.
-- ============================================================================

create table if not exists public.league_deep_runs (
  id              uuid primary key default gen_random_uuid(),
  round_id        uuid not null references public.prediction_rounds(id) on delete cascade,
  product         text not null check (product in ('open', 'debate')),
  user_id         uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'running' check (status in ('running', 'done', 'error')),
  stage           text not null default 'start',
  result          jsonb,
  providers       jsonb not null default '[]'::jsonb,
  state           jsonb not null default '{}'::jsonb,
  charged         boolean not null default false,
  charged_cost    integer not null default 0,
  deduct_skipped  boolean not null default false,
  refunded        boolean not null default false,
  billed_usd      numeric not null default 0,
  estimated_usd   numeric not null default 0,
  provider_calls  integer not null default 0,
  busy_until      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (round_id, product, user_id)
);

create index if not exists league_deep_runs_user_created_idx
  on public.league_deep_runs (user_id, created_at desc);

alter table public.league_deep_runs enable row level security;

comment on table public.league_deep_runs is
  'Idempotent league deep-analysis runs. One row per (round, product, user). Service-role only. Not a league score.';
