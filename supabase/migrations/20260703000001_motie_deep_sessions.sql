-- Chunked-polling state store for the MOTIE (AX COUNCIL) governance pipelines.
-- Mirrors public.jeju_deep_sessions exactly (isolated table for the motie tree).
-- A single ~5min+ run is split across multiple short API actions; each action
-- loads/saves the accumulating pipeline state from this row. `state` is an
-- opaque JSONB blob owned by app/api/motie/{deep,deliberate,brief,diagnostic}
-- routes (snapshot, plan, analyses, searches, revised, debate, rounds[],
-- verdict, vote, and the AX COUNCIL councilMode).
create table if not exists public.motie_deep_sessions (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  status text not null default 'running',
  stage text not null default 'start',
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists motie_deep_sessions_status_idx on public.motie_deep_sessions (status);

-- Access is server-only via the service-role client (supabaseAdmin), which
-- bypasses RLS. Enable RLS with no permissive policies so anon/authenticated
-- clients cannot read or write these session rows directly.
alter table public.motie_deep_sessions enable row level security;
