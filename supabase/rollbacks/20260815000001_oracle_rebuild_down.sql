-- ============================================================================
-- ROLLBACK for 20260815000001_oracle_rebuild.sql
--
-- NOT a numbered file under supabase/migrations/ — putting a down script
-- there would make `supabase db push` apply it immediately after the up
-- migration and undo the schema. Apply this file manually:
--
--   psql "$DATABASE_URL" -f supabase/rollbacks/20260815000001_oracle_rebuild_down.sql
--
-- Drops ONLY the rebuild tables. Does NOT touch:
--   - public.users.oracle_birth_profile
--   - public.profiles.oracle_birth_profile
--   - public.oracle_sessions (legacy share/vote archive)
-- ============================================================================

drop table if exists public.oracle_consensus cascade;
drop table if exists public.oracle_verdicts cascade;
drop table if exists public.oracle_readings cascade;
drop table if exists public.oracle_computations cascade;
drop table if exists public.oracle_job_sessions cascade;
drop table if exists public.oracle_profiles cascade;
drop table if exists public.oracle_daily_cache cascade;

comment on table public.oracle_sessions is null;
