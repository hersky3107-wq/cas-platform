ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS topup_expires_at TIMESTAMPTZ;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_credits_billing_mode_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_credits_billing_mode_check
  CHECK (credits_billing_mode IN ('subscription', 'pay_as_you_go', 'topup'));
