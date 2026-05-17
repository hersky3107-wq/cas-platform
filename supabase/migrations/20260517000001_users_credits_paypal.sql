-- Credits balance on public.users (auth user id)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 0;

-- Keep profiles in sync when that table is used elsewhere
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 0;

-- Idempotent PayPal capture log (prevents double-granting credits)
CREATE TABLE IF NOT EXISTS public.paypal_credit_purchases (
  paypal_order_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  plan_id TEXT NOT NULL,
  credits_granted INTEGER NOT NULL,
  amount_usd NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS paypal_credit_purchases_user_id_idx
  ON public.paypal_credit_purchases (user_id);
