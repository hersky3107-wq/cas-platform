-- ============================================================================
-- AI Prediction League — LMArena leaderboard snapshots (AI 순위 / 테크).
--
-- Run in the Supabase SQL Editor. Do NOT `supabase db push`.
--
-- Source: Hugging Face lmarena-ai/leaderboard-dataset (license: cc-by-4.0).
-- Attribution for later display: "순위 데이터: LMArena (CC BY 4.0)".
-- Artificial Analysis is not ingested (free API is internal-use; customer-
-- facing ranking / redistribution needs a Commercial order form).
--
-- Security: RLS enabled with NO policies — default-deny for anon/authenticated;
-- only the service role (which bypasses RLS) reads/writes this table.
-- ============================================================================

create table if not exists public.league_ai_leaderboard (
  source text not null,
  arena text not null,
  category text not null,
  publish_date date not null,
  model text not null,
  organization text null,
  brand text null,
  rank int not null,
  score numeric null,
  votes int null,
  fetched_at timestamptz not null default now(),
  primary key (source, arena, category, publish_date, model)
);

create index if not exists league_ai_leaderboard_rank_idx
  on public.league_ai_leaderboard (source, arena, category, publish_date desc, rank);

alter table public.league_ai_leaderboard enable row level security;

comment on table public.league_ai_leaderboard is
  'LMArena (CC BY 4.0) leaderboard snapshots. Service-role only. Upsert key is (source, arena, category, publish_date, model).';
