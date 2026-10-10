-- CrisisWatch public access: user RLS on the engine queue, plus unlock and refund receipts.
--
-- DO NOT apply via supabase db push. Paste into the Supabase SQL Editor.
-- Rollback and the ledger insert are in docs/crisis/APPLY_PUBLIC.md.

drop policy if exists crisis_engine_requests_user_select on public.crisis_engine_requests;
create policy crisis_engine_requests_user_select on public.crisis_engine_requests
  for select
  to authenticated
  using (requested_by = auth.uid());

drop policy if exists crisis_engine_requests_user_insert on public.crisis_engine_requests;
create policy crisis_engine_requests_user_insert on public.crisis_engine_requests
  for insert
  to authenticated
  with check (
    requested_by = auth.uid()
    and scope = 'region'
    and region_id is not null
    and status = 'queued'
  );

comment on table public.crisis_engine_requests is
  'Engine run queue. Admin may read and enqueue any row. Authenticated users may insert and read their own region-scoped requests.';

create table if not exists public.crisis_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null,
  run_id uuid references public.crisis_engine_runs (id) on delete cascade,
  region_id bigint references public.crisis_regions (id) on delete set null,
  request_id uuid references public.crisis_engine_requests (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint crisis_unlocks_kind_chk check (kind in ('brief', 'deep', 'deep_refund'))
);

comment on table public.crisis_unlocks is
  'Per-user paid unlock and refund receipts. First view charges; later views replay from cache; failures record deep_refund. Service role writes.';

create unique index if not exists crisis_unlocks_brief_unique
  on public.crisis_unlocks (user_id, run_id)
  where kind = 'brief' and run_id is not null;

create unique index if not exists crisis_unlocks_deep_unique
  on public.crisis_unlocks (user_id, region_id)
  where kind = 'deep' and region_id is not null;

create unique index if not exists crisis_unlocks_refund_unique
  on public.crisis_unlocks (request_id)
  where kind = 'deep_refund' and request_id is not null;

alter table public.crisis_unlocks enable row level security;

grant all on table public.crisis_unlocks to service_role;

drop policy if exists crisis_unlocks_user_select on public.crisis_unlocks;
create policy crisis_unlocks_user_select on public.crisis_unlocks
  for select
  to authenticated
  using (user_id = auth.uid());
