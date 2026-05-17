'use client'

import { supabase } from '@/lib/db/supabase'

/** Client access token for API Bearer auth (refreshes when near expiry). */
export async function getClientAccessToken(): Promise<string | null> {
  try {
    const { data: sessionData } = await supabase.auth.getSession()
    let session = sessionData.session

    const expiresAt = session?.expires_at ?? 0
    const needsRefresh = !session?.access_token || expiresAt * 1000 < Date.now() + 60_000

    if (needsRefresh) {
      const { data: refreshed } = await supabase.auth.refreshSession()
      session = refreshed.session ?? session
    }

    return session?.access_token ?? null
  } catch {
    return null
  }
}
