-- Kick-off + polling job store for the 도민(resident) 농수산 AI 조업 판단
-- (fishing-decision). The work combines TWO upstream data routes (marine +
-- fishery-price, each with its own upstream fan-out + Perplexity calls) plus a
-- single AI synthesis, so it exceeds the 30s single-request budget. Instead of
-- holding one long HTTP request open (which dies when a phone backgrounds >30s
-- and drops the connection), the route:
--   1. POST → inserts a 'pending' row and returns { jobId } in <200ms, then runs
--      the compute in a Next.js after() background task and writes the result +
--      status back to this row.
--   2. GET ?jobId → returns the row's current status + result.
-- The client polls the GET every few seconds, so a dropped connection during
-- backgrounding no longer loses the result — the next poll picks it up.
--
-- Mirrors public.jeju_course_jobs exactly (same store pattern as DEEP/Arena).
-- `input`  = normalized request params (species/spot).
-- `result` = the finished { ok:true, decision, marine, fishery, … } | { ok:false, error }.
create table if not exists public.jeju_fishing_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending', -- 'pending' | 'done' | 'error'
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jeju_fishing_jobs_status_idx on public.jeju_fishing_jobs (status);
create index if not exists jeju_fishing_jobs_created_at_idx on public.jeju_fishing_jobs (created_at);

-- Access is server-only via the service-role client (supabaseAdmin), which
-- bypasses RLS. Enable RLS so anon / authenticated clients cannot read or
-- write job rows directly (default deny when no permissive policy exists).
-- An explicit service_role policy documents intent for operators; the API routes
-- use supabaseAdmin exclusively — mirrors public.jeju_course_jobs pattern.
alter table public.jeju_fishing_jobs enable row level security;

drop policy if exists "jeju_fishing_jobs service only" on public.jeju_fishing_jobs;
create policy "jeju_fishing_jobs service only"
  on public.jeju_fishing_jobs
  for all
  to service_role
  using (true)
  with check (true);
