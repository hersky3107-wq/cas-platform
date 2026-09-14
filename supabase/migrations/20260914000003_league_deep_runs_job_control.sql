-- ============================================================================
-- AI Prediction League — job-control columns on league_deep_runs.
--
-- WHY: deep-open (50 credits, ~5.2 min / 4 hops) and deep-debate (70 credits,
-- ~6.2 min / 4 hops) are the last paid surface whose refund lives inside the
-- HTTP request. A platform kill mid-hop leaves status='running', busy_until
-- set, and no refund. They move onto the generation runner from 166832c
-- (atomic lease claim, 20s heartbeats, attempt cap that fails-and-refunds).
--
-- Money fields already match league_generation_jobs (charged, charged_cost,
-- deduct_skipped, refunded). Resume state already lives in `state` jsonb.
-- This migration adds ONLY the four job-control columns the runner needs:
--   attempt_count, lease_until, last_heartbeat_at, last_error
--
-- NOT changed on purpose:
--   - status CHECK stays ('running','done','error') — existing rows and
--     decideDeepRunAction depend on 'error', not generation's 'failed'.
--   - busy_until stays. Mid-flight HTTP hops still set it; the runner will
--     stop writing it after wiring. Dropping it here would race a live hop.
--   - no 'queued' status. Deep rows are born 'running' at claim (the
--     2026-08-29 claim → charge → seed order). The sweeper treats
--     status='running' + free lease as claimable, same as a generation
--     job whose lease expired.
--
-- Existing rows get attempt_count=0 and null leases — a mid-flight run
-- becomes claimable by the first sweep after deploy, which resumes from
-- the already-persisted `state` / `stage` and does not re-charge.
--
-- Service-role only. RLS already on. Do not apply until confirmed.
-- ============================================================================

alter table public.league_deep_runs
  add column if not exists attempt_count     integer not null default 0,
  add column if not exists lease_until       timestamptz,
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists last_error        text;

create index if not exists league_deep_runs_status_heartbeat_idx
  on public.league_deep_runs (status, last_heartbeat_at);

comment on column public.league_deep_runs.attempt_count is
  'Fruitless lease claims. Caps at LEAGUE_JOB_MAX_ATTEMPTS then fail-and-refund. Resets when a hop persists progress. Same meaning as league_generation_jobs.attempt_count.';

comment on column public.league_deep_runs.lease_until is
  'Oracle-style exclusive lease. Conditional UPDATE on (attempt_count, lease_until) claims the row. Replaces busy_until for the runner; busy_until is left in place for in-flight HTTP hops.';

comment on column public.league_deep_runs.last_heartbeat_at is
  'Renewed every 20s while a hop is in flight so a live worker is not swept as stale.';

comment on column public.league_deep_runs.last_error is
  'Last hop / seed failure message. Audit only; refund is gated by refunded=false, not by this text.';
