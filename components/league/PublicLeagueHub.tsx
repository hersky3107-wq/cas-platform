'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { ModuleCreditsLink } from '@/components/credits/ModuleCreditsLink'
import { PredictionCard } from '@/components/league/PredictionCard'
import { Leaderboard } from '@/components/league/Leaderboard'
import { RecordRoom } from '@/components/league/RecordRoom'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'
import { creditsForLeagueGenerate } from '@/lib/credits'
import type { CardData } from '@/lib/league/card-types'
import type { LeaderboardData } from '@/lib/league/leaderboard-aggregate'
import type { RecordRoomPage } from '@/lib/league/record-room-aggregate'

export type LeagueHubTab = 'cards' | 'leaderboard' | 'recordRoom'

type PublicInstrument = { instrument: string; label: string; category: string; horizon: string }

const LIVE_COST = creditsForLeagueGenerate()

/**
 * The PUBLIC (logged-in, non-admin) league surface.
 *
 * Mobile-first: a tab strip, then one panel. On a wide viewport the board
 * uses the full `max-w-7xl` width (division grid), not a centered phone
 * column. Everything it
 * renders is an existing component — `PredictionCard`, `Leaderboard`,
 * `RecordRoom`, each already wrapped in `CardCompliance` (disclaimer +
 * approved phrasing) and already locale-aware through `useLeagueLocale`. This
 * file adds no new card chrome and no new compliance surface of its own.
 *
 * FREE VS PAID, made visible: the three tabs are cache reads and cost nothing.
 * The single paid affordance is "ask the models now", which carries its price
 * in the button label and only flips `PredictionCard`'s `live` prop — the
 * server re-checks auth, jurisdiction, rate limit and credits regardless of
 * what this component does (see `app/api/league/generate-stream/route.ts`).
 *
 * Note the deliberate absence of an instrument search box: public users get
 * the curated ranked set returned by `GET /api/league/instruments`, and the
 * API refuses anything else.
 */
