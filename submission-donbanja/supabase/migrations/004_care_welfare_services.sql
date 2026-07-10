-- 복지·지원금 matching catalog for the 동반자 (care) app.
--
-- Used by: lib/care/welfare.ts (via app/api/care/welfare-match/route.ts)
--
-- Rows are populated by offline batch scripts (not included in this submission)
-- from data.go.kr welfare APIs. The app reads rows where region IN
-- (user's residence slug, 'national') and scores them against a user profile.
--
-- Conflict target (region, source, seq) keeps provincial, central-government,
-- and nationwide local-government sources from colliding.

create table if not exists public.care_welfare_services (
  id bigint generated always as identity primary key,
  region text not null,
  source text not null,
  seq text not null,
  name text,
  support text,
  contents text,
  application text,
  all_loc boolean,
  province_loc boolean,
  seogwipo_loc boolean,
  target text[],
  life_cycle text,
  situation text[],
  min_age integer,
  is_elderly_relevant boolean,
  one_line_summary text,
  eligibility_plain text[],
  benefit_plain text,
  prepare_plain text[],
  apply_where_plain text,
  tagged_at timestamptz,
  unique (region, source, seq)
);

create index if not exists care_welfare_services_region_idx
  on public.care_welfare_services (region);

create index if not exists care_welfare_services_elderly_idx
  on public.care_welfare_services (is_elderly_relevant)
  where is_elderly_relevant = true;

alter table public.care_welfare_services enable row level security;

drop policy if exists "care_welfare_services public read" on public.care_welfare_services;
create policy "care_welfare_services public read"
  on public.care_welfare_services
  for select
  using (true);

drop policy if exists "care_welfare_services service write" on public.care_welfare_services;
create policy "care_welfare_services service write"
  on public.care_welfare_services
  for all
  to service_role
  using (true)
  with check (true);
