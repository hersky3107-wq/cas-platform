-- 이야기(TALE) content cache for the 동반자 (care) app.
--
-- Four AI-generated, listen-first content kinds, each generated ONCE per day:
--   life      = 인생 이야기
--   health    = 오늘의 건강 이야기
--   reminisce = 그 시절 회상
--   wisdom    = 오늘의 좋은 말
--
-- Used by: app/api/care/tale/route.ts
--
-- `day`   = 'YYYY-MM-DD-{kind}' (KST), unique — one row per kind per day.
-- `items` = generated items array (shape varies per kind; see route.ts).

create table if not exists public.care_tale (
  id uuid primary key default gen_random_uuid(),
  day text not null,
  kind text not null,
  generated_at timestamptz not null default now(),
  items jsonb not null default '[]'::jsonb,
  unique (day)
);

create index if not exists care_tale_day_idx on public.care_tale (day);

alter table public.care_tale enable row level security;

drop policy if exists "care_tale public read" on public.care_tale;
create policy "care_tale public read"
  on public.care_tale
  for select
  using (true);

drop policy if exists "care_tale service write" on public.care_tale;
create policy "care_tale service write"
  on public.care_tale
  for all
  to service_role
  using (true)
  with check (true);
