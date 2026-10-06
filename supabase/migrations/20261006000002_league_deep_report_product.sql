-- Allow the merged premium product on league_deep_runs.
-- Existing open/debate rows stay readable. New purchases use product = 'report'.

alter table public.league_deep_runs drop constraint if exists league_deep_runs_product_check;

alter table public.league_deep_runs
  add constraint league_deep_runs_product_check
  check (product in ('open', 'debate', 'report'));

comment on constraint league_deep_runs_product_check on public.league_deep_runs is
  'open and debate are legacy. report is AI 심층 리포트 (100 credits).';
