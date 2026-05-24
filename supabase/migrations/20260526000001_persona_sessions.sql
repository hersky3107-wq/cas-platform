CREATE TABLE IF NOT EXISTS public.persona_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  question TEXT NOT NULL,
  responses JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_public BOOLEAN NOT NULL DEFAULT false,
  voted_ai TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS persona_sessions_user_id_idx
  ON public.persona_sessions (user_id);

CREATE INDEX IF NOT EXISTS persona_sessions_share_id_idx
  ON public.persona_sessions (share_id);

CREATE INDEX IF NOT EXISTS persona_sessions_public_share_id_idx
  ON public.persona_sessions (share_id)
  WHERE is_public = true;
