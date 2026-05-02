import { createClient, SupabaseClient } from '@supabase/supabase-js'

/** Server-side / API-route client using the caller's JWT (RLS applies). */
export function createSupabaseWithToken(accessToken?: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing.')
  }

  return createClient(url, anon, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