export function PublicLeagueHub({ initialTab = 'cards' }: { initialTab?: LeagueHubTab }) {
  const { t, dir } = useLeagueLocale()
  const [tab, setTab] = useState<LeagueHubTab>(initialTab)

  return (
    <div dir={dir} className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 bg-slate-50 px-3 pb-16 pt-3 sm:px-6">
      <header className="flex items-center justify-between gap-2">
        <Link
          href="/"
          aria-label="Home"
          className="inline-flex items-center rounded-full bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition hover:bg-slate-100"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Link>
        <ModuleCreditsLink className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50" />
      </header>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{t.hub.title}</h1>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">{t.hub.subtitle}</p>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{t.hub.freeReadNote}</p>
      </div>

      <nav className="flex gap-1 rounded-full bg-white p-1 shadow-sm" aria-label={t.hub.title}>
        {(['cards', 'leaderboard', 'recordRoom'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key}
            className={`flex-1 rounded-full px-2 py-2 text-xs font-semibold transition ${
              tab === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.hub.tabs[key]}
          </button>
        ))}
      </nav>

      {tab === 'cards' ? <CardsPanel /> : null}
      {tab === 'leaderboard' ? <LeaderboardPanel /> : null}
      {tab === 'recordRoom' ? <RecordRoomPanel /> : null}
    </div>
  )
}

type CardLoadError = 'load_failed' | 'jurisdiction_blocked'

function CardsPanel() {
  const { t } = useLeagueLocale()
  const [instruments, setInstruments] = useState<PublicInstrument[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [card, setCard] = useState<CardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CardLoadError | null>(null)
  // Live is opt-in per card and resets whenever the selected instrument
  // changes, so switching tabs/instruments can never silently start a paid run.
  const [live, setLive] = useState(false)
  // Guards against a slower, now-superseded fetch overwriting the result of a
  // later one (e.g. clicking two instruments in quick succession).
  const requestIdRef = useRef(0)

  // The SERVER'S response is the only jurisdiction decision this panel
  // trusts: `GET /api/league/card` already runs the real check (with the
  // same admin bypass every other league route has — see
  // `lib/league/public-access.ts`). A client-side re-check of "is this
  // category allowed" from raw locale/IP signals has no way to know the
  // caller is an admin, so it used to contradict a card that had already
  // loaded successfully (and, unlike the server, never refetches when the
  // *account's* declared country is missing). Deriving "blocked" from the
  // HTTP status instead means the Cards tab can never disagree with the
  // Leaderboard/Record room tabs again, since all three now trust the same
  // one thing: what the server actually returned.
  const loadCard = useCallback(async (instrument: string) => {
    const requestId = (requestIdRef.current += 1)
    try {
      const res = await fetch(`/api/league/card?instrument=${encodeURIComponent(instrument)}`, {
        credentials: 'include',
      })
      const body = (await res.json()) as CardData | { error: string; code?: string }
      if (requestId !== requestIdRef.current) return
      if (!res.ok) {
        setCard(null)
        setError('code' in body && body.code === 'jurisdiction_blocked' ? 'jurisdiction_blocked' : 'load_failed')
        return
      }
      setCard(body as CardData)
      setError(null)
    } catch {
      if (requestId === requestIdRef.current) {
        setCard(null)
        setError('load_failed')
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/league/instruments', { credentials: 'include' })
        const body = (await res.json()) as { instruments?: PublicInstrument[] }
        if (cancelled) return
        const list = body.instruments ?? []
        setInstruments(list)
        const first = list[0]?.instrument ?? null
        setSelected(first)
        if (first) {
          void loadCard(first)
        } else {
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setInstruments([])
          setLoading(false)
          setError('load_failed')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadCard])

  // A plain click handler, not a `[selected]`-keyed effect: re-clicking the
  // ALREADY-selected instrument (e.g. the default first chip) must still
  // fire a fresh fetch and still clear `loading`. Keying the fetch off a
  // state-change effect meant `setSelected(sameValue)` was a no-op re-render
  // with no state change, so the effect never re-ran and `loading` — set to
  // `true` right here — never came back down. That is the "stuck loading
  // forever" bug: clicking an already-selected chip lit the spinner and
  // nothing ever turned it back off.
  function selectInstrument(instrument: string) {
    setLive(false)
    setSelected(instrument)
    setCard(null)
    setError(null)
    setLoading(true)
    void loadCard(instrument)
  }

  if (instruments === null) return <PanelMessage text={t.hub.loading} />
  if (instruments.length === 0) return <PanelMessage text={t.hub.noInstruments} />

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {instruments.map((i) => (
          <button
            key={i.instrument}
            type="button"
            onClick={() => selectInstrument(i.instrument)}
            aria-current={selected === i.instrument}
            className={`rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition ${
              selected === i.instrument
                ? 'bg-emerald-600 text-white'
                : 'bg-white text-slate-600 shadow-sm hover:bg-slate-100'
            }`}
          >
            <span className="block truncate text-sm">{i.label}</span>
            <span className={`mt-0.5 block truncate text-[10px] font-medium ${
              selected === i.instrument ? 'text-emerald-100' : 'text-slate-400'
            }`}>
              {i.horizon}
            </span>
          </button>
        ))}
      </div>

      {loading ? <PanelMessage text={t.hub.loading} /> : null}
      {!loading && error === 'jurisdiction_blocked' ? <PanelMessage text={t.gating.unavailable} /> : null}
      {!loading && error === 'load_failed' ? <PanelMessage text={t.hub.genericError} tone="error" /> : null}

      {!loading && !error && card ? (
        <>
          <PredictionCard key={card.round.round_id} initialData={card} live={live} />
          <button
            type="button"
            disabled={live}
            onClick={() => setLive(true)}
            className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50 md:max-w-sm"
          >
            {live ? t.hub.generating : t.hub.generateLive(LIVE_COST)}
          </button>
        </>
      ) : null}
    </div>
  )
}

function LeaderboardPanel() {
  const { t } = useLeagueLocale()
  const [data, setData] = useState<LeaderboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/league/leaderboard', { credentials: 'include' })
        const body = (await res.json()) as LeaderboardData | { error: string }
        if (cancelled) return
        if (!res.ok) throw new Error('error' in body ? body.error : `request failed (${res.status})`)
        setData(body as LeaderboardData)
      } catch {
        if (!cancelled) setError('load_failed')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <PanelMessage text={t.hub.genericError} tone="error" />
  if (!data) return <PanelMessage text={t.hub.loading} />
  return <Leaderboard data={data} />
}

function RecordRoomPanel() {
  const { t } = useLeagueLocale()
  const [data, setData] = useState<RecordRoomPage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/league/record-room?page=1&pageSize=20', { credentials: 'include' })
        const body = (await res.json()) as RecordRoomPage | { error: string }
        if (cancelled) return
        if (!res.ok) throw new Error('error' in body ? body.error : `request failed (${res.status})`)
        setData(body as RecordRoomPage)
      } catch {
        if (!cancelled) setError('load_failed')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <PanelMessage text={t.hub.genericError} tone="error" />
  if (!data) return <PanelMessage text={t.hub.loading} />
  return <RecordRoom initialData={data} />
}

function PanelMessage({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'error' }) {
  return (
    <p
      className={`rounded-2xl border border-dashed px-4 py-6 text-center text-xs ${
        tone === 'error' ? 'border-rose-300 text-rose-600' : 'border-slate-300 text-slate-500'
      }`}
    >
      {text}
    </p>
  )
}
