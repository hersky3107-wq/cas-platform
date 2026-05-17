import { getSiteUrl } from '@/lib/supabase/site-url'

/** Add both to Supabase Auth → Redirect URLs (Vercel sends apex → www at the edge). */
export const PRODUCTION_AUTH_CALLBACK_APEX = 'https://aimani.ai/auth/callback'
export const PRODUCTION_AUTH_CALLBACK_WWW = 'https://www.aimani.ai/auth/callback'

export function getAuthCallbackUrl(fallbackOrigin?: string): string {
  return `${getSiteUrl(fallbackOrigin)}/auth/callback`
}
