-- ============================================================================
-- AI Prediction League — KRX evening refresh log.
--
-- Run in the Supabase SQL Editor. Do NOT `supabase db push`.
--
-- One row per session. The league-generate cron uses last_attempt_at to
-- retry a not-yet-published day at most once per hour between 18:00 and
-- 23:00 KST, and published to skip KRX once flows and daily bars are stored.
--
-- Security: RLS enabled with NO policies — default-deny for anon/authenticated;
-- only the service role (which bypasses RLS) reads/writes this table.
-- ============================================================================

create table if not exists public.league_krx_refresh_log (
  bas_dd date primary key,
  last_attempt_at timestamptz not null,
  published boolean not null default false
);

alter table public.league_krx_refresh_log enable row level security;

comment on table public.league_krx_refresh_log is
  'Evening KRX flows/daily refresh gate. Service-role only. Hourly backoff until published.';
