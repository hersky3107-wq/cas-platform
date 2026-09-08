-- 오늘의 운세: per-user daily cache + reader_count=1 (one AI, not a panel).
--
-- oracle_daily_cache was created global-by-date and never written. A personal
-- natal daily cannot live in a row every authenticated user can SELECT.
-- Recreate as (user_id, civil date). The original table is unused in app code.

alter table public.oracle_job_sessions
  drop constraint if exists oracle_job_sessions_reader_count_chk;

alter table public.oracle_job_sessions
  add constraint oracle_job_sessions_reader_count_chk
    check (reader_count in (1, 3, 5, 7, 9));

drop policy if exists "oracle_daily_cache_select_authenticated" on public.oracle_daily_cache;
drop policy if exists "oracle_daily_cache_service_write" on public.oracle_daily_cache;
drop policy if exists "own_oracle_daily_cache" on public.oracle_daily_cache;

drop table if exists public.oracle_daily_cache;

create table public.oracle_daily_cache (
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null,
  values      jsonb not null default '{}'::jsonb,
  session_id  uuid references public.oracle_job_sessions(id) on delete set null,
  computed_at timestamptz not null default now(),
  primary key (user_id, date)
);

comment on table public.oracle_daily_cache is
  'Per-user 오늘의 운세. One row per (user_id, civil date in the subject timezone). Written by the runner on first successful read; reused on re-open.';

alter table public.oracle_daily_cache enable row level security;

create policy "own_oracle_daily_cache" on public.oracle_daily_cache
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists oracle_daily_cache_session_id_idx
  on public.oracle_daily_cache (session_id)
  where session_id is not null;
