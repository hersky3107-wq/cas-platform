'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/db/supabase'
import { RecordRoom } from '@/components/league/RecordRoom'
import { setLeagueLocaleOverride } from '@/lib/league/i18n/locale-store'
import { normalizeLeagueLocale } from '@/lib/league/i18n/locales'
import type { RecordRoomPage } from '@/lib/league/record-room-aggregate'

const OWNER_EMAIL = 'hersky3107@gmail.com'

/**
 * Admin preview for the league record room — the read-only, paginated,
 * immutable log of resolved rounds (see
 * `lib/league/record-room-aggregate.ts` and `GET /api/league/record-room`).
 *
 * Usage:
 *   /admin/league/record-room
 *   /admin/league/record-room?locale=ko   (force display language)
 */
export default function LeagueRecordRoomPreviewPage() {
  const [authState, setAuthState] = useState<'checking' | 'denied' | 'allowed'>('checking')
  const [data, setData] = useState<RecordRoomPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/league/record-room?page=1&pageSize=20', { credentials: 'include' })
      const body = (await res.json()) as RecordRoomPage | { error: string }
      if (!res.ok) throw new Error('error' in body ? body.error : `request failed (${res.status})`)
      setData(body as RecordRoomPage)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'failed to load record room')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const { data: authData, error: authError } = await supabase.auth.getUser()
      const email = authData.user?.email ?? ''
      if (authError || !email || email.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
        setAuthState('denied')
        return
      }
      setAuthState('allowed')

      const params = new URLSearchParams(window.location.search)
      const forcedLocale = normalizeLeagueLocale(params.get('locale'))
      if (forcedLocale) setLeagueLocaleOverride(forcedLocale)

      await load()
    })()
  }, [load])

  if (authState === 'checking') return <p className="p-6 text-sm text-gray-500">Checking access…</p>
  if (authState === 'denied') return <p className="p-6 text-sm text-red-600">Forbidden.</p>

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col gap-4 bg-gray-50 p-4">
      <h1 className="text-lg font-bold">League Record Room — preview</h1>

      {loading ? <p className="text-sm text-gray-500">Loading…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {data ? <RecordRoom initialData={data} /> : null}
    </div>
  )
}
