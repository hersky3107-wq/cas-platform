/**
 * Live deps for the league adapter. Isolated so unit tests never load
 * `server-only` / supabaseAdmin.
 */
import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { createSupabaseLeagueDivinationCache } from './cache'
import { readLeagueDivination } from './adapter'
import type { LeagueDivinationAdapterInput, LeagueDivinationAdapterOutput } from './adapter-types'

export async function readLeagueDivinationLive(
  input: LeagueDivinationAdapterInput,
): Promise<LeagueDivinationAdapterOutput> {
  return readLeagueDivination(input, { cache: createSupabaseLeagueDivinationCache(supabaseAdmin) })
}
