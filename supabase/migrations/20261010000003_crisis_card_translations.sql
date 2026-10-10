-- CrisisWatch card translations: one cached payload per published card and language.
--
-- DO NOT apply via supabase db push. Paste into the Supabase SQL Editor.
-- Rollback and the ledger insert are in docs/crisis/APPLY_TRANSLATIONS.md.

create table if not exists public.crisis_card_translations (
  card_id uuid not null references public.crisis_engine_runs (id) on delete cascade,
  lang text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (card_id, lang)
);

comment on table public.crisis_card_translations is
  'Cached AI card text per language. Korean is written at publish time; other langs on first view. Evidence link titles stay in the source language and are not stored here.';

create index if not exists crisis_card_translations_lang_idx
  on public.crisis_card_translations (lang, created_at desc);

alter table public.crisis_card_translations enable row level security;

grant all on table public.crisis_card_translations to service_role;

drop policy if exists crisis_card_translations_user_select on public.crisis_card_translations;
create policy crisis_card_translations_user_select on public.crisis_card_translations
  for select
  to authenticated
  using (true);
