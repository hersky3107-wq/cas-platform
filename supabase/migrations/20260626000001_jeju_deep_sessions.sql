-- Chunked-polling state store for the JEJU DEEP pipeline.
-- A single ~5min+ run is split across multiple short API actions; each action
-- loads/saves the accumulating pipeline state from this row. `state` is an
-- opaque JSONB blob owned by app/api/jeju/deep/route.ts (snapshot, plan,
-- analyses, searches, revised, debate, rounds[], verdict, vote).
create table if not exists public.jeju_deep_sessions (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  status text not null default 'running',
  stage text not null default 'start',
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jeju_deep_sessions_status_idx on public.jeju_deep_sessions (status);
