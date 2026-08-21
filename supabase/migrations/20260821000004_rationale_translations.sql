-- ============================================================================
-- AI Prediction League — RATIONALE TRANSLATION CACHE.
--
-- View-time only. One row per (prediction, locale). Generation never writes
-- here — a round is not charged for languages nobody opens.
-- ============================================================================

create table if not exists public.prediction_rationale_translations (
  prediction_id   uuid not null references public.model_predictions(id) on delete cascade,
  locale          text not null,
  translated_text text not null,
  source_hash     text not null,
  created_at      timestamptz not null default now(),
  primary key (prediction_id, locale)
);

create index if not exists prediction_rationale_translations_locale_idx
  on public.prediction_rationale_translations (locale);

alter table public.prediction_rationale_translations enable row level security;

drop policy if exists "prediction_rationale_translations service only" on public.prediction_rationale_translations;
create policy "prediction_rationale_translations service only"
  on public.prediction_rationale_translations
  for all
  using (false)
  with check (false);

comment on table public.prediction_rationale_translations is
  'Cached view-time translations of model_predictions.reasoning_snippet, keyed by (prediction_id, locale). source_hash is of the English original so a changed snippet is retranslated.';
