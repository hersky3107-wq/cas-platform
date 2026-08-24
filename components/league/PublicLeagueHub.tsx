'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { ModuleCreditsLink } from '@/components/credits/ModuleCreditsLink'
import { PredictionCard } from '@/components/league/PredictionCard'
import { DeepAnalysis } from '@/components/league/DeepAnalysis'
import { Leaderboard } from '@/components/league/Leaderboard'
import { RecordRoom } from '@/components/league/RecordRoom'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'
import { creditsForLeagueGenerate } from '@/lib/credits'
import type { CardData, ColorBucket } from '@/lib/league/card-types'
import { defaultCatalogCategoryId, type CatalogKind, type PublicCategoryId } from '@/lib/league/catalog'
import { UI_HORIZONS, type UiHorizon } from '@/lib/league/horizon'
import type { LeaderboardData } from '@/lib/league/leaderboard-aggregate'
import type { RecordRoomPage } from '@/lib/league/record-room-aggregate'

export type LeagueHubTab = 'cards' | 'leaderboard' | 'recordRoom'

type PublicCatalogCategory = {
  id: PublicCategoryId
  ledgerCategory: string
  tone: ColorBucket
  kind: CatalogKind
  instruments: { instrument: string }[]
}

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
 * the 12-category catalog from `GET /api/league/instruments` (jurisdiction-
 * filtered), and the API refuses anything else.
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

type CardLoadError = 'load_failed' | 'jurisdiction_blocked' | 'no_round'

