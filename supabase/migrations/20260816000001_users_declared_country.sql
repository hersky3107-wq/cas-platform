-- Self-declared jurisdiction for the AI Prediction League's country-gating
-- layer (lib/league/jurisdiction/*). Nullable: most users won't have
-- declared one yet; IP-country alone is the fallback signal in that case.
-- Combined with IP-country and the STRICTER (more restrictive) result wins
-- — see lib/league/jurisdiction/resolve.ts. Not verified/enforced beyond
-- this app reading it; see the in-app ToS note (lib/league/i18n/dictionary.ts
-- `gating.tosNote`) for the liability-shift language shown to users.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS declared_country TEXT;

COMMENT ON COLUMN public.users.declared_country IS
  'Self-declared ISO 3166-1 alpha-2 country code (e.g. KR, US). Used only for league prediction-card jurisdiction gating, alongside IP-country; not independently verified.';
