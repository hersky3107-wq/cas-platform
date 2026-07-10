import { createClient } from '@supabase/supabase-js'

/**
 * Server-side admin client (service role).
 *
 * IMPORTANT:
 * - Use ONLY in server contexts (API routes / server actions).
 * - Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client.
 * - Bypasses RLS, so every write must still be authorized at the app layer.
 */
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

