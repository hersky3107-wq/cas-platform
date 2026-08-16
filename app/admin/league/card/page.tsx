'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/db/supabase'
import { PredictionCard } from '@/components/league/PredictionCard'
import { JurisdictionGate } from '@/components/league/JurisdictionGate'
import { setLeagueLocaleOverride } from '@/lib/league/i18n/locale-store'
import { normalizeLeagueLocale } from '@/lib/league/i18n/locales'
import type { CardData } from '@/lib/league/card-types'

const OWNER_EMAIL = 'hersky3107@gmail.com'

/**
 * Admin preview for the league prediction card, including the i18n (Layer A)
 * and country-gating (Layer B) demo affordances.
 *
 * Usage:
 *   /admin/league/card?instrument=AAPL
 *   /admin/league/card?instrument=AAPL&locale=ko            (force display language)
 *   /admin/league/card?instrument=AAPL&dev_declared_country=KR&dev_ip_country=KR   (jurisdiction: shows)
 *   /admin/league/card?instrument=AAPL&dev_declared_country=CN&dev_ip_country=CN   (jurisdiction: hides — China mainland row is empty in the matrix)
 *   /admin/league/card?instrument=AAPL&live=1                (opt into the live generation stream — see the "Generate live" toggle below)
 *
 * LIVE (Layer 4): the "Generate live" checkbox is the explicit opt-in for
 * `POST /api/league/generate-stream`. Unchecked (the default, matching every
 * other card view on the product) always renders the STORED round exactly as
 * `GET /api/league/card` returned it — this page never generates anything on
 * a plain load.
 *
 * `dev_declared_country` / `dev_ip_country` are forwarded verbatim to
 * `PredictionCard`/`JurisdictionGate` as `devSignalsQuery` — a DEV-ONLY
 * escape hatch (see `app/api/league/context/route.ts`) since local dev has
 * no real IP-geolocation header to test Layer B against. `locale` sets the
 * SAME override the visible language toggle uses, so this is exercising the
 * real Layer A mechanism, not a preview-only shortcut.
 */
export default function LeagueCardPreviewPage() {
  const [authState, setAuthState] = useState<'checking' | 'denied' | 'allowed'>('checking')
  const [card, setCard] = useState<CardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('instrument=AAPL')
  const [devSignalsQuery, setDevSignalsQuery] = useState<string | undefined>(undefined)
  const [live, setLive] = useState(false)

  const load = useCallback(async (qs: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/league/card?${qs}`, { credentials: 'include' })
      const body = (await res.json()) as CardData | { error: string }
      if (!res.ok) throw new Error('error' in body ? body.error : `request failed (${res.status})`)
      setCard(body as CardData)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'failed to load card')
      setCard(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const { data, error: authError } = await supabase.auth.getUser()
      const email = data.user?.email ?? ''
      if (authError || !email || email.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
        setAuthState('denied')
        return
      }
      setAuthState('allowed')

      const params = new URLSearchParams(window.location.search)

      const forcedLocale = normalizeLeagueLocale(params.get('locale'))
      if (forcedLocale) setLeagueLocaleOverride(forcedLocale)

      if (params.get('live') === '1') setLive(true)

      const devParams = new URLSearchParams()
      const devIp = params.get('dev_ip_country')
      const devDeclared = params.get('dev_declared_country')
      if (devIp) devParams.set('dev_ip_country', devIp)
      if (devDeclared) devParams.set('dev_declared_country', devDeclared)
      setDevSignalsQuery(devParams.toString() || undefined)

      const cardParams = new URLSearchParams(params)
      cardParams.delete('locale')
      cardParams.delete('dev_ip_country')
      cardParams.delete('dev_declared_country')
      cardParams.delete('live')
      const initial = cardParams.toString() || 'instrument=AAPL'
      setQuery(initial)
      await load(initial)
    })()
  }, [load])

  if (authState === 'checking') return <p className="p-6 text-sm text-gray-500">Checking access…</p>
  if (authState === 'denied') return <p className="p-6 text-sm text-red-600">Forbidden.</p>

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col gap-4 bg-gray-50 p-4">
      <h1 className="text-lg font-bold">League Prediction Card — preview</h1>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void load(query)
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="round_id=<uuid> or instrument=AAPL"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="shrink-0 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white">
          Load
        </button>
      </form>

      <label className="flex items-center gap-2 text-xs text-gray-600">
        <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
        Generate live (re-runs the roster now, streamed — stored card is the default; this is opt-in)
      </label>

      {loading ? <p className="text-sm text-gray-500">Loading…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {card ? (
        <JurisdictionGate category={card.round.category} devSignalsQuery={devSignalsQuery}>
          <PredictionCard key={card.round.round_id} initialData={card} live={live} devSignalsQuery={devSignalsQuery} />
        </JurisdictionGate>
      ) : null}
    </div>
  )
}
