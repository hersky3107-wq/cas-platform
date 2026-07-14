-- Chunked-polling state store for the FESTIVAL success-forecast pipeline.
-- Mirrors public.motie_deep_sessions EXACTLY (schema-identical), but is a fully
-- SEPARATE table so festival never reads/writes MOTIE or Jeju session rows.
--
-- ISOLATION INVARIANT: dropping this table + deleting lib/festival/* +
-- app/api/festival/* leaves MOTIE (motie_deep_sessions) and AX Jeju
-- (jeju_deep_sessions) byte-for-byte identical. Zero shared mutable surface.
--
-- A single multi-minute run is split across short per-stage API actions; each
-- action loads/saves the accumulating pipeline `state` from this row. `state` is
-- an opaque JSONB blob owned solely by app/api/festival/* (stubbed plan input,
-- 8-investigator results, debate turns/summaries, converge scores, verdict).
create table if not exists public.festival_sessions (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  status text not null default 'running',
  stage text not null default 'start',
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists festival_sessions_status_idx on public.festival_sessions (status);

-- Access is server-only via the service-role client (supabaseAdmin), which
-- bypasses RLS. Enable RLS with no permissive policies so anon/authenticated
-- clients cannot read or write these session rows directly.
alter table public.festival_sessions enable row level security;
