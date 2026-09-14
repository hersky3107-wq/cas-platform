-- ============================================================================
-- AI Prediction League — cron-driven round generation jobs + durable gateway
-- receipts.
--
-- WHY (jobs): a 41-model round takes 186-271s; generate-stream is capped at
-- 180s on Vercel, so paid rounds die mid-roster, credits are not refunded,
-- and the locked button makes a retry charge again. Generation moves to the
-- oracle runner pattern (lib/oracle/runner): atomic lease claim via a
-- conditional UPDATE on (attempt_count, lease_until), 20s heartbeats,
-- per-unit persistence, and an attempt cap that fails-and-refunds.
--
-- Job control mirrors public.oracle_job_sessions (20260815000001).
-- Money fields mirror public.league_deep_runs (20260818000003) because the
-- refund path reuses the deep-analysis refund flow.
--
-- Deliberate deviations from the oracle schema:
--   - no progress jsonb: resume state is derived from which model_ids already
--     have rows in model_predictions (unique on round_id, model_id).
--   - stage has NO check constraint: oracle's next_action CHECK predated its
--     runner and forced 'consensus' to double as 'finalize'. App-validated.
--   - no 'partial' status: a model that times out gets a null-direction row
--     (결번) and the round still completes as 'done'.
--   - user_id is nullable: system/cron-enqueued population has no payer.
--   - one ACTIVE job per round (partial unique): model_predictions rows are
--     shared per (round_id, model_id); two live jobs would fight over them.
--
-- WHY (receipts): the gateway charge receipt lives in an in-process Map
-- (lib/league/gateway/charge-receipt.ts). On serverless the gateway and the
-- generate call can land on different isolates, the lookup misses, and the
-- user is charged TWICE. The receipt moves here; consume is a single
-- conditional UPDATE (consumed_at is null and expires_at > now()) so it is
-- exactly-once across isolates. Same 5-minute TTL, one consume.
--
-- Service-role only. RLS on, no policies.
-- ============================================================================

-- ── 1. league_generation_jobs ───────────────────────────────────────────────
create table if not exists public.league_generation_jobs (
  id                 uuid primary key default gen_random_uuid(),
  round_id           uuid not null references public.prediction_rounds(id) on delete cascade,
  -- The payer (refund target). NULL for system/cron-enqueued population.
  user_id            uuid references auth.users(id) on delete cascade,
  status             text not null default 'queued',
  -- packet → premier → challenger → world → scout → finalize → done.
  -- No CHECK on purpose (see header).
  stage              text not null default 'packet',
  locale             text not null default 'ko',

  -- Money (shape of league_deep_runs; read by the shared refund path).
  charged            boolean not null default false,
  charged_cost       integer not null default 0,
  deduct_skipped     boolean not null default false,
  refunded           boolean not null default false,

  -- Job control (shape of oracle_job_sessions).
  attempt_count      integer not null default 0,
  lease_until        timestamptz,
  last_heartbeat_at  timestamptz,
  last_error         text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  completed_at       timestamptz,

  constraint league_generation_jobs_status_chk
    check (status in ('queued', 'running', 'done', 'failed'))
);

-- One active job per round: two concurrent jobs would upsert over the same
-- (round_id, model_id) rows. A press while a job is active returns the
-- active job instead of charging again.
create unique index if not exists league_generation_jobs_active_round_uniq
  on public.league_generation_jobs (round_id)
  where status in ('queued', 'running');

-- Cron sweep: claim queued / stale-lease jobs (mirrors
-- oracle_job_sessions_status_heartbeat_idx).
create index if not exists league_generation_jobs_status_heartbeat_idx
  on public.league_generation_jobs (status, last_heartbeat_at);

create index if not exists league_generation_jobs_user_created_idx
  on public.league_generation_jobs (user_id, created_at desc);

alter table public.league_generation_jobs enable row level security;

comment on table public.league_generation_jobs is
  'Cron-driven league round generation jobs (oracle runner pattern). One active job per round. Money fields mirror league_deep_runs; refund path is shared. Service-role only.';

-- ── 2. league_gateway_receipts ──────────────────────────────────────────────
create table if not exists public.league_gateway_receipts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  instrument   text not null,
  horizon      text not null,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- GC by TTL (mirrors league_gateway_normalize_cache_exp_idx).
create index if not exists league_gateway_receipts_exp_idx
  on public.league_gateway_receipts (expires_at);

alter table public.league_gateway_receipts enable row level security;

comment on table public.league_gateway_receipts is
  'Durable one-consume gateway charge receipts (5-min TTL). Replaces the in-process Map that double-charged across serverless isolates. Consume = conditional UPDATE where consumed_at is null. Service-role only.';
