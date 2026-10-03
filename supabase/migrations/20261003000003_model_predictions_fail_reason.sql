-- Why: null-direction seats (미응답) previously stored no machine cause, so
-- timeouts, empty-content, parse failures, and reasoning-trace leaks were
-- indistinguishable. fail_reason is a short code only — never a provider body
-- or secret. Apply manually (no db push).
alter table public.model_predictions
  add column if not exists fail_reason text;

comment on column public.model_predictions.fail_reason is
  'Machine code when predicted_direction is null: timeout, http_4xx:<code>, http_5xx:<code>, empty_content, unparseable, reasoning_leak, rate_limited. Null on answered rows. Never a raw provider body.';
