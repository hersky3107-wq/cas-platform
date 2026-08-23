-- ============================================================================
-- public.model_cost_logs — ADDITIVE: oracle_session_id column.
--
-- BACKGROUND: this table predates migration tracking, so no earlier migration
-- file defines it. The DDL block below is the LIVE schema as observed via
-- PostgREST introspection (GET {supabase_url}/rest/v1/) on 2026-08-23 — the
-- read-only method used because there was no migration history to read from.
-- It is captured here so the table's real shape is finally version-controlled.
--
-- CURRENT FULL DDL OF public.model_cost_logs (as observed, not asserted):
--
--   create table public.model_cost_logs (
--     id                uuid primary key default gen_random_uuid(),
--     session_id        uuid references public.sessions(id),   -- nullable
--     ai_name           text not null,
--     model_name        text not null,
--     input_tokens      integer,
--     output_tokens     integer,
--     cost_usd          numeric,
--     response_time_ms  integer,
--     created_at        timestamptz default now()
--   );
--
--   No CHECK constraints. No prompt_tokens/completion_tokens/total_tokens/
--   error_text columns exist (some callers historically wrote those names by
--   mistake; those writes always failed and fell back to a degraded row).
--
-- WHY THIS MIGRATION: session_id's FK to public.sessions means the ORACLE
-- rebuild path (lib/oracle/ai/call.ts) — whose session id is a
-- public.oracle_job_sessions row, a completely separate id space — can never
-- populate session_id without violating the FK, so it logs with
-- session_id = null. That loses per-session cost attribution for the rebuild
-- path, which is needed for session pricing.
--
-- oracle_session_id is a plain, unconstrained uuid column: nullable, no
-- default, NO foreign key (oracle_job_sessions rows can be pruned/rotated
-- independently of cost logs, and this table already has no FK enforcement
-- pattern worth copying). Purely additive — no existing column is altered,
-- renamed, or dropped, so every current writer (including the league cost
-- logger, which never sets this column) keeps working unchanged.
-- ============================================================================

alter table public.model_cost_logs
  add column if not exists oracle_session_id uuid;

comment on column public.model_cost_logs.oracle_session_id is
  'public.oracle_job_sessions(id) for the ORACLE layer-1 rebuild path. No FK by design (see migration header) — session_id stays null for these rows because oracle_job_sessions is a separate id space from public.sessions.';
