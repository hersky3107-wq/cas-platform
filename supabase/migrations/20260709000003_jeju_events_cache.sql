-- Daily cache for the 도민(resident) 축제·행사 (Jeju events) chip.
-- One merged culture-XML + Perplexity build per KST calendar day; subsequent
-- GETs reuse this row (events change slowly — per-click Perplexity is wasteful).
--
-- cache_date = Asia/Seoul calendar day (YYYY-MM-DD) as the primary key.
-- payload    = full EventsPayload jsonb (groups + contextMeta + errors …).
--
-- Access is server-only via supabaseAdmin (service role), which bypasses RLS.
-- Enable RLS so anon / authenticated clients cannot read or write cache rows
-- (default deny). Explicit service_role policy documents intent — mirrors
-- public.jeju_news_cache / jeju_fishing_jobs.

create table if not exists public.jeju_events_cache (
  cache_date date primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists jeju_events_cache_created_at_idx
  on public.jeju_events_cache (created_at);

alter table public.jeju_events_cache enable row level security;

drop policy if exists "jeju_events_cache service only" on public.jeju_events_cache;
create policy "jeju_events_cache service only"
  on public.jeju_events_cache
  for all
  to service_role
  using (true)
  with check (true);
