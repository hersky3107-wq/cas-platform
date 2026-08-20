-- Per-reading state belongs to the session, not the profile. This preserves
-- historical PRISM picks for later re-test delta comparisons.
alter table public.oracle_job_sessions
  add column if not exists session_inputs jsonb;

comment on column public.oracle_job_sessions.session_inputs is
  'Generic per-session input bag. Current shape: {"prism"?: {"impulse": ColorId, "need": ColorId, "identity": ColorId, "microCheck"?: [1-5, 1-5, 1-5, 1-5]}}. Future systems may add top-level keys without another migration.';
