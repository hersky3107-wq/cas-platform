-- Program-computed lesson notes for the 복기 extra seat.
-- Manual apply. RLS on, no policies (service role only).

create table if not exists public.league_lesson_notes (
  category text not null,
  horizon text not null,
  scope text not null check (scope in ('category', 'global')),
  stats jsonb not null default '{}'::jsonb,
  note_text_ko text,
  note_text_en text,
  n_rounds int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (category, horizon, scope)
);

alter table public.league_lesson_notes enable row level security;

alter table public.model_predictions
  add column if not exists applied_lesson text;
