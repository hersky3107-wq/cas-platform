-- Additive oracle cost-log telemetry (layer-1 rebuild path).
-- Apply in Supabase SQL Editor if not using migration runner:
--
--   ALTER TABLE public.model_cost_logs ADD COLUMN IF NOT EXISTS is_estimated boolean;
--   ALTER TABLE public.model_cost_logs ADD COLUMN IF NOT EXISTS http_attempts integer;
--   ALTER TABLE public.model_cost_logs ADD COLUMN IF NOT EXISTS final_attempt_ms integer;

ALTER TABLE public.model_cost_logs
  ADD COLUMN IF NOT EXISTS is_estimated boolean;

ALTER TABLE public.model_cost_logs
  ADD COLUMN IF NOT EXISTS http_attempts integer;

ALTER TABLE public.model_cost_logs
  ADD COLUMN IF NOT EXISTS final_attempt_ms integer;
