-- GDELT country-pair days and domestic country days.
--
-- DO NOT apply via supabase db push. Paste into the Supabase SQL Editor.
-- Rollback and the ledger insert are in docs/crisis/APPLY_DYADS.md.

create table if not exists public.crisis_dyad_daily (
  actor1_country text not null,
  actor2_country text not null,
  day            date not null,
  stats          jsonb not null,
  primary key (actor1_country, actor2_country, day),
  constraint crisis_dyad_daily_distinct_chk check (actor1_country <> actor2_country)
);

comment on table public.crisis_dyad_daily is
  'Undirected GDELT country pairs (ISO3, actor1 < actor2) for one day. stats holds events, quad classes, conflict_share, averages, mentions, sources, cameo_18_20. Service role only.';

create index if not exists crisis_dyad_daily_day_idx
  on public.crisis_dyad_daily (day);

alter table public.crisis_dyad_daily enable row level security;

grant all on table public.crisis_dyad_daily to service_role;

create table if not exists public.crisis_country_daily (
  country_iso3 text not null,
  day          date not null,
  stats        jsonb not null,
  primary key (country_iso3, day)
);

comment on table public.crisis_country_daily is
  'Domestic GDELT days plus internet, advisory, and wiki mobilization counts. Service role only.';

create index if not exists crisis_country_daily_day_idx
  on public.crisis_country_daily (day);

alter table public.crisis_country_daily enable row level security;

grant all on table public.crisis_country_daily to service_role;
