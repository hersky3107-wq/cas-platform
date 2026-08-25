-- SINGLE-SYSTEM reader panels need more than one reading for the same
-- (session, system). Brand is the seat identity: a retry by the same brand is
-- idempotent, while a different brand may write its own row.
--
-- SQL Editor (run manually; do NOT use `supabase db push` for this change):
--
--   alter table public.oracle_readings
--     drop constraint if exists oracle_readings_session_system_uniq;
--
--   alter table public.oracle_readings
--     add constraint oracle_readings_session_system_brand_uniq
--     unique (session_id, system, brand);

alter table public.oracle_readings
  drop constraint if exists oracle_readings_session_system_uniq;

alter table public.oracle_readings
  add constraint oracle_readings_session_system_brand_uniq
  unique (session_id, system, brand);
