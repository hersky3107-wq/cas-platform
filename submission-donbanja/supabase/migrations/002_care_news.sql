-- 오늘의 소식 (news) cache for the 동반자 (care) app.
--
-- Used by: app/api/care/news/route.ts
--
-- Twice-daily cache keyed by a KST "slot":
--   09:00–17:59  → YYYY-MM-DD-am  (today)
--   18:00–23:59  → YYYY-MM-DD-pm  (today)
--   00:00–08:59  → YYYY-MM-DD-pm  (YESTERDAY — last evening's news carries over)
--
-- The care app appends a region suffix to the slot (e.g. `-110000` for 서울) so
-- each user's residence caches separately.
--
-- Column `region_news` holds regional/local ("우리 지역") news items.

create table if not exists public.care_news (
  id uuid primary key default gen_random_uuid(),
  slot text not null,
  national jsonb not null default '[]'::jsonb,
  region_news jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  unique (slot)
);

create index if not exists care_news_slot_idx on public.care_news (slot);

alter table public.care_news enable row level security;

drop policy if exists "care_news public read" on public.care_news;
create policy "care_news public read"
  on public.care_news
  for select
  using (true);

drop policy if exists "care_news service write" on public.care_news;
create policy "care_news service write"
  on public.care_news
  for all
  to service_role
  using (true)
  with check (true);
