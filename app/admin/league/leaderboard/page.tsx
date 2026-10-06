'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/db/supabase'
import { Leaderboard } from '@/components/league/Leaderboard'
import { setLeagueLocaleOverride } from '@/lib/league/i18n/locale-store'
import { normalizeLeagueLocale } from '@/lib/league/i18n/locales'
import { isBoardsResponse, type BoardsResponse } from '@/lib/league/boards/types'

const OWNER_EMAIL = 'hersky3107@gmail.com'

/**
 * Admin preview for the league leaderboard boards (`GET /api/league/leaderboard`).
 * Without `test=1` it reads the same cache the public board reads; with it,
 * boards are computed live and include test rounds (never cached).
 *
 * Usage:
 *   /admin/league/leaderboard
 *   /admin/league/leaderboard?test=1      (live preview including test rounds)
 *   /admin/league/leaderboard?locale=ko   (force display language)
 */
export default function LeagueLeaderboardPreviewPage() {
  const [authState, setAuthState] = useState<'checking' | 'denied' | 'allowed'>('checking')
  const [data, setData] = useState<BoardsResponse | null>(null)
  const [query, setQuery] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (extra: string | undefined) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/league/leaderboard?door=all${extra ? `&${extra}` : ''}`, { credentials: 'include' })
      const body: unknown = await res.json()
      if (!res.ok || !isBoardsResponse(body)) {
        const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null
        throw new Error(message ?? `request failed (${res.status})`)
      }
      setData(body)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'failed to load leaderboard')
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
      const extra = params.get('test') === '1' ? 'test=1' : undefined
      setQuery(extra)

      await load(extra)
    })()
  }, [load])

  if (authState === 'checking') return <p className="p-6 text-sm text-gray-500">Checking access…</p>
  if (authState === 'denied') return <p className="p-6 text-sm text-red-600">Forbidden.</p>

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col gap-4 bg-gray-50 p-4">
      <h1 className="text-lg font-bold">League Leaderboard — preview{query ? ' (live, incl. test rounds)' : ''}</h1>

      {loading ? <p className="text-sm text-gray-500">Loading…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {data ? <Leaderboard initial={data} query={query} /> : null}
    </div>
  )
}
