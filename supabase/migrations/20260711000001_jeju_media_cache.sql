-- Daily cache for the 거버넌스 언론(매스컴) 동향 (Jeju governance media watch) digest.
-- One 10-Perplexity + 1-Anthropic fan-out per KST calendar day (per mode);
-- subsequent callers (including the page's auto-load on mount) reuse this row.
--
-- cache_date = `${KST YYYY-MM-DD}:${mode}` (e.g. '2026-07-11:governance'), so
-- governance and resident digests never collide even though they share the
-- same underlying lib/jeju/mediawatch.ts engine — mirrors jeju_welfare_cache's
-- `YYYY-MM-DD:guide:<topic>` compound-key pattern.
-- payload    = full JejuMediaWatch jsonb (searches + coreIssues/minorIssues/
--              nationalVsLocal/summary + fromCache …).
--
-- Access is server-only via supabaseAdmin (service role), which bypasses RLS.
-- Enable RLS so anon / authenticated clients cannot read or write cache rows
-- (default deny). Explicit service_role policy documents intent — mirrors
-- public.jeju_news_cache / jeju_events_cache / jeju_welfare_cache.

create table if not exists public.jeju_media_cache (
  cache_date text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists jeju_media_cache_created_at_idx
  on public.jeju_media_cache (created_at);

alter table public.jeju_media_cache enable row level security;

drop policy if exists "jeju_media_cache service only" on public.jeju_media_cache;
create policy "jeju_media_cache service only"
  on public.jeju_media_cache
  for all
  to service_role
  using (true)
  with check (true);
