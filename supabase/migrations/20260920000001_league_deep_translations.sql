-- ============================================================================
-- AI Prediction League — DEEP-ANALYSIS TRANSLATION CACHE.
--
-- View-time only. One row per (run, part, locale). Generation never writes
-- here — a finished English run is translated when a non-en/pt viewer opens it.
-- source_hash is of the English original so a rewritten brief is retranslated
-- and a cache hit is never sent back to the model.
-- ============================================================================

create table if not exists public.league_deep_translations (
  run_id          uuid not null references public.league_deep_runs(id) on delete cascade,
  part_key        text not null,
  locale          text not null,
  translated_text text not null,
  source_hash     text not null,
  created_at      timestamptz not null default now(),
  primary key (run_id, part_key, locale)
);

create index if not exists league_deep_translations_locale_idx
  on public.league_deep_translations (locale);

alter table public.league_deep_translations enable row level security;

drop policy if exists "league_deep_translations service only" on public.league_deep_translations;
create policy "league_deep_translations service only"
  on public.league_deep_translations
  for all
  using (false)
  with check (false);

comment on table public.league_deep_translations is
  'Cached view-time translations of league deep-analysis briefing/analyst/synthesis prose, keyed by (run_id, part_key, locale).';
