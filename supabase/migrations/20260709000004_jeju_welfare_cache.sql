-- Daily cache for the 도민(resident) 복지·행정 (welfare) chip.
--
-- Two payload kinds share this table via the cache_date TEXT key:
--   * main GET (deadline-soon)  → key = 'YYYY-MM-DD'
--   * guide per topic           → key = 'YYYY-MM-DD:guide:<topic>'
-- The user-specific POST /match is NEVER cached.
--
-- payload = full WelfarePayload / GuideResult jsonb.
--
-- Access is server-only via supabaseAdmin (service role), which bypasses RLS.
-- Enable RLS so anon / authenticated clients cannot read or write cache rows
-- (default deny). Explicit service_role policy documents intent — mirrors
-- public.jeju_news_cache / jeju_events_cache.
--
-- NOTE: cache_date is TEXT (not date) because guide keys carry a topic suffix.

create table if not exists public.jeju_welfare_cache (
  cache_date text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists jeju_welfare_cache_created_at_idx
  on public.jeju_welfare_cache (created_at);

alter table public.jeju_welfare_cache enable row level security;

drop policy if exists "jeju_welfare_cache service only" on public.jeju_welfare_cache;
create policy "jeju_welfare_cache service only"
  on public.jeju_welfare_cache
  for all
  to service_role
  using (true)
  with check (true);