function CardsPanel() {
  const { t } = useLeagueLocale()
  const [categories, setCategories] = useState<PublicCatalogCategory[] | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<PublicCategoryId | null>(null)
  const [selectedInstrument, setSelectedInstrument] = useState<string | null>(null)
  // Horizon selector next to the instrument chips. Default '1d' — every
  // instrument opens on the 1-day card first.
  const [horizon, setHorizon] = useState<UiHorizon>('1d')
  const [card, setCard] = useState<CardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CardLoadError | null>(null)
  // Live is opt-in per card and resets whenever the selected instrument
  // changes, so switching tabs/instruments can never silently start a paid run.
  const [live, setLive] = useState(false)
  // Guards against a slower, now-superseded fetch overwriting the result of a
  // later one (e.g. clicking two instruments/horizons in quick succession).
  const requestIdRef = useRef(0)

  // The SERVER'S response is the only jurisdiction decision this panel
  // trusts: `GET /api/league/card` already runs the real check (with the
  // same admin bypass every other league route has — see
  // `lib/league/public-access.ts`). Deriving "blocked" from the HTTP status
  // means the Cards tab can never disagree with Leaderboard/Record room.
  const loadCard = useCallback(async (instrument: string, horizonArg: UiHorizon) => {
    const requestId = (requestIdRef.current += 1)
    try {
      const res = await fetch(
        `/api/league/card?instrument=${encodeURIComponent(instrument)}&horizon=${encodeURIComponent(horizonArg)}`,
        { credentials: 'include' }
      )
      const body = (await res.json()) as CardData | { error: string; code?: string }
      if (requestId !== requestIdRef.current) return
      if (!res.ok) {
        setCard(null)
        if ('code' in body && body.code === 'jurisdiction_blocked') {
          setError('jurisdiction_blocked')
        } else if (res.status === 404 || ('code' in body && body.code === 'no_round')) {
          setError('no_round')
        } else {
          setError('load_failed')
        }
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
        const body = (await res.json()) as { categories?: PublicCatalogCategory[] }
        if (cancelled) return
        const list = body.categories ?? []
        setCategories(list)
        const firstId = defaultCatalogCategoryId(list)
        setSelectedCategory(firstId)
        const firstCat = list.find((c) => c.id === firstId)
        const firstInstrument = firstCat?.instruments[0]?.instrument ?? null
        setSelectedInstrument(firstInstrument)
        if (firstInstrument) {
          void loadCard(firstInstrument, '1d')
        } else {
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setCategories([])
          setLoading(false)
          setError('load_failed')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadCard])

  function selectCategory(id: PublicCategoryId) {
    if (!categories) return
    const next = categories.find((c) => c.id === id)
    setLive(false)
    setSelectedCategory(id)
    setCard(null)
    setError(null)
    if (!next || next.kind === 'coming_soon' || next.instruments.length === 0) {
      setSelectedInstrument(null)
      setLoading(false)
      return
    }
    const first = next.instruments[0]!.instrument
    setSelectedInstrument(first)
    setLoading(true)
    void loadCard(first, horizon)
  }

  // A plain click handler, not a `[selected]`-keyed effect: re-clicking the
  // ALREADY-selected instrument must still fire a fresh fetch.
  function selectInstrument(instrument: string) {
    setLive(false)
    setSelectedInstrument(instrument)
    setCard(null)
    setError(null)
    setLoading(true)
    void loadCard(instrument, horizon)
  }

  // Switching horizon loads THAT horizon's round for the currently selected
  // instrument — a genuinely different round (separate resolves_at), never a
  // reinterpretation of the one just shown. Falls into the same empty state
  // (with the priced generate CTA) when none exists yet for this horizon.
  function selectHorizon(next: UiHorizon) {
    if (next === horizon) return
    setLive(false)
    setHorizon(next)
    setCard(null)
    setError(null)
    if (!selectedInstrument) return
    setLoading(true)
    void loadCard(selectedInstrument, next)
  }

  if (categories === null) return <PanelMessage text={t.hub.loading} />
  if (categories.length === 0) return <PanelMessage text={t.hub.noInstruments} />

  const active = categories.find((c) => c.id === selectedCategory) ?? null

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => selectCategory(c.id)}
            aria-current={selectedCategory === c.id}
            className={categoryChipClass(c.tone, selectedCategory === c.id)}
          >
            {t.catalog.categories[c.id]}
          </button>
        ))}
      </div>

      {active?.kind === 'coming_soon' ? (
        <ComingSoonPanel categoryId={active.id} />
      ) : null}

      {active?.kind === 'instruments' ? (
        <div className="flex flex-wrap gap-1.5">
          {active.instruments.map((i) => {
            const selected = selectedInstrument === i.instrument
            return (
              <button
                key={i.instrument}
                type="button"
                onClick={() => selectInstrument(i.instrument)}
                aria-current={selected}
                className={`rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${
                  selected ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 shadow-sm hover:bg-slate-100'
                }`}
              >
                <span className="block text-sm">{instrumentLabel(t, i.instrument)}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {active?.kind === 'instruments' ? (
        <div className="flex gap-1.5" role="group" aria-label="Horizon">
          {UI_HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => selectHorizon(h)}
              aria-current={horizon === h}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                horizon === h ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 shadow-sm hover:bg-slate-100'
              }`}
            >
              {t.catalog.horizons[h]}
            </button>
          ))}
        </div>
      ) : null}

      {active?.kind === 'instruments' && loading ? <PanelMessage text={t.hub.loading} /> : null}
      {active?.kind === 'instruments' && !loading && error === 'jurisdiction_blocked' ? (
        <PanelMessage text={t.gating.unavailable} />
      ) : null}
      {active?.kind === 'instruments' && !loading && error === 'no_round' ? (
        <EmptyInstrumentState
          instrument={selectedInstrument}
          horizon={horizon}
          onOpened={() => {
            if (selectedInstrument) {
              setError(null)
              setLoading(true)
              void loadCard(selectedInstrument, horizon)
            }
          }}
        />
      ) : null}
      {active?.kind === 'instruments' && !loading && error === 'load_failed' ? (
        <PanelMessage text={t.hub.genericError} tone="error" />
      ) : null}

      {active?.kind === 'instruments' && !loading && !error && card ? (
        <>
          <PredictionCard key={card.round.round_id} initialData={card} live={live} />
          <DeepAnalysis
            roundId={card.round.round_id}
            category={card.round.category}
            colorBucket={card.round.color_bucket}
          />
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

/**
 * Generate currently lives BELOW an already-loaded PredictionCard
 * (`!loading && !error && card`). That gate is why VNQ (and any instrument
 * with no ranked round) was a dead end: the empty state replaced the card
 * block, so the paid button never rendered. The button here is the same
 * CTA (`hub.generateLive`) and hits the same endpoint with
 * `{ instrument, horizon }`, which opens the currently-open catalog-defined
 * ranked round FOR THAT HORIZON when none exists.
 */
function EmptyInstrumentState({
  instrument,
  horizon,
  onOpened,
}: {
  instrument: string | null
  horizon: UiHorizon
  onOpened: () => void
}) {
  const { t } = useLeagueLocale()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function startGenerate() {
    if (!instrument || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/league/generate-stream', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrument, horizon }),
      })
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as
          | { balance?: number; required?: number }
          | null
        if (res.status === 402) {
          setNotice(t.hub.insufficientCredits(detail?.required ?? LIVE_COST, detail?.balance ?? 0))
        } else if (res.status === 429) {
          setNotice(t.hub.rateLimited)
        } else if (res.status === 403) {
          setNotice(t.gating.unavailable)
        } else {
          setNotice(t.hub.genericError)
        }
        return
      }
      if (!res.body) {
        setNotice(t.hub.genericError)
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let opened = false
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          let msg: { type?: string } | null = null
          try {
            msg = JSON.parse(line) as { type?: string }
          } catch {
            continue
          }
          if ((msg?.type === 'round' || msg?.type === 'done') && !opened) {
            opened = true
            onOpened()
          }
          if (msg?.type === 'error' && !opened) {
            setNotice(t.hub.genericError)
          }
        }
      }
      if (!opened) onOpened()
    } catch {
      setNotice(t.hub.genericError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center">
      <p className="text-sm font-semibold text-slate-800">{t.catalog.noCardYet}</p>
      <button
        type="button"
        disabled={busy || !instrument}
        onClick={() => void startGenerate()}
        className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50 md:max-w-sm"
      >
        {busy ? t.hub.generating : t.hub.generateLive(LIVE_COST)}
      </button>
      {notice ? <p className="mt-3 text-xs text-rose-700">{notice}</p> : null}
    </div>
  )
}

function ComingSoonPanel({ categoryId }: { categoryId: PublicCategoryId }) {
  const { t } = useLeagueLocale()
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center">
      <p className="text-sm font-semibold text-slate-800">{t.catalog.comingSoon}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{t.catalog.comingSoonHint}</p>
      {categoryId === 'macro_econ' ? (
        <p className="mt-2 text-xs leading-relaxed text-slate-600">{t.catalog.macroEconHint}</p>
      ) : null}
    </div>
  )
}

function instrumentLabel(t: { catalog: { instruments: Record<string, string> } }, instrument: string): string {
  return t.catalog.instruments[instrument] ?? instrument
}

function categoryChipClass(tone: ColorBucket, selected: boolean): string {
  const base = 'shrink-0 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-semibold transition min-h-[44px]'
  if (tone === 'green') {
    return selected ? `${base} bg-emerald-600 text-white` : `${base} bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100`
  }
  if (tone === 'yellow') {
    return selected ? `${base} bg-amber-500 text-white` : `${base} bg-amber-50 text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100`
  }
  return selected ? `${base} bg-rose-600 text-white` : `${base} bg-rose-50 text-rose-800 ring-1 ring-rose-200 hover:bg-rose-100`
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
        const res = await fetch('/api/league/record-room?page=1&pageSize=5', { credentials: 'include' })
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
