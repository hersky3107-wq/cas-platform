-- Kick-off + polling job store for the JEJU tourist AI 여행 코스 (tourist-course).
-- The heavy work (VisitJeju pool + sonar + sonnet compose) is a single ~105s
-- computation. Instead of holding one long HTTP request open (which dies when a
-- phone backgrounds >30s and drops the connection), the route:
--   1. POST → inserts a 'pending' row and returns { jobId } in <200ms, then runs
--      the compute in a Next.js after() background task and writes the result +
--      status back to this row.
--   2. GET ?jobId → returns the row's current status + result.
-- The client polls the GET every few seconds, so a dropped connection during
-- backgrounding no longer loses the result — the next poll picks it up.
--
-- `input`  = normalized request params (mode/query/duration/area/locale/…).
-- `result` = the finished { ok:true, courses } | { ok:false, error } payload.
create table if not exists public.jeju_course_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending', -- 'pending' | 'done' | 'error'
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jeju_course_jobs_status_idx on public.jeju_course_jobs (status);
create index if not exists jeju_course_jobs_created_at_idx on public.jeju_course_jobs (created_at);

-- Access is server-only via the service-role client (supabaseAdmin), which
-- bypasses RLS. Enable RLS with NO permissive policy (default deny) so anon /
-- authenticated clients can neither read nor write these job rows directly —
-- mirrors public.motie_deep_sessions / public.jeju_deep_sessions.
alter table public.jeju_course_jobs enable row level security;
