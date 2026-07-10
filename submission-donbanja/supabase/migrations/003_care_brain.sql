-- 오늘의 뇌 운동 (brain) cache for the 동반자 (care) app.
--
-- Used by: app/api/care/brain/route.ts
--
-- Cache key is `YYYY-MM-DD-<level>` in `day`, so each difficulty level
-- (easy | normal | hard) caches independently.
--
-- `questions` = BrainQuestion[] jsonb (domain, question, choices, answerIndex,
-- explanation, optional memoryPrep — see route.ts).

create table if not exists public.care_brain (
  id uuid primary key default gen_random_uuid(),
  day text not null,
  questions jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  unique (day)
);

create index if not exists care_brain_day_idx on public.care_brain (day);

alter table public.care_brain enable row level security;

drop policy if exists "care_brain public read" on public.care_brain;
create policy "care_brain public read"
  on public.care_brain
  for select
  using (true);

drop policy if exists "care_brain service write" on public.care_brain;
create policy "care_brain service write"
  on public.care_brain
  for all
  to service_role
  using (true)
  with check (true);
