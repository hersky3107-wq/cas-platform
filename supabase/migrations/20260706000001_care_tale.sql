-- 이야기(TALE) content cache for the national senior-care app.
--
-- Four AI-generated, listen-first content kinds, each generated ONCE per day by
-- Claude and cached here (same pattern as jeju_resident_news / jeju_resident_brain):
--   life      = 인생 이야기 (short emotional life stories of that generation)
--   health    = 오늘의 건강 이야기 (practical, enjoyable health talk)
--   reminisce = 그 시절 회상 (reminiscence-therapy prompts)
--   wisdom    = 오늘의 좋은 말 (short daily 덕담·지혜·명언)
--
-- `day`   = 'YYYY-MM-DD-{kind}' (KST), unique — one row per kind per day.
-- `items` = the generated items array (shape varies per kind; see route.ts).
create table if not exists public.care_tale (
  id uuid primary key default gen_random_uuid(),
  day text not null,
  kind text not null,
  generated_at timestamptz not null default now(),
  items jsonb not null default '[]'::jsonb,
  unique (day)
);

create index if not exists care_tale_day_idx on public.care_tale (day);

-- RLS: content is non-sensitive daily content.
--   - public READ (anon + authenticated) so the client could read it directly.
--   - WRITES happen only through the service-role client (supabaseAdmin) in the
--     API route, which bypasses RLS; we still add an explicit service_role
--     write policy for clarity.
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
