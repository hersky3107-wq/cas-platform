-- Pre-launch test rounds stay off the public track record.
-- Apply this file in the SQL editor. New rounds default to false.

alter table public.prediction_rounds
  add column if not exists is_test boolean not null default false;

comment on column public.prediction_rounds.is_test is
  'True for pre-launch / operator test rounds. Hidden from public lists; admin pages show a 테스트 badge.';

create index if not exists prediction_rounds_public_track_idx
  on public.prediction_rounds (created_at desc)
  where is_test = false;
