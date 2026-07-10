-- 이야기(TALE) content cache for Jeju resident senior mode.
--
-- INDEPENDENT of public.care_tale — the care app (동반자) and Jeju resident
-- (AX 제주) must never share this cache. Same shape, separate table.
--
-- Five AI-generated, listen-first content kinds, each generated ONCE per day:
--   life      = 인생 이야기
--   health    = 오늘의 건강 이야기
--   reminisce = 그 시절 회상
--   wisdom    = 오늘의 좋은 말
--   jeju      = 제주 이야기 (설화·역사·삶 — Perplexity-grounded)
--
-- `day`   = 'YYYY-MM-DD-{kind}' (KST), unique — one row per kind per day.
-- `items` = the generated items array (shape varies per kind; see route.ts).
create table if not exists public.jeju_resident_tale (
  id uuid primary key default gen_random_uuid(),
  day text not null,
  kind text not null,
  generated_at timestamptz not null default now(),
  items jsonb not null default '[]'::jsonb,
  unique (day)
);

create index if not exists jeju_resident_tale_day_idx on public.jeju_resident_tale (day);

-- RLS: non-sensitive daily content.
--   - public READ (anon + authenticated)
--   - WRITES via service-role (supabaseAdmin) in the API route
alter table public.jeju_resident_tale enable row level security;

drop policy if exists "jeju_resident_tale public read" on public.jeju_resident_tale;
create policy "jeju_resident_tale public read"
  on public.jeju_resident_tale
  for select
  using (true);

drop policy if exists "jeju_resident_tale service write" on public.jeju_resident_tale;
create policy "jeju_resident_tale service write"
  on public.jeju_resident_tale
  for all
  to service_role
  using (true)
  with check (true);
