-- Billing display for credits UI (subscription vs pay-as-you-go) and % gauge ceiling.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS credits_billing_mode TEXT NOT NULL DEFAULT 'pay_as_you_go';

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_credits_billing_mode_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_credits_billing_mode_check
  CHECK (credits_billing_mode IN ('subscription', 'pay_as_you_go'));

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS credits_percent_ceiling INTEGER NOT NULL DEFAULT 1000;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_credits_percent_ceiling_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_credits_percent_ceiling_check
  CHECK (credits_percent_ceiling >= 1);
