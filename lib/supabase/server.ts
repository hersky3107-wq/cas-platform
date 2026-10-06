import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side admin client (service role).
 *
 * IMPORTANT:
 * - Use ONLY in server contexts (API routes / server actions).
 * - Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client.
 * - Bypasses RLS, so every write must still be authorized at the app layer.
 *
 * Created on first use so a missing env var cannot fail `next build`.
 */
let cached: SupabaseClient | null = null

function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing.')
  }
  return createClient(url, key)
}

export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, _receiver) {
    if (!cached) cached = createAdminClient()
    const value = Reflect.get(cached, prop, cached)
    return typeof value === 'function' ? (value as (...args: never[]) => unknown).bind(cached) : value
  },
})
