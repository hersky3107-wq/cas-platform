-- Admin announcement banner (single active row; version bumps on each edit)
CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text TEXT NOT NULL,
  version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS announcements_updated_at_idx
  ON public.announcements (updated_at DESC);

INSERT INTO public.announcements (text, version)
SELECT
  'AIMANI is now live. More modes and features coming soon. Thank you for being here.',
  'v1'
WHERE NOT EXISTS (SELECT 1 FROM public.announcements LIMIT 1);

-- Optional profile fields for admin dashboard signups
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email TEXT;

-- Bigdata: daily session counts by module
CREATE OR REPLACE VIEW public.daily_module_stats AS
SELECT
  DATE(created_at) AS date,
  mode,
  COUNT(*) AS session_count
FROM public.sessions
GROUP BY DATE(created_at), mode
ORDER BY date DESC, session_count DESC;
