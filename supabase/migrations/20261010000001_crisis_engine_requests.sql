-- Crisis engine admin run queue.
--
-- DO NOT apply via supabase db push. Paste into the Supabase SQL Editor.
-- Rollback and the ledger insert are in docs/crisis/APPLY_ENGINE_REQUESTS.md.
--
-- crisis_engine_requests is a deletable working table. Admin only.
-- It is not part of the append-only public ledger (crisis_hypotheses).

create table if not exists public.crisis_engine_requests (
  id uuid primary key default gen_random_uuid(),
  region_id bigint references public.crisis_regions (id) on delete set null,
  scope text not null,
  requested_by uuid,
  status text not null default 'queued',
  run_id uuid references public.crisis_engine_runs (id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint crisis_engine_requests_scope_chk check (scope in ('region', 'all')),
  constraint crisis_engine_requests_status_chk check (status in ('queued', 'running', 'done', 'failed')),
  constraint crisis_engine_requests_region_scope_chk
    check (
      (scope = 'region' and region_id is not null)
      or (scope = 'all' and region_id is null)
    )
);

comment on table public.crisis_engine_requests is
  'Admin run queue for the crisis engine. One region at a time. Service role writes; authenticated admin may read and enqueue.';

create index if not exists crisis_engine_requests_status_created_idx
  on public.crisis_engine_requests (status, created_at);

create index if not exists crisis_engine_requests_region_created_idx
  on public.crisis_engine_requests (region_id, created_at desc);

alter table public.crisis_engine_requests enable row level security;

grant all on table public.crisis_engine_requests to service_role;
grant select, insert, update on table public.crisis_engine_requests to authenticated;

drop policy if exists crisis_engine_requests_admin_all on public.crisis_engine_requests;
create policy crisis_engine_requests_admin_all on public.crisis_engine_requests
  for all
  to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'hersky3107@gmail.com')
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'hersky3107@gmail.com');
