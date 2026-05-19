-- One-time signup bonus tracking (prevents re-granting on every login)
CREATE TABLE IF NOT EXISTS public.welcome_credit_grants (
  user_id UUID PRIMARY KEY,
  credits_granted INTEGER NOT NULL DEFAULT 30,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS welcome_credit_grants_granted_at_idx
  ON public.welcome_credit_grants (granted_at);
