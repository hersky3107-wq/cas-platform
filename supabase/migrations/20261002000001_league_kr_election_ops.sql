-- ============================================================================
-- AI Prediction League — KR election operator alerts + manual close switch.
--
-- Run in the Supabase SQL Editor. Do NOT `supabase db push`.
--
-- Alerts (D-14 / D-7 / D-6 / poll close) are idempotent per (election, milestone).
-- The manual close flag is a single row the admin UI toggles without a deploy.
-- Env fallback KR_ELECTION_MANUAL_CLOSE still works if this table is missing.
-- Service-role only (supabaseAdmin). No public policies.
-- ============================================================================

create table if not exists public.league_kr_election_alert_sent (
  election_id text not null,
  milestone text not null,
  sent_at timestamptz not null default now(),
  primary key (election_id, milestone)
);

alter table public.league_kr_election_alert_sent
  drop constraint if exists league_kr_election_alert_sent_milestone_chk;

alter table public.league_kr_election_alert_sent
  add constraint league_kr_election_alert_sent_milestone_chk
  check (milestone in ('d14', 'd7', 'd6', 'poll_close'));

comment on table public.league_kr_election_alert_sent is
  'Idempotency markers for KR election Telegram risk alerts. One row per (calendar raceKey, milestone).';

create table if not exists public.league_kr_election_manual_close (
  id text primary key default 'default',
  value text not null default 'off',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.league_kr_election_manual_close (id, value)
values ('default', 'off')
on conflict (id) do nothing;

comment on table public.league_kr_election_manual_close is
  'Operator switch: off | all_kr | comma-separated KR calendar raceKeys. Closes KR ELECTION instruments for every non-admin viewer.';

alter table public.league_kr_election_alert_sent enable row level security;
alter table public.league_kr_election_manual_close enable row level security;
