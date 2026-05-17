import { CANONICAL_PRODUCTION_ORIGIN, getSiteUrl } from '@/lib/supabase/site-url'

/** Production magic-link redirect (must match Supabase Auth → Redirect URLs). */
export const PRODUCTION_AUTH_CALLBACK = 'https://aimani.ai/auth/callback'

export function getAuthCallbackUrl(fallbackOrigin?: string): string {
  const site = getSiteUrl(fallbackOrigin)
  if (site === CANONICAL_PRODUCTION_ORIGIN || site.includes('aimani.ai')) {
    return PRODUCTION_AUTH_CALLBACK
  }
  return `${site}/auth/callback`
}
